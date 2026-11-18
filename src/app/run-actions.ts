import { InferenceError } from "../inference/errors.ts";
import type { InferenceResult, InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import { runRealityCheck } from "../verification/reality-check.ts";
import { acceptProposal, buildDisclosureDraft, type PreparedTwin } from "../workflow/pipeline.ts";
import type { ProposalState, WorkspaceState } from "./workspace-state.ts";
import { isIntentPlanRequest, isRankedPlanRequest } from "../inference/intent-prompt.ts";
import { effectiveLocalPolicy } from "../inference/cloud-models.ts";
import { localCandidatesForDestination } from "../matching/destination-candidates.ts";
import { acceptCompiledPlan, compileIntentPlan, type CompileInput } from "../plan/compile.ts";
import type { CompiledIntegration, PlanAnswers, PlanIssue } from "../plan/types.ts";
import { parseIntentPlanText, validateIntentPlan } from "../plan/validate.ts";

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
  // Sprint 18B (ADR 0018): an answer to an intent-plan request is a plan, never a Mapping Proposal.
  if (isIntentPlanRequest(review.preview.outboundPrompt)) return evaluatePlan(workspace, prepared, review, input);
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
    // Sprint 14: lets the guided view count rejected answers per identical request (a hash, never content).
    payloadHash: review.preview.payloadHash,
    code: result.ok ? undefined : result.issues[0]?.code,
  });
  if (result.ok || result.stage === "resolve") {
    recordWorkflowEvent({ kind: "alias-resolve", ok: result.ok, code: result.ok ? undefined : result.issues[0]?.code, payloadHash: review.preview.payloadHash });
  }
  return { origin: input.origin, text: input.text, provenance: input.provenance, requestId: input.requestId, result };
}

/**
 * Sprint 18D: local candidate evidence and the question policy, or undefined
 * (the Sprint 18C behaviour) unless a dev harness selected a policy. Local only.
 */
function withLocalEvidence(workspace: WorkspaceState, prepared: PreparedTwin): Pick<CompileInput, "local"> {
  const policy = effectiveLocalPolicy();
  if (!policy) return {};
  let schema: unknown;
  try {
    schema = JSON.parse(workspace.destinationText);
  } catch {
    return {};
  }
  return { local: { localCandidates: localCandidatesForDestination(schema, prepared, workspace.source?.records ?? []), ...policy } };
}

/** The user's answers held in the workspace (the guided decision maps). Local only. */
function planAnswers(workspace: WorkspaceState): PlanAnswers {
  return { fieldMatches: workspace.fieldMatches, categoryMeanings: workspace.categoryMeanings, semanticConfirmations: workspace.semanticConfirmations };
}

/** Counts of a compiled plan for the workflow log (numbers only, never names). */
function planCounts(compiled: CompiledIntegration): Record<string, number> {
  const { fields, executable, byGemini, byUser, needsClarification, unsupported, noSource } = compiled.counts;
  return { fields, executable, byGemini, byUser, needsClarification, unsupported, noSource, unwrittenRequired: compiled.unwrittenRequired.length };
}

/**
 * Sprint 18B (ADR 0018): parse, validate and compile an Integration Intent
 * Plan answer, with the user's current answers. A whole-plan rejection (or a
 * plan answered for a different twin) is a `stage: "plan"` refusal with no
 * receipt. Workflow events carry codes, counts and hashes only.
 */
