# 0007 — Destination disclosure and the proposal conversion boundary

Status: Accepted  
Date: 2026-11-11

## Context

Sprint 3 connects locally generated Phantom Twins to Gemini mapping proposals. Two boundaries were missing:

1. Gemini must know the destination fields to propose a mapping, but a destination JSON Schema can carry sensitive prose (titles, descriptions, examples, business rules). Cloud disclosure 1.0.0 had no place to describe it, and appending it to the prompt outside the payload would bypass the approval fingerprint.
2. The mapping-proposal output schema is more permissive than the executable Mapping Contract (`params` is an open object, `from` may be a string or array). Model output therefore cannot be handed to `executeMapping` as-is, and it refers to aliases, not source fields.

## Decision

**Cloud disclosure 1.1.0.** A new schema version (`cloud-disclosure.v1.1.schema.json`) equals 1.0.0 plus a required `target.fields[]` with only `name`, `type`, `required`, `nullable`, `format`, `enumValues`. `describeTargetSchema` (`src/twin/target-disclosure.ts`) projects those keys from the destination JSON Schema and drops titles, descriptions, `$id`, defaults and unsupported constructs. The projection is part of the payload, so it is covered by the payload hash, the exact-prompt hash, and the single-use approval. `validateContract` now dispatches by `(kind, schemaVersion)`. Every other family stays 1.0.0, and 1.0.0 disclosures remain valid for the diagnostic workspace.

**One conversion boundary.** `convertProposal` (`src/proposal/convert.ts`) is the only path from proposal JSON (model output or a local edit) to an alias-level canonical Mapping Contract. It rejects, and never repairs:

- malformed JSON;
- unknown ops and unexpected or missing params;
- executable content and prototype keys;
- undeclared aliases and destination fields outside the approved `target`;
- duplicate writes;
- enum keys that were not disclosed;
- more than 16 operations.

**Local alias resolution.** `resolveAliases` (`src/proposal/resolve.ts`) rewrites alias references to private source paths using `PrivateBindings`. The bindings are validated first, the resolved contract is validated again, and only then is the unchanged Sprint 2 engine invoked.

## Consequences

- The engine (ADR 0006) is not widened. Invalid proposals fail before execution.
- A destination description is reviewed exactly like twin fields. Destination names are disclosed by design; titles and descriptions are not.
- Bindings never enter a contract that leaves the browser. `PrivateBindings` keeps entries in an ES private field and throws on `JSON.stringify`.
