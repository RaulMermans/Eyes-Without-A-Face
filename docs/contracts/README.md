# Contract families

Canonical schemas: `src/domain/contracts/schemas/*.v1*.schema.json`  
Current versions: **1.0.0** for every family. `cloud-disclosure` also accepts **1.1.0** ([ADR 0007](../decisions/0007-target-disclosure-and-proposal-boundary.md)). Accepted versions per kind are listed in `SUPPORTED_SCHEMA_VERSIONS` (`src/domain/contracts/kinds.ts`).  
Validator: `src/domain/validation/validate-contract.ts` (Ajv 2020-12)

TypeScript types in `src/domain/contracts/types.ts` are a convenience view. If they drift, the JSON Schema wins ([ADR 0001](../decisions/0001-canonical-json-schema.md)).

| Family | Schema | Doc | Valid example |
| --- | --- | --- | --- |
| Source | `source.v1.schema.json` | [source.md](source.md) | `tests/fixtures/valid/source-contract.json` |
| Phantom | `phantom.v1.schema.json` | [phantom.md](phantom.md) | `tests/fixtures/valid/phantom-contract.json` |
| Mapping | `mapping.v1.schema.json` | [mapping.md](mapping.md) | `tests/fixtures/valid/mapping-contract.json` |
| Validation | `validation.v1.schema.json` | [validation.md](validation.md) | `tests/fixtures/valid/validation-report.json` |
| Export | `export.v1.schema.json` | [export.md](export.md) | `tests/fixtures/valid/export-manifest.json` |
| Cloud disclosure | `cloud-disclosure.v1.schema.json`, `cloud-disclosure.v1.1.schema.json` | [cloud-disclosure.md](cloud-disclosure.md) | `tests/fixtures/valid/cloud-disclosure.json`; 1.1.0 is built in `tests/contracts/phantom-contracts.test.ts` |

Mapping proposals (model output) are not a contract family. They become a Mapping Contract only through the conversion boundary described in [mapping-proposal.md](mapping-proposal.md).

Invalid examples live in `tests/fixtures/invalid/`.
