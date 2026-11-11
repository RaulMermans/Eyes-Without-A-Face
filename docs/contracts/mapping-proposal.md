# Mapping proposal → executable mapping

**Model output schema:** `src/domain/inference-output/schemas/mapping-proposal.v1.schema.json`  
**Conversion boundary:** `src/proposal/convert.ts` (`convertProposal`)  
**Alias resolution:** `src/proposal/resolve.ts` (`resolveAliases`)  
**Orchestration:** `src/workflow/pipeline.ts` (`acceptProposal`)  
**Decision:** [ADR 0007](../decisions/0007-target-disclosure-and-proposal-boundary.md)

The proposal schema is deliberately looser than the Mapping Contract. A proposal is never passed to `executeMapping` directly.

## Sequence

1. **Parse.** Raw text goes through `JSON.parse` only. Malformed text gives `MALFORMED_PROPOSAL`; there is no repair and no retry.
2. **Structural safety.** Non-JSON values, prototype keys (`PROTOTYPE_POLLUTION`) and executable keys or strings (`EXECUTABLE_CONTENT`: `code`, `expr`, `function(`, `=>{`, `eval(` and others) are rejected.
3. **Allowlist.** Ops outside the eight-op allowlist give `UNKNOWN_OPERATION`. More than 16 operations gives `TOO_MANY_OPERATIONS`.
4. **Per-operation canonicalization**, checked against the approved disclosure (1.1.0 with `target`):
   - Exact parameter keys per op. Unexpected or missing params, or wrong types, give `INVALID_PARAMS`. An empty `params: {}` on a no-param op is dropped and reported as a warning.
   - `from` must be a disclosed alias (`UNKNOWN_ALIAS`). Dotted or array refs are rejected.
   - `to` must be a field in the approved `target` (`UNKNOWN_TARGET_FIELD`, `INVALID_FIELD_REF`).
   - Each destination may have at most one writer and one `default_if_missing` fallback (`DUPLICATE_DESTINATION`).
   - `map_enum` keys must be disclosed `enumValues` of that alias (`INVALID_ENUM_MAPPING`). Values outside the destination enum produce a warning; the Reality Check decides.
5. **Canonical validation.** The alias-level Mapping Contract (`destinationSchemaId: approved-target`) is validated with Ajv and the safety walker.
6. **Alias resolution (local).** The phantom id must match, `validateBindings` must pass, and every alias must be shareable and bound. Aliases are rewritten to private paths and the result is validated again.
7. **Execution.** The unchanged `executeMappingBatch` runs against the destination JSON Schema.

## Origins

The UI labels every proposal with exactly one origin:

| Origin | Meaning |
| --- | --- |
| `gemini-cloud` | `resultKind = real-cloud`, `simulated = false`, provenance `IN_CLOUD` |
| `test-adapter` | Dev-only deterministic harness (`deriveTestProposal`). Labeled "Simulated test adapter — not Gemini" |
| `manual-edit` | Text edited locally. Same validation, never sent back to Gemini |
