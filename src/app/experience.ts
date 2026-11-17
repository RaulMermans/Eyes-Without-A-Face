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
 *   Generate → Verify → Deliver. The same `WorkspaceState` reordered: the
 *   approval is a moment inside Generate, Gemini's field matches and the
 *   user's few answers live in Verify, downloads in Deliver.
 * - "technical": the Sprint 10/11 CONNECT / OBSERVE / OUTCOME experience with
 *   the full 17-stage runtime and every workbench control.
 *
 * Switching view or step never changes workflow state and never approves.
 */
export type View = "guided" | "technical";

export type GuidedStep = "data" | "destination" | "generate" | "verify" | "deliver";

export const GUIDED_STEPS: ReadonlyArray<{ id: GuidedStep; number: number; label: string; short: string; headingId: string }> = [
  { id: "data", number: 1, label: "Connect", short: "Connect", headingId: "data-heading" },
  { id: "destination", number: 2, label: "Destination", short: "Destination", headingId: "destination-step-heading" },
  { id: "generate", number: 3, label: "Generate", short: "Generate", headingId: "generate-heading" },
  { id: "verify", number: 4, label: "Verify", short: "Verify", headingId: "verify-heading" },
  { id: "deliver", number: 5, label: "Deliver", short: "Deliver", headingId: "deliver-heading" },
];

/** "Step 3 of 5" — derived from GUIDED_STEPS, never hand-written. */
export function stepCaption(id: GuidedStep): string {
  const step = GUIDED_STEPS.find((item) => item.id === id);
  return step ? `Step ${step.number} of ${GUIDED_STEPS.length}` : "";
}

export const TECHNICAL_HASH = "#technical";

export function initialView(hash: string): View {
  return hash === TECHNICAL_HASH ? "technical" : "guided";
}

export function viewHash(view: View): string {
  return view === "technical" ? TECHNICAL_HASH : "";
}
