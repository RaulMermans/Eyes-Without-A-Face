# Sprint 18D — Semantic intelligence recovery

| Item | Value |
| --- | --- |
| Branch | `sprint-18b-ai-first` |
| Release status | **CODE_READY**. Not a release candidate. Production `c7220768` is unchanged and nothing was deployed or pushed |
| Milestone verdict | **BLOCKED ON LIVE EVALUATION.** Stage 1 (dev, live) awaits the owner's budget approval; Stage 2 (holdout) follows it |
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

## Checks

| Check | Result |
| --- | --- |
| lint, typecheck | PASS |
| unit | 694 PASS |
| contracts | 100 PASS (runtime bundle regenerated, EXP-007) |
| privacy | 105 PASS |
| evaluation | 217 PASS, 5 skipped by design (env-gated) + EVAL-305 freeze PASS |
| build | PASS |
| E2E | 170 / 170 PASS (adds E2E-190 ranked questions, E2E-191 1.4.0 review) |
| Holdout rehearsal (`node scripts/eval-18d.mjs --rehearse`, zero requests, counts only) | 8 arms × 20 built, 0 leaks, 0 sample mismatches |
| UI dry rehearsal (Stage 1 dev pool, zero requests) | 8 arms × 14 ready to send, preview = reconstruction, destination = arm, 0 requests |

## Not done (needs approval or evidence)

- **Stage 1 live run (dev):** NOT RUN. It needs the owner's approval of at most 128 requests (≈ $2 expected, ≤ $9 worst case).
- **Stage 2 live run (holdout):** NOT RUN. It depends on Stage 1.
- **Model availability for our project:** unverified until a live request succeeds.
- **Usability sessions:** not run.
- **Browser (WebGPU/WASM) behaviour of Transformers.js:** not measured. It is not used.

**Milestone 1 is not accepted.** There is no fresh end-to-end evidence yet.
