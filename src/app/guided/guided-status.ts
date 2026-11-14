import type { CompletionState } from "../../verification/outcomes.ts";
import { bestCandidate, currentStage, type OutcomeCandidateView, type RuntimeStage } from "../runtime-model.ts";

/**
 * The one prominent status line of the guided flow (Sprint 13, A6).
 *
 * A pure reading of `deriveRuntime` plus the single local operation that is
 * in flight right now (preparing the request or checking the result, which
 * are synchronous-to-short local steps the runtime does not model as
 * "running"). No percentages, no simulated progress, no invented activity:
 * every value maps to a canonical stage status.
 */
export type GuidedStatusId =
  | "idle"
  | "ready-to-build"
  | "preparing"
  | "approval"
  | "rejected"
  | "generating"
  | "checking"
  | "revision-approval"
  | "revision-generating"
  | "ready"
  | "ready-exceptions"
  | "needs-review"
  | "draft"
  | "failed"
  /** Sprint 14: Gemini answered, EYES refused the answer locally; the diagnosis names why. */
  | "not-built"
  | "attention";

export interface GuidedStatus {
  id: GuidedStatusId;
  label: string;
  /** One plain sentence. */
  detail: string;
  tone: "neutral" | "busy" | "approval" | "pass" | "warn" | "fail";
}

export type InFlight = "preparing" | "checking" | null;

/**
 * Sprint 14: plain-language context for a failed stage. Both values are
 * readings of canonical state (the rejected `acceptProposal` result and the
 * classified provider failure); they only choose words, never the status.
 */
export interface FailureContext {
  rejection?: { title: string } | null;
  cloudFailureTitle?: string | null;
}

const VERDICT: Record<CompletionState, GuidedStatus> = {
  VERIFIED: { id: "ready", label: "Integration ready", detail: "Every record passed the local checks.", tone: "pass" },
  VERIFIED_WITH_EXCEPTIONS: { id: "ready-exceptions", label: "Ready, with exceptions", detail: "The mapping passed; some records are set aside for review.", tone: "warn" },
  PARTIALLY_VERIFIED: { id: "draft", label: "Draft — not fully verified", detail: "Some checks did not pass. Review the issues before using it.", tone: "warn" },
  REVISION_FAILED: { id: "failed", label: "Failed", detail: "The revised mapping did not run.", tone: "fail" },
  BLOCKED: { id: "failed", label: "Failed", detail: "There is no mapping that passed the local checks.", tone: "fail" },
};

