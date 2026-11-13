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
  | "attention";

export interface GuidedStatus {
  id: GuidedStatusId;
  label: string;
  /** One plain sentence. */
  detail: string;
  tone: "neutral" | "busy" | "approval" | "pass" | "warn" | "fail";
}

export type InFlight = "preparing" | "checking" | null;

const VERDICT: Record<CompletionState, GuidedStatus> = {
  VERIFIED: { id: "ready", label: "Integration ready", detail: "Every record passed the local checks.", tone: "pass" },
  VERIFIED_WITH_EXCEPTIONS: { id: "ready-exceptions", label: "Ready, with exceptions", detail: "The mapping passed; some records are set aside for review.", tone: "warn" },
  PARTIALLY_VERIFIED: { id: "draft", label: "Draft — not fully verified", detail: "Some checks did not pass. Review the issues before using it.", tone: "warn" },
  REVISION_FAILED: { id: "failed", label: "Failed", detail: "The revised mapping did not run.", tone: "fail" },
  BLOCKED: { id: "failed", label: "Failed", detail: "There is no mapping that passed the local checks.", tone: "fail" },
};

export function guidedStatus(stages: readonly RuntimeStage[], candidates: readonly OutcomeCandidateView[], inFlight: InFlight): GuidedStatus {
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
  if (failed) return { id: "attention", label: "Needs your attention", detail: failed.next ?? failed.note ?? `${failed.label} did not complete.`, tone: "fail" };
  if (status("disclosure-prepared") === "completed") return { id: "approval", label: "Your approval is needed", detail: "Review what would be sent to Gemini. Nothing has been sent.", tone: "approval" };
  if (status("contract-validated") === "completed" && status("reality-check") === "not-started") {
    return { id: "needs-review", label: "Needs review", detail: "A validated mapping is ready but has not been checked yet.", tone: "warn" };
  }
  return { id: "ready-to-build", label: "Ready to build", detail: "Choose the destination, then build.", tone: "neutral" };
}
