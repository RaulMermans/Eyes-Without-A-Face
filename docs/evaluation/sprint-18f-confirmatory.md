# Sprint 18F — Confirmatory evaluation of ADR 0022 (pre-registration)

**Status: PRE-REGISTERED, NOT RUN.**
- Written before any model saw the eval-18f holdout. Frozen by `node scripts/freeze-ai-value.mjs --set f`.
- Results are appended under [§ Results](#results) and never edit the sections above them.
- **The live run needs the owner's approval of the budget below.**

## Question

Does the ADR 0022 pipeline deliver complete, correct integrations on fresh data that nobody has seen?
- Evidence so far is an exploratory replay of 125 recorded answers: **66 / 95**, wedge 0.70, general 0.69.
- That replay was tuned on its own data, so a drop is expected here.

## Frozen configurations (code at the freeze commit)

| | Baseline | Candidate |
| --- | --- | --- |
| Request (arm) | **A**: `gemini-3.5-flash-lite` at its default thinking, disclosure 1.1.0, prompt v5 (the Sprint 18C request) | **RB**: `gemini-3.5-flash-lite` at its default thinking, disclosure 1.4.0 (sanitized destination descriptions), prompt v6 (ranked alternatives) |
| Compiler policy | `base`: the 18C rule, plus the ADR 0022 corrections that apply to every compile | `local`: local candidates order the questions, and local evidence asks (ADR 0022 B, C) |

**Simulated user:** `runOracle18d`. It answers exactly the questions the app asks, truthfully from the ground truth:
- "Not the right field" when a question shows the wrong field;
- "Combine several fields" for a combined value, with a separator the question offers;
- identical labels mapped to themselves;
- it never corrects a match it was not asked about.

## Holdout

`tests/fixtures/eval-18f/holdout/`: 24 scenarios.
- **wedge:** 12 (9 completable);
- **general:** 12 (9 completable).

**Independence.**
- A new independent author wrote it after the ADR 0022 implementation (`085c0b6`). The author had no access to the implementation, prompts, evidence or any earlier holdout.
- The holdout and the author's `author/specs_holdout_*.py` are sealed, and no engineer opens them.
- Only the frozen scorer reads them, emitting aggregates and per-index rows.

## Run

- 24 scenarios × 2 configurations × 1 trial = **48 first requests**, interleaved per scenario (A, then RB).
- One re-approved recovery request per provider failure, with a hard cap of 12. A scenario whose UI step sent nothing is re-run once through the same slot.

## Gates (evaluated by EVAL-402; thresholds fixed now)

**Improvement (F).** Bold rows must pass for "improvement confirmed".

| ID | Metric | Pass |
| --- | --- | --- |
| **F1** | Candidate E1 − baseline E1, completable (18 each) | **≥ +0.20** |
| **F2** | Wedge E1 | **candidate > baseline** |
| **F3 / F4 / F5** | Candidate: falsely verified records / false completes / invented values | **0 / 0 / 0** |
| **F6** | Incorrect among transformed records | **candidate < baseline** |

**Milestone 1. The original Gate D, unchanged,** applied to the candidate:

| Metric | Pass |
| --- | --- |
| E1-W, and E1-G | **≥ 0.70** each |
| E2 | **≤ 0.05** |
| S5 = 0, E3 = 0, M4 = 0, M10 ≤ A, M1 ≥ A − 0.05 | as stated |
| U1 (manual field choices) | **≤ 0.5 ×** the manual guided flow |
| U2 (all answers) | **≤ 0.6 ×** the manual guided flow |
| R1 | **≥ 0.90** |
| S1 / S2 / S3 | 0 / every request proven / 0 |

**Verdict wording (fixed).**
- Every Milestone 1 row passes: **"Milestone 1 accepted"**.
- Every row except E1-G passes: **"narrow-scope success (wedge only)"**.
- Otherwise: **"Milestone 1 not met"**.

**Known in advance and reported plainly.** The candidate asks more questions by design: the exploratory replay ran at 0.70 × the manual flow, against U2's 0.6 ×. Unless the owner changes the effort bound **before** the run, U2 will very likely fail the Milestone verdict even if correctness passes.

## Budget (needs owner approval)

| Item | Value |
| --- | --- |
| Model | `gemini-3.5-flash-lite` only, `ONLY_IN_CLOUD`, App Check, Firebase AI Logic |
| Requests | 48 first, plus ≤ 12 recovery = **≤ 60** |
| Expected cost | measured about $0.003 per request, so **≈ $0.20** |
| Worst case | 60 × (3.5 k in at $0.30 + 8 192 out at $2.50 per 1 M), so **≤ $1.30** |
| Stop rules | Stop on any source-derived privacy finding. Stop a configuration after 4 consecutive HTTP 400 or 429. No automatic retry, no model fallback, no loops |

**Zero-request rehearsals before the run:**
- EVAL-401: both configurations build all 24, 0 leaks, 0 sample mismatches.
- The UI dry run on the holdout for A and RB: ready to send, and the preview equals the reconstruction.

## Results

### Confirmatory run (2026-11-18, owner-approved; gate unchanged)

**Requests: 53 of 60.**
- 48 first requests, interleaved per scenario.
- 5 recovery requests: 4 after HTTP 500 `INTERNAL` (all recovered) and 1 after a 45 s client timeout (it then returned HTTP 500).
- No stop rule fired. 0 privacy findings, 0 prompt mismatches, 0 unauthorized requests.
- Recorded tokens: A 68.5 k in / 19.6 k out; RB 69.8 k in / 21.3 k out. **≈ $0.15.**
- Evidence: [live.json](../evidence/sprint-18f/live.json). Official scoring (EVAL-402, frozen code): [summary-official.json](../evidence/sprint-18f/summary-official.json).

**Improvement gate (F): PASS. Improvement confirmed.**

| ID | Metric | Baseline A / `base` | Candidate RB / `local` | Verdict |
| --- | --- | --- | --- | --- |
| **F1** | E1, completable | 1 / 18 (0.056) | **9 / 18 (0.500)** (+0.44) | pass |
| **F2** | E1, wedge | 0 / 9 | **4 / 9** | pass |
| — | E1, general | 1 / 9 | 5 / 9 | reported |
| **F3 / F4 / F5** | Falsely verified records / false completes / invented values | 0 / 2 / 0 | **0 / 0 / 0** | pass |
| **F6** | Incorrect among transformed records | 361 / 402 (0.898) | **177 / 452 (0.392)** | pass |

**Milestone 1 (original Gate D, unchanged): NOT MET.**

| Row | Candidate | Bound | Verdict |
| --- | --- | --- | --- |
| E1-W / E1-G | 0.44 / 0.56 | ≥ 0.70 each | fail |
| E2 | 0.392 | ≤ 0.05 | fail |
| S5, E3, M4 | 0, 0, 0 | 0 | pass |
| M1 | 0.354 (A: 0.339) | ≥ A − 0.05 | pass |
| M10 | 0 | ≤ A | pass |
| U1 | 5.75 (manual flow 8.75) | ≤ 0.5 × | fail |
| U2 | 8.58 (manual flow 11.58) | ≤ 0.6 × | fail |
| R1 | 23 / 27 = 0.85 (HTTP 500 `INTERNAL`, client timeout) | ≥ 0.90 | fail |
| S1 / S2 / S3 | 0 / proven / 0 | | pass |

**Other measures:**
- Correspondence, candidate: M2 0.368, M3 0.190.
- Top-1 / top-3 recall: Gemini 0.488 / 0.711, local 0.668 / 0.834, combined top-3 0.855.

**The holdout is now inspected.**

### Trace (aggregate only, after scoring)

**Candidate, 18 completable scenarios:**
- 9 complete;
- 1 had no answer (provider);
- **2 lost to whole-plan rejection**;
- 6 failed with a single cause each:

| Cause | Scenarios |
| --- | --- |
| A field with no valid source filled by a decoy | 2 |
| Wrong value source | 2 |
| Wrong date source | 1 |
| Wrong combined field | 1 |

In all six, Gemini and the local matcher agreed on the wrong field.

**Whole-plan rejections, across both configurations: 7.** Each was one entry listing more candidate fields than the canonical bound (`from` > 4, `alternatives` > 2). The decoder cannot enforce nested bounds (ADR 0018), so the validator rejected the whole plan, against ADR 0018's own entry-level rule.

### Correction after the run (not evidence)

- **Change.** `validateIntentPlan` now rejects only the over-long entry: its field is asked, and nothing is repaired. Any other schema violation still rejects the plan.
- **Exploratory rescore of these recorded answers with the correction:**
  - candidate 10 / 18 (wedge 5 / 9);
  - false completes 0 → **1**: a rescued plan for a non-completable scenario met a decoy;
  - baseline 2 / 18.
- The replay corpus is unchanged (66 / 95).
- None of this is evidence. A claim needs another fresh holdout.

