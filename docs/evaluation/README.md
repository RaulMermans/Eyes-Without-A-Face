# Blind Integration evaluation (Sprint 7 foundation)

Code:

- `src/evaluation/` — scenarios, evaluation, before/after comparison, pipeline runner
- `src/verification/outcomes.ts` — outcome classes and completion states

Fixtures: `src/examples/scenarios/*.json`. All data is fictional, and each scenario carries the privacy canary.

## Case sets

| Set | Used for | Never used for |
| --- | --- | --- |
| Imported | Profiling, Phantom Twin, disclosure, Reality Check, feedback | — |
| Revision-feedback | Reality Check (reserved hidden cases), feedback projection | Profiling, disclosure |
| Holdout | Final evaluation of both mapping versions, only after the final mapping exists | Profiling, disclosure, feedback, prompt design |

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

## Limits

- Three small scenarios with one live run each: preliminary, not statistically meaningful. Sprint 8 is the benchmark.
- Ground truth exists only for fixtures. For user data the UI reports schema-valid output, which is not proven correct.
