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
 * - "guided" (default): Your data → Destination → Result. The approval and
 *   the progress are moments inside Result, not places to learn.
 * - "technical": the Sprint 10/11 CONNECT / OBSERVE / OUTCOME experience with
 *   the full 17-stage runtime and every workbench control.
 *
 * Switching view or step never changes workflow state and never approves.
 */
export type View = "guided" | "technical";

export type GuidedStep = "data" | "destination" | "result";

export const GUIDED_STEPS: ReadonlyArray<{ id: GuidedStep; number: number; label: string; short: string }> = [
  { id: "data", number: 1, label: "Your data", short: "Data" },
  { id: "destination", number: 2, label: "Destination", short: "Destination" },
  { id: "result", number: 3, label: "Result", short: "Result" },
];

export const TECHNICAL_HASH = "#technical";

export function initialView(hash: string): View {
  return hash === TECHNICAL_HASH ? "technical" : "guided";
}

export function viewHash(view: View): string {
  return view === "technical" ? TECHNICAL_HASH : "";
}
