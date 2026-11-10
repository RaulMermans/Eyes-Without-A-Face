# Validation Contract

**Kind:** `validation`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/validation.v1.schema.json`

Local verification report for a mapping version. Diagnostics must stay safe: they identify fixture ids and failure codes, not raw private records.

## Required fields

- `reportId`, `mappingId`, `mappingVersion`
- `results[]` with `testId`, `status` (`pass` \| `fail`), `expected`, `observed`

Failed results also require `failureCode` and `diagnostic`.

## Failure codes

`FIELD_MISSING`, `TYPE_MISMATCH`, `ENUM_UNMAPPED`, `CONSTRAINT_VIOLATION`, `DATE_PARSE_FAILED`, `UNEXPECTED_VALUE`

`reproduction.fixtureId` (and optional `seed`) make a failing case replayable without embedding the private source dataset in the report.
