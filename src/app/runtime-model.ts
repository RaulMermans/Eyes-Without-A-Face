/**
 * Live Intelligence Runtime — presentation model (Sprint 10, ADR 0011).
 *
 * A PURE derivation from canonical state:
 *   - WorkspaceState (source, review, proposal, report, revision…)
 *   - the prepared twin (profile + twin, derived from the source)
 *   - the safe in-memory workflow log (codes, counts, durations, hashes)
 *   - adapter availability and the local evaluators' results
 *
 * It records nothing, sends nothing and owns no state. A stage is shown as
 * `completed` only when the state that proves it exists; optional stages that
 * did not run are `skipped` with a reason; upstream invalidation clears the
 * state these functions read, so dependent stages revert automatically.
 *
 * Never put record values, field names, prompts, rationales or engine messages
 * in any string produced here: only counts, codes, durations and labels.
 */
import type { ProfileIssue } from "../domain/profile/profile.ts";
import type { ExportEligibility } from "../export/eligibility.ts";
import type { WorkflowEvent } from "../observability/workflow-log.ts";
import type { TwinIssue } from "../phantom/generate.ts";
import { REVISION_VERDICT_TEXT } from "../revision/decision.ts";
import type { SemanticReport, SemanticStatus } from "../semantics/verify.ts";
import type { CompletionState } from "../verification/outcomes.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkflowStepId } from "./workflow.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export type RuntimeStatus =
  | "not-started"
  | "running"
  | "completed"
  | "awaiting-approval"
  | "blocked"
  | "failed"
  | "skipped"
  | "requires-review";

/** Where a stage executes. `approval` is the user at the privacy boundary. */
export type RuntimeZone = "local" | "on-device" | "approval" | "cloud";

export type RuntimeStageId =
  | "source-imported"
  | "source-profiled"
  | "on-device"
  | "twin"
  | "disclosure-prepared"
  | "authorization"
  | "cloud-inference"
  | "mapping-proposed"
  | "contract-validated"
  | "reality-check"
  | "semantic"
  | "revision-prepared"
  | "revision-authorization"
  | "revision-inference"
  | "revision-evaluated"
  | "outcome"
  | "export";

export interface RuntimeStage {
  id: RuntimeStageId;
  number: number;
  label: string;
  zone: RuntimeZone;
  status: RuntimeStatus;
  /** One short, safe line: counts, codes, provenance. */
  summary: string;
  /** What this stage does (static). */
  purpose: string;
  /** Component or model responsible. */
  responsible: string;
  /** Category of input it reads (never values). */
  input: string;
  /** Artifact it produces. */
  output: string;
  /** Whether the output has been validated, in words. */
  validation: string;
  durationMs: number | null;
  /** Remaining uncertainty, error or reason for skip/block. */
  note: string | null;
  /** What the user can do next, if anything. */
  next: string | null;
  /** Workbench stage that holds the controls. "outcome" opens OUTCOME. */
  target: WorkflowStepId | "outcome";
  optional: boolean;
}

export interface OutcomeCandidateView {
  id: "active" | "revised";
  label: string;
  eligibility: ExportEligibility;
}

export interface RuntimeInput {
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  profileIssues: readonly ProfileIssue[];
  twinIssues: readonly TwinIssue[];
  /** Safe workflow events of THIS run (already filtered by the caller). */
  events: readonly WorkflowEvent[];
  onDeviceState: "disabled" | "unconfigured" | "configured";
  /** True when the labeled test adapters are active (results are simulated). */
  simulatedAdapters: boolean;
  semantic: SemanticReport | null;
  candidates: readonly OutcomeCandidateView[];
}

export const STATUS_TEXT: Readonly<Record<RuntimeStatus, string>> = {
  "not-started": "Not started",
  running: "Running",
  completed: "Completed",
  "awaiting-approval": "Awaiting approval",
  blocked: "Blocked",
  failed: "Failed",
  skipped: "Skipped",
  "requires-review": "Requires review",
};

export const ZONE_TEXT: Readonly<Record<RuntimeZone, string>> = {
  local: "This browser · deterministic",
  "on-device": "This browser · on-device AI",
  approval: "You · privacy boundary",
  cloud: "Gemini Cloud · approved data only",
};

const STATE_RANK: Readonly<Record<CompletionState, number>> = {
  VERIFIED: 4,
  VERIFIED_WITH_EXCEPTIONS: 3,
  PARTIALLY_VERIFIED: 2,
  REVISION_FAILED: 1,
  BLOCKED: 0,
};

const SEMANTIC_REVIEW: ReadonlySet<SemanticStatus> = new Set(["SEMANTIC_AMBIGUOUS", "SEMANTIC_EVIDENCE_MISSING", "SEMANTIC_UNVERIFIED"]);

const PROBE_ONLY = new Set(["ON_DEVICE_AVAILABLE", "ON_DEVICE_BLOCKED"]);

