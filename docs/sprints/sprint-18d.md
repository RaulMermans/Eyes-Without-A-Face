# Sprint 18D — Semantic intelligence recovery

| Item | Value |
| --- | --- |
| Branch | `sprint-18b-ai-first` |
| Release status | **CODE_READY**. Not a release candidate. Production `c7220768` is unchanged and nothing was deployed or pushed |
| Milestone verdict | **NOT ACCEPTED: blocked on evidence.** Stage 1 ran live on dev (owner-approved, 112 requests, $0.40 recorded). No configuration reaches the Stage 2 gate on dev, so Stage 2 was not run and the holdout stays sealed |
| Decision | [ADR 0021](../decisions/0021-semantic-intelligence-recovery.md) |
| Pre-registration | [sprint-18d-semantic-intelligence.md](../evaluation/sprint-18d-semantic-intelligence.md), frozen in `docs/evidence/sprint-18d/semantic-freeze.json` |
| Local matching | [sprint-18d-local-matching.md](../evaluation/sprint-18d-local-matching.md) |

## What was built

**A — Model configurations** (`src/inference/cloud-models.ts`):
- Allowlisted models and thinking levels, verified against the Firebase AI Logic docs and SDK 13.2.0.
- The model and thinking level are bound into the approved destination. There is no fallback between models.
- Dev-only arm selection goes through `__EYES_EVAL_CONFIG__`, which never switches to the simulated adapters.
- **The product default is unchanged.**

**B — Destination semantics** (cloud-disclosure **1.4.0**):
- Sanitized destination descriptions, failing closed (injection, URLs, emails, digits, tokens, private values, source field names).
- The review lists them, and the leak scan re-checks them.
- 1.0.0–1.3.0 are untouched, and historical replays still pass.

**C — Local Semantic Matcher** (`src/matching/`):
- Local-only ranking: up to 3 candidates per destination field, with evidence and contradiction codes.
- Dev results (N = 131 fields), with the existing ranker in brackets:
  - all dev splits: 0.817 top-1 (0.496), 0.931 top-3 (0.802);
  - fresh 18D dev split only: 0.784 (0.451) top-1.
- Valentine (best: 0.405) and Transformers.js embeddings (best fusion: 0.748) were benchmarked offline. **Neither was integrated.**

**D — Ranked planning** (prompt **v6**, plan **1.1.0** `alternatives`):
- Ranked question candidates: Gemini's pick, then its alternatives, then local candidates, at most 3.
- Opt-in policies: ask on alternatives, and ask on local disagreement. Agreement never upgrades a match.
- Without the option, compiling is byte-identical to 18C.

**E — Evaluation:**
- `src/evaluation/eval-18d.ts`: arms × policies, T1/T3 recall (Gemini, local, combined), the disagreement trace, and off-list answers.
- The live harness has a new set `d`.
- A fresh independent set `eval-18d`: 6 dev and 20 holdout scenarios; 16 wedge (CRM → helpdesk) and 10 general. The holdout and the author's holdout spec scripts are sealed.

## Defects found and fixed this sprint

1. **Confirmation lost Gemini's transformation.** When a question about Gemini's own pick was answered with that same field, the field was rebuilt by the local rule (`trim` → `copy`, which gave wrong records). This also affected the ADR 0020 §7 questions. Now Gemini's operation stands, through the gate, with origin `gemini+user`.
2. **Nested destination enums always read as a policy conflict.** `destinationEnums` was flat, so a correct user translation of, for example, `profile.locale` produced `SEMANTIC_POLICY_CONFLICT`. That made a complete correct integration impossible for any destination with a nested enum.
   - Fixed. Freeze amendments are recorded for Sprint 8 and Sprint 12.
   - Rescoring the historical 18C answers with today's tree could differ from the recorded results; the recorded 18C results stand as historical.
3. **Ranked answers would have been rejected.** Both adapters validated every plan as 1.0.0, so every v6 answer would have been rejected (this would have wasted the live RB/RD requests). The browser E2E caught it before any spend.

4. **A wrong source was reported as verified** (found live, Stage 1). A date field's `SEMANTIC_PASS` came from an observed date order of the wrong source. Fixed in `verify.ts` (field PASS needs a user, source-contract or local-rule constraint), with freeze amendments.

## Checks

| Check | Result |
| --- | --- |
| lint, typecheck | PASS |
| unit | 696 PASS |
| contracts | 100 PASS (runtime bundle regenerated, EXP-007) |
| privacy | 105 PASS |
| evaluation | 220 PASS, 7 skipped by design (env-gated; EVAL-306 rehearsal and EVAL-307 Stage 1 scoring pass when enabled) |
| build | PASS |
| E2E | 170 / 170 PASS (adds E2E-190 ranked questions, E2E-191 1.4.0 review) |
| Holdout rehearsal (`node scripts/eval-18d.mjs --rehearse`, zero requests, counts only) | 8 arms × 20 built, 0 leaks, 0 sample mismatches |
| UI dry rehearsal (Stage 1 dev pool, zero requests) | 8 arms × 14 ready to send, preview = reconstruction, destination = arm, 0 requests |

## Stage 1 (live, dev) — results

[Full results](../evaluation/sprint-18d-semantic-intelligence.md#results).

**Provider:**
- flash-lite: 56 / 56 HTTP 200.
- `gemini-3.8-flash`: 2 / 56. 18 exceeded the 45 s client timeout and 36 returned HTTP 429, so the model comparison is unresolved.

**Correspondence:**
- Gemini top-1 is 0.66–0.68 and the local matcher's top-1 is 0.83, on the same scenarios.
- Destination descriptions did not raise M1 (−0.02).
- Ranked v6 raised Gemini top-3 to 0.78.

**Pre-registered selection:** the 18C configuration, with no eligible policy (every policy on A has a false complete).

**Safety finding, fixed (defect 4).** The verifier reported a wrong date source as `SEMANTIC_PASS` from an observed date order. S5 is now 0 in every arm.

**Root causes (aggregate):**
- the largest is optional fields Gemini left empty with no question;
- then required category fields with the wrong source;
- then wrong sources executed;
- then `trim`/`copy`.

**Exploratory (dev-tuned, not evidence):** letting the local matcher open questions Gemini closed (RB + `open`) gives 5 / 11 complete, E2 0.25, S5 0, E3 0, and answers within the bound. The Stage 2 gate is 0.70, so **Stage 2 was not run.**

## Not done

- **Stage 2 (holdout):** NOT RUN, deliberately. The holdout is sealed for a candidate that can plausibly pass.
- **Next blockers, in order of dev impact:**
  1. Concatenated required fields: no single-field question can supply them. A question kind for "combine these fields" is needed.
  2. Whitespace: Gemini cannot see padding in the twin, so it chooses `copy`, not `trim`. This needs a disclosed fixed fact, or an ADR-approved rule.
  3. Category-source errors that the local matcher ranks only as ambiguous.
  4. `gemini-3.8-flash` availability: timeout and quota are owner decisions.
- **Usability sessions:** not run.
- **Browser (WebGPU/WASM) behaviour of Transformers.js:** not measured. It is not used.

**Milestone 1 is not accepted.** There is no fresh end-to-end evidence yet.
