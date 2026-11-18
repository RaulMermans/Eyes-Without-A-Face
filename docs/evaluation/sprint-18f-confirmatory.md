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

(none yet)
