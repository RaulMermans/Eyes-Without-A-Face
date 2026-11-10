# Contract families

Canonical schemas: `src/domain/contracts/schemas/*.v1.schema.json`  
Current version: **1.0.0**  
Validator: `src/domain/validation/validate-contract.ts` (Ajv 2020-12)

TypeScript types in `src/domain/contracts/types.ts` are a convenience view. If they drift, the JSON Schema wins ([ADR 0001](../decisions/0001-canonical-json-schema.md)).

| Family | Schema | Doc | Valid example |
| --- | --- | --- | --- |
| Source | `source.v1.schema.json` | [source.md](source.md) | `tests/fixtures/valid/source-contract.json` |
| Phantom | `phantom.v1.schema.json` | [phantom.md](phantom.md) | `tests/fixtures/valid/phantom-contract.json` |
| Mapping | `mapping.v1.schema.json` | [mapping.md](mapping.md) | `tests/fixtures/valid/mapping-contract.json` |
| Validation | `validation.v1.schema.json` | [validation.md](validation.md) | `tests/fixtures/valid/validation-report.json` |
| Export | `export.v1.schema.json` | [export.md](export.md) | `tests/fixtures/valid/export-manifest.json` |

Invalid examples live in `tests/fixtures/invalid/`.
