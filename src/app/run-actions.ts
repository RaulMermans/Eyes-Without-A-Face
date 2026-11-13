import { InferenceError } from "../inference/errors.ts";
import type { InferenceResult, InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import { runRealityCheck } from "../verification/reality-check.ts";
import { acceptProposal, buildDisclosureDraft, type PreparedTwin } from "../workflow/pipeline.ts";
import type { ProposalState, WorkspaceState } from "./workspace-state.ts";

/**
 * The workflow actions shared by the guided flow (Sprint 13) and the
 * technical workbench panels, so each step has exactly one implementation.
 *
 * None of these functions decides FOR the user: `approveReview` is only ever
 * called from the user's approval click, `sendApprovedRequest` only with an
 * approval the user just granted, and the local verification is deterministic
 * code that never leaves this browser.
 */

export function originFor(result: InferenceResult): ProposalOrigin {
  return result.provenance.resultKind === "real-cloud" && !result.provenance.simulated ? "gemini-cloud" : "test-adapter";
}

/** Record the user's approval of the pending preview. Single-use, bound to its payload hash. */
export function approveReview(workspace: WorkspaceState): WorkspaceState {
  const review = workspace.review;
  if (!review || review.status !== "pending") return workspace;
  const approval = approveDisclosurePreview(review.preview);
  recordWorkflowEvent({ kind: "disclosure-approve", ok: true, payloadHash: review.preview.payloadHash });
  return { ...workspace, review: { ...review, approval, status: "approved" } };
}

/** Record the user's rejection. Nothing is sent; a new request needs a new preview. */
export function rejectReview(workspace: WorkspaceState): WorkspaceState {
  const review = workspace.review;
  if (!review) return workspace;
  recordWorkflowEvent({ kind: "disclosure-reject", ok: true, payloadHash: review.preview.payloadHash });
  return { ...workspace, review: { ...review, approval: null, status: "rejected" } };
}

/** Validate a proposal locally: canonical contract, alias resolution. */
export function evaluateProposal(
  workspace: WorkspaceState,
  prepared: PreparedTwin,
  input: { structured: unknown; text: string; origin: ProposalOrigin; requestId: string; provenance: ProposalState["provenance"] },
): ProposalState | null {
  const review = workspace.review;
  if (!review) return null;
  const started = performance.now();
  const result = acceptProposal({
    proposal: input.structured,
    proposalText: input.text,
    disclosure: review.preview.payload,
    twin: prepared.twin,
    origin: input.origin,
    mappingId: `proposal-${input.requestId.slice(0, 8)}`,
  });
  recordWorkflowEvent({
    kind: "proposal-validate",
    ok: result.ok || result.stage === "resolve",
    durationMs: performance.now() - started,
    code: result.ok ? undefined : result.issues[0]?.code,
  });
  if (result.ok || result.stage === "resolve") {
    recordWorkflowEvent({ kind: "alias-resolve", ok: result.ok, code: result.ok ? undefined : result.issues[0]?.code });
  }
  return { origin: input.origin, text: input.text, provenance: input.provenance, requestId: input.requestId, result };
}

/** Mark the approval spent BEFORE the request resolves (single use). */
export function spendApproval(workspace: WorkspaceState): WorkspaceState {
  const review = workspace.review;
  if (!review) return workspace;
  return { ...workspace, review: { ...review, approval: null, status: "sent" }, cloudError: null, proposal: null, report: null };
}

/**
 * Send the approved request through the gate and validate the answer locally.
 * `spent` is the workspace returned by `spendApproval` for the same review;
 * `approval` is the approval taken from the review before it was spent.
 * Never retried, never sent without an approval, never falls back.
 */
export async function sendApprovedRequest(
  spent: WorkspaceState,
  approved: NonNullable<WorkspaceState["review"]>,
  prepared: PreparedTwin,
  inference: InferenceServices,
  isCurrent: () => boolean = () => true,
): Promise<WorkspaceState | null> {
  const preview = approved.preview;
  const approval = approved.approval;
  if (!approval) return { ...spent, cloudError: { code: "NOT_APPROVED", detail: "There is no approval for this request." } };
  const started = performance.now();
  try {
    const result = await submitApprovedCloudInference(inference.cloud, preview, approval, {
      requestId: preview.requestId,
      destinationKey: preview.destinationKey,
      purpose: "mapping-proposal",
    });
    if (!isCurrent()) return null;
    recordWorkflowEvent({ kind: "cloud-proposal", ok: true, durationMs: performance.now() - started, payloadHash: preview.payloadHash, inferenceSource: result.provenance.actualSource });
    const evaluated = evaluateProposal(spent, prepared, {
      structured: result.structured,
      text: result.structured !== undefined ? JSON.stringify(result.structured, null, 2) : result.text,
      origin: originFor(result),
      requestId: preview.requestId,
      provenance: result.provenance,
    });
    return { ...spent, proposal: evaluated, mappingChoice: "proposal" };
  } catch (caught) {
    if (!isCurrent()) return null;
    const code = caught instanceof DisclosureRejectedError ? "DISCLOSURE_REJECTED" : caught instanceof InferenceError ? caught.code : "CLOUD_FAILED";
    // Raw provider text stays local and collapsed; the default view shows guidance only.
    const detail = caught instanceof DisclosureRejectedError ? `${caught.reason}: ${caught.details.join("; ")}` : caught instanceof Error ? caught.message : String(caught);
    recordWorkflowEvent({ kind: "cloud-proposal", ok: false, durationMs: performance.now() - started, payloadHash: preview.payloadHash, code: caught instanceof DisclosureRejectedError ? caught.reason : code });
    return { ...spent, cloudError: { code, detail } };
  }
}

/**
 * Run the active mapping locally against the imported records (and the
 * reserved hidden cases when included). Deterministic; nothing leaves the
 * browser.
 */
export function runLocalVerification(workspace: WorkspaceState, prepared: PreparedTwin | null, includeReserved = true): WorkspaceState {
  if (!workspace.source) {
    return { ...workspace, mappingRunError: "Import a source dataset before running the local mapping engine.", report: null };
  }
  const accepted = workspace.proposal?.result.ok ? workspace.proposal.result.value : null;
  const useProposal = Boolean(accepted) && workspace.mappingChoice === "proposal";
  let mapping: unknown;
  if (useProposal && accepted) {
    mapping = accepted.resolved.executable;
  } else {
    try {
      mapping = JSON.parse(workspace.mappingText) as unknown;
    } catch {
      return { ...workspace, mappingRunError: "Mapping contract is not valid JSON.", report: null };
    }
  }
  let targetSchema: unknown;
  try {
    targetSchema = JSON.parse(workspace.destinationText) as unknown;
  } catch {
    return { ...workspace, mappingRunError: "Destination schema is not valid JSON.", report: null };
  }
  const reserved = workspace.reservedRecords;
  const report = runRealityCheck({
    records: workspace.source.records,
    reservedRecords: includeReserved && reserved ? reserved : [],
    mappingContract: mapping,
    targetSchema,
    bindings: useProposal ? (prepared?.twin.bindings ?? null) : null,
  });
  recordWorkflowEvent({
    kind: "reality-check",
    ok: report.overall === "pass",
    durationMs: report.durationMs,
    code: report.failureCodes[0]?.code,
    counts: { total: report.total, passed: report.passed, failed: report.failed, reserved: report.reservedTotal },
  });
  return { ...workspace, report, mappingRunError: null };
}

/** Stop waiting: the approval stays consumed; a late answer is discarded. */
export function cancelWaiting(workspace: WorkspaceState): WorkspaceState {
  const review = workspace.review;
  if (!review) return workspace;
  recordWorkflowEvent({ kind: "cloud-proposal", ok: false, payloadHash: review.preview.payloadHash, code: "CANCELLED" });
  return {
    ...workspace,
    review: { ...review, approval: null, status: "sent" },
    proposal: null,
    report: null,
    cloudError: { code: "CANCELLED", detail: "Stopped by the user while waiting for the provider." },
  };
}

/**
 * Explicit recovery: rebuild the same reviewed disclosure as a NEW preview
 * with a new request id. It must be approved again. The consumed approval is
 * never reused; nothing is sent here.
 */
export async function prepareFreshReview(workspace: WorkspaceState, prepared: PreparedTwin): Promise<{ ok: true; workspace: WorkspaceState } | { ok: false; message: string }> {
  try {
    const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(workspace.destinationText) as unknown });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const preview = await createDisclosurePreview(draft.value.payload);
    recordWorkflowEvent({ kind: "cloud-recovery", ok: true, payloadHash: preview.payloadHash, code: "FRESH_REQUEST" });
    return { ok: true, workspace: { ...workspace, review: { preview, approval: null, status: "pending" }, proposal: null, cloudError: null, report: null, revision: null } };
  } catch (caught) {
    recordWorkflowEvent({ kind: "cloud-recovery", ok: false, code: "FRESH_REQUEST_FAILED" });
    return { ok: false, message: caught instanceof Error ? caught.message : String(caught) };
  }
}
