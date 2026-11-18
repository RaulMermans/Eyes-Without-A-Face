/**
 * Experience modes (Sprint 10, ADR 0011). UI navigation state only: switching
 * modes never changes or discards workflow state, and never grants approval.
 */
export type ExperienceMode = "connect" | "observe" | "outcome";

export const EXPERIENCE_MODES: ReadonlyArray<{ id: ExperienceMode; label: string; caption: string }> = [
  { id: "connect", label: "Connect", caption: "Source and destination" },
  { id: "observe", label: "Observe", caption: "The hybrid run, live" },
  { id: "outcome", label: "Outcome", caption: "Result and export" },
];

/**
 * Sprint 13 (ADR 0012): two views over ONE workspace state.
 *
 * - "guided" (default): Sprint 18B (ADR 0018 §9) — Connect → Destination →
 *   Generate → Verify → Deliver, shown since Sprint 19 as three stages. The same `WorkspaceState` reordered: the
 *   approval is a moment inside Generate, Gemini's field matches and the
 *   user's few answers live in Verify, downloads in Deliver.
 * - "technical": the Sprint 10/11 CONNECT / OBSERVE / OUTCOME experience with
 *   the full 17-stage runtime and every workbench control.
 *
 * Switching view or step never changes workflow state and never approves.
 */
export type View = "guided" | "technical";

export type GuidedStep = "data" | "destination" | "generate" | "verify" | "deliver";

/**
 * Sprint 19: the five steps are presented as three stages (presentation only; the
 * steps, their order and their gates are unchanged).
 */
export type GuidedStage = 1 | 2 | 3;

export const GUIDED_STAGES: ReadonlyArray<{ stage: GuidedStage; label: string }> = [
  { stage: 1, label: "Add your data" },
  { stage: 2, label: "Build & review" },
  { stage: 3, label: "Check & export" },
];

export const GUIDED_STEPS: ReadonlyArray<{ id: GuidedStep; number: number; stage: GuidedStage; label: string; short: string; headingId: string }> = [
  { id: "data", number: 1, stage: 1, label: "Your data", short: "Data", headingId: "data-heading" },
  { id: "destination", number: 2, stage: 2, label: "Destination", short: "Destination", headingId: "destination-step-heading" },
  { id: "generate", number: 3, stage: 2, label: "Approve", short: "Approve", headingId: "generate-heading" },
  { id: "verify", number: 4, stage: 2, label: "Review", short: "Review", headingId: "verify-heading" },
  { id: "deliver", number: 5, stage: 3, label: "Export", short: "Export", headingId: "deliver-heading" },
];

/** "Step 2 of 3 · Build & review" — derived from GUIDED_STEPS and GUIDED_STAGES, never hand-written. */
export function stepCaption(id: GuidedStep): string {
  const step = GUIDED_STEPS.find((item) => item.id === id);
  const stage = GUIDED_STAGES.find((item) => item.stage === step?.stage);
  return step && stage ? `Step ${stage.stage} of ${GUIDED_STAGES.length} · ${stage.label}` : "";
}

export const TECHNICAL_HASH = "#technical";

export function initialView(hash: string): View {
  return hash === TECHNICAL_HASH ? "technical" : "guided";
}

export function viewHash(view: View): string {
  return view === "technical" ? TECHNICAL_HASH : "";
}
