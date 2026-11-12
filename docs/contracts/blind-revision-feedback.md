# Blind Revision Feedback 1.0.0 / 1.1.0 and cloud disclosure 1.2.0 / 1.3.0

Schemas:

- `src/domain/contracts/schemas/blind-revision-feedback.v1.schema.json`
- `src/domain/contracts/schemas/cloud-disclosure.v1.2.schema.json`

- `src/domain/contracts/schemas/blind-revision-feedback.v1.1.schema.json` (Sprint 8)
- `src/domain/contracts/schemas/cloud-disclosure.v1.3.schema.json` (Sprint 8)

Decisions: [ADR 0008](../decisions/0008-blind-revision.md), [ADR 0009](../decisions/0009-semantic-verification.md).

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

## Feedback 1.1.0 and cloud disclosure 1.3.0 (Sprint 8)

**When it is used.** It is used only when the local semantic verifier ([semantic-verification.md](semantic-verification.md)) yields at least one sendable finding. Otherwise the projector emits **exactly** Feedback 1.0.0 inside a 1.2.0 request, byte-identical to Sprint 7. `tests/contracts/semantic-contracts.test.ts` proves this.

**What 1.1.0 adds to 1.0.0.** It keeps every 1.0.0 field, with these changes:

- `findings` may be empty when there are semantic findings;
- the objective `respect-approved-semantic-constraints` is added;
- two new arrays, below.

| Field | Content |
| --- | --- |
| `semanticFindings[]` | `operation` (1-based), `op`, `alias` (disclosed only), `to` (approved target only), `code`, `category`, `affectedCases` (bucket; absent when the finding is static) |
| `approvedConstraints[]` | Only constraints the user ticked. `date-order {alias, inputFormat}`, `category-order {alias, to, sourceOrder, targetOrder}`, `category-meaning {alias, to, map}` |

| Semantic code | Category | Sent? |
| --- | --- | --- |
| `SEMANTIC_DATE_ORDER_CONFLICT` | `date-order-conflict` | yes (mismatch) |
| `SEMANTIC_ORDER_INVERSION` | `ordered-category-inversion` | yes (mismatch) |
| `SEMANTIC_ENUM_MEANING_CONFLICT` | `enum-meaning-conflict` | yes (mismatch) |
| `SEMANTIC_POLICY_VIOLATION` | `semantic-policy-violation` | yes (policy conflict) |
| `SEMANTIC_AMBIGUOUS_DATE` | `ambiguous-date-interpretation` | yes (ambiguous) |
| `SEMANTIC_EVIDENCE_MISSING` | `insufficient-evidence` | only for an ambiguous or untrusted category constraint; "no constraint covers this operation" is withheld |

**Constraint projection** (`src/revision/semantic-feedback.ts`). A constraint is projected only when all of these hold:

1. the user authorized it;
2. it is `trusted`;
3. it backs a finding that is sent;
4. its source is a disclosed alias;
5. every source label is **already** in that alias's approved `enumValues`;
6. every destination value is in that destination's enum.

Otherwise it is withheld, with one of these reasons, and counted locally:

- `NOT_TRUSTED`
- `NO_SENT_FINDING`
- `SOURCE_NOT_DISCLOSED`
- `LABEL_NOT_DISCLOSED`
- `VALUE_NOT_IN_TARGET`
- `NOT_PROJECTABLE`

A constraint therefore adds **no new label**. It adds meaning: the order or the correspondence. The review panel shows this as *new semantic information* and counts new labels in the cumulative disclosure ledger; the count must be 0.

**Validation.** `validateRevisionFeedback` checks the 1.1.0 schema plus `validateSemanticBlock`: aliases disclosed, destinations approved, operations matching, labels approved. The gate's private-value scan also covers `approvedConstraints`.

**Prompt.** A 1.3.0 request uses `SEMANTIC_REVISION_INSTRUCTIONS` (prompt v3): v2 plus how to read semantic findings and approved constraints, and an explicit instruction to abstain rather than invent. 1.2.0 keeps prompt v2 unchanged.

**Migration.** Both versions stay supported. Nothing about 1.0.0 / 1.2.0 changed meaning. A 1.3.0 payload cannot carry 1.0.0 feedback and vice versa; tests cover both directions.
