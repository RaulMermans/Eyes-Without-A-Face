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

### Run 1 — stopped by the lead after P2 trial 1 (2026-11-17)

**Setup.**
- The owner approved the 40-request budget on 2026-11-17.
- P2 = `sprint-18b-ai-first` @ `9489795`, served on port 5174. P0 = `main` @ `1e9de92`, served from a temporary worktree on port 5175.

**Zero-request rehearsals.**

| Split | P0 | P2 |
| --- | --- | --- |
| Dev (4) | 4 / 4 ready to send, prompt reconstruction matched | 4 / 4 ready to send, prompt reconstruction matched |
| Holdout (10) | 9 / 10 ready to send. Holdout #3 cannot be built on `main`: the build step fails, with the same symptom as the 18A / 18A.5 build failure | 10 / 10 ready to send |

**Live, in ABBA order.**

| Config | Requests | Outcome |
| --- | --- | --- |
| P0 t1 | 9 | #3 not buildable; 1 HTTP 500 provider failure |
| P2 t1 | 10 | **every request refused by the provider with HTTP 400 before any answer**. No plan was produced. |

- Privacy: 0 findings.
- Budget used: **19 of 40**.

**Why the run stopped.**
- A provider refusal of every request is deterministic. It is not a sampling outcome, so P2 t2 would have spent 10 more requests on certain refusals.
- AGENTS.md says to never loop real requests until one passes. The lead therefore stopped before P2 t2 and P0 t2.
- The evidence is kept unchanged in [intent-plan-live.json](../evidence/sprint-18b/intent-plan-live.json).

**Diagnosis so far (no request text inspected).**
- The P2 request differs from P0 only in two things: the instruction text and the response schema `INTENT_PLAN_JSON_SCHEMA`.
- The schema is the most likely cause. It uses `minItems` / `maxItems`, which no earlier live schema used, and Worker A had verified it only against documentation.
- The provider's 400 text was not recorded by the harness, so the exact rejected keyword is unproven.

**Status: no verdict.**
- As run, P2 produced no usable answer: M9 = 1.0 > 0.10, so Gate B-AI would **FAIL**.
- The cause is in the request transport, not in planning quality. Resuming needs the owner's decision, as in 18A.5.
- Nothing was tuned on the holdout. No P0 or P2 answer was read by an engineer.


### Diagnosis and fix (owner decision: diagnose, fix, resume)

- **Two diagnostic requests and one check request** on the dev split (the CRM contacts → helpdesk scenario; the holdout was not used):
  - The first diagnostic's error text was lost to an output-filter mistake by the lead.
  - The second read the provider error: `INVALID_ARGUMENT — "The specified schema produces a constraint that has too many states for serving … long array length limits (especially when nested)"`.
- **Fix** `0194e92`: the decoder schema no longer has `minItems` / `maxItems`.
  - The canonical schema still enforces every bound in `validateIntentPlan`.
  - S18B-C-002 lists the bounds as canonical-only, each with an instance proved `MALFORMED_PLAN`.
- **The check request returned HTTP 200 with a valid plan.**
- Nothing was tuned on the holdout. No P0 or P2 answer had been read.

### Run 2 — resumed and complete (2026-11-17)

**Setup.**

| Item | Value |
| --- | --- |
| P2 | `0194e92` |
| Order | P2 t1 (rerun), P2 t2, P0 t2 |
| Evidence | [intent-plan-live-run2.json](../evidence/sprint-18b/intent-plan-live-run2.json) |
| Scored set | P0 t1 from run 1 plus the three run-2 trials: [intent-plan-live-scored.json](../evidence/sprint-18b/intent-plan-live-scored.json) |
| Scorer | `src/evaluation/eval-18b.ts`, unchanged. Only the evidence path became an environment variable. |
| Summary | [intent-plan-live-summary.json](../evidence/sprint-18b/intent-plan-live-summary.json) |

Run 1's P2 t1 (10 × HTTP 400) is kept in its own file and is not scored, because a transport defect means no plan was produced.

**Requests in total: 51**, over the 40 first approved. The owner approved the overrun:

