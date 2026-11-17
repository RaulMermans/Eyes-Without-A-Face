# 0019 — An absent input for an optional destination field omits the field

Status: Accepted
Date: 2026-11-17
Amends: [ADR 0006](0006-mapping-execution-semantics.md), row "Optional destination"

## Context

- **ADR 0006 says an optional destination field is "omitted unless an operation writes it".** In practice, an operation whose input was missing or null refused the whole record. It failed with `MISSING_SOURCE_FIELD` or `NULL_VALUE` (string operations), or with a schema mismatch (a copied null).
- **Correct mappings lost valid records.** The Sprint 18B dev trace ([evaluation](../evaluation/sprint-18b-intent-plan.md#trace-why-records-stay-unresolved-dev-split-2026-11-17)) found the engine refusing valid records under the ground-truth mapping:
  - 16 of 34 in one scenario (an empty end date);
  - 3 of 26 in another (a missing optional email).

  Real exports leave optional fields empty all the time.

## Decision

In `executeMapping` (`src/domain/mapping/execute.ts`), before an operation runs:

- **The operation writes nothing** when both of these hold:
  - its destination field is **optional**: the leaf is declared in the target schema and is not in its parent's `required`;
  - one of its inputs is **missing**, is **null**, or has a null parent.

  The field is then omitted and the record continues. The target schema still validates the whole output.
- **Unchanged:**
  - required destination fields, which still refuse the record;
  - fields the schema does not declare;
  - `default_if_missing`;
  - present but invalid values, such as a wrong date format or a non-string, which still fail.
- **A null copied** (`copy` / `rename`) into an optional field that accepts null (`type` contains `"null"`, or `enum` contains `null`) is still written as null, as ADR 0006 says.
- **The rule depends only on the target schema and the record.** No model decides it, and no value is invented: an omitted field is absent, never defaulted.

## Consequences

- **More valid records transform.** In the dev ground truth: 16 → 0 and 3 → 0 refused records. A required field with no source still refuses every record, which is correct.
- **The portable package runtime is rebuilt** (`node scripts/build-runtime.mjs`, EXP-007), so exported integrations behave the same.
- **The meaning of a missing optional value is unchanged.** Semantic verification still judges only the values that are written.
