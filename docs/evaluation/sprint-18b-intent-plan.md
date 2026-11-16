# Sprint 18B — Does the Integration Intent Plan let EYES do the integration engineering? (pre-registration)

**Status: PRE-REGISTERED.** This document was written and committed after the contract freeze (ADR 0018) and before any implementation worker saw the evaluation set. It was frozen before any model saw the set.

- Results are appended in [§ Results](#results) and never edit the sections above them.
- A change to a frozen input is recorded with `node scripts/freeze-ai-value.mjs --set b --amend "reason"` and reported.
- All data is fictional. **The live run needs the owner's approval of the budget below.** Without it, the live verdict is NOT RUN.

## Question

**18A.5 lesson.** A planner forced to choose between "write a complete operation" and "stay silent" stays silent: correct mappings on mappable fields fell from 0.661 to 0.205.

**Hypothesis H18B.** The planner states correspondences separately from transformations (Integration Intent Plan 1.0.0). A deterministic compiler then executes only what is fully specified and asks the user only what genuinely needs them. Under these conditions, EYES:

1. keeps the baseline's correct field correspondences;
2. stops fabricating category translations and defaults;
3. does not abstain indiscriminately;
4. reaches correct, verified integrations on fresh scenarios with far fewer manual mapping decisions than the current guided flow.

## Evaluation set

`tests/fixtures/eval-18b/` was written by an **independent author**: a separate agent that had no access to the implementation, prompts or earlier holdouts. It was written in parallel with Phase 2, after the contract freeze.

| Split | Scenarios | Use |
| --- | --- | --- |
| `dev/` | 4, including a CRM-contacts → helpdesk scenario | Engineers may read it, rehearse on it and tune on it |
| `holdout/` | 10 (7 completable, 3 with a required field that has no valid source) | **Never opened** by any engineer or implementation worker. Read only by the frozen harness and scorer, which emit aggregates and per-index rows. |

- **Ground truth per destination field:** source path or `null`, transform, source date format, concat sources and separator, and a `categoryMap` for each enum target. The `categoryMap` maps every observed source label to a destination value, or to `null` for a record that must be held for review.
- **Earlier holdouts are not used:** the Sprint 18A and 18A.5 holdouts are consumed.

## Configurations

| Config | App | Twin | Initial prompt / response schema |
| --- | --- | --- | --- |
| **P0** (baseline) | `main` @ `1e9de92`, served from a temporary worktree | concept-bearing (18A) | Sprint 3 instructions, `mapping-response-per-operation-1` |
| **P2** | branch `sprint-18b-ai-first` at the frozen release-candidate SHA, recorded in the freeze | same | intent plan prompt v5, `integration-intent-plan-1` |

Both configurations share the following:

- **Path and model:** the same seed, the technical-view UI path, the same model (`gemini-3.5-flash-lite`, `ONLY_IN_CLOUD`) and the in-app approval gate.
- **Request:** no category names are shared (the default a new user meets), no revision and no retry.

## How each answer is scored

The scoring is offline and deterministic, from the recorded alias-level model text. It is done by the frozen scorer `src/evaluation/eval-18b.ts` (EVAL-190+). Before scoring, the scorer rebuilds each prompt with its configuration's builder and proves that the hash equals the one sent.

### Correspondence

| Config | The correspondence of a destination field is |
| --- | --- |
| P0 | the source alias(es) of the single operation that writes it. A `default_if_missing` with no `from` counts as no correspondence. |
| P2 | the `from` of its plan entry when the validator kept the correspondence (verdict `accepted` or `correspondence-only`) and the status is not `no_source`. A `field-meaning` entry with more than one candidate counts as **not** correct, because it is a question. |

A correspondence is **correct** when it equals the ground-truth alias, or the ground-truth set for concat. A ground truth of `null` is correct when the field has no correspondence.

### Oracle user (end-to-end)

For P2, an **oracle user** answers exactly the clarifications the app asks, truthfully from the ground truth, and nothing else:

| Question | The oracle answers |
| --- | --- |
| `translate-categories` | the `categoryMap` restricted to the observed labels; `null` means set aside |
| `confirm-date-order` | the ground-truth `dateFormat` |
| `choose-field` | the ground-truth source if it is among the fields; otherwise "no field" |
| `missing-required-source` | cannot be answered; the integration stays incomplete |

The compiled contract then runs through the canonical engine, the acceptance policy (`guidedPolicy`) and the semantic verifier. The outputs are compared with **expected outputs computed by the same engine from the ground-truth mapping**.

- **P0 has no clarification mechanism.** Its accepted proposals are run as they are.
- **The oracle does not inspect or correct a confident wrong correspondence.** Silent errors therefore stay in the end-to-end score.

### Manual mapping effort (deterministic, no inference)

- **Baseline guided flow (`1e9de92`, Sprint 16B rules):** one manual mapping decision per destination field with a ground-truth source (choose or confirm a field), plus one per enum target (translate), plus one per date target whose order the data does not prove.
- **P2:** one per `choose-field` or `missing-required-source` question, plus one per `translate-categories` or `confirm-date-order` question.
- **Two counts are reported:**
  - **manual mapping operations** (field choices only);
  - **all clarification answers.**

## Metrics and pre-registered thresholds (holdout, live, pooled over trials)

| ID | Metric | Pass condition |
| --- | --- | --- |
| **M1** | Correct correspondences, all destination fields | P2 ≥ P0 |
| **M2** | Correct correspondences on mappable targets (ground-truth source, not an enum target): the 18A.5 metric C | **P2 ≥ P0 − 0.05** (non-inferiority) |
| **M3** | Category targets whose correspondence is correct (preserved although labels are withheld) | P2 ≥ 0.60 |
| **M4** | Invented values in executable output: defaults or `unmapped: "default"` (P0); compiled operations with a value no source or user gave (P2) | P2 = 0 |
| **M5** | Invalid enum translations: a `map_enum` or `valueMap` with undisclosed labels | P2 ≤ 0.25 × P0 |
| **M6** | Unnecessary abstention: mappable targets with no correspondence in P2 | ≤ 0.15 |
| M7 | Appropriate abstention: share of `null` targets with no correspondence | reported |
| M8 | Incorrect `unsupported`: targets with a supported ground-truth transform that P2 marks `unsupported` | reported |
| **M9** | Whole-plan rejections (`MALFORMED_PLAN`) plus provider failures, as a share of P2 answers | ≤ 0.10 |
| **M10** | Hallucinated references | P2 ≤ P0 |
| **E1** | End-to-end success on completable scenarios (oracle): compiled `complete`, every record either equal to the expected output or correctly held for review, no semantic mismatch | **P2 ≥ 0.50** of completable answers (P0 reported on the same rule) |
| **E2** | Incorrect records transformed: records output as transformed whose value differs from the expected output, over all transformed records | P2 ≤ 0.05 |
| **E3** | False completes on non-completable scenarios (`complete` true although a required field has no valid source) | P2 = 0 |
| E4 | Correctly quarantined records, unsupported records, verifier statuses | reported |
| **U1** | Manual mapping operations per scenario | P2 mean ≤ 0.5 × baseline mean |
| U2 | Clarification answers per scenario; unnecessary questions (asked about a target whose ground truth is `null`) | reported |
| **S1** | Privacy: in-run request-body scan (`privateTermsInBody`), source-derived findings | = 0 |
| **S2** | Proof: sent prompt hash = previewed prompt hash = reconstruction hash | every request |
| S3 | Provenance (`IN_CLOUD`, not simulated), latency, HTTP status | reported |

**Milestone AI gate (Gate B-AI)** passes only when every bold condition holds: M1, M2, M3, M4, M5, M6, M9, M10, E1, E2, E3, U1, S1 and S2.

- A failure is reported as a failure.
- The prompt is not tuned on this holdout.
- The holdout is **inspected** after scoring.

## Budget (requires owner approval)

| Item | Value |
| --- | --- |
| Requests | 10 holdout scenarios × 2 configs × 2 trials = **40 cloud requests** at most, through Firebase AI Logic (`ONLY_IN_CLOUD`), the existing project and the registered App Check debug token |
| Order | ABBA: P0 t1, P2 t1, P2 t2, P0 t2 |
| Revision | none |
| Retries | none. A provider failure or a harness failure is recorded and not repeated |
| Stop rule | stop on the first source-derived privacy finding (trace first, as in 18A.5) or on a per-scenario budget breach |
| Rehearsal | zero-request rehearsals on the dev split and the holdout (UI up to an enabled Send button, nothing sent) |

## Results

*(appended after the run; not yet run)*
