# Sprint 8 — Semantic Verification & Blind Intelligence Benchmark

**Date:** 2026-11-12
**Branch:** `sprint-8`, from `main` @ `2dafe30` (merge of PR #8, Sprint 7).
**Question:** Can Eyes Without a Face detect and correct semantically incorrect mappings, using locally verified constraints and one approval-gated blind revision?

## Outcome

**Measured with real models.** These are preliminary results: 5 trials per scenario, many provider failures, and every number replayed by `EVAL-081`.

1. **Silent errors are detected (H1, supported).**
   - Real Gemini again produced schema-valid but wrong mappings: CRM read dates `MM/DD`, and support reversed the priority scale.
   - The verifier flagged **every** schema-valid-but-wrong holdout output of every valid real initial mapping: CRM **20 / 20**, support **36 / 36**, **0 false alarms**.
   - It used only trusted evidence: CRM by local observation, support by owner declaration. It never consulted ground truth.
2. **A real Gemini revision corrected the meaning without seeing the records (H2, supported in 2 of 2 delivered revisions, n = 2).**

   | Scenario, trial | Approved disclosure | Holdout correct transformations (of 10) | Holdout cases | Local decision |
   | --- | --- | --- | --- | --- |
   | Support, t1 | `f_01 → priority` rank `p1 > p2 > p3 > p4` ↔ `urgent > high > normal > low` | **0 → 6** (correctly handled 1 → 8; incorrect 6 → 0) | 7 improved · 0 regressed | `ACCEPTED` |
   | CRM, t3 | `f_03` dates are `DD/MM/YYYY` (observed locally, no human input) | **1 → 9** (incorrect 4 → 0) | improved · 0 regressed | `ACCEPTED` |

3. **The provider is the bottleneck.**
   - **Initial requests:** 10 of 30 failed (`500 high demand` or `TIMEOUT`). One more was invalid model output: extra `map_enum` params, which the converter rejected and did not repair.
   - **Revision requests:** 5 of 8 timed out at 45 s, after approval. Each was recorded and not retried.
   - **Delivered revisions:** 2 of 6 attempted CRM/support revision cycles produced a revision.
4. **Gemini does not beat a rule-based patch here.**
   - The offline control **P** applies the same approved feedback with fixed local rules, and matched or exceeded every delivered Gemini revision:
     - CRM: 9 vs 9;
     - support: 7 vs 6 (P also trimmed the id);
     - billing: 0 vs 0, both regressed.
   - The correcting information is the approved constraint. Gemini proved it can act on it while blind, but it adds no measured accuracy over a deterministic patch on these fixtures.
5. **The local decision caught a harmful revision.**
   - Billing t1 (feedback 1.0.0, no semantic finding): Gemini answered a `destination-constraint` finding by changing `copy → trim` on a numeric amount.
   - Every holdout record was then held back: 6 → 0 correct transformations.
   - The ground-truth-blind decision said `REGRESSED`, with 7 operation regressions. P made the same mistake.
6. **Nano contributes nothing measurable (H3, supported as a null result).** Details are in [Nano ablation](#nano-ablation).
7. **Privacy:**
   - 0 private strings in 38 real request bodies;
   - 0 private matches in any replayed prompt;
   - every approved constraint repeated only labels already disclosed (ledger: 0 new labels).

**Not achieved or not shown**

- Five successful revisions per configuration: the provider prevented it.
- Any statistical claim.
- Any advantage of the model over the deterministic patch.
- Any Nano benefit.

**Verdict on the thesis.** "A cloud model can correct a semantically wrong integration from controlled, approved feedback without inspecting the records" is **demonstrated twice with real Gemini on an independent, pre-frozen holdout**. "Blind revision is more useful than simpler alternatives" is **not demonstrated**.

## Benchmark results (replayed)

Source: `docs/evidence/sprint-8/benchmark-summary.json`, regenerated from `live-semantic-benchmark.json` (30 entries) by `EVAL-081`.

- 38 cloud requests (cap 60), 0 body leaks, 0 replay mismatches.
- 21 run records are provider failures: a failed initial request fails both C and D.
- The primary metric is holdout **correct transformations**. Quarantine never counts.

| Scenario | A | B (per valid run) | C (per valid run) | D (per run with a mapping) | P control |
| --- | --- | --- | --- | --- | --- |
| CRM | 0 | 1, 1, 1 (2 failures) | 1, 1 (2 failures, 1 invalid) | 1 (blocked), **9** | 9, 9 |
| Support | 0 | 0, 0, 0, 0 (1 failure) | 0, 6, 0 (2 failures) | **6**, 6 (blocked; C was already 6), 0 (blocked) | 7, 7, 7 |
| Billing | 0 | 6, 6, 6, 6 (1 failure) | 6, 6, 6 (2 failures) | **0** (regressed), 6, 6 (both blocked) | 0, 0, 0 |

A "blocked" D keeps its C mapping, so its row repeats C. Holdout size is 10 per scenario.

| Measure | CRM | Support | Billing |
| --- | --- | --- | --- |
| Semantic detection, B + C (detected / schema-valid-but-wrong, false alarms) | 20 / 20, 0 | 36 / 36, 0 | 0 / 0, 0 |
| Revision verdicts (D) | 1 `ACCEPTED`, 1 `BLOCKED`, 1 not sent (invalid initial) | 1 `ACCEPTED`, 2 `BLOCKED` | 1 `REGRESSED`, 2 `BLOCKED` |
| Feedback version sent | 1.1.0 (1 constraint) | 1.1.0 (1 constraint) | 1.0.0 (no semantic finding) |
| Holdout case regressions, delivered revisions | 0 | 0 | 6 |
| Median latency: Nano · initial cloud (C) · revision | 14.8 s · 13.0 s · 31.7 s | 15.3 s · 22.4 s · 24.9 s | 17.8 s · 13.0 s · 45.3 s (timeouts) |
| Human interventions (D cells) | 7 (5 Nano applies; constraint opt-in and approval) | 7 | 4 |

**Configuration A** (the deterministic proposer) produces no correct transformation on any holdout. The billing B/C mappings were already right on everything the destination allows (6 of 10 transformable; the rest are expected quarantines or the invented plan default), and the semantic verifier flagged the invented `starter → basic` plan as a policy conflict on the holdout.

## Nano ablation

Paired by trial, C against B, over the same frozen inputs:

| Scenario | Suggestions (consistent / applicable / rejected) | Applied | Changed the disclosure | Changed the mapping vs B | C − B holdout correct |
| --- | --- | --- | --- | --- | --- |
| CRM | 20 / 5 / 5 | 5 (`unternehmen` → organization) | 5 of 5 | 0 | — (no paired valid run) |
| Support | 14 / 1 / 15 | 1 (`body`, a withheld field) | 0 | 1 of 3 paired runs | 0, +6, 0 |
| Billing | 25 / 3 / 7 | 3 (`internal_memo`, withheld) | 0 | 0 | 0, 0 |

- Nano ran on every trial with 0 errors and 0 cloud requests, at a median of 15–18 s.
- Its only disclosure-changing suggestion, the organization role in CRM, never changed Gemini's mapping.
- The one support run where C beat B (t2, +6) had **no** applied suggestion and a disclosure identical to B's. That gain is Gemini's sampling variance, not Nano's.

**Why Nano adds nothing here:**

- **Task design.** The fixtures' hard parts (date order, priority rank) are not inferable from bounded samples. The date order needs a disambiguating value that the imported sample lacks, and the priority rank is business knowledge.
- **Representation.** Applied refinements change descriptors that Gemini already handles well.
- **Model limits.** Nano never proposed the date order.

What does help, the constraint, comes from local deterministic observation or the owner, not from Nano.

## Tests and evidence

| Suite | Baseline (`2dafe30`) | Sprint 8 |
| --- | --- | --- |
| lint / typecheck / build | PASS, 0 warnings | PASS, 0 warnings |
| unit | 163 | **170** (SEMV-001/002) |
| contracts | 26 | **32** (CON-080/081) |
| privacy | 42 | **60** (PRIV-080…083: the 15 adversarial cases) |
| evaluation | 16 | **58** (SEM-001…005, EVAL-080 freeze, EVAL-081 replay, EVAL-082 aggregation, Sprint 7 replay on `development`) |
| E2E | 69 | **75** (E2E-080…084, including no console error in the hero journey) |

No existing assertion was weakened. Sprint 7's replay still passes, against the reclassified `development` set.

| Item | Status |
| --- | --- |
| Silent date/priority errors in real Gemini output (SEM-001, from Sprint 7 run 3 and Sprint 8 runs) | **Real**, reproduced |
| Semantic detection, revision outcomes, Nano ablation | **Real** (Gemini `IN_CLOUD`, Nano `ON_DEVICE`), replayed |
| E2E-080…084, PRIV/EVAL tests with `deriveTestRevision` | **Simulated** test adapter, labeled. They prove gates and wiring, not model quality |
| P control | **Deterministic rules**, offline, not AI |
| H4 (codes alone are insufficient) | **Simulated only** (E2E-081, PRIV-083). Not measured live: every live D run authorized the constraint |
| Live harness | Fixed after trial 2 (guarded reads, 420 s timeout, non-serial). These are not frozen inputs, and no result was edited |
| Usability test, screen-reader audit, non-Chromium browsers | **Not done** |

Live environment: Chrome with the dedicated Nano profile, Firebase AI Logic, App Check debug token, `gemini-3.5-flash-lite`. Nothing was deployed, and no external settings changed.


## Architecture

The pipeline is still a deterministic workflow with bounded model reasoning. There is no agent framework, no memory and no retry loop. The new stage is described in [ADR 0009](../decisions/0009-semantic-verification.md) and [architecture/system.md](../architecture/system.md#sprint-8-changes-semantic-verification-no-new-boundary):

```
Reality Check rows ─ Semantic Verification Contract (LOCAL: owner declarations + user confirmations
                     + sufficient observations over imported/feedback records, never holdout)
                   ─ verifySemantics (generic: date interpretation, ordered categories, meaning, allowed values)
                   ─ Feedback 1.1.0 (codes + only user-ticked constraints, approved vocabulary only)
                   ─ disclosure 1.3.0 ─ same gate (preview · SHA-256 · approve · single use · budget 1)
                   ─ Gemini revision ─ convertProposal (unchanged) ─ re-evaluation + semantic re-verification
                   ─ decideRevision (ground-truth blind; both mappings kept; never auto-promoted)
                   ─ final holdout (scoring only)
```

## Changes

| Area | Files |
| --- | --- |
| Semantic Verification Contract 1.0.0 | `src/semantics/contract.ts`, `semantic-verification.v1.schema.json` |
| Deterministic observation | `src/semantics/observe.ts`: date order is trusted only with a disambiguating value and no conflict; otherwise `ambiguous` |
| Verifier | `src/semantics/verify.ts`: static and per-record checks. Statuses: PASS, MISMATCH, POLICY_CONFLICT, AMBIGUOUS, EVIDENCE_MISSING, UNVERIFIED. Includes regression comparison |
| Safe semantic feedback | `src/revision/semantic-feedback.ts`; `feedback.ts` now emits 1.1.0 only when there is a semantic finding; `blind-revision-feedback.v1.1.schema.json`, `cloud-disclosure.v1.3.schema.json` |
| Request and prompt | `revision-payload.ts` (1.3.0, `isRevisionSchemaVersion`), `prompts.ts` (`SEMANTIC_REVISION_INSTRUCTIONS`, v3; v2 unchanged), live and test adapters |
| Gate scan | `src/privacy/leak-scan.ts` also scans `approvedConstraints` |
| Decision | `src/revision/decision.ts`: ground-truth-blind verdicts, operation-level regressions, refusal-only gains never `ACCEPTED` |
| Benchmark | `src/evaluation/benchmark.ts` (semantic stage, detection scoring), `src/evaluation/aggregate.ts` (replay, A, P control, summary, Nano ablation) |
| Scenarios v2.0.0 | Owner declarations (`semanticSpec`); the Sprint 7 holdout becomes `development`; a fresh 10-case holdout per scenario |
| Freeze | `scripts/freeze-benchmark.mjs`, `docs/evidence/sprint-8/freeze-manifest.json`, `EVAL-080` |
| Integration Studio | `SemanticPanel.tsx` (layered validity, per-field meaning, trusted constraint and evidence, local-only detail, date confirmation); `BlindRevisionPanel.tsx` (per-constraint opt-in, cumulative ledger, decision card, semantic before/after, holdout semantics); semantic-aware verdict card |
| Telemetry | `semantic-verify`, `semantic-feedback`, `revision-decision` events (codes and counts only) |
| Live benchmark | `tests/live/semantic-benchmark.spec.ts` (evidence outside `test-results/`) |

Nothing changed in the engine, the eight-operation DSL, the converter, the alias resolver, the 1.1.0 path or the approval gate.

## Plan and methodology

**Hypotheses.** H1–H4 were predeclared in the freeze manifest before any live run:

- **H1:** the verifier flags the silent errors.
- **H2:** an approved constraint lets one real revision raise holdout correctness without regressions.
- **H3:** Nano adds nothing on these fixtures.
- **H4:** codes alone are insufficient (simulated only).

**Evidence used per scenario.**

| Scenario | Evidence | Human input |
| --- | --- | --- |
| CRM | The date order is **observed** locally. The revision-feedback case `25/03/2026` proves day-first; imported records alone leave it ambiguous | None |
| Support | The priority order is **user-declared** (fictional owner declaration) | One declaration |
| Billing | Plan meaning is **user-declared** | One declaration |

Constraints are never built from ground truth or holdout records. Tests prove both (SEM-005, PRIV-083).

**Holdout discipline.** Sprint 7's holdout had been inspected, so it became `development`. Ten fresh cases per scenario were written from each scenario's documented meaning. Then the following were hashed in the freeze manifest (commit `520086a`) **before the first Sprint 8 live request**:

- prompts and the model id;
- schemas and scenarios;
- the verifier, the projection, the decision rule and the evaluator.

`EVAL-080` fails if any of them changes.

**Budget.** Predeclared: trials 1–5, 3 scenarios, B = 1 and C/D = 2 cloud requests per scenario and trial, at most 60 in total. There are no retries and no replacement trials. A provider failure is a recorded failure.

**Configurations.**

| Config | What it is |
| --- | --- |
| A | Deterministic proposer, offline |
| B | Real Gemini |
| C | Real Nano (validated, applied) + real Gemini |
| D | C + one real Gemini revision; every trusted constraint behind a semantic finding authorized (recorded) |
| **P** | Offline control: the same initial mapping and the same approved feedback as D, revised by fixed local rules (the labeled simulated reviser). It answers whether the model adds anything beyond a rule-based patch |

**Replay.** Every number is regenerated offline from the archived alias-level real outputs by the same pipeline (`EVAL-081`), and must equal what the browser displayed.

## Risks and rollback

- **Semantic-rule uncertainty.** A constraint is only as good as its evidence.
  - Owner declarations are human knowledge, counted as interventions.
  - Observations are trusted only when sufficient. Weaker evidence stays `ambiguous`.
  - Order constraints are deliberately weak. They disclose less than a full map, and they cannot catch a wrong mapping that preserves order (for example a single label mapped to the wrong rank).
- **Ground-truth limits.** Ground truth exists only for the fictional fixtures. For real data the product reports semantic status and outcome classes, never "correct".
- **Feedback leakage.** Feedback 1.1.0 reveals meaning: the date order of an alias, or the rank correspondence of labels already disclosed. It adds no label and no value. The ledger counts new labels, which must be 0. Coarse buckets still reveal small counts ("1"). The prompt scan is a substring heuristic: zero matches is evidence, not proof.
- **Cumulative disclosure.** The budget allows at most two requests per (approved disclosure, initial mapping). The budget is browser-local: a fresh page has a fresh budget.
- **Model unreliability.** The revision is only as reliable as `gemini-3.5-flash-lite` under a constrained schema. The local decision is the safeguard.
- **Provider failures.** `500 high demand` and timeouts occurred. They are recorded and never retried, which shrinks the sample.
- **Benchmark bias.**
  - Small fictional scenarios, written by the same team that wrote the verifier.
  - D receives human-approved constraints that B and C do not.
  - Control P shows how much of D's gain comes from that information rather than from the model.
- **Holdout contamination.** The holdout was frozen before the live runs. Simulated E2E tests evaluate it with simulated mappings only. Its results are now inspected: a Sprint 9 iteration must treat it as development data and write a new holdout.
- **Regression risk.** The engine, DSL, converter, gate and the 1.1.0/1.2.0 paths are unchanged. 1.0.0/1.2.0 output is byte-identical when there is no semantic finding (contract test). The changes to the verdict card and revision panel are display-only, except for the new opt-in.
- **Rollback.** Revert the Sprint 8 merge commit. Feedback 1.1.0 and disclosure 1.3.0 are additive. Scenario v2.0.0 keeps the Sprint 7 holdout as `development`, and the Sprint 7 replay still passes against it. No data migration is involved.

## Sprint 9 readiness (not started)

| Item | Readiness |
| --- | --- |
| Portable Integration Export | Not started. The decision card already keeps both mapping versions and their verdicts, which are the inputs an export would package |
| Final product usability testing | The semantic journey works with keyboard, at 390 and 768 px, with no console error (E2E-080…084). No user test yet |
| Production Firebase Hosting verification | Unchanged since Sprint 5. Deployment still needs owner approval; nothing was deployed |
| Judge-ready live demonstration | Partially ready. Script C ([demo/README.md](../demo/README.md)) is the support journey, which reproduced once live (0 → 6). Provider reliability is the risk: 5 of 8 revisions timed out. A recording needs a quiet provider window and must show whatever happens |
| Devpost submission | Not submitted. The draft needs Sprint 8 results and owner approval |
| Engineering blockers | (1) Provider timeouts on revision requests at the 45 s client limit. A longer limit is a product decision; retries stay forbidden. (2) The initial proposal schema is not constrained per operation (CRM t4 produced invalid params). (3) The gain should be re-measured on a new holdout, since this one is now inspected |
