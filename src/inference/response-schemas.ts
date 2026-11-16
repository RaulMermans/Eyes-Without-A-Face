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
import { INITIAL_MAPPING_RESPONSE_SCHEMA_V2 } from "./planner-prompt.ts";
import { MAPPING_REVISION_JSON_SCHEMA } from "./prompts.ts";

/**
 * Sprint 18A.5 (ADR 0017): initial proposals use schema 2, the per-operation
 * schema without default_if_missing and with unmapped limited to "fail". It
 * narrows decoding only; validation is unchanged. Revisions keep the Sprint 7
 * schema, where an approved fallback may still be used.
 */
export const INITIAL_RESPONSE_SCHEMA_ID = "mapping-response-initial-2";
export const INITIAL_MAPPING_RESPONSE_SCHEMA = INITIAL_MAPPING_RESPONSE_SCHEMA_V2;
export const REVISION_MAPPING_RESPONSE_SCHEMA = MAPPING_REVISION_JSON_SCHEMA;
