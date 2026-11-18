/**
 * Response schemas selected per request kind (Sprint 9, Workstream B1).
 *
 * Sprint 8 recorded one real initial proposal that the converter rejected:
 * the flat MAPPING_PROPOSAL_JSON_SCHEMA declares every param on every
 * operation, so the decoder filled `value`/`separator` on a map_enum. Sprint 7
 * had already fixed exactly that for revisions with a per-operation schema.
 * Initial proposals now use the same per-operation schema. It constrains what
 * the decoder can emit; it does not relax validation: every response still
 * passes `convertProposal` unchanged, and invalid output is never repaired.
 *
 * The schemas themselves live in the frozen prompts.ts (Sprint 8 freeze
 * manifest) and are reused unchanged; only the selection changes here.
 * EVAL-090 replays the archived real outputs against both schemas.
 */
import { MAPPING_REVISION_JSON_SCHEMA } from "./prompts.ts";
import { INTENT_PLAN_JSON_SCHEMA, isIntentPlanRequest, isRankedPlanRequest, RANKED_PLAN_JSON_SCHEMA } from "./intent-prompt.ts";
import { INTENT_PLAN_RESPONSE_SCHEMA_ID } from "../plan/types.ts";

/** Schema for initial requests built with the frozen Sprint 3 instructions (planner "mapping-proposal-sprint3"). */
export const INITIAL_RESPONSE_SCHEMA_ID = "mapping-response-per-operation-1";
export const INITIAL_MAPPING_RESPONSE_SCHEMA = MAPPING_REVISION_JSON_SCHEMA;
export const REVISION_MAPPING_RESPONSE_SCHEMA = MAPPING_REVISION_JSON_SCHEMA;

/**
 * Sprint 18B (ADR 0018): an initial request built with prompt v5
 * (`isIntentPlanRequest`) is answered with an Integration Intent Plan 1.0.0
 * under `INTENT_PLAN_JSON_SCHEMA`, id `INTENT_PLAN_RESPONSE_SCHEMA_ID`
 * ("integration-intent-plan-1"). The answer is validated against the canonical
 * plan schema and judged by `validateIntentPlan` (src/plan/validate.ts);
 * nothing is repaired. Revisions are unchanged.
 */
export { INTENT_PLAN_RESPONSE_SCHEMA_ID };
export const INTENT_PLAN_RESPONSE_SCHEMA = INTENT_PLAN_JSON_SCHEMA;

export type CloudResponseKind = "integration-intent-plan" | "mapping-proposal";

/** Which answer an outbound prompt asks for. A revision is never a plan request. */
export function cloudResponseKind(outboundPrompt: string, revision: boolean): CloudResponseKind {
  return !revision && isIntentPlanRequest(outboundPrompt) ? "integration-intent-plan" : "mapping-proposal";
}

/** Sprint 18D (ADR 0021): prompt v6 is answered with plan 1.1.0 (ranked `alternatives`). */
export const RANKED_PLAN_RESPONSE_SCHEMA_ID = "integration-intent-plan-2";
export const RANKED_PLAN_RESPONSE_SCHEMA = RANKED_PLAN_JSON_SCHEMA;

/** The decoder schema for a plan request's prompt. */
export function planResponseSchemaFor(outboundPrompt: string): typeof INTENT_PLAN_JSON_SCHEMA | typeof RANKED_PLAN_JSON_SCHEMA {
  return isRankedPlanRequest(outboundPrompt) ? RANKED_PLAN_RESPONSE_SCHEMA : INTENT_PLAN_RESPONSE_SCHEMA;
}
