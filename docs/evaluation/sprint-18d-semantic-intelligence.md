# Sprint 18D — What actually improves correspondence? (pre-registration)

**Status: PRE-REGISTERED.**
- This document was written before any model saw the Sprint 18D evaluation set. It is frozen with the set by `node scripts/freeze-ai-value.mjs --set d`.
- Results are appended in [§ Results](#results) and never edit the sections above them.
- **Both live stages need the owner's approval of the budget below.** The default cloud budget is zero; without approval each stage's verdict is NOT RUN.

Decision: [ADR 0021](../decisions/0021-semantic-intelligence-recovery.md). Scorer: `src/evaluation/eval-18d.ts` (EVAL-300–304 prove its mechanics on dev).

## Questions

**Q1 (model).** Does a stronger model (`gemini-3.8-flash`) raise correspondence accuracy materially over `gemini-3.5-flash-lite`?

**Q2 (context).** Do sanitized destination descriptions (cloud-disclosure 1.4.0) raise accuracy independently of the model?

**Q3 (thinking).** Does a higher thinking level help either model?

**Q4 (ranking).** Does asking for ranked alternatives (prompt v6) put the right field in the top 3 when the top pick is wrong?

**Q5 (local evidence).** Does local candidate evidence improve end-to-end correctness, and does local/Gemini disagreement predict wrong matches?

**Q6 (product gate).** Does the selected configuration deliver complete, correct integrations on a fresh, independent holdout (Milestone 1)?

## Evaluation set (`tests/fixtures/eval-18d/`, independent author)

| Split | Scenarios | Wedge (CRM → helpdesk) | General | Use |
| --- | --- | --- | --- | --- |
| `dev/` | 6 | 4 (3 completable) | 2 (2) | Stage 1, tuning allowed |
| `holdout/` | 20 | 12 (9 completable) | 8 (6) | Stage 2 only. **Never opened.** Scored only by the frozen scorer |

- **Who wrote it.** The author read only the 18B/18C READMEs and the 18C dev files, for the format.
- **Sealed author files.** The author's holdout spec scripts (`author/specs_holdout_*.py`) contain holdout ground truth. They are sealed in the holdout digest and never opened.
- **Sample check.** The author's two scripts agree on all 80 expected samples.

**Stage 1 dev pool: 14 scenarios.**
- 18D dev: 6.
- 18C dev: 4. These were never sent to a model; earlier live runs used holdouts only.
- 18B dev: 4. Same: never sent to a model.

Their destinations have no descriptions, so Q2 is measured on 18C and 18D dev only (10 scenarios). It is reported separately.

## Arms (what is sent) — `ARMS_18D`

| Arm | Model | Thinking | Disclosure | Prompt |
| --- | --- | --- | --- | --- |
| **A** | flash-lite | default (MINIMAL) | 1.1.0 | v5. Byte-identical to the 18C P1 request (EVAL-300) |
| B | flash-lite | default | 1.4.0 + descriptions | v5 |
| C | 3.8-flash | default (MEDIUM) | 1.1.0 | v5 |
| D | 3.8-flash | default | 1.4.0 + descriptions | v5 |
| BH | flash-lite | HIGH | 1.4.0 + descriptions | v5 |
| DH | 3.8-flash | HIGH | 1.4.0 + descriptions | v5 |
| RB | flash-lite | default | 1.4.0 + descriptions | v6 (ranked) |
| RD | 3.8-flash | default | 1.4.0 + descriptions | v6 (ranked) |

**How arms differ.**
- A vs C and B vs D vary only the model.
- A vs B and C vs D vary only the destination context. The version string in the payload changes too ("1.1.0" vs "1.4.0").
- B vs BH and D vs DH vary only thinking.
- B vs RB and D vs RD vary only the prompt.

**Held constant across arms:** source, destination, seed, twin, validator, compiler, oracle and scorer.

## Policies (what the compiler does with an answer) — `POLICIES_18D`

Scored offline on the **same** recorded answers, so they need no extra requests:

| Policy | What it does |
| --- | --- |
| `base` | The 18C rule only: a non-high match is a question |
| `rank` | `base`, plus local candidates ranked into the questions |
| `alt` | `rank`, plus a high-confidence match that lists alternatives is asked |
| `disagree` | `rank`, plus a high-confidence match is asked when the local matcher is clear about a different field and does not list Gemini's pick |
| `both` | `alt` and `disagree` together |

## Metrics (unchanged definitions from 18C unless stated)

| Metric | Meaning |
| --- | --- |
| E1 | Complete integrations: oracle-answered, every record correct or correctly held, no semantic mismatch |
| E2 | Incorrect among transformed records |
| S5 | Falsely verified records |
| E3 | False completes |
| M1 / M2 / M3 | Correspondence: all fields / mappable fields / category fields |
| M4 | Invented executable values |
| M10 | Hallucinated references |
| T1 / T3 | **New.** Top-1 and top-3 recall on single-source targets. Reported for Gemini (`from` + `alternatives`), local (`matchLocally`) and combined (Gemini first, then local) |
| DIS | **New.** Wrong rate among high-confidence executable matches, split by whether the local matcher disagrees |
| U1 / U2 / U3 | Manual field choices / all answers / unnecessary questions |
| U4 | **New.** Choose-field answers whose true field was not in the 3 candidates shown first |
| R1 / R2 / R3 | Provider success / HTTP 400 / latency, tokens, cost |
| S1 / S2 / S3 | Privacy findings / prompt = preview = reconstruction / unauthorized requests |

The oracle answers exactly what the app asks, truthfully from the ground truth. It never corrects a confident wrong match it was not asked about.

## Stage 1 — dev, live (decision rules fixed now)

**Run.**
- 14 dev scenarios × 8 arms × 1 trial = **112 first requests**.
- At most one owner-re-approved recovery request after a provider failure, with a hard cap of 16.
- Order: arms interleaved per scenario. Evidence goes to `docs/evidence/sprint-18d/stage1-live.json`.

**Decision rules (applied mechanically; ties go to the cheaper option):**

1. **Model.** Choose 3.8-flash only if, in **both** pairs (A→C and B→D), it raises M2 by ≥ 0.10 **or** E1 (`base` policy) by ≥ 2 scenarios. If it raises only one pair, run a diagnostic note and keep flash-lite. Otherwise keep flash-lite.
2. **Context.** Adopt 1.4.0 descriptions if, on the 10 described scenarios, B ≥ A and D ≥ C on M1, with at least one pair at +0.05 and no pair below −0.05.
3. **Thinking.** Adopt HIGH for a model only if it beats that model's default arm by the bar in rule 1, and its cost per request stays ≤ 3 × the default arm's cost.
4. **Ranking.** Adopt v6 if, for the chosen model, Gemini T3 − T1 ≥ 0.10 and E1 (best policy) is not lower than with v5.
5. **Policy.** Choose the policy with the highest E1 subject to:
   - S5 = 0;
   - E3 = 0;
   - U2 ≤ 0.6 × baseline.
   
   Ties go to fewer answers (U2).
6. **The candidate** is the chosen arm plus the chosen policy. It is recorded as a freeze amendment **before** Stage 2.

**Stop rules.**
- Stop on any source-derived privacy finding, and trace it before drawing any conclusion.
- Stop an arm after its first 4 requests all return HTTP 400 (a deterministic refusal, for example an unsupported thinking level or an unavailable model). Report it as unavailable.
- Never loop requests until one passes.

## Stage 2 — holdout, live (thresholds fixed now)

**Configurations.**
- **A** (baseline, 18C P1).
- **The Stage 1 candidate.**

Each runs on 20 holdout scenarios × 2 trials, so 80 first requests, plus at most 20 recovery requests. Order ABBA.

**Gate D (on the candidate).** The wedge and general tracks are reported separately.

| ID | Metric | Pass |
| --- | --- | --- |
| **E1-W** | Complete correct integrations, **wedge** completable scenario-trials (18). Unrecovered provider failures count as failures | **≥ 0.70** |
| E1-G | The same, general track (12) | reported; Milestone 1 (general) needs ≥ 0.70 |
| **E2** | Incorrect among transformed records, both tracks | **≤ 0.05** |
| **S5** | Falsely verified records | **= 0** |
| **E3** | False completes | **= 0** |
| **M1** | Correspondence, all fields | **≥ A − 0.05** (no regression) |
| **M4** | Invented executable values | **= 0** |
| **M10** | Hallucinated references | **≤ A** |
| **U1** | Manual field choices | **≤ 0.5 ×** baseline guided flow |
| **U2** | All answers | **≤ 0.6 ×** baseline |
| **R1** | Provider success, all requests | **≥ 0.90** |
| **S1, S3** | Privacy findings, unauthorized requests | **= 0** |
| **S2** | Every scenario-trial sent and proven | every one |

**Verdict wording (fixed now).**
- Every bold row passes **and** E1-G ≥ 0.70: **Milestone 1 accepted** (evidence only; release status per AGENTS.md).
- Every bold row passes but E1-G < 0.70: **narrow-scope success (wedge only)**. Milestone 1 is not accepted.
- Any bold row fails: **Gate D failed**.

## Budget (requires owner approval, per stage)

Prices are Gemini Developer API paid tier on 2026-11-18, per 1M tokens:
- flash-lite: $0.30 in / $2.50 out.
- 3.8-flash: $0.75 in / $3.75 out (introductory).

Output includes thinking. Prompt size is about 2.7 k tokens, as observed in 18C, plus about 0.3 k with descriptions.

| Arm | Requests | Output tokens / request (estimate) | Expected | Worst case at the output cap |
| --- | --- | --- | --- | --- |
| A, B, RB | 42 | ≈ 1 k | ≈ $0.15 | 8192 cap → ≤ $0.89 |
| C, D, RD | 42 | ≈ 3–6 k (MEDIUM thinking) | ≈ $0.90 | 24 576 cap → ≤ $4.0 |
| BH | 14 | ≈ 4–8 k | ≈ $0.25 | 24 576 → ≤ $0.87 |
| DH | 14 | ≈ 8–15 k | ≈ $0.80 | 24 576 → ≤ $1.32 |
| Recovery | ≤ 16 | — | — | ≤ $1.5 |
| **Stage 1 total** | **≤ 128 requests** | | **≈ $2** | **≤ $9** |

**Stage 2:** at most 100 requests. Expected cost: below $1 with flash-lite, about $2 with 3.8-flash. The worst case is ≤ $10 either way. The exact figure is stated with the candidate at the Stage 2 approval.

**Zero-request rehearsals before each stage:**
1. EVAL-300–304: every arm builds, arm A is identical to 18C P1, the scorer is sound, and there are no privacy findings.
2. The UI dry run (`EYES_AI_VALUE_DRY=1`) per arm. It must reach an enabled Send button, the preview must equal the reconstruction, and the destination must equal the arm's.

## Results

### Stage 1 — dev, live (2026-11-18, owner-approved)

**Run.**
- 112 first requests: 14 dev scenarios × 8 arms, arms rotated per scenario.
- No recovery requests were sent: each needs a fresh owner approval.
- Evidence (alias-level answers, hashes, statuses, tokens): [stage1-live.json](../evidence/sprint-18d/stage1-live.json). Scored: [stage1-summary.json](../evidence/sprint-18d/stage1-summary.json) (EVAL-307).
- Privacy: 0 findings. 0 requests beyond one per scenario-trial. Every sent prompt equals the scorer's reconstruction.

**Provider (R1–R3):**

| Arms | HTTP 200 | Failures | Median latency | Measured cost |
| --- | --- | --- | --- | --- |
| A, B, RB (flash-lite) | 42 / 42 | 0 | 5.1–5.7 s | $0.12 |
| BH (flash-lite HIGH) | 14 / 14 | 0 | 19.4 s | $0.25 (6 × per request) |
| C, D, DH, RD (3.8-flash) | **2 / 56** | 18 client timeouts (> 45 s, the app's fixed `CLOUD_TIMEOUT_MS`), 36 × HTTP 429 | — | $0.03 recorded |

- Timed-out requests report no usage, so their cost is unknown. Total recorded spend is **$0.40**.
- **Q1 (model) and Q3 for Flash are NOT ANSWERED.** `gemini-3.8-flash` is not usable on this project within the product's 45 s limit and its current rate limit. The stop rule covered HTTP 400 only, so each planned Flash request was sent once (no retries; 429s are not billed).

**Correspondence and recall (`base` policy):**

| Arm | M1 | M2 | M3 | Gemini T1 | Gemini T3 | Local T1 | Local T3 | Combined T3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0.619 | 0.633 | 0.606 | 0.661 | 0.693 | 0.827 | 0.937 | 0.953 |
| B | 0.612 | 0.622 | 0.576 | 0.661 | 0.724 | 0.827 | 0.937 | 0.937 |
| BH | 0.585 | 0.592 | 0.515 | 0.677 | 0.764 | 0.827 | 0.937 | 0.929 |
| RB | 0.639 | 0.653 | 0.576 | 0.677 | 0.780 | 0.827 | 0.937 | 0.921 |

- Q2: descriptions did not raise M1. On the described subset the change was −0.02 (A→B).
- Q4: v6 raised Gemini T3 − T1 to 0.10 (RB), with M1 +0.02.
- Q5: **the local matcher's top-1 (0.83) beats Gemini's (0.66–0.68) on the same scenarios.** It reads real field names, which Gemini never sees.

**Pre-registered decision rules (mechanical), and why they cannot pick a candidate:**
- model: flash-lite (Flash not measurable);
- descriptions: no;
- thinking: no;
- ranked: no;
- chosen arm: **A**;
- chosen policy: **none**. Every pre-registered policy on A has a false complete (E3 = 1), so none is eligible.

The pre-registered disagreement policy never fired (0 cases). Its "pick not listed at all" condition is too strict when local T3 is 0.94.

**Safety trace (found and fixed during scoring; not tuning).**
- Arms B and BH first scored S5 = 23 on one dev scenario. Gemini had mapped a date field to the wrong (but unambiguous) date source, and the verifier marked that field `SEMANTIC_PASS` from a deterministic observation of its date order.
- Fix: a field is `SEMANTIC_PASS` only when a passing constraint was established by the user, a source contract or a local rule. Freeze amendments are recorded.
- After the fix, S5 = 0 in every arm, and E1 is unchanged.

**Failure causes (arm A, completable dev scenarios, aggregate):**

| Cause | Count |
| --- | --- |
| Optional field with a real source left empty (Gemini abstained, nothing asked) | 9 |
| Required category field left empty (wrong category source, so the translation is unanswerable) | 5 |
| Wrong source executed | 5 |
| Right source, wrong operation (`trim`/`copy`) | 3 |
| Other | 3 |

**Exploratory policies (added AFTER seeing Stage 1, tuned on dev only; not evidence):**

| Arm + policy | E1 | E2 | S5 | E3 | U1 | U2 (≤ 7.41) |
| --- | --- | --- | --- | --- | --- | --- |
| A `base` (the 18C configuration) | 1 / 11 | 0.734 | 0 | 1 | 2.93 | 6.14 |
| A `open` | 3 / 11 | 0.510 | 0 | 1 | 3.71 | 6.93 |
| RB `base` | 2 / 11 | 0.615 | 0 | 0 | 2.64 | 5.79 |
| **RB `open`** | **5 / 11** | **0.250** | **0** | **0** | 3.57 | 6.71 |
| BH `open` | 5 / 11 | 0.346 | 0 | 0 | 4.71 | 7.79 |

`open` = the local matcher may OPEN a choose-field question that Gemini closed. This covers an optional field Gemini gave no source but with a clear local candidate, and a category match whose clear local top-1 is another field. It never executes anything.

Relaxing `open` to ambiguous candidates, and asking on local top-1 disagreement, added questions without adding completions.

**What remains on dev under RB `open`:**
- concatenated required fields that no single-field question can supply (3 scenarios);
- `trim` versus `copy`, because padded whitespace is invisible in the twin (2 scenarios);
- wrong category or date sources the local matcher ranks only as ambiguous.

### Stage 1 verdict

- The pre-registered rules select the 18C configuration with **no eligible policy**.
- The best dev configuration (RB + `open`, exploratory) reaches 0.45, against the Stage 2 gate's 0.70.
- **Stage 2 was not run.** Spending the one-shot holdout now would most likely confirm a Gate D failure and consume the set. The holdout stays sealed.