function plural(count: number, word: string): string {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${/(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`}`;
}

function lastEvent(events: readonly WorkflowEvent[], predicate: (event: WorkflowEvent) => boolean): WorkflowEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && predicate(event)) return event;
  }
  return null;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…`;
}

function originText(origin: string, simulated: boolean | undefined, source: string | undefined): string {
  if (origin === "manual-edit") return "manually edited locally — not model output";
  if (origin === "test-adapter" || simulated) return "simulated test adapter — not Gemini";
  return source === "IN_CLOUD" ? "real Gemini output · IN_CLOUD" : "Gemini output · provenance unverified";
}

/** The candidate with the strongest eligibility, without promoting anything. */
export function bestCandidate(candidates: readonly OutcomeCandidateView[]): OutcomeCandidateView | null {
  let best: OutcomeCandidateView | null = null;
  for (const candidate of candidates) {
    if (!best || STATE_RANK[candidate.eligibility.state] > STATE_RANK[best.eligibility.state]) best = candidate;
  }
  return best;
}

export function deriveRuntime(input: RuntimeInput): RuntimeStage[] {
  const { workspace, prepared, events } = input;
  const source = workspace.source;
  const review = workspace.review;
  const proposal = workspace.proposal;
  const report = workspace.report;
  const manualPath = workspace.mappingChoice === "manual" || (!proposal?.result.ok && Boolean(report));
  const revision = workspace.revision && workspace.revision.initialProposal === proposal ? workspace.revision : null;
  const history = revision?.history ?? [];
  const phase = revision?.phase ?? null;

  const stages: RuntimeStage[] = [];
  const push = (stage: Omit<RuntimeStage, "number">) => stages.push({ ...stage, number: stages.length + 1 });

  // 1 · Source imported
  push({
    id: "source-imported",
    label: "Source imported",
    zone: "local",
    status: source ? "completed" : workspace.sourceError ? "failed" : "not-started",
    summary: source ? `${plural(source.records.length, "record")}${workspace.reservedRecords ? ` · ${plural(workspace.reservedRecords.length, "reserved hidden case")}` : ""}` : workspace.sourceError ? "the file could not be read as JSON records" : "no source yet",
    purpose: "Reads your JSON records into this browser tab. Nothing is uploaded or stored.",
    responsible: "Source import (local parser)",
    input: "Your private JSON records",
    output: "In-memory dataset",
    validation: source ? "Parsed as an array of records" : "—",
    durationMs: null,
    note: workspace.sourceError ? "Import failed. Check the file is an array of records or { \"records\": [...] }." : null,
    next: source ? null : "Choose the fictional CRM demo or import a JSON file in Connect.",
    target: "source",
    optional: false,
  });

  // 2 · Source profiled
  const profileBlocked = input.profileIssues.some((issue) => issue.severity === "error");
  push({
    id: "source-profiled",
    label: "Source profiled",
    zone: "local",
    status: prepared ? "completed" : profileBlocked ? "failed" : "not-started",
    summary: prepared ? `${plural(prepared.profile.fields.length, "field")} typed · ${plural(prepared.profile.recordCount, "record")}` : profileBlocked ? `${plural(input.profileIssues.length, "issue")} block profiling` : "waiting for a source",
    purpose: "Infers each field's type, format, optionality and categories with deterministic code. No model reads the records here.",
    responsible: "Deterministic profiler (src/domain/profile)",
    input: "Your private records",
    output: "Source profile (local only)",
    validation: prepared ? "Deterministic; no model involved" : "—",
    durationMs: prepared ? prepared.profileMs : null,
    note: profileBlocked ? "The profile could not be built. Open the Source stage for the issues." : null,
    next: null,
    target: "source",
    optional: false,
  });

  // 3 · On-device interpretation (optional, user-started)
  const nano = lastEvent(events, (event) => event.kind === "on-device-probe" && !PROBE_ONLY.has(event.code ?? ""));
  const nanoAvailable = input.onDeviceState === "configured" || input.simulatedAdapters;
  let nanoStatus: RuntimeStatus;
  let nanoSummary: string;
  let nanoNote: string | null = null;
  let nanoNext: string | null = null;
  if (nano) {
    nanoStatus = nano.ok ? "completed" : "failed";
    nanoSummary = nano.ok
      ? `${input.simulatedAdapters ? "simulated test adapter" : "Gemini Nano · ONLY_ON_DEVICE"} · ${plural(nano.counts?.fields ?? 0, "field")} interpreted`
      : `stopped · ${nano.code ?? "FAILED"}`;
    nanoNote = nano.ok
      ? "Suggestions are validated against the deterministic profile and change the twin only when you apply them."
      : "Nothing was sent to the cloud; the deterministic profile still applies. One user-started retry is allowed.";
  } else if (lastEvent(events, (event) => event.kind === "on-device-probe" && PROBE_ONLY.has(event.code ?? ""))?.code === "ON_DEVICE_BLOCKED") {
    nanoStatus = "skipped";
    nanoSummary = "unavailable · the local capability check failed in this browser";
    nanoNote = "This session is not hybrid: no on-device model ran. Profiling and the twin are deterministic and still complete.";
  } else if (!nanoAvailable) {
    nanoStatus = "skipped";
    nanoSummary = input.onDeviceState === "disabled" ? "unavailable · on-device inference is turned off" : "unavailable · Firebase is not configured";
    nanoNote = "This session is not hybrid: no on-device model ran. Profiling and the twin are deterministic and still complete.";
  } else if (review || proposal || report) {
    nanoStatus = "skipped";
    nanoSummary = "optional · not run";
    nanoNote = "The twin was built from the deterministic profile only.";
  } else {
    nanoStatus = "not-started";
    nanoSummary = "optional · starts only when you ask";
    nanoNext = "Open the Phantom Twin stage to let Gemini Nano interpret fields on this device.";
  }
  push({
    id: "on-device",
    label: "On-device interpretation",
    zone: "on-device",
    status: prepared ? nanoStatus : "not-started",
    summary: prepared ? nanoSummary : "waiting for a profile",
    purpose: "Gemini Nano may read bounded private context on this device to suggest field roles. It never leaves the browser.",
    responsible: input.simulatedAdapters ? "Simulated on-device test adapter (not Gemini Nano)" : "Gemini Nano via Firebase AI Logic · ONLY_ON_DEVICE",
    input: "Bounded private context of individual fields",
    output: "Field-role suggestions (not applied automatically)",
    validation: "Checked against the deterministic profile before you can apply it",
    durationMs: nano?.durationMs ?? null,
    note: prepared ? nanoNote : null,
    next: prepared ? nanoNext : null,
    target: "phantom",
    optional: true,
  });

  // 4 · Phantom Twin generated
  const twinFailed = !prepared && input.twinIssues.length > 0;
  const twin = prepared?.twin ?? null;
  push({
    id: "twin",
    label: "Phantom Twin generated",
    zone: "local",
    status: twin ? (input.twinIssues.length > 0 ? "requires-review" : "completed") : twinFailed ? "failed" : "not-started",
    summary: twin ? `${plural(twin.fields.length, "alias")} · ${twin.fields.filter((field) => field.shareable).length} offered · seed ${twin.seed}` : twinFailed ? "generation failed" : "waiting for a profile",
    purpose: "Replaces every private field with an alias (f_NN) and fictional example values. Alias bindings stay in this browser.",
    responsible: "Phantom Twin generator (seeded, deterministic)",
    input: "Source profile and your field decisions",
    output: "Phantom Contract + private alias bindings",
    validation: twin ? "Checked for private-value leaks before any disclosure" : "—",
    durationMs: prepared ? prepared.twinMs : null,
    note: input.twinIssues.length > 0 ? "Some field descriptors were rejected and left out. Review them on the Phantom Twin stage." : null,
    next: null,
    target: "phantom",
    optional: false,
  });

  // 5 · Cloud disclosure prepared
  const previewFailed = lastEvent(events, (event) => event.kind === "disclosure-preview");
  const payload = review?.preview.payload ?? null;
  push({
    id: "disclosure-prepared",
    label: "Cloud disclosure prepared",
    zone: "local",
    status: review ? "completed" : previewFailed && !previewFailed.ok && prepared ? "failed" : "not-started",
    summary: payload
      ? `${plural(payload.fields.length, "alias")} · ${plural(payload.syntheticExamples.length, "fictional row")} · ${plural(payload.target?.fields.length ?? 0, "destination field")} · sha ${shortHash(review!.preview.payloadHash)}`
      : previewFailed && !previewFailed.ok && prepared
        ? `refused · ${previewFailed.code ?? "DRAFT_INVALID"}`
        : "not prepared",
    purpose: "Projects the twin through an allowlist into the exact request Gemini would receive, and hashes it. Nothing is sent.",
    responsible: "Disclosure projection + SHA-256 binding",
    input: "Phantom Twin (aliases, fictional rows) and the destination's field description",
    output: "Exact outbound prompt and its hash",
    validation: review ? "Private-value leak scan passed" : "—",
    durationMs: review ? (lastEvent(events, (event) => event.kind === "disclosure-preview" && event.ok)?.durationMs ?? null) : null,
    note: previewFailed && !previewFailed.ok && !review && prepared ? "The request was refused locally before anything could be approved. Open Disclosure Review for the reason." : null,
    next: !review && prepared ? "Build the disclosure (Build Integration does this for you)." : null,
    target: "review",
    optional: false,
  });

  // 6 · Awaiting authorization
  let authStatus: RuntimeStatus = "not-started";
  let authSummary = "no request to approve";
  if (review?.status === "pending") {
    authStatus = "awaiting-approval";
    authSummary = "waiting for you · nothing has been sent";
  } else if (review?.status === "approved") {
    authStatus = "completed";
    authSummary = "approved · valid for one request";
  } else if (review?.status === "sent") {
    authStatus = "completed";
    authSummary = "approved · used for one request";
  } else if (review?.status === "rejected") {
    authStatus = "blocked";
    authSummary = "rejected · nothing approved";
  }
  push({
    id: "authorization",
    label: "Your authorization",
    zone: "approval",
    status: authStatus,
    summary: authSummary,
    purpose: "You read exactly what Gemini will and will not receive, then approve or reject. Approval is single-use and bound to the prompt's SHA-256.",
    responsible: "You · single-use authorization gate",
    input: "The prepared disclosure",
    output: "One approval for one request",
    validation: "Any upstream change clears it",
    durationMs: null,
    note: review?.status === "rejected" ? "Nothing will be sent. Change the twin or destination and prepare a new request, or use a hand-written contract." : null,
    next: review?.status === "pending" ? "Review what crosses the boundary and decide." : null,
    target: "review",
    optional: false,
  });

  // 7 · Gemini Cloud inference
  const cloudEvent = lastEvent(events, (event) => event.kind === "cloud-proposal");
  let cloudStatus: RuntimeStatus = "not-started";
  let cloudSummary = review?.status === "approved" ? "ready · approval valid for one request" : "not requested";
  let cloudNote: string | null = null;
  if (review?.status === "sent") {
    if (proposal) {
      cloudStatus = "completed";
      cloudSummary = originText(proposal.origin, proposal.provenance?.simulated, proposal.provenance?.actualSource);
      if (proposal.provenance && proposal.provenance.actualSource !== "IN_CLOUD" && !proposal.provenance.simulated && proposal.origin === "gemini-cloud") {
        cloudNote = "The SDK did not report where inference ran (PROVENANCE_UNVERIFIED).";
      }
    } else if (workspace.cloudError) {
      cloudStatus = "failed";
      cloudSummary = `no proposal · ${workspace.cloudError.code}`;
      cloudNote = "The approval was used. Recovery is a NEW request that you approve again; nothing is retried automatically.";
    } else {
      cloudStatus = "running";
      cloudSummary = "waiting for Gemini · up to 45 s";
    }
  } else if (manualPath && report && !proposal) {
    cloudStatus = "skipped";
    cloudSummary = "not used · hand-written contract";
  }
  push({
    id: "cloud-inference",
    label: "Gemini Cloud inference",
    zone: "cloud",
    status: cloudStatus,
    summary: cloudSummary,
    purpose: "Gemini receives the approved request only (aliases, fictional rows, destination field description) and proposes declarative operations.",
    responsible: input.simulatedAdapters ? "Simulated cloud test adapter (no network, not Gemini)" : "Gemini via Firebase AI Logic · ONLY_IN_CLOUD",
    input: "The approved request — no records, no field names",
    output: "Mapping proposal text",
    validation: "Not trusted until converted and validated locally",
    durationMs: proposal?.provenance?.durationMs ?? (cloudEvent?.durationMs ?? null),
    note: cloudNote,
    next: review?.status === "approved" ? "Send the approved request." : workspace.cloudError ? "Prepare a fresh request and approve it again." : null,
    target: "mapping",
    optional: false,
  });

  // 8 · Mapping proposed
  push({
    id: "mapping-proposed",
    label: "Mapping proposed",
    zone: "local",
    status: proposal ? "completed" : workspace.cloudError ? "blocked" : cloudStatus === "skipped" ? "skipped" : "not-started",
    summary: proposal ? originText(proposal.origin, proposal.provenance?.simulated, proposal.provenance?.actualSource) : workspace.cloudError ? "no proposal returned" : cloudStatus === "skipped" ? "not used" : "no proposal yet",
    purpose: "The text Gemini returned, received into this browser and labeled by origin.",
    responsible: "Proposal intake",
    input: "Model response",
    output: "Proposal (alias-level)",
    validation: "Pending conversion",
    durationMs: null,
    note: null,
    next: null,
    target: "mapping",
    optional: false,
  });

  // 9 · Contract validated
  const result = proposal?.result ?? null;
  push({
    id: "contract-validated",
    label: "Contract validated",
    zone: "local",
    status: result ? (result.ok ? "completed" : "failed") : cloudStatus === "skipped" ? "skipped" : "not-started",
    summary: result
      ? result.ok
        ? `${plural(result.value.converted.contract.operations.length, "operation")} · aliases resolved locally`
        : `rejected at ${result.stage} · ${plural(result.issues.length, "issue")} · not repaired`
      : cloudStatus === "skipped"
        ? "not used"
        : "nothing to validate",
    purpose: "Converts the proposal into the canonical Mapping Contract (eight allowlisted operations), then resolves aliases to private fields inside this page.",
    responsible: "convertProposal + resolveAliases",
    input: "Proposal, approved disclosure, private bindings",
    output: "Executable mapping (local only)",
    validation: result?.ok ? "Schema-valid contract; every alias was approved" : result ? "Invalid output is never repaired" : "—",
    durationMs: null,
    note: result && !result.ok ? "Inspect the issues in the Cloud Mapping stage. A local edit or a fresh, re-approved request are the ways forward." : null,
    next: result && !result.ok ? "Inspect the rejected proposal." : null,
    target: "mapping",
    optional: false,
  });

  // 10 · Local Reality Check
  push({
    id: "reality-check",
    label: "Local Reality Check",
    zone: "local",
    status: report ? (report.overall === "pass" ? "completed" : "requires-review") : workspace.mappingRunError ? "failed" : "not-started",
    summary: report
      ? `${report.passed}/${report.total} records ran clean${report.reservedTotal > 0 ? ` · ${report.reservedTotal} hidden cases included` : ""}`
      : workspace.mappingRunError
        ? "could not run"
        : "not run",
    purpose: "Runs the mapping on every private record plus reserved hidden cases the model never saw, and validates each output against the destination schema.",
    responsible: "Deterministic mapping engine (executeMappingBatch)",
    input: "Private records, hidden cases, executable mapping",
    output: "Reality Check report (findings stay local)",
    validation: report ? "Structure validated; meaning is checked separately" : "—",
    durationMs: report?.durationMs ?? null,
    note: report && report.overall !== "pass" ? `${plural(report.failed, "record")} failed. Failures are findings, not crashes, and are never auto-corrected.` : null,
    next: !report && (proposal?.result.ok || workspace.mappingChoice === "manual") ? "Run the Reality Check." : null,
    target: "verification",
    optional: false,
  });

  // 11 · Semantic verification
  const semantic = input.semantic;
  let semStatus: RuntimeStatus = "not-started";
  if (semantic) {
    // Unknown is never a pass: a clean verdict over partial coverage still needs review.
    semStatus =
      semantic.overall === "SEMANTIC_PASS"
        ? semantic.coverage.unknown > 0
          ? "requires-review"
          : "completed"
        : SEMANTIC_REVIEW.has(semantic.overall)
          ? "requires-review"
          : "failed";
  } else if (report) {
    semStatus = "skipped";
  }
  push({
    id: "semantic",
    label: "Semantic verification",
    zone: "local",
    status: semStatus,
    summary: semantic
      ? `${workspace.revision?.revisedEvaluation ? "initial mapping · " : ""}${semantic.coverage.verified}/${semantic.coverage.fields} fields verified · ${semantic.overall.replace("SEMANTIC_", "").toLowerCase().replace(/_/g, " ")}`
      : report
        ? "not available for this mapping"
        : "not run",
    purpose: "Checks what the output means against trusted local constraints. Unknown is never a pass; schema validity is not correctness.",
    responsible: "Local semantic verifier (Semantic Verification Contract 1.0.0)",
    input: "Outputs and trusted constraints (declared or observed locally)",
    output: "Per-field semantic status",
    validation: "Only trusted evidence counts; model suggestions never do",
    durationMs: null,
    note: semantic && semStatus !== "completed" ? (semStatus === "failed" ? "An output contradicts a trusted constraint." : "Some meaning could not be verified: it is reported as unknown, not as a pass.") : null,
    next: semStatus === "failed" ? "Consider one bounded, approved revision." : null,
    target: "verification",
    optional: false,
  });

  // 12–15 · Blind revision (optional)
  const best = bestCandidate(input.candidates);
  const revisionNotNeeded = !revision && best?.eligibility.state === "VERIFIED";
  const revisionAvailable = !revision && Boolean(report) && Boolean(proposal?.result.ok) && !revisionNotNeeded;
  push({
    id: "revision-prepared",
    label: "Safe revision prepared",
    zone: "local",
    status: revision?.feedback ? "completed" : phase === "REVISION_BLOCKED" ? "blocked" : revisionNotNeeded ? "skipped" : "not-started",
    summary: revision?.feedback
      ? `${plural(revision.feedback.value.findings.length, "finding")} projected · ${plural(revision.feedback.excluded.length, "item")} kept private`
      : phase === "REVISION_BLOCKED"
        ? `stopped · ${revision?.blocked?.code ?? "BLOCKED"}`
        : revisionNotNeeded
          ? "not needed · verified"
          : revisionAvailable
            ? "available · optional"
            : "not prepared",
    purpose: "Projects local findings into allowlisted feedback (no records, no values, no engine messages) for at most one revision request.",
    responsible: "projectRevisionFeedback (local)",
    input: "Reality Check and semantic findings",
    output: "Blind Revision Feedback (preview only)",
    validation: "Privacy screen before preview",
    durationMs: lastEvent(events, (event) => event.kind === "revision-feedback" && event.ok)?.durationMs ?? null,
    note: revisionAvailable ? "The evaluator may suggest a revision; only you can approve one." : null,
    next: revisionAvailable ? "Prepare a safe revision on the Reality Check stage." : null,
    target: "verification",
    optional: true,
  });

  const approvedRevision = history.includes("REVISION_APPROVED");
  push({
    id: "revision-authorization",
    label: "Revision authorization",
    zone: "approval",
    status:
      phase === "REVISION_REVIEW_REQUIRED"
        ? "awaiting-approval"
        : approvedRevision
          ? "completed"
          : phase === "REVISION_BLOCKED" && history.includes("REVISION_REVIEW_REQUIRED")
            ? "blocked"
            : revisionNotNeeded
              ? "skipped"
              : "not-started",
    summary:
      phase === "REVISION_REVIEW_REQUIRED"
        ? "waiting for you · nothing has been sent"
        : approvedRevision
          ? "approved · one request"
          : phase === "REVISION_BLOCKED" && history.includes("REVISION_REVIEW_REQUIRED")
            ? `stopped · ${revision?.blocked?.code ?? "DECLINED"}`
            : revisionNotNeeded
              ? "not needed"
              : "no request",
    purpose: "A fresh, separate approval for the revision request. The first approval never covers it.",
    responsible: "You · single-use authorization gate",
    input: "The revision request preview",
    output: "One approval for one revision request",
    validation: "Budget: one revision per approved disclosure and initial mapping",
    durationMs: null,
    note: null,
    next: phase === "REVISION_REVIEW_REQUIRED" ? "Review what the revision request discloses and decide." : null,
    target: "verification",
    optional: true,
  });

  const revisionEvent = lastEvent(events, (event) => event.kind === "revision-request");
  const revisionSent = history.includes("REVISION_SENT");
  let revStatus: RuntimeStatus = revisionNotNeeded ? "skipped" : "not-started";
  let revSummary = revisionNotNeeded ? "not needed" : "not requested";
  if (phase === "REVISION_SENT") {
    revStatus = "running";
    revSummary = "waiting for Gemini";
  } else if (phase === "REVISION_VALIDATED" || phase === "REVISION_EVALUATED") {
    revStatus = "completed";
    revSummary = revision?.revised ? originText(revision.revised.origin, revision.revised.provenance?.simulated, revision.revised.provenance?.actualSource) : "received";
  } else if (phase === "REVISION_REJECTED") {
    revStatus = "failed";
    revSummary = "revised proposal invalid · not repaired";
  } else if (phase === "REVISION_BLOCKED" && revisionSent) {
    revStatus = "failed";
    revSummary = `no revision · ${revision?.blocked?.failureCode ?? revision?.blocked?.code ?? "FAILED"} · budget spent`;
  }
  push({
    id: "revision-inference",
    label: "Gemini revision request",
    zone: "cloud",
    status: revStatus,
    summary: revSummary,
    purpose: "Gemini receives only the approved feedback and the original approved disclosure, and proposes a revised mapping.",
    responsible: input.simulatedAdapters ? "Simulated cloud test adapter (no network, not Gemini)" : "Gemini via Firebase AI Logic · ONLY_IN_CLOUD",
    input: "Approved feedback — no records, no values",
    output: "Revised mapping proposal",
    validation: "Converted against the original disclosure; never repaired",
    durationMs: revision?.revised?.provenance?.durationMs ?? revisionEvent?.durationMs ?? null,
    note: phase === "REVISION_BLOCKED" && revisionSent ? "A failed revision still uses the budget. The initial mapping stays available with its own status." : null,
    next: null,
    target: "verification",
    optional: true,
  });

  const decision = revision?.decision ?? null;
  push({
    id: "revision-evaluated",
    label: "Revised mapping evaluated",
    zone: "local",
    status: revision?.revisedEvaluation ? (decision?.verdict === "ACCEPTED" ? "completed" : "requires-review") : phase === "REVISION_REJECTED" ? "skipped" : revisionNotNeeded ? "skipped" : "not-started",
    summary: revision?.revisedEvaluation
      ? `${decision ? decision.verdict : "evaluated"} · clean ${decision?.cleanTransformations.before ?? "?"} → ${decision?.cleanTransformations.after ?? "?"} · ${plural(decision?.regressedRows ?? 0, "regression")}`
      : phase === "REVISION_REJECTED"
        ? "nothing to evaluate"
        : revisionNotNeeded
          ? "not needed"
          : phase === "REVISION_VALIDATED"
            ? "ready to run"
            : "not run",
    purpose: "Runs the revised mapping through the same local checks and compares it with the initial one. Never promoted automatically.",
    responsible: "Local evaluator + decideRevision (ground-truth blind)",
    input: "Revised mapping, same records and hidden cases",
    output: "Before/after comparison and a recommendation",
    validation: "Operation-level regressions counted",
    durationMs: revision?.revisedEvaluation?.report.durationMs ?? null,
    note: decision ? REVISION_VERDICT_TEXT[decision.verdict] : null,
    next: phase === "REVISION_VALIDATED" ? "Run the revised Reality Check." : null,
    target: "verification",
    optional: true,
  });

  // 16 · Final outcome
  const outcomeState = best?.eligibility.state ?? null;
  push({
    id: "outcome",
    label: "Final outcome available",
    zone: "local",
    status: !report || !best ? "not-started" : outcomeState === "VERIFIED" || outcomeState === "VERIFIED_WITH_EXCEPTIONS" ? "completed" : outcomeState === "PARTIALLY_VERIFIED" ? "requires-review" : "blocked",
    summary: best && report ? `${best.label} · ${outcomeState!.toLowerCase().replace(/_/g, " ")}` : "no verified evidence yet",
    purpose: "Combines structure, policy outcomes, meaning and any revision decision into one export eligibility. Nothing here claims production readiness.",
    responsible: "exportEligibility (local, deterministic)",
    input: "Reality Check, outcome classes, semantic report, revision decision",
    output: "Outcome and export eligibility",
    validation: "Computed, never asserted",
    durationMs: null,
    note: best?.eligibility.reasons[0] ?? null,
    next: report ? "See the outcome." : null,
    target: "outcome",
    optional: false,
  });

  // 17 · Portable package
  const lastEvidence = lastEvent(events, (event) => event.kind === "reality-check" || event.kind === "revision-evaluate");
  const exportEvent = lastEvent(events, (event) => event.kind === "export-package");
  const exportCurrent = Boolean(report && exportEvent && (!lastEvidence || exportEvent.at >= lastEvidence.at));
  const exportable = best ? best.eligibility.decision !== "BLOCKED" : false;
  push({
    id: "export",
    label: "Portable package",
    zone: "local",
    status: exportCurrent ? (exportEvent!.ok ? "completed" : "failed") : report && !exportable ? "blocked" : "not-started",
    summary: exportCurrent ? (exportEvent!.ok ? `exported · ${exportEvent!.code ?? "package"} · ${plural(exportEvent!.counts?.files ?? 0, "file")}` : `refused · ${exportEvent!.code ?? "FAILED"}`) : report && !exportable ? "not exportable" : "not exported",
    purpose: "Builds a ZIP in this browser: alias-level mapping, destination schema, fictional fixtures, the app's engine and a runner for Node 22. A download, not a deployment.",
    responsible: "buildIntegrationPackage + privacy scan",
    input: "Verified evidence and the alias-level mapping",
    output: "Export Contract 1.1.0 package",
    validation: "Blocking privacy scan; every file SHA-256 pinned",
    durationMs: exportCurrent ? (exportEvent!.durationMs ?? null) : null,
    note: exportCurrent && !exportEvent!.ok ? "The privacy scan or input checks refused the package. See the Outcome for the reason." : null,
    next: report && exportable && !exportCurrent ? "Export the integration from the Outcome." : null,
    target: "outcome",
    optional: false,
  });

  return stages;
}

/** The stage the run is "at": first running/awaiting/failed-blocking stage, else the last that progressed. */
export function currentStage(stages: readonly RuntimeStage[]): RuntimeStage {
  const active = stages.find((stage) => stage.status === "running" || stage.status === "awaiting-approval");
  if (active) return active;
  const failed = stages.find((stage) => (stage.status === "failed" || stage.status === "blocked") && !stage.optional);
  if (failed) return failed;
  let last = stages[0]!;
  for (const stage of stages) {
    if (stage.status !== "not-started" && stage.status !== "skipped") last = stage;
  }
  return last;
}

/** One sentence that explains what the system is doing or waiting for. */
export function runHeadline(stages: readonly RuntimeStage[]): string {
  const stage = currentStage(stages);
  if (stage.status === "awaiting-approval") {
    return stage.id === "authorization" ? "Waiting for your approval of one cloud request." : "Waiting for your approval of one revision request.";
  }
  if (stage.status === "running") return stage.zone === "cloud" ? "Waiting for Gemini. Your records are not part of this request." : `${stage.label} is running.`;
  if (stage.status === "failed" || stage.status === "blocked") return `${stage.label}: ${stage.status === "failed" ? "failed" : "blocked"}. ${stage.next ?? ""}`.trim();
  switch (stage.id) {
    case "source-imported":
      return stage.status === "completed" ? "Source imported locally." : "Connect a source to begin.";
    case "source-profiled":
    case "twin":
    case "on-device":
      return "The Phantom Twin is ready. Prepare the disclosure to continue.";
    case "disclosure-prepared":
      return "The disclosure is prepared. Review it to continue.";
    case "authorization":
      return stage.status === "completed" ? "Approved. Send the request when you are ready." : "Nothing has been sent.";
    case "cloud-inference":
    case "mapping-proposed":
    case "contract-validated":
      return "A validated mapping is ready. Run the Reality Check.";
    case "reality-check":
    case "semantic":
    case "revision-prepared":
    case "revision-authorization":
    case "revision-inference":
    case "revision-evaluated":
      return "Local verification is complete. Review the findings or see the outcome.";
    case "outcome":
      return "The outcome is ready to review and export.";
    case "export":
      return "Integration exported. It runs outside this app with Node 22.";
  }
}

/** Timeline: map safe workflow events to presentation entries. */
export interface TimelineEntry {
  key: string;
  at: string;
  zone: RuntimeZone;
  label: string;
  ok: boolean;
  summary: string;
  durationMs: number | null;
}

const EVENT_LABEL: Readonly<Record<WorkflowEvent["kind"], [RuntimeZone, string]>> = {
  profile: ["local", "Source profiled"],
  "twin-generate": ["local", "Phantom Twin generated"],
  "disclosure-preview": ["local", "Disclosure prepared"],
  "disclosure-approve": ["approval", "You approved one request"],
  "disclosure-reject": ["approval", "You rejected the request"],
  "cloud-proposal": ["cloud", "Gemini mapping request"],
  "proposal-validate": ["local", "Proposal validated"],
  "alias-resolve": ["local", "Aliases resolved locally"],
  "reality-check": ["local", "Reality Check"],
  "on-device-probe": ["on-device", "On-device model"],
  "revision-feedback": ["local", "Revision feedback projected"],
  "revision-request": ["cloud", "Gemini revision request"],
  "revision-evaluate": ["local", "Revised mapping evaluated"],
  "holdout-evaluate": ["local", "Holdout comparison"],
  "semantic-verify": ["local", "Semantic verification"],
  "semantic-feedback": ["local", "Semantic feedback projected"],
  "revision-decision": ["local", "Revision decision"],
  "outcome-compare": ["local", "Outcome comparison"],
  "export-package": ["local", "Package exported"],
  "cloud-recovery": ["local", "Fresh request prepared"],
};

export function timelineEntries(events: readonly WorkflowEvent[]): TimelineEntry[] {
  return events.map((event, index) => {
    const [zone, label] = EVENT_LABEL[event.kind];
    const parts: string[] = [];
    if (event.code) parts.push(event.code);
    if (event.inferenceSource) parts.push(event.inferenceSource);
    if (event.counts) {
      for (const [key, value] of Object.entries(event.counts)) parts.push(`${key} ${value}`);
    }
    if (event.payloadHash) parts.push(`sha ${shortHash(event.payloadHash)}`);
    const approvalLabel = event.kind === "disclosure-approve" && event.code === "REVISION" ? "You approved one revision request" : label;
    // Sprint 11: a capability check that finds no on-device model is a fact about this browser, not a failed step.
    const unavailable = event.kind === "on-device-probe" && event.code === "ON_DEVICE_BLOCKED";
    return {
      key: `${event.at}-${index}`,
      at: event.at,
      zone,
      label: unavailable ? "On-device AI unavailable in this browser" : event.ok ? approvalLabel : `${approvalLabel} — did not succeed`,
      ok: event.ok || unavailable,
      summary: parts.join(" · "),
      durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Sprint 11 — compact presentation helpers. Pure functions of the     */
/* stages above: they group, pick and label; they never add a stage,   */
/* a status or an event.                                               */
/* ------------------------------------------------------------------ */

export type RuntimeGroupId = "understand" | "boundary" | "verify" | "revise" | "deliver";

export interface RuntimeGroup {
  id: RuntimeGroupId;
  label: string;
  /** Where the group's stages run, in words. */
  where: string;
  stageIds: readonly RuntimeStageId[];
}

/** The 17 stages in five phases. Every stage belongs to exactly one group. */
export const RUNTIME_GROUPS: readonly RuntimeGroup[] = [
  { id: "understand", label: "Understand locally", where: "This browser", stageIds: ["source-imported", "source-profiled", "on-device", "twin"] },
  { id: "boundary", label: "Cross the boundary", where: "Your approval · Gemini Cloud", stageIds: ["disclosure-prepared", "authorization", "cloud-inference", "mapping-proposed"] },
  { id: "verify", label: "Verify locally", where: "This browser", stageIds: ["contract-validated", "reality-check", "semantic"] },
  { id: "revise", label: "Blind revision · optional", where: "Your approval · Gemini Cloud · this browser", stageIds: ["revision-prepared", "revision-authorization", "revision-inference", "revision-evaluated"] },
  { id: "deliver", label: "Outcome and export", where: "This browser", stageIds: ["outcome", "export"] },
];

export function groupOf(id: RuntimeStageId): RuntimeGroup {
  return RUNTIME_GROUPS.find((group) => group.stageIds.includes(id)) ?? RUNTIME_GROUPS[0]!;
}

/** Counts per status, in a fixed order, for a group header ("3 completed · 1 skipped"). */
export function groupTally(stages: readonly RuntimeStage[], group: RuntimeGroup): string {
  const members = stages.filter((stage) => group.stageIds.includes(stage.id));
  const order: RuntimeStatus[] = ["failed", "blocked", "awaiting-approval", "running", "requires-review", "completed", "skipped", "not-started"];
  return order
    .map((status) => [status, members.filter((stage) => stage.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${STATUS_TEXT[status].toLowerCase()}`)
    .join(" · ");
}