function evaluatePlan(
  workspace: WorkspaceState,
  prepared: PreparedTwin,
  review: NonNullable<WorkspaceState["review"]>,
  input: { structured: unknown; text: string; origin: ProposalOrigin; requestId: string; provenance: ProposalState["provenance"] },
): ProposalState {
  const started = performance.now();
  const disclosure = review.preview.payload;
  const refuse = (issues: PlanIssue[]): ProposalState => {
    recordWorkflowEvent({ kind: "proposal-validate", ok: false, durationMs: performance.now() - started, payloadHash: review.preview.payloadHash, code: issues[0]?.code ?? "PLAN_REJECTED" });
    return { origin: input.origin, text: input.text, provenance: input.provenance, requestId: input.requestId, result: { ok: false, stage: "plan", issues }, plan: null };
  };
  let raw = input.structured;
  if (raw === undefined) {
    const parsed = parseIntentPlanText(input.text);
    if (!parsed.ok) return refuse(parsed.issues);
    raw = parsed.value;
  }
  if (disclosure.phantomId !== prepared.twin.phantom.phantomId) {
    return refuse([{ code: "DISCLOSURE_MISSING_TARGET", message: "The approved disclosure belongs to a different Phantom Twin. Regenerate and re-approve." }]);
  }
  const validation = validateIntentPlan(raw, disclosure, { ranked: isRankedPlanRequest(review.preview.outboundPrompt) });
  if (!validation.ok) return refuse(validation.issues);
  const compileInput: CompileInput = {
    validated: validation.value,
    disclosure,
    prepared,
    records: workspace.source?.records ?? [],
    answers: planAnswers(workspace),
    requestId: input.requestId,
    origin: input.origin,
    ...withLocalEvidence(workspace, prepared),
  };
  const compiled = compileIntentPlan(compileInput);
  const result = acceptCompiledPlan(compiled, compileInput);
  recordWorkflowEvent({
    kind: "proposal-validate",
    ok: result.ok || result.stage === "resolve",
    durationMs: performance.now() - started,
    payloadHash: review.preview.payloadHash,
    code: result.ok ? (compiled.complete ? "PLAN_COMPLETE" : "PLAN_PARTIAL") : result.stage === "plan" ? "PLAN_NOT_EXECUTABLE" : result.issues[0]?.code,
    counts: planCounts(compiled),
  });
  if (result.ok || result.stage === "resolve") {
    recordWorkflowEvent({ kind: "alias-resolve", ok: result.ok, code: result.ok ? undefined : result.issues[0]?.code, payloadHash: review.preview.payloadHash });
  }
  return {
    origin: input.origin,
    text: input.text,
    provenance: input.provenance,
    requestId: input.requestId,
    result,
    plan: { planVersion: validation.value.planVersion, validated: validation.value, compiled },
  };
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

/**
 * Sprint 18B (ADR 0018). OWNER: Worker B. Re-derive `proposal.plan.compiled`
 * and `proposal.result` from the immutable validated plan and the user's
 * current answers (`fieldMatches`, `categoryMeanings`, `semanticConfirmations`).
 * Clears `report` / `mappingRunError` when the compiled contract changed.
 * Never sends, never approves, never touches `review`. Returns the workspace
 * unchanged when the active proposal is not a plan.
 */
export function recompilePlan(workspace: WorkspaceState, prepared: PreparedTwin | null): WorkspaceState {
  const proposal = workspace.proposal;
  const receipt = proposal?.plan;
  const disclosure = workspace.review?.preview.payload;
  if (!proposal || !receipt || !prepared || !disclosure || disclosure.phantomId !== prepared.twin.phantom.phantomId) return workspace;
  const compileInput: CompileInput = {
    validated: receipt.validated,
    disclosure,
    prepared,
    records: workspace.source?.records ?? [],
    answers: planAnswers(workspace),
    requestId: proposal.requestId,
    origin: proposal.origin,
    ...withLocalEvidence(workspace, prepared),
  };
  const compiled = compileIntentPlan(compileInput);
  if (JSON.stringify(compiled) === JSON.stringify(receipt.compiled)) return workspace;
  const result = acceptCompiledPlan(compiled, compileInput);
  const next: WorkspaceState = { ...workspace, proposal: { ...proposal, result, plan: { ...receipt, compiled } } };
  const contractChanged = JSON.stringify(compiled.aliasContract) !== JSON.stringify(receipt.compiled.aliasContract);
  if (!contractChanged) return next;
  recordWorkflowEvent({ kind: "proposal-validate", ok: result.ok || result.stage === "resolve", payloadHash: workspace.review?.preview.payloadHash, code: "PLAN_RECOMPILED", counts: planCounts(compiled) });
  // The last run and any revision were built on the old contract. A hand-written run is not this plan's.
  return {
    ...next,
    ...(workspace.mappingChoice === "proposal" ? { report: null, mappingRunError: null } : {}),
    revision: null,
    revisionConstraintIds: [],
  };
}