| Requests | What |
| --- | --- |
| 9 | run 1 P0 t1 |
| 10 | run 1 P2 t1 (refused) |
| 3 | diagnostic and check, dev only |
| 29 | run 2 |

**Integrity:**
- privacy: 0 source-derived findings;
- prompt mismatches: 0;
- every scored answer carries real `IN_CLOUD` provenance.

| ID | Metric | P0 | P2 | Pass condition | Verdict |
| --- | --- | --- | --- | --- | --- |
| **M1** | Correct correspondences, all fields | 0.547 | 0.440 | P2 ≥ P0 | **FAIL** |
| **M2** | Correct on mappable targets | 0.673 | 0.482 | P2 ≥ P0 − 0.05 | **FAIL** |
| **M3** | Category correspondence preserved | 0.175 | 0.250 | P2 ≥ 0.60 | **FAIL** |
| **M4** | Invented values in executable output | 17 | **0** | P2 = 0 | pass |
| **M5** | Invalid enum translations | 17 | **0** | ≤ 0.25 × P0 | pass |
| **M6** | Unnecessary abstention | 0.022 | 0.075 | ≤ 0.15 | pass |
| M7 | Appropriate abstention | 0.313 | 0.714 | reported | — |
| M8 | Incorrect `unsupported` | 0 | 0 | reported | — |
| **M9** | Whole-plan rejections + provider failures | 0.111 (2 × HTTP 500) | **0.300 (6 × HTTP 500)** | ≤ 0.10 | **FAIL** |
| **M10** | Hallucinated references | 0 | 0 | P2 ≤ P0 | pass |
| **E1** | End-to-end success, completable answers | 0 / 14 | **0 / 14** | ≥ 0.50 | **FAIL** |
| **E2** | Incorrect transformed records | — (0 transformed) | **28 / 28 = 1.0** | ≤ 0.05 | **FAIL** |
| **E3** | False completes | 0 | 0 | = 0 | pass |
| **U1** | Manual mapping operations per scenario | 10.9 | **4.2** | ≤ 0.5 × baseline (10.7) | pass |
| U2 | All clarification answers; unnecessary questions | 14.1; 0 | 7.3; 4 | reported | — |
| **S1** | Privacy findings | 0 | 0 | = 0 | pass |
| **S2** | Prompt proof | 0 mismatches | 0 mismatches | every request | every sent request proven; the scorer reports false because P0 holdout #3 could never be built and sent |

Note on the scorer, reported rather than changed after the run:
- **S2:** the scorer also requires every scenario to have been sent.
- **Correction (2026-11-17):** an earlier version of this section called E2 a scorer defect ("count against rate"). That was the lead's misreading: the summary value 1 is the rate 28 / 28. The scorer was right.

**Gate B-AI verdict: FAIL** on M1, M2, M3, M9, E1 and E2.

**Explanatory breakdown (not pre-registered).** These figures count only requests that got an answer.

| Measure | P0 | P2 |
| --- | --- | --- |
| Correct, all fields | 0.613 (n = 16) | 0.624 (n = 14) |
| Correct, mappable | 0.755 | 0.683 |
| Category correspondence | 0.194 | 0.355 |
| Manual mapping operations | 10.9 | 1.5 |
| Complete plans | 0 | 3 |

On the 9 scenarios both configurations answered, mappable correctness was 0.755 for P0 against 0.690 for P2.

**What this shows:**
1. **Separating correspondence from transformation did what it was designed to do.**
   - Invented values and invalid enum translations fell from 17 to 0.
   - Category correspondences survived more often, without the 18A.5 collapse: unnecessary abstention was 0.075.
   - Manual mapping work fell by about 60 % overall, and by about 86 % on answered requests.
2. **The plan request is less reliable at the provider: HTTP 500 on 30 % of requests**, against 11 % for P0. A large constrained-decoding schema is the likely cause, but it is unproven.
3. **Even when answered, mappable correctness is slightly below the baseline** (−0.07). It is not inferior beyond doubt, but it is outside the pre-registered bound.
4. **No end-to-end success on either configuration.**
   - 333 records stayed unresolved: the engine refused them.
   - The cause is not yet traced. It may be strict handling of missing optional values, oracle coverage, or wrong correspondences.
   - This must be investigated on the dev split or a fresh set, never on this holdout.

