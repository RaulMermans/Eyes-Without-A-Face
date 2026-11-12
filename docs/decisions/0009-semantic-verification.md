# 0009 — Semantic verification and semantic blind revision

Status: Accepted
Date: 2026-11-12

## Context

Sprint 7 showed that real Gemini mappings can be **schema-valid but semantically wrong**:

- CRM: `parse_date` read `DD/MM/YYYY` dates as `MM/DD/YYYY`. Every date with both parts ≤ 12 still parsed, to the wrong day.
- Support: `map_enum` mapped `p1 → low … p4 → urgent`, a reversed priority scale. Every value was a destination enum member.

Nothing structural catches either error. The Mapping Contract allows both date formats, JSON Schema accepts any enum member, and the engine reports success. Without ground truth these runs look like success. Blind Revision Feedback 1.0.0 also had nothing to say, because nothing failed.

## Decision

### Trusted semantic constraints, verified locally

A **Semantic Verification Contract 1.0.0** (`semantic-verification.v1.schema.json`, `src/semantics/contract.ts`) holds explicit expectations about meaning. It is **local only**: it references local source paths and is never serialized into a payload.

Four constraint families are supported. There is no rule language.

| Kind | Expectation |
| --- | --- |
| `date-interpretation` | How a source date field is written (`DD/MM/YYYY`, …), or that this is undecided (`ambiguous`, with candidates) |
| `ordered-categories` | Source labels and destination values, both highest to lowest; a mapping must never invert the ranking |
| `enum-meaning` | The declared business meaning of listed categories |
| `allowed-values` | A destination invariant: output belongs to an authorized set |

`ordered-categories` and `enum-meaning` also say what happens to undeclared categories. Under `review`, an undeclared category must not become a successful output.

**Trust.** A constraint can verify only when `trust: "trusted"`, and its evidence must be one of:

- `user-declared`;
- `source-contract`;
- `local-rule`;
- `deterministic-observation`.

A `deterministic-observation` must be *sufficient on its own*. For a date order that means at least one disambiguating value (one part > 12) and no conflicting value. Weaker evidence is recorded as `ambiguous`. A `model-suggestion` (Nano or Gemini) can only be `proposed`; the validator rejects it as trusted.

**Evidence sources.** Observations read imported records plus revision-feedback cases, never holdout cases. Nothing in `src/semantics/` imports fixtures or reads `expected`. Tests prove the verifier output is identical when ground truth is removed or falsified, and when holdout records are poisoned.

**Verifier** (`src/semantics/verify.ts`) runs after the unchanged engine, on the same rows. Each check is generic and runs two ways:

- statically, over the declarative operation (for example `inputFormat` against the trusted format, or `map_enum` pairs against the ranking);
- dynamically, per record (for example produced date against the trusted reading of the same source value).

Statuses are never collapsed:

| Status | Meaning |
| --- | --- |
| `SEMANTIC_PASS` | A trusted constraint was exercised and held |
| `SEMANTIC_MISMATCH` | The output contradicts a trusted constraint |
| `SEMANTIC_POLICY_CONFLICT` | A value requiring review became output, or the constraint conflicts with the destination or with another constraint |
| `SEMANTIC_AMBIGUOUS` | Legitimate evidence could not decide; confirmation is needed |
| `SEMANTIC_EVIDENCE_MISSING` | A meaning-bearing operation (`map_enum`, slash-date `parse_date`) has no trusted constraint |
| `SEMANTIC_UNVERIFIED` | Structure only (copy, trim, normalize), or the constraint was not exercised |

### Safe semantic feedback (additive versions)

- **Blind Revision Feedback 1.1.0.** It keeps every 1.0.0 field and adds two arrays:
  - `semanticFindings`: operation number, `op`, disclosed alias, approved destination, fixed code → category, coarse bucket. It is absent for static findings.
  - `approvedConstraints`: present only for constraints the user explicitly authorized. Each one is built from labels **already approved** for that alias, destination enum values, and fixed date formats. `allowed-values` is never projected.
- **Cloud disclosure 1.3.0** is 1.2.0 with a 1.1.0 feedback block, and uses prompt v3.
- **Backward compatibility.** When there is no sendable semantic finding, the projector emits Feedback 1.0.0 and the request is 1.2.0, byte-identical to Sprint 7. A contract test proves this.
- **What is sent.** Only `MISMATCH`, `POLICY_CONFLICT` and `AMBIGUOUS` produce findings. "No constraint covers this operation" is withheld, because it is not a defect and it invites guessing.
- **Approval.** The same gate, preview, exact-prompt hash, single-use ledger and budget apply. Toggling a constraint changes the projection, so a prepared request and its pending approval are discarded.

### Deterministic acceptance, never automatic promotion

`src/revision/decision.ts` classifies a revised mapping from outcome classes and the semantic verifier only. It never uses ground truth or model text. The verdicts are:

- `ACCEPTED`
- `REJECTED`
- `UNCHANGED`
- `INSUFFICIENT_INFORMATION`: unchanged reply to semantic findings without an approved constraint
- `NO_IMPROVEMENT`
- `REGRESSED`
- `HUMAN_REVIEW_REQUIRED`

Regressions are counted per record *and* per destination operation. This catches a previously valid operation that broke on a record that was already wrong for another reason. A row the engine refused before is exempt, because the engine stops at the first failure.

A gain that adds no clean transformation, for example by holding more records back, is never `ACCEPTED`. Both mapping versions are kept. The user decides.

### Holdout discipline

Sprint 7's holdout results were inspected, so scenario v2.0.0 keeps that set as `development`. A fresh 10-case holdout was added per scenario, written from each scenario's documented meaning before any Sprint 8 model run.

`docs/evidence/sprint-8/freeze-manifest.json` hashes the following before the live runs, and a test fails if any of them changes:

- prompts and the model id;
- schemas;
- scenarios, including the holdout;
- the verifier, the projection, the decision rule and the evaluator.

The manifest also records the run budget and hypotheses.

## Consequences

- Silent semantic errors are detected only where trusted evidence exists. Fields without constraints stay explicitly unknown.
- Order constraints are weak by design: they disclose less than a full map, and they cannot detect a wrong mapping that preserves order. Example: a single label mapped to the wrong rank.
- A user-declared constraint is human knowledge. The benchmark counts it as a human intervention and reports what each configuration received.
- If the constraint is known, a deterministic local patch could apply it without any model. The value of the cloud revision is producing a complete, consistent mapping from blind feedback. This is a claim the benchmark must support, not assume.
- The engine, the eight-operation DSL, the converter and the 1.1.0/1.2.0 paths are unchanged.
