# Sprint 18C — Does EYES now deliver complete, correct integrations? (pre-registration)

**Status: PRE-REGISTERED.**
- This document was written before any model saw the Sprint 18C evaluation set, and it is frozen with the set by `node scripts/freeze-ai-value.mjs --set c`.
- Results are appended in [§ Results](#results) and never edit the sections above them.
- **The live run needs the owner's approval of the budget below.** Without it, the verdict is NOT RUN.

## Question

**Hypothesis H18C.** EYES reaches correct, complete integrations on most fresh, resolvable scenarios. The user only answers the questions EYES asks; no known-wrong record is labelled verified, nothing is invented, and correspondence quality does not regress. Three corrective changes since the Sprint 18B architecture make this possible:
- category detection for real-world labels, with distinguishable descriptors and category groupings (ADR 0020);
- the optional-absent rule (ADR 0019);
- a picker for any field on plan questions.

## Evaluation set

`tests/fixtures/eval-18c/` was written by an **independent author**: a separate agent with no access to `src/`, the prompts, the scorers, the evidence or any earlier holdout. It could read only the 18B fixture README and the 18B dev files, for the format.

| Split | Scenarios | Use |
| --- | --- | --- |
| `dev/` | 4 (3 completable) | Engineers may read and tune on these |
| `holdout/` | 16 (12 completable, 4 with a required field that has no valid source) | **Never opened.** Read only by the frozen harness and scorer, which emit aggregates and per-index rows |

**Additions over 18B:**
- **Confusable category fields in every scenario:**
  - account status vs payment status;
  - membership type vs lifecycle state;
  - segment vs category;
  - stage vs priority.
- **Repeated personal-name fields** that must not feed an enum.
- **Optional values** that are null in some records and missing in others.
- **Required fields** that are null in some records.
- **Optional targets** that need unsupported transformations.
- **Ambiguous identifiers.**
- **Hand-written `expectedSamples`:** 4 records per completable scenario.

The earlier holdouts (18A, 18A.5, 18B) are consumed and are not used.

## Configurations

| Config | App | Twin | Prompt / decoder schema |
| --- | --- | --- | --- |
| **P0** | `cb26d64` (Sprint 18B architecture before the corrective changes), served from a temporary worktree | token-only categories, pre-18C lexicon. Rebuilt offline with `labelCategories: false` | intent plan prompt v5, `integration-intent-plan-1` |
| **P1** | `sprint-18b-ai-first` at the frozen candidate SHA recorded in the freeze manifest | real-world categories, groupings (ADR 0020) | the same v5 prompt and decoder schema; `maxOutputTokens` 8192 |

**Shared by both configurations:**
- the model `gemini-3.5-flash-lite`, `ONLY_IN_CLOUD`, through Firebase AI Logic;
- the same seed and the technical-view UI path;
- the in-app approval gate;
- no category names shared, and no Gemini revision.

**Scoring choice.** Both configurations are executed offline by the P1 engine (ADR 0019). P0 therefore also benefits from the optional-absent fix, so the comparison isolates planning and is conservative against P1.

## Scoring (frozen scorer `src/evaluation/eval-18c.ts`)

- **Prompt proof.** Every recorded prompt hash must equal the scorer's reconstruction and the in-app preview (S2).
- **Correspondences.** As in 18B (M1–M3). A multi-candidate `field-meaning` entry is never correct.
- **Oracle user.** The oracle answers exactly the questions the app asks, truthfully from the ground truth:
  - a category translation (`categoryMap`);
  - a date order;
  - a choice of field. This covers "missing required source", because the picker now lists every usable field.

  The oracle never corrects a confident wrong correspondence it was not asked about, and never answers for a concat target.
- **End-to-end.** The compiled contract runs through the canonical engine, the guided acceptance policy and the semantic verifier. Each record is compared with the engine run of the ground-truth mapping.
- **Ground-truth integrity.** The author's hand-written samples must agree with that engine run: 0 mismatches in the zero-request rehearsal. If any mismatch appears, the **author** (not the engineer) reviews it, and the fix is recorded as a freeze amendment before any model run.
- **Recovery.** A provider failure is any answer that is not HTTP 200 with readable text. It may be followed by **one** new request, which the in-app gate approves again (the product's own recovery path). The last attempt decides the outcome, and every request counts towards R1.

## Metrics and thresholds (holdout, live, pooled over two trials)

Unit: one scenario-trial. Bold = Gate C.

| ID | Metric | Pass condition (P1) |
| --- | --- | --- |
| **E1** | Complete integrations: compiled complete, every record equal to the expected output or correctly held, no semantic mismatch. Measured over **completable scenario-trials sent**; provider failures that the one recovery did not fix count as failures | **≥ 0.70** (P0 reported) |
| **E2** | Incorrect records among transformed records | **≤ 0.05** |
| **S5** | Records with a wrong value in a field the verifier reported `SEMANTIC_PASS` (false verification) | **= 0** |
| E2b | Wrong records counted as accepted (structure-valid, meaning not verified) | reported |
| **E3** | False completes on non-completable scenarios | **= 0** |
| **M1** | Correct correspondences, all fields | **≥ P0 − 0.05** |
| **M2** | Correct correspondences, mappable targets | **≥ P0 − 0.05** |
| **M3** | Correct category correspondences | **≥ 0.60** |
| **M4** | Invented executable values (defaults, Gemini translations of withheld labels) | **= 0** |
| M6, M7, M8 | Unnecessary abstention, appropriate abstention, incorrect `unsupported` | reported |
| **M10** | Hallucinated references | **≤ P0** |
| **R1** | Provider success rate over **all** P1 requests, including recovery requests | **≥ 0.90** |
| **R2** | HTTP 400 responses (schema refusal) | **= 0** |
| R3 | HTTP 5xx, latency (median), prompt and output tokens | reported |
| **U1** | Manual field choices per scenario-trial | **≤ 0.5 ×** the baseline guided flow (Sprint 16B rules) |
| **U2** | All clarification answers per scenario-trial | **≤ 0.6 ×** baseline. Answers the user genuinely needs are protected by E1/E2, so omitting them cannot pass |
| U3 | Unnecessary questions (about a target whose ground truth is no source) | reported |
| **S1** | Source-derived privacy findings in request bodies | **= 0** |
| **S2** | Every planned scenario-trial sent and proven (prompt = preview = reconstruction) | **every one** |
| **S3** | Unauthorized requests: more than one request per attempt, more than one recovery, or a recovery without a provider failure | **= 0** |

**What these thresholds rule out:**
- zero invented values with few mappings (E1, M1, M2);
- schema-valid but wrong output (E2, S5);
- good field accuracy with no complete integrations (E1);
- low effort bought by skipping necessary questions (E1, E2);
- good accuracy on answered requests while provider failures are ignored (E1 counts unrecovered failures, R1).

## Budget (requires owner approval)

| Item | Value |
| --- | --- |
| First requests | 16 holdout scenarios × 2 configs × 2 trials = **64** |
| Recovery requests | at most one per failed scenario-trial. **Hard cap 16**: when it is reached, further failures stay failures |
| Maximum | **80 requests** to `gemini-3.5-flash-lite` |
| Expected tokens | about 3–4 k prompt and 1 k output tokens per request (18B: answers ≤ 3.1 KB), so ≤ about 0.32 M prompt and ≤ 0.1 M output tokens in total. Priced at Google's published Gemini flash-lite rates on the run date, recorded in the results |
| Order | ABBA: P0 t1, P1 t1, P1 t2, P0 t2, then the recovery attempts for each configuration and trial |
| Revisions, automatic retries | none |
| Stop rules | Stop on the first source-derived privacy finding (trace it before any conclusion). Stop a configuration when its first 4 requests all return HTTP 400 (a deterministic refusal; diagnose on dev, as in 18B). Never loop requests until one passes |
| Rehearsals (zero requests) | (1) `node scripts/eval-18c.mjs --rehearse`: P0 and P1 build, reconstruction, privacy pre-scan and sample check on the holdout, counts only. (2) The UI up to an enabled Send button on the dev split for both served apps, with a preview-to-reconstruction match |

## Results

### Live run (2026-11-17, owner-approved budget of 80 requests)

**Setup.**
- P1 = `sprint-18b-ai-first` @ `a08149b` (the frozen candidate), served on port 5174. P0 = `cb26d64`, served from a temporary worktree on port 5175.
- Order ABBA: P0 t1, P1 t1, P1 t2, P0 t2, then recovery.
- Evidence: [reliability-live.json](../evidence/sprint-18c/reliability-live.json) (alias-level answers, hashes, statuses, token counts). Summary: [reliability-live-summary.json](../evidence/sprint-18c/reliability-live-summary.json).
- The scorer `src/evaluation/eval-18c.ts` was unchanged after the freeze.

**Requests: 66 of 80.**
- 64 first requests.
- 2 recovery requests: P0 t2 #11 and #15 after HTTP 500, each re-approved in-app, both HTTP 200.
- No stop rule fired.

**Rehearsals (zero requests):** the offline holdout rehearsal and the UI rehearsals on dev and holdout passed for P0 and P1:
- 16 / 16 ready to send;
- dev previews equal the reconstruction;
- 0 leaks;
- 0 sample mismatches.

| ID | Metric | P0 | P1 | Pass condition | Verdict |
| --- | --- | --- | --- | --- | --- |
| **E1** | Complete integrations, completable scenario-trials | 1 / 24 (0.042) | **0 / 24** | ≥ 0.70 | **FAIL** |
| **E2** | Incorrect among transformed records | 257 / 281 (0.915) | **202 / 202 (1.0)** | ≤ 0.05 | **FAIL** |
| **S5** | Falsely verified records | 0 | **0** | = 0 | pass |
| E2b | Wrong records counted as accepted (structure only) | 257 | 202 | reported | — |
| **E3** | False completes | 0 | **1** | = 0 | **FAIL** |
| **M1** | Correct correspondences, all fields | 0.556 | 0.526 | ≥ P0 − 0.05 | pass |
| **M2** | Correct correspondences, mappable | 0.653 | 0.604 | ≥ P0 − 0.05 | pass |
| **M3** | Correct category correspondences | 0.388 | **0.398** | ≥ 0.60 | **FAIL** |
| **M4** | Invented executable values | 0 | 0 | = 0 | pass |
| M6 / M7 / M8 | Unnecessary abstention / appropriate abstention / incorrect `unsupported` | 0.064 / 0.475 / 2 | 0.117 / 0.462 / 1 | reported | — |
| **M10** | Hallucinated references | 0 | 0 | ≤ P0 | pass |
| **R1** | Provider success, all requests | 0.941 (2 × HTTP 500, both recovered) | **1.0** | ≥ 0.90 | pass |
| **R2** | HTTP 400 | 0 | **0** | = 0 | pass |
| R3 | Median latency; prompt / output tokens | 6.6 s; 84.5 k / 26.4 k | 5.7 s; 87.5 k / 26.2 k | reported | — |
| **U1** | Manual field choices per scenario-trial | 2.63 | **2.5** (baseline 9.38) | ≤ 0.5 × baseline | pass |
| **U2** | All clarification answers | 6.31 | **6.59** (baseline 13.13) | ≤ 0.6 × baseline | pass |
| U3 | Unnecessary questions | 17 | 14 | reported | — |
| **S1** | Privacy findings | 0 | 0 | = 0 | pass |
| **S2** | Every scenario-trial sent and proven | 32, 0 mismatches | 32, 0 mismatches | every one | pass |
| **S3** | Unauthorized requests | 0 | 0 | = 0 | pass |

Also: 1 P1 plan was rejected whole (`MALFORMED_PLAN`).

**Gate C verdict: FAIL** on E1, E2, E3 and M3. The holdout is now **inspected**.

### Trace (aggregate-only, after scoring)

Codes and counts only; no names, fields or values were printed.

**Gemini's confidence is calibrated, but the compiler ignored it.**

| P1 correspondences | Right | Wrong | Precision |
| --- | --- | --- | --- |
| high | 115 | 18 | 86 % |
| medium | 30 | 49 | 38 % |
| low | 16 | 61 | 21 % |

P0 is similar: 119 / 26, 36 / 26 and 15 / 78.

**Errors are spread across whole plans.**
- 25 of 31 usable P1 plans have 3 or more wrong correspondences.
- The oracle, like a user who trusts the match table, does not correct a match it was not asked about. A single wrong field makes every record wrong.

**Wrong correspondences by ground-truth transform (P1):**

| Transform | Wrong |
| --- | --- |
| map_enum | 56 |
| copy | 33 |
| no valid source (a decoy was used) | 21 |
| concat | 9 |
| trim | 7 |
| parse_date | 2 |

The category groupings did not move category correspondence (0.388 → 0.398).

**Provider reliability is not the blocker.**
- P1: 32 / 32 HTTP 200, 0 HTTP 400.
- P0: two HTTP 500, both recovered by the one approved re-request.

### Correction implemented after the run (not evidence)

[ADR 0020 §7](../decisions/0020-category-groupings-and-plan-recovery.md), commit `62b6a32`: a single-field correspondence below high confidence becomes a choose-field question, with Gemini's pick listed first, instead of an executed match. Exempt: a category match awaiting the user's translation.

**Exploratory replay of the recorded P1 answers through `62b6a32`.**
- It ran once, after the commit, and the rule was not changed afterwards. The holdout is inspected, so these figures are **not evidence**.

| Measure | Live P1 | Replay |
| --- | --- | --- |
| E1 | 0 / 24 | 3 / 24 |
| E2 | 1.0 | 0.636 (117 wrong records accepted structurally) |
| S5 | 0 | 0 |
| E3 (false completes) | 1 | 0 |
| U1 | 2.5 | 3.22 |
| U2 | 6.59 | 7.31 (≤ 7.88 allowed) |

The correction removes silent errors without breaking the effort bound, but it is far from the 0.70 target. **The limit is the planner's correspondence accuracy.** A successor needs a fresh holdout and a new pre-registration.
