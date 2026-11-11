# Mapping Contract

**Kind:** `mapping`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/mapping.v1.schema.json`  
**Interpreter:** `src/domain/mapping/execute.ts`

Declarative integration proposal. Models must never supply executable JavaScript. The interpreter is independent of Firebase, React, and browser APIs.

## Supported operations

| `op` | Parameters | Execution |
| --- | --- | --- |
| `copy` | `from`, `to` | Copy a JSON primitive |
| `rename` | `from`, `to` | Same as copy onto a new name; source is not mutated |
| `trim` | `from`, `to` | Trim a string |
| `normalize_email` | `from`, `to` | Trim, lowercase, validate email |
| `parse_date` | `from`, `to`, `params.inputFormat` | Parse to `YYYY-MM-DD` or UTC ISO-8601 |
| `map_enum` | `from`, `to`, `params.map`, `params.unmapped` | Exact string map; fail or default |
| `default_if_missing` | `to`, `params.value`, optional `from` | Write constant when destination is unset |
| `concat` | `from[]` (≥2), `to`, `params.separator` | Join present strings |

Unknown operations fail schema validation. Keys such as `javascript`, `eval`, or function bodies fail the safety walker in `src/domain/mapping/safety.ts`.

## Engine API

```ts
executeMapping({ sourceRecord, mappingContract, targetSchema })
executeMappingBatch({ sourceRecords, mappingContract, targetSchema })
```

Expected validation failures return `{ ok: false, issues }` rather than thrown exceptions. Since Sprint 3, programmatic non-JSON inputs (bigint, functions, `undefined`, non-finite numbers, class instances) return `NON_JSON_VALUE`, and circular records, contracts, or schemas return `CIRCULAR_REFERENCE` instead of throwing (`src/domain/json/inspect.ts`). Operation semantics are unchanged.

Engine issue messages may quote private values (for example `UNMAPPED_ENUM`). The Reality Check (`src/verification/reality-check.ts`) keeps those messages as local detail and shows a fixed per-code explanation with the alias by default. See [mapping-proposal.md](mapping-proposal.md) for how model output reaches this engine.

Batch limits (documented in `src/domain/mapping/limits.ts`): 250 records, 1 MiB total, 64 KiB per record. Failed records are reported individually; a mixed batch is not `ok`.

Semantics: [ADR 0006](../decisions/0006-mapping-execution-semantics.md).