/** The most recent stage (by order, before the current one) that is `completed`. */
export function lastCompletedStage(stages: readonly RuntimeStage[]): RuntimeStage | null {
  const current = currentStage(stages);
  let last: RuntimeStage | null = null;
  for (const stage of stages) {
    if (stage.status === "completed" && stage.id !== current.id) last = stage;
  }
  return last;
}

/**
 * The next thing the user can do: the current stage's own `next`, otherwise
 * the first later stage that names one. Null when nothing is required.
 */
export function nextStep(stages: readonly RuntimeStage[]): RuntimeStage | null {
  const current = currentStage(stages);
  if (current.next) return current;
  return stages.find((stage) => stage.number > current.number && stage.next !== null && stage.status !== "skipped") ?? null;
}

/** A short verb phrase for the primary action button of a stage's `next`. */
export function actionLabel(stage: RuntimeStage): string {
  switch (stage.id) {
    case "source-imported":
      return "Choose a source";
    case "on-device":
      return "Interpret on-device";
    case "disclosure-prepared":
      return "Prepare the request";
    case "authorization":
      return "Review what crosses the boundary";
    case "cloud-inference":
      return stage.status === "failed" ? "Prepare a fresh request" : "Send the approved request";
    case "contract-validated":
      return "Inspect the rejected proposal";
    case "reality-check":
      return "Run the Reality Check";
    case "semantic":
      return "Review the finding";
    case "revision-prepared":
      return "Prepare a safe revision";
    case "revision-authorization":
      return "Review the revision request";
    case "revision-evaluated":
      return "Run the revised Reality Check";
    case "outcome":
      return "See the outcome";
    case "export":
      return "Export the integration";
    default:
      return "Open the controls";
  }
}

