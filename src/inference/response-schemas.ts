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

export const INITIAL_RESPONSE_SCHEMA_ID = "mapping-response-per-operation-1";
export const INITIAL_MAPPING_RESPONSE_SCHEMA = MAPPING_REVISION_JSON_SCHEMA;
export const REVISION_MAPPING_RESPONSE_SCHEMA = MAPPING_REVISION_JSON_SCHEMA;
