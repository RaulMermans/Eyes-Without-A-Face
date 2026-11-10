# Phantom Contract

**Kind:** `phantom`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/phantom.v1.schema.json`

Synthetic representation that may be sent to cloud mapping after human approval. It contains aliases, semantic descriptors, and synthetic examples — not raw private rows.

## Required fields

- `phantomId`, `sourceDatasetId`
- `entities[]`, `fields[]` (each field has `alias`, `entityId`, `type`, `shareable`, `semanticDescriptor`)
- `syntheticExamples[]`
- `shareableFieldAliases[]`
- `nonShareableSourceFieldIds[]`

`approvedForCloud` must be `true` before the disclosure gate allows a cloud call (`src/twin/disclosure-gate.ts`).

## Disclosure rules

- Must not contain the private-data canary `PRIVATE_CANARY_PII_DO_NOT_SHARE`
- Shareable fields must not point at source fields with sensitivity `private`
- Source fields listed in `nonShareableSourceFieldIds` must not be marked `shareable: true`
