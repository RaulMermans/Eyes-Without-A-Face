# Sprint 18D rescue — confirmatory holdout run (pre-registration)

**Status: PRE-REGISTERED, NOT RUN.**
- Written before any model saw the 18D holdout. Frozen by `node scripts/freeze-ai-value.mjs --set d2`.
- Results are appended under [§ Results](#results) and never edit the sections above them.
- **The live run needs the owner's approval of the budget below.**

Context:
- [Stage 1 results](sprint-18d-semantic-intelligence.md#results).
- [ADR 0021](../decisions/0021-semantic-intelligence-recovery.md).
- The candidate was chosen on dev, **after** Stage 1. The Stage 1 pre-registered rules selected no eligible configuration, so this run is a new pre-registration and not the original Stage 2.

## Frozen candidate

| | Baseline | Candidate |
| --- | --- | --- |
| Code | `105c6002` (this tree) | `105c6002` (this tree) |
| Arm (what is sent) | **A**: flash-lite, default thinking, disclosure 1.1.0, prompt v5. This is the Sprint 18C P1 request, byte-identical | **RB**: flash-lite, default thinking, disclosure 1.4.0 (sanitized destination descriptions), prompt v6 (ranked alternatives) |
| Policy (what the compiler does) | `base`: the 18C rule | `local`: local candidates order the questions; local evidence may ask (contradicted pick, empty optional field with a clear local candidate, category field whose clear local top-1 differs) |

**Not part of this run:**
- `gemini-3.8-flash`: 2 / 56 usable in Stage 1;
- thinking HIGH: 6 × cost per request, no completeness gain;
- the removed exploratory options.

## Holdout

`tests/fixtures/eval-18d/holdout/`: 20 scenarios.
- **wedge:** 12 (9 completable);
- **general:** 8 (6 completable).

**Independence.** An independent author wrote it before the candidate existed, without access to the implementation.
- It has been sealed since: no engineer opened it or the author's holdout specs.
- Only counts-only rehearsals read it (EVAL-306).
- It is the "fresh independent holdout" for this candidate. The 18A, 18A.5, 18B and 18C holdouts are not used.

## Run

- Each configuration runs 20 scenarios × 2 trials = **80 first requests**. Order ABBA: A t1, RB t1, RB t2, A t2.
- **Recovery.** A provider failure (anything other than HTTP 200 with readable text) gets at most **one** new request, re-approved in-app. There is a hard cap of 20 recovery requests, and the last attempt decides.
- No automatic retry and no model fallback.

## Metrics and thresholds

Unit: one scenario-trial. **Bold rows are the gate.** An unrecovered provider failure counts as a failure.

| ID | Metric | Pass condition |
| --- | --- | --- |
| **G1** | E1 improvement: candidate E1 − baseline E1, completable scenario-trials (30 each) | **≥ +0.20** |
| **G2** | E1 improvement, wedge track (18 each) | **candidate > baseline** |
| **S5** | Falsely verified records (candidate) | **= 0** |
| **E3** | False completes (candidate) | **= 0** |
| **M4** | Invented executable values (candidate) | **= 0** |
| **E2** | Incorrect among transformed records (candidate) | **< baseline** |
| **U2** | All answers per scenario-trial (candidate) | **≤ 0.6 ×** baseline guided flow (Sprint 16B rules) |
| **R1** | Provider success, every candidate request | **≥ 0.90** |
| **S1 / S2 / S3** | Privacy findings / prompt = preview = reconstruction / unauthorized requests | **0 / every one / 0** |
| M1–M3, T1/T3 (Gemini, local, combined), no-source abstention (local offers and asked questions on no-source targets), U1, U3, latency, tokens, cost | | reported |
| **Milestone 1** (unchanged) | E1-W ≥ 0.70 **and** E1-G ≥ 0.70 (candidate) | reported; not part of G1/G2 |

**Verdict wording (fixed now).**
- Every bold row passes: **"rescue improvement confirmed"**. Milestone 1 is still judged only by its own row.
- Any bold row fails: **"rescue not confirmed"**.

## Budget (needs owner approval)

| Item | Value |
| --- | --- |
| Model | `gemini-3.5-flash-lite`, default thinking (MINIMAL), via Firebase AI Logic, `ONLY_IN_CLOUD`, App Check |
| Requests | 80 first, plus ≤ 20 recovery = **≤ 100** |
| Expected cost | Stage 1 measured about $0.003 per request, so **≈ $0.30** |
| Worst case | 100 × (3.2 k in at $0.30 + 8 192 out at $2.50 per 1 M), so **≤ $2.15** |
| Stop rules | Stop on any source-derived privacy finding (trace it before drawing any conclusion). Stop a configuration after 4 consecutive HTTP 400 or 429. Never loop requests until one passes |

**Rehearsals before the run (zero requests):**
- `node scripts/eval-18d.mjs --rehearse`: every arm builds, 0 leaks, 0 sample mismatches.
- The UI dry run on the holdout split for A and RB: ready to send, and the preview equals the reconstruction.

## Results

(none yet)