**Decision.**
- **The intent planner is not shipped.** The production release `c7220768` is unchanged.
- This holdout is now **inspected**.
- A successor needs a fresh holdout and a pre-registration. Its inputs:
  - a smaller decoder schema or a two-step request, to cut provider errors;
  - tracing why compiled plans leave records unresolved;
  - mappable recall.

### Trace: why records stay unresolved (dev split, 2026-11-17)

**Method.** A throwaway script, not committed, ran each dev scenario through the frozen scorer's oracle and the canonical engine. It printed codes and counts only, for two kinds of plan:
- a plan stating the ground-truth correspondences, with category labels withheld;
- the simulated planner.

The holdout was read only through its existing aggregate rows.

**1. The pipeline is sound once the correspondences are right.**
- With the ground-truth plan, every completable dev scenario reached exactly the expected outcome. For CRM → helpdesk: 28 records transformed and 4 held for review, as expected.
- The oracle's local category translation works on these fields.

**2. Primary cause: category source fields are invisible to Gemini.**
- The profile's category rule `CATEGORY_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/` (`src/domain/profile/profile.ts`) accepts only lowercase ASCII tokens.
- All 8 dev category sources fail it. Real labels have capitals, spaces, accents or codes: "Marketing Qualified Lead", "Básico", "Klavier", "ALT-IMPORT 2019".
- Such a field is profiled as `string`. The twin therefore describes it as "Short text value", the same as 13–16 other text fields in the same request. Nothing tells Gemini that it holds a small set of categories.
- Gemini then cannot find the source of a required fixed-list field (M3 = 0.25 live). The compiled integration lacks a required field, so every record fails `OUTPUT_SCHEMA_MISMATCH` and is UNRESOLVED.
- **Live aggregates agree:** 11 of 14 answered P2 plans were incomplete, with 0 records transformed.

**3. The oracle overstates failure.**
- A required field that the plan wrongly marks `no_source` yields `missing-required-source`. The pre-registration treats that question as unanswerable.
- The UI offers "choose a field", which a real user could answer.

**4. Strict null handling loses valid records, even with the correct mapping.**
- A record whose source value for an *optional* destination field is null or missing is refused whole (`NULL_VALUE`, `MISSING_SOURCE_FIELD`).
- Dev examples: 16 of 34 records (gym) and 3 of 26 (music school).
- The scorer counts these as "correctly not transformed", because the ground-truth contract refuses them too. For a user they are still lost records.

**5. Complete but wrong: not traced on dev.**
- One holdout scenario compiled complete in both trials and transformed 14 of 14 records wrongly.
- The simulated planner on dev reproduces no such case, and the holdout is not opened for it.

**Candidate fixes for a successor.** Each needs its own decision and tests.
- **Category detection that accepts real-world labels** (≤ 12 repeated values, ≤ 32 characters, any letters or spaces).
  - Labels stay withheld by default. Only the category kind and the count reach the twin.
  - This needs a privacy review, because more fields become enum.
- **The question for a required `no_source` field** should name the candidate fields. The oracle could then answer it as a user would.
- **An optional destination field whose source is null or missing** could be omitted instead of failing the record.
  - This changes the engine semantics in ADR 0006, so it needs a new ADR.

**Fix applied for cause 2 (not yet evaluated live).**
- `profileRecords` also accepts repeated real-world labels as categories: ≤ 12 labels, ≤ 32 characters, at least 2 values per label on average.
- All 8 dev category sources are now `enum` with labels withheld. 7 of 8 have a descriptor no other field shares.
- Historical replays use `labelCategories: false` and still reproduce their recorded prompts.
- **Remaining weakness:** every category gets the role text "Lifecycle status category". A category without a concept (for example a membership type) can still look like other category fields.
- Whether Gemini now finds category sources must be measured on a fresh holdout. This holdout is inspected.
