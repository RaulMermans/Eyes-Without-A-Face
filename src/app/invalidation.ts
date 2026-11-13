import type { WorkspaceState } from "./workspace-state.ts";

/**
 * Sprint 11, Workstream C4. When an upstream change clears a prepared request
 * (by `invalidateDownstream`), say why and offer one clear action: prepare a
 * new review. This is an explanation of a state change that already
 * happened; it never restores, reuses or grants an approval.
 */
export interface Invalidation {
  cause: "twin" | "destination" | "other";
  /** The cleared request had been approved (or sent) before the change. */
  hadApproval: boolean;
  /** A mapping or verification result was cleared too. */
  hadResults: boolean;
}

export function invalidationCause(previous: WorkspaceState, next: WorkspaceState): Invalidation {
  const twinChanged = previous.overrides !== next.overrides || previous.seed !== next.seed;
  const destinationChanged = previous.destinationText !== next.destinationText;
  const status = previous.review?.status;
  return {
    cause: twinChanged ? "twin" : destinationChanged ? "destination" : "other",
    hadApproval: status === "approved" || status === "sent",
    hadResults: Boolean(previous.proposal || previous.report || previous.revision),
  };
}
