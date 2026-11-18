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

- **Amendment 1 (owner, before any holdout request):** one trial per configuration, the smallest run that still answers G1/G2.
  - 20 scenarios × 2 configurations × 1 trial = **40 first requests**.
  - Order: interleaved per scenario (A, then RB).
- **Recovery.** A provider failure (anything other than HTTP 200 with readable text) gets at most **one** new request, re-approved in-app. There is a hard cap of 10 recovery requests, and the last attempt decides.
- No automatic retry and no model fallback.

## Metrics and thresholds

Unit: one scenario-trial. **Bold rows are the gate.** An unrecovered provider failure counts as a failure.

| ID | Metric | Pass condition |
| --- | --- | --- |
| **G1** | E1 improvement: candidate E1 − baseline E1, completable scenarios (15 each) | **≥ +0.20** |
| **G2** | E1 improvement, wedge track (9 each) | **candidate > baseline** |
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
| Requests | 40 first, plus ≤ 10 recovery = **≤ 50** (amendment 1) |
| Expected cost | Stage 1 measured about $0.003 per request, so **≈ $0.15** |
| Worst case | 50 × (3.2 k in at $0.30 + 8 192 out at $2.50 per 1 M), so **≤ $1.10** |
| Stop rules | Stop on any source-derived privacy finding (trace it before drawing any conclusion). Stop a configuration after 4 consecutive HTTP 400 or 429. Never loop requests until one passes |

**Rehearsals before the run (zero requests):**
- `node scripts/eval-18d.mjs --rehearse`: every arm builds, 0 leaks, 0 sample mismatches.
- The UI dry run on the holdout split for A and RB: ready to send, and the preview equals the reconstruction.

## Results

### Confirmatory run (2026-11-18, owner-approved, amendment 1)

**Requests: 45 of 50.**
- 40 first requests, interleaved per scenario.
- 5 recovery requests after HTTP 500: 2 recovered, 3 did not.
- 2 harness re-runs. Baseline scenarios #15 and #16 sent **no** request on their first attempt: the destination step's UI check failed before Send, although both had passed the zero-request rehearsal. They were re-run once each through the recovery slot; both were sent, and both returned HTTP 500.
- No stop rule fired.
- Evidence: [stage2-live.json](../evidence/sprint-18d/stage2-live.json) (alias-level answers, hashes, statuses, tokens). Scored: [stage2-summary.json](../evidence/sprint-18d/stage2-summary.json) (EVAL-308, aggregates and per-index rows).
- Recorded cost: **≈ $0.10** (A 46.8 k in / 12.4 k out; RB 52.7 k in / 15.7 k out tokens).

| ID | Metric | Baseline A / `base` | Candidate RB / `local` | Pass condition | Verdict |
| --- | --- | --- | --- | --- | --- |
| **G1** | E1, completable | 0 / 15 | **1 / 15** (+0.067) | ≥ +0.20 | **FAIL** |
| **G2** | E1, wedge | 0 / 9 | 0 / 9 | candidate > baseline | **FAIL** |
| E1-G | E1, general | 0 / 6 | 1 / 6 | reported | — |
| **S5** | Falsely verified records | 0 | **0** | = 0 | pass |
| **E3** | False completes | 2 | **0** | = 0 | pass |
| **M4** | Invented values | 0 | **0** | = 0 | pass |
| **E2** | Incorrect among transformed | 112 / 121 (0.926) | **126 / 168 (0.750)** | < baseline | pass |
| **U2** | Answers per scenario-trial | 5.05 | **6.25** (baseline flow 11.65; ≤ 6.99) | ≤ 0.6 × | pass |
| U1 / U3 | Manual choices / unnecessary questions | 2.25 / 0.55 | 3.25 / 0.80 | reported | — |
| **R1** | Provider success, candidate requests | 17 / 22 | **18 / 23 (0.78)** | ≥ 0.90 | **FAIL** (HTTP 500, clustered in time) |
| **S1 / S2 / S3** | Privacy / prompt proof / unauthorized | 0 / 0 mismatches / 0 | 0 / 0 mismatches / 0 | 0 / every one / 0 | pass |
| M1 / M2 / M3 | Correspondence: all / mappable / category | 0.443 / 0.518 / 0.333 | 0.469 / 0.564 / 0.351 | reported | — |
| T1 / T3 | Gemini top-1 / top-3 | 0.566 / 0.662 | 0.600 / **0.800** | reported | — |
| T1 / T3 | Local matcher top-1 / top-3 | 0.747 / 0.852 | 0.747 / 0.852 | reported | — |
| R3 | Median time per scenario (UI), median | 12.5 s | 14.8 s | reported | — |
| **Milestone 1** | E1-W ≥ 0.70 and E1-G ≥ 0.70 | — | 0 / 9, 1 / 6 | — | **NOT MET** |

**Verdict: rescue not confirmed** (G1, G2 and R1 fail). The holdout is now **inspected**.

**What held:**
- no false verification;
- no false complete (the baseline had 2);
- no invented values;
- fewer wrong records (0.75 vs 0.93);
- question load within the bound;
- 0 privacy findings.

**What did not:** complete integrations stayed near zero. The dev result (5 / 11) did not generalize.

### Trace (aggregate only, after scoring; codes and counts, no names, fields or values)

Candidate, 15 completable scenarios:
- 1 had no answer (HTTP 500 after recovery);
- 13 failed with an answer;
- 1 succeeded.

Blockers, counted as scenarios containing them:

| Blocker | Scenarios |
| --- | --- |
| **Wrong source executed: value fields** | **6** |
| Wrong source executed: date fields | 3 |
| Wrong source executed: concatenated fields | 2 |
| Wrong operation | 4 |
| Required category field left unfilled | 4 |
| Required date field left unfilled | 2 |
| Optional category / value field left unfilled | 2 / 2 |
| Concatenated field unfillable | 2 |
| `copy` instead of `trim` | 1 |

- 3 scenarios have a single blocker: 2 are a wrong value source, 1 an unfilled required date.
- **Single highest-impact remaining cause: confident wrong source fields executed without a question**, in 8 of 13 scenarios (value, date or concatenated).
- Unlike on dev, the local matcher's evidence rarely *contradicts* these picks, so the candidate rule does not ask. The local matcher's top-1 (0.75) is still well above Gemini's (0.60). Trusting it more is a hypothesis that needs a fresh holdout, not a conclusion.