export function guidedStatus(stages: readonly RuntimeStage[], candidates: readonly OutcomeCandidateView[], inFlight: InFlight, context: FailureContext = {}): GuidedStatus {
  if (inFlight === "preparing") return { id: "preparing", label: "Preparing the integration", detail: "Building the fictional stand-in for your data, on this device.", tone: "busy" };
  if (inFlight === "checking") return { id: "checking", label: "Checking the result", detail: "Running the mapping on your records, on this device.", tone: "busy" };
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const status = (id: RuntimeStage["id"]) => byId.get(id)?.status ?? "not-started";
  const current = currentStage(stages);

  if (status("source-imported") !== "completed") return { id: "idle", label: "Add your data", detail: "Upload a file or connect a source to begin.", tone: "neutral" };
  if (current.status === "awaiting-approval") {
    return current.id === "revision-authorization"
      ? { id: "revision-approval", label: "Your approval is needed", detail: "A second, separate request is ready for review. Nothing has been sent.", tone: "approval" }
      : { id: "approval", label: "Your approval is needed", detail: "Review what would be sent to Gemini. Nothing has been sent.", tone: "approval" };
  }
  if (current.status === "running") {
    return current.id === "revision-inference"
      ? { id: "revision-generating", label: "Generating a revised mapping", detail: "Waiting for Gemini. Your records are not part of this request.", tone: "busy" }
      : { id: "generating", label: "Generating the mapping", detail: "Waiting for Gemini. Your records are not part of this request.", tone: "busy" };
  }
  if (status("authorization") === "blocked") {
    return { id: "rejected", label: "Not sent", detail: "You declined the request. Nothing left this device.", tone: "neutral" };
  }
  if (status("authorization") === "completed" && status("cloud-inference") === "not-started") {
    return { id: "approval", label: "Approved — not sent yet", detail: "Your approval is valid for this one request. Send it when you are ready.", tone: "approval" };
  }
  const outcome = byId.get("outcome");
  if (outcome && outcome.status !== "not-started" && outcome.status !== "skipped") {
    const best = bestCandidate(candidates);
    if (best) return VERDICT[best.eligibility.state];
  }
  const failed = stages.find((stage) => (stage.status === "failed" || stage.status === "blocked") && !stage.optional);
  if (failed?.id === "contract-validated" && context.rejection) {
    return { id: "not-built", label: context.rejection.title, detail: "EYES checked Gemini's answer and stopped before running it on your records.", tone: "fail" };
  }
  if (failed?.id === "cloud-inference" && context.cloudFailureTitle) {
    return { id: "attention", label: context.cloudFailureTitle, detail: "Nothing was run on your records. Your data and destination are kept.", tone: "fail" };
  }
  if (failed) return { id: "attention", label: "The build stopped", detail: failed.next ?? failed.note ?? `${failed.label} did not complete.`, tone: "fail" };
  if (status("disclosure-prepared") === "completed") return { id: "approval", label: "Your approval is needed", detail: "Review what would be sent to Gemini. Nothing has been sent.", tone: "approval" };
  if (status("contract-validated") === "completed" && status("reality-check") === "not-started") {
    return { id: "needs-review", label: "Needs review", detail: "A validated mapping is ready but has not been checked yet.", tone: "warn" };
  }
  return { id: "ready-to-build", label: "Ready to build", detail: "Choose the destination, then build.", tone: "neutral" };
}

/**
 * Sprint 14 (C3): how the fields were understood, in words that never claim
 * on-device AI ran when only deterministic code did. A pure reading of the
 * runtime's optional "on-device" stage plus the local capability probe.
 *
 * - `nano-used`: Gemini Nano ran on this device in this run.
 * - `simulated`: the labeled E2E test adapter ran — never called Gemini Nano.
 * - `nano-failed`: it was started and stopped; the deterministic analysis applies.
 * - `nano-available`: available in this browser, not used (optional).
 * - `nano-unavailable`: not available here; deterministic analysis only.
 * - `checking`: the local capability check has not finished.
 */
export type UnderstandingKind = "nano-used" | "simulated" | "nano-failed" | "nano-available" | "nano-unavailable" | "checking";

export interface FieldUnderstanding {
  kind: UnderstandingKind;
  text: string;
}

export function fieldUnderstanding(stages: readonly RuntimeStage[], probe: "idle" | "checking" | "blocked" | "available"): FieldUnderstanding {
  const stage = stages.find((item) => item.id === "on-device");
  if (stage?.status === "completed" && stage.summary.includes("simulated")) {
    return { kind: "simulated", text: "A simulated on-device test adapter (not Gemini Nano) read your fields. No real on-device AI ran." };
  }
  if (stage?.status === "completed") {
    return { kind: "nano-used", text: "Gemini Nano read your fields on this device. Its suggestions changed the stand-in only where you applied them; nothing it saw was sent." };
  }
  if (stage?.status === "failed") {
    return { kind: "nano-failed", text: "On-device AI was started but stopped. EYES used its own deterministic analysis of your fields." };
  }
  if (probe === "blocked" || stage?.summary.startsWith("unavailable")) {
    return { kind: "nano-unavailable", text: "On-device AI isn't available in this browser. EYES used its own deterministic analysis of your fields — no AI read your records." };
  }
  if (probe === "available") {
    return { kind: "nano-available", text: "On-device AI (Gemini Nano) is available in this browser but was not used. EYES used its own deterministic analysis of your fields." };
  }
  return { kind: "checking", text: "Checking whether on-device AI is available in this browser." };
}
