# Mapping Contract

**Kind:** `mapping`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/mapping.v1.schema.json`

Declarative integration proposal from an approved Phantom Twin onto a destination JSON Schema. Models must never supply executable JavaScript.

## Supported operations

| `op` | Parameters |
| --- | --- |
| `copy` | `from`, `to` |
| `rename` | `from`, `to` |
| `trim` | `from`, `to` |
| `normalize_email` | `from`, `to` |
| `parse_date` | `from`, `to`, `params.inputFormat` |
| `map_enum` | `from`, `to`, `params.map`, `params.unmapped` |
| `default_if_missing` | `to`, `params.value` |
| `concat` | `from[]` (≥2), `to`, `params.separator` |

Unknown operations fail schema validation. Keys such as `javascript`, `eval`, or function bodies fail the safety walker in `src/domain/mapping/safety.ts`.

The interpreter (`executeMapping`) is not implemented in Sprint 0.
