# Sprint 18E — Confident-mismatch recovery (exploratory diagnosis and replay)

**Status: EXPLORATORY.** Every number below comes from replaying RECORDED real Gemini answers offline. No new Gemini call was made.
- Source answers:
  - 18C holdout, P1 = arm A, 32 answers;
  - 18D dev Stage 1, 58 answers;
  - 18D holdout confirmatory run, 35 answers.
- All 125 replay byte-identically against today's prompt reconstruction (`src/evaluation/dev-corpus.ts`).
- **The 18C and 18D holdouts are consumed.** They are diagnosis data here, and **never** proof. A success claim needs a new independent holdout.

Harnesses (aggregates only):
- `tests/evaluation/disagreement-18e.test.ts`: `EYES_DIAG_18E=1`;
- `tests/evaluation/diagnose-18d.test.ts`: `EYES_DIAGNOSE=1`.

## Root cause

When Gemini and the local matcher disagree, Gemini is usually wrong. Until now, a confident Gemini pick was executed regardless.
- Gemini never sees source field names; the local matcher does.
- So their disagreement carries information that Gemini's own confidence does not.

## Phase 1 — Disagreement statistics (863 single-source Gemini picks, concat excluded)

| Relation to local top-1 | Picks | Gemini right | Local right | Both wrong | Gemini error |
| --- | --- | --- | --- | --- | --- |
| Agree | 614 | 566 | 566 | **48** | **0.08** |
| Disagree, local **clear** about another field (pick listed lower) | 44 | 5 | 34 | 5 | **0.89** |
| Disagree, local **clear**, pick not listed | 40 | 2 | 34 | 4 | **0.95** |
| Disagree, pick **contradicted** by local evidence | 15 | 0 | 9 | 6 | **1.00** |
| Disagree, local unsure, pick **not listed** | 17 | 0 | 5 | 12 | **1.00** |
| Disagree, local unsure, pick listed | 80 | 50 | 25 | 5 | 0.38 |
| No local candidate | 53 | 16 | — | 37 | 0.70 |

**By Gemini confidence:** a high-confidence pick that disagrees is wrong 52 % of the time (n = 83). Before 18E these executed silently.

**By target kind, among disagreements:**
- category: Gemini error 0.92, local right 44 / 60;
- value: 0.72;
- date: 0.31.

**Disagreement strength predicts errors.** By the local score margin among disagreements:
- ≥ 4: Gemini wrong 21 / 21;
- 2–4: 0.83;
- < 1: 0.45.

**Agreement can be wrong too.** Both were wrong in 48 cases (8 %). No disagreement rule can catch those.

**No-source decisions** (Gemini said "no source"):
- The field really has a source and the local matcher is clear: local right 58, wrong 3.
- The field really has none: local clear on 4, unsure on 20, silent on 54.

## Phase 2 — Policy (`src/plan/agreement.ts`, wired via `CompileInput.local.askOnLocalEvidence`)

Deterministic classes for Gemini's single-source pick. Model confidence is not an input.

1. **Supported agreement** (local top-1 = the pick): the existing rules decide. Agreement never upgrades an uncertain match.
2. **Significant disagreement** (pick contradicted, local clear about another field, or the pick not in the local list): **one choose-field question**, whatever Gemini's confidence, and before any category translation.
   - The ranked candidates are Gemini's pick, then the local candidates.
   - "Choose another field" and "none" stay available.
   - Nothing is switched automatically.
3. **Insufficient evidence** (local unsure and the pick listed, or no local candidate): the existing rules decide.
4. **No valid source:** Gemini's "no source" stands unless the local matcher is clear. Then one question, for optional fields; a required field is already asked.

Unchanged:
- Confirmed answers are preserved, and the field recompiles through the canonical compiler, engine and verifier.
- Questions are deduplicated and ordered required first (`buildClarifications`).
- Off in the product (`effectiveLocalPolicy` is dev-only).

## Phase 3 — Counterfactual replay (95 completable scenario-answers)

**Interceptions** (Gemini matches the old rule kept, n = 782):
- wrong picks now asked: **79**;
- right picks needlessly asked: **9**;
- precision 0.90.

**No-source fields now asked:**
- 42 really had a source;
- 2 did not.

| | Old rule (`base`) | 18E rule (`local`) |
| --- | --- | --- |
| **Complete integrations, all** | **11 / 95 (0.116)** | **26 / 95 (0.274)** |
| Wedge (CRM → helpdesk) | 5 / 27 (0.185) | **13 / 27 (0.481)** |
| General | 6 / 68 (0.088) | 13 / 68 (0.191) |
| 18C holdout / 18D dev / 18D holdout | 3 / 24, 8 / 45, 0 / 26 | 4 / 24, 18 / 45, 4 / 26 |
| Incorrect among transformed records | 786 / 1145 (0.686) | 826 / 1555 (0.531) |
| Falsely verified records | 0 | 0 |
| False completes | 4 | 3 |
| Invented values | 0 | 0 |
| Manual field choices per scenario | 2.98 | 4.05 |
| All answers per scenario | 6.35 | **7.45**. The 0.6 × baseline bound is 7.42, so this is **0.03 over** on aggregate |
| Unnecessary questions per scenario | 0.58 | 0.62 |

**Remaining causes under the 18E rule** (field counts, failed scenarios):

| Cause | Fields |
| --- | --- |
| Category translation asked about the wrong field, with no field escape in that question | 21 |
| Combined (concat) fields | 20 |
| `copy` instead of `trim` (padding invisible to Gemini) | 17 |
| Optional field neither Gemini nor local finds | 16 |
| `normalize_email` against an expected original-case email | 10 |

34 of the failed scenarios have two independent blockers.

## Phase 4 — Provider failures

**The 500s are clustered in time.**
- 18D confirmatory run: 10 × HTTP 500, all in two windows (14:55–15:01 and 15:07–15:09).
- They hit both configurations equally (A 5, RB 5).
- Each came after 8–24 s of server time. Schema or request refusals return HTTP 400 fast; there were none.
- 2 of 5 retries succeeded.

**Diagnosis: a transient provider-side internal error.** It is not caused by the application, the prompt, the decoder schema or the budget.
- The Stage 1 HTTP 429s were a separate per-model rate limit on `gemini-3.8-flash`.
- The 2 sends that never happened (confirmatory #15–#16) were a browser-harness UI check, not the provider.

**Correction (harness only):** the live harness now records the provider's error status and code, never its message. Earlier evidence has only the HTTP code. No retry or fallback was added.

## Answer

**Does detecting and resolving Gemini/local-matcher disagreements improve complete integration correctness enough to justify keeping this mechanism?**

**Yes, keep it.** It is the largest single improvement measured in Sprint 18:
- complete integrations rise 2.4×, from 0.12 to 0.27 (wedge 0.19 → 0.48);
- it catches 79 wrong picks for 9 needless questions;
- there are no safety regressions.

**It does not solve Milestone 1.**
- 0.27 overall, against the 0.70 gate.
- It spends the question budget (7.45 against 7.42).
- What is left is no longer silent wrong picks: it is the five causes above.

Exploratory replay only. Confirming it needs a fresh holdout.
