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
