# Blind Revision Feedback 1.0.0 and cloud disclosure 1.2.0

Schemas:

- `src/domain/contracts/schemas/blind-revision-feedback.v1.schema.json`
- `src/domain/contracts/schemas/cloud-disclosure.v1.2.schema.json`

Decision: [ADR 0008](../decisions/0008-blind-revision.md).

## Purpose

Blind Revision Feedback is the only representation of a local Reality Check that may be sent to the cloud, and only inside a separately approved cloud-disclosure 1.2.0 request.

## Projection

`projectRevisionFeedback` (`src/revision/feedback.ts`) is pure and deterministic. It reads:

- the alias-level contract that was evaluated;
- the approved 1.1.0 disclosure and its hash;
- the Reality Check report over imported plus revision-feedback cases. Holdout cases are never passed in.
- the evaluator classification (for `UNAPPROVED_FALLBACK`);
- the local acceptance policy (for approved fallbacks only).

It builds the output field by field. It never reads `localIssues[].message`, record values, source paths or rationales.

## Fields

| Field | Content |
| --- | --- |
| `feedbackVersion` | `"1.0.0"` |
| `runId` | `run-` + 16 hex |
| `baseDisclosureHash` | SHA-256 of the approved 1.1.0 payload |
| `previousMapping` | `contractHash`, `origin`, alias-level `operations` (explicit copy of op/from/to/params) |
| `findings[]` | `operation` (1-based), `op`, `alias` (disclosed only), `to` (approved target only), `code`, `category`, `affectedCases` (`"1"`, `"2-4"`, `"5+"`) |
| `unaffectedOperations` | 1-based numbers of operations with no finding |
| `approvedFallbacks` | `{to, value, appliesTo: "undisclosed-category"}`. `value` must be in that target field's `enumValues` |
| `objectives` | Fixed enum list |
| `revisionBudget` | `{maxRevisions: 1, remainingAfterThisRequest: 0}` |

## Codes and categories

| Code | Category | Source |
| --- | --- | --- |
| `UNMAPPED_ENUM` | `undisclosed-category` | engine |
| `MISSING_SOURCE_FIELD` | `missing-value` | engine |
| `NULL_VALUE` | `null-value` | engine |
| `EMPTY_VALUE` | `empty-value` | engine |
| `TYPE_MISMATCH` | `unexpected-type` | engine |
| `INVALID_EMAIL` | `invalid-email` | engine |
| `INVALID_DATE` | `date-format-mismatch` | engine |
| `OUTPUT_SCHEMA_MISMATCH` | `destination-constraint` | engine (destination taken from the instance path, kept only if it is an approved target field) |
| `UNAPPROVED_FALLBACK` | `unapproved-fallback` | evaluator: a row was `REJECTED_BY_POLICY` |

Every other engine code (contract-level, structural, limits) is withheld and counted locally as "not allowlisted".

## Cloud disclosure 1.2.0

1.2.0 is 1.1.0 plus a required `revision: { feedback }`. `buildRevisionPayload` copies the approved base explicitly. `assertSameBase` proves that `fields`, `entities`, `syntheticExamples`, `disclosureConstraints`, `destination` and `target` are unchanged. The outbound prompt uses `BLIND_REVISION_INSTRUCTIONS` (fixed text) followed by the canonical payload.

## Validation

`validateRevisionFeedback` checks:

- the schema;
- that aliases are disclosed, targets are approved, and fallbacks lie inside the target enum;
- that `previousMapping` equals the evaluated contract;
- that every finding matches its operation.

The disclosure gate then runs the 1.2.0 schema, forbidden keys, the canary and the private-value scan. The scan covers map labels, defaults and fallbacks; labels the user already approved for disclosure are exempt.

## Tests

- `tests/unit/blind-revision.test.ts`
- `tests/contracts/blind-revision-contracts.test.ts`
- `tests/privacy/blind-revision-privacy.test.ts` (adversarial: canary, rare categories, long and unicode values, nested objects, prompt injection, smuggled values, aggregation buckets, approval binding and replay)
