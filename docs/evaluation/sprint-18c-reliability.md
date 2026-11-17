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

_Not run._
