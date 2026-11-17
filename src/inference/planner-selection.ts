/**
 * Initial planner selection (Sprint 18B, ADR 0018).
 *
 * Which instructions an initial (cloud-disclosure 1.1.0) request carries:
 *   "intent-plan-1"            prompt v5 (src/inference/intent-prompt.ts), answered
 *                              with an Integration Intent Plan 1.0.0
 *   "mapping-proposal-sprint3" the frozen Sprint 3 instructions
 *                              (`buildCloudPromptText`), answered with a Mapping
 *                              Proposal 1.0.0
 *
 * ADR 0018: if the pre-registered live comparison fails, this constant reverts
 * to "mapping-proposal-sprint3" (as ADR 0017 reverted v4). Revisions (1.2.0,
 * 1.3.0) are never affected: they keep their frozen prompts and schema.
 */
export type InitialPlanner = "intent-plan-1" | "mapping-proposal-sprint3";

export const INITIAL_PLANNER = "intent-plan-1" as const satisfies InitialPlanner;