/**
 * The Privacy Boundary Transformation (Sprint 11 signature): four stations
 * and the approval gate between them, each read from stage statuses only.
 *   private source → phantom twin → | approval | → approved cloud reasoning → verified local outcome
 */
export type BoundaryStationState = "pending" | "reached" | "attention" | "failed";
export type BoundaryGateState = "closed" | "awaiting" | "open";

export interface BoundaryState {
  source: BoundaryStationState;
  twin: BoundaryStationState;
  gate: BoundaryGateState;
  cloud: BoundaryStationState;
  outcome: BoundaryStationState;
  /** True when the twin was refined by on-device AI in this run. */
  onDevice: boolean;
}

function station(stage: RuntimeStage | undefined): BoundaryStationState {
  if (!stage) return "pending";
  if (stage.status === "completed") return "reached";
  if (stage.status === "failed" || stage.status === "blocked") return "failed";
  if (stage.status === "requires-review" || stage.status === "running" || stage.status === "awaiting-approval") return "attention";
  return "pending";
}

export function boundaryState(stages: readonly RuntimeStage[]): BoundaryState {
  const byId = (id: RuntimeStageId) => stages.find((stage) => stage.id === id);
  const auth = byId("authorization");
  const revisionAuth = byId("revision-authorization");
  const awaiting = auth?.status === "awaiting-approval" || revisionAuth?.status === "awaiting-approval";
  const cloud = byId("cloud-inference");
  return {
    source: station(byId("source-imported")),
    twin: station(byId("twin")),
    gate: awaiting ? "awaiting" : auth?.status === "completed" ? "open" : "closed",
    cloud: cloud?.status === "running" ? "attention" : station(cloud),
    outcome: station(byId("outcome")),
    onDevice: byId("on-device")?.status === "completed",
  };
}
