# 0006 — Deterministic mapping execution semantics

Status: Accepted  
Date: 2026-11-10

## Decision

Mapping execution is a local, provider-independent interpreter of the Mapping Contract schema (`1.0.0`). Models may later propose operations; they never execute them. The engine does not evaluate JavaScript, expressions, or user-supplied functions.

`copy` and `rename` both copy a JSON primitive onto a destination path. Rename does not delete the source field because the engine builds a new object.

## Semantics

| Topic | Rule |
| --- | --- |
| Missing | Key absent on the source object |
| `null` | Present value. Not missing. `default_if_missing` does not replace it |
| Optional destination | Omitted unless an operation writes it; target schema then decides validity |
| Type preservation | `copy` / `rename` keep string, number, boolean, or null. Objects and arrays are rejected |
| Strings | `trim` / `normalize_email` / `concat` / `map_enum` / `parse_date` require strings. No coercion |
| Empty string | Present value. `parse_date` rejects it |
| Enums | Exact string match. `unmapped=fail` errors. `unmapped=default` requires `params.default` |
| Defaults | Written only if the destination is unset, and if `from` is set, only when that source field is missing |
| Dates | `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY` emit calendar `YYYY-MM-DD` with no timezone. `ISO-8601` date-only stays `YYYY-MM-DD`; date-times are converted to UTC (`Z`) |
| Concat | All `from` fields must be present strings |
| Ordering | Operations run in array order |
| Conflicts | A second write to the same destination path fails, except `default_if_missing` which no-ops |
| Unsupported ops | Fail closed at contract validation |
| Field refs | Dotted object identifiers only. `__proto__`, `prototype`, `constructor`, array indexes, and JSON Pointer are forbidden |

## Consequences

Verification and export can reuse `executeMapping` / `executeMappingBatch` in the browser, a future CLI, or packaging without importing Firebase or React.
