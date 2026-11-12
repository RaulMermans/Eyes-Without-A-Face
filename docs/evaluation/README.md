# Blind Integration evaluation (Sprint 7 foundation, Sprint 8 benchmark)

Code:

- `src/evaluation/` — scenarios, evaluation, before/after comparison, pipeline runner
- `src/verification/outcomes.ts` — outcome classes and completion states

Fixtures: `src/examples/scenarios/*.json`. All data is fictional, and each scenario carries the privacy canary.

## Case sets

| Set | Used for | Never used for |
| --- | --- | --- |
| Imported | Profiling, Phantom Twin, disclosure, Reality Check, feedback | — |
| Revision-feedback | Reality Check (reserved hidden cases), feedback projection | Profiling, disclosure |
| Development (Sprint 8) | Sprint 7's holdout. Its results were inspected in Sprint 7, so it is now debugging data only | Feedback, semantic evidence, any reported "independent" result |
| Holdout | Final evaluation of both mapping versions, only after the final mapping exists. Sprint 8: 10 fresh cases per scenario, frozen before any Sprint 8 model run | Profiling, disclosure, feedback, semantic evidence, prompt design |

`validateScenario` rejects overlapping sets. The UI enables the holdout only in a terminal revision state (or when there was nothing to revise).

## Scenarios

| Scenario | Difficulty |
| --- | --- |
| `crm-eu-accounts` | German field names; translated states; slash dates whose day/month order the imported sample cannot prove; approved fallback `status → other` |
| `support-tickets` | Priority codes p1–p4 to interpret; whitespace and case only in hidden cases; unknown priorities and channels must never be guessed |
| `billing-subscriptions` | `trialing → trial`; approved fallback `status → unknown`; string amounts and impossible dates that no operation can fix |

## Metrics

Each metric counts records in one evaluated set.

| Metric | Definition |
| --- | --- |
| transformed | Engine produced schema-valid output, no fallback or default used, and (with ground truth) the output equals the expected output |
| handled by approved rule | As above, but the output relied on a fallback or default listed in the policy |
| quarantined | Engine refused the record and every issue matches a policy quarantine rule. Never counted as a transformation |
| quarantined as expected | Quarantined and the ground truth says quarantine |
| unresolved | Engine refused the record for a reason no rule covers |
| rejected by policy | Engine produced output using an unapproved fallback or default (an invented value) |
| incorrect | Schema-valid output that differs from ground truth, or output for a record whose ground truth is quarantine |
| correctly handled | transformed + handled + quarantined-as-expected, ground truth only |
| output-schema violations | Rows whose issues include `OUTPUT_SCHEMA_MISMATCH` |
| model calls / approvals | Cloud requests dispatched and approvals granted in the run |
| prompt privacy check | Bytes of the entire outbound prompt; canary present; forbidden keys; private strings found in the prompt after removing the fixed instruction text and approved vocabulary |
| latency | Wall-clock time from click to response (live spec) and the SDK-reported duration (provenance) |

Improvement compares each case's outcome before and after. Correct handling ranks highest, then transformed or handled, then quarantined, then unresolved, then rejected or incorrect. "Strict improvement" means at least one case improved and none regressed. The evaluator decides; model rationale is never an input.

## Configurations

| Config | Initial proposal | Nano | Revision |
| --- | --- | --- | --- |
| A | Deterministic test proposer (no AI) | — | — |
| B | Real Gemini `IN_CLOUD` | — | — |
| C | Real Gemini `IN_CLOUD` | Real Gemini Nano private interpretation; validated suggestions applied | — |
| D | as C | as C | One approved real Gemini revision |

## How to run

- **Offline (deterministic).** `pnpm test:evaluation`, which covers scenarios, configuration A, the evaluator machinery with a hand-written initial contract and the simulated reviser, and a replay of the recorded live run.
- **Live (opt-in; uses quota).** See [testing/playwright-live.md](../testing/playwright-live.md#sprint-7-blind-revision-benchmark).

Live evidence: [`docs/evidence/sprint-7/`](../evidence/sprint-7/). `tests/evaluation/live-replay.test.ts` re-evaluates run 3's recorded real outputs and must reproduce the browser's counts exactly.

## Sprint 8 additions

**Semantic verification.** See [contracts/semantic-verification.md](../contracts/semantic-verification.md). Each scenario carries `semanticSpec.declared`: fictional owner declarations, written from the scenario's documented meaning, never from ground truth.

| Scenario | Declared (user) | Observed (local) |
| --- | --- | --- |
| `crm-eu-accounts` | status meaning (`aktiv → active`, …) | date order of `angelegt_am`. Ambiguous on imported records alone; proven day-first once the revision-feedback cases are included |
| `support-tickets` | priority order `p1 > p2 > p3 > p4` ↔ `urgent > high > normal > low`, undeclared → review; channel meaning | — |
| `billing-subscriptions` | plan meaning, undeclared → review | — |

**Additional metrics**

| Metric | Definition |
| --- | --- |
| correct transformations | `transformed + handled` records whose output equals ground truth. **Primary metric.** Quarantine never counts |
| semantic detection | Among schema-valid outputs that ground truth says are wrong: detected / missed by the verifier; false alarms = flagged rows that are correct. Scoring only; ground truth never reaches the verifier |
| revision verdict | `src/revision/decision.ts`: `ACCEPTED`, `REJECTED`, `UNCHANGED`, `INSUFFICIENT_INFORMATION`, `NO_IMPROVEMENT`, `REGRESSED`, `HUMAN_REVIEW_REQUIRED`. Ground-truth blind |
| operation regressions | (destination, record) failures that appear only after the revision, excluding records the engine refused before |
| holdout Δ | Holdout correct transformations, revised minus initial, for the same run |
| human interventions | Applied Nano suggestions, the constraint-disclosure decision, the revision approval |

**What each configuration receives**

| Config | Disclosure | Nano | Semantic constraint | Revision |
| --- | --- | --- | --- | --- |
| A | Approved 1.1.0 (to the deterministic proposer) | — | — | — |
| B | Approved 1.1.0 | — | — | — |
| C | Approved 1.1.0, including applied Nano refinements | Real, validated, user-applied | — | — |
| D | As C, plus one 1.3.0 (or 1.2.0) request | As C | Every trusted constraint behind a semantic finding, authorized by the user | One |

The semantic verifier runs locally for **every** configuration. Only D sends anything about it.

**Reproduce**

- Offline: `pnpm test:evaluation`. `EVAL-081` regenerates `docs/evidence/sprint-8/benchmark-summary.json` from `live-semantic-benchmark.json` and fails on any difference. To rewrite it after archiving new evidence:

  ```bash
  EYES_WRITE_BENCHMARK=1 pnpm vitest run tests/evaluation/sprint8-benchmark.test.ts
  ```
- Live (opt-in; uses quota): [testing/playwright-live.md](../testing/playwright-live.md#sprint-8-semantic-benchmark).
- Freeze: `docs/evidence/sprint-8/freeze-manifest.json`, checked by `EVAL-080`.

## Limits

- Three small scenarios. Sprint 7 had one live run each. Sprint 8 has at most five per scenario and configuration. This is an engineering benchmark, not a statistical study.
- Ground truth exists only for fixtures. For user data the UI reports schema-valid output, which is not proven correct.
