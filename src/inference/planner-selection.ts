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
export type InitialPlanner = "intent-plan-1" | "intent-plan-2" | "mapping-proposal-sprint3";
// "intent-plan-2" (Sprint 18D, ADR 0021): prompt v6, ranked alternatives, answered with plan 1.1.0.
// Evaluation-only until the pre-registered comparison selects it; never the default by intuition.

/** Library default (replays, scorers, unit tests): prompt v5. */
export const INITIAL_PLANNER = "intent-plan-1" as const satisfies InitialPlanner;

/**
 * Sprint 18F release decision: the running app uses prompt v6 (ranked alternatives), confirmed on the fresh
 * eval-18f holdout as part of RB + local (docs/evaluation/sprint-18f-confirmatory.md).
 */
export const PRODUCT_INITIAL_PLANNER = "intent-plan-2" as const satisfies InitialPlanner;
