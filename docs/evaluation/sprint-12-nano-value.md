# Sprint 12 — What does Gemini Nano add? A focused, pre-registered experiment

**Answer on this scenario: neutral.** Gemini Nano understood the private fields correctly where deterministic profiling could not, and its suggestions were validated and applied. Gemini Cloud's mapping was **identical** with and without them, and Nano did not resolve the one error that mattered (day-first dates). That error was caught by the local semantic verifier in every run, with or without Nano.

All data is fictional. Every number below is regenerated from the recorded real runs by `EVAL-122` ([tests/evaluation/nano-value.test.ts](../../tests/evaluation/nano-value.test.ts)) into [nano-value-summary.json](../evidence/sprint-12/nano-value-summary.json).

## Why this experiment

Sprint 8 found no measurable Nano benefit on the existing fixtures. A judge may fairly ask: *what does local AI contribute that deterministic profiling alone cannot?* So we built one scenario where the local model has a real chance to matter and measured whether it does.

## Scenario: `crm-nl-relations` (fictional)

A Dutch CRM `relaties` export must become a helpdesk requester directory: `id`, `email`, `status`, `customerSince`, `organization`, `contactName`.

- **Non-English field names.** The deterministic role rules are English patterns. `bedrijf` (company) and `contactpersoon` (contact person) both become the generic role `text` with the **same** descriptor ("Short text value"). The twin cannot tell the cloud which alias is the company and which the person.
- **Unprovable date order.** Every imported `sinds` (customer since) date has day and month ≤ 12, so profiling cannot prove the order and assumes `MM/DD/YYYY`. The source is Dutch; the true order is day-first.
- Lifecycle `fase` uses Dutch labels with a declared meaning; an unseen stage may be filed as `other`.

These are exactly the two things Nano's validated output can change: a field's **role** and an ambiguous **day/month order** (`src/private-semantics/semantics.ts`). We chose the scenario for relevance to the product's real use, not to guarantee a win: Nano could fail either.

## Protocol (frozen before any model run)

[nano-value-freeze.json](../evidence/sprint-12/nano-value-freeze.json) was committed (`05343e8`, 14:10 CET) before Nano or Gemini saw the scenario. It hashes the scenario (with ground truth and holdout), prompts, validators, profiler, twin generator, converter, verifier, evaluator and the live harness; `EVAL-120` fails if any of them changes.

| Config | What runs |
| --- | --- |
| **A** | Deterministic profiling only. Offline (`EVAL-121`) |
| **B** | A + real Gemini Nano (`ONLY_ON_DEVICE`) on bounded private context. Only validated suggestions, applied by the user, change the twin |
| **C** | Real Gemini Cloud initial mapping from A's twin. No revision |
| **D** | Real Gemini Cloud initial mapping from B's twin. No revision |

Local comparison: B vs A. Downstream comparison: D vs C, paired by trial. Ground truth was written from the scenario's documented meaning; development cases are separate from the 10-case holdout, which is never profiled, disclosed or used for feedback.

**Budget:** 3 trials, ≤ 6 cloud requests (C: 1, D: 1 per trial), 3 Nano runs, no revisions, no retries; a provider failure counts as a failure. **Used:** 6 requests, 3 Nano runs, 0 provider failures.

Environment: local dev server, the registered App Check debug token, the dedicated Nano Chrome profile (Chrome 157), `gemini-3.5-flash-lite`, 2026-11-13.

## Results

### Local understanding (A vs B)

| Field | Ground truth | A (deterministic) | B (Nano, 3 runs) |
| --- | --- | --- | --- |
| `bedrijf` | organization | `text` (generic) | `organization`, applicable, **3 / 3** |
| `contactpersoon` | person-name | `text` (same descriptor as `bedrijf`) | `person-name`, applicable, **3 / 3** |
| `sinds` | date, **DD/MM** | date, `MM/DD/YYYY` assumed, **unproven** | agreed with the deterministic profile, **0 / 3** resolved the order |
| `opmerking` | free text (withheld) | `text` | `free-text`, applicable 2 / 3 (withheld field: no disclosure effect) |
| `mailadres`, `fase` | email, status | correct | 5 suggestions **rejected** by the validator ("identifier contradicts the observed profile") |

- 21 suggestions: 8 applicable, 8 consistent, 5 rejected. All 8 applicable suggestions matched the ground truth. No wrong suggestion reached the twin.
- Applied suggestions changed the approved disclosure in 3 / 3 runs.
- Nano latency: median **17.9 s** per run, 0 errors, 0 cloud requests during interpretation.

### Downstream mapping (C vs D)

| | C t1 | D t1 | C t2 | D t2 | C t3 | D t3 |
| --- | --- | --- | --- | --- | --- | --- |
| Mapping valid | yes | yes | yes | yes | yes | yes |
| Same mapping as the paired run | — | **identical** | — | **identical** | — | **identical** |
| `organization ← bedrijf`, `contactName ← contactpersoon` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customerSince` parsed as | MM/DD ✗ | MM/DD ✗ | MM/DD ✗ | MM/DD ✗ | MM/DD ✗ | MM/DD ✗ |
| Holdout correct transformations (of 10) | 0 | 0 | 0 | 0 | 0 | 0 |
| Holdout: valid-looking wrong dates / unparseable / quarantined | 3 / 6 / 1 | same | same | same | same | same |
| Wrong dates flagged by the local verifier | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |
| Cloud latency (SDK) | 2.4 s | 2.0 s | 1.6 s | 2.0 s | 1.8 s | 1.6 s |

Paired holdout delta D − C: **0, 0, 0**. Human interventions: 0 in C; 2–3 applied suggestions in D.

### Interpretation

- **What Nano contributed:** correct local understanding of private field names that the English rule set could not read. This is information the cloud model was never given, because the field names are private.
- **Why it did not change the outcome here:** in C the two text fields were indistinguishable to Gemini (identical descriptor, nonsense examples), yet Gemini assigned them correctly in 3 / 3 runs. The alias order (`f_03` < `f_06`) matched the destination order (`organization` before `contactName`), so C was correct by **ordering, not by information**. We did not test the reversed order, so we do **not** claim Nano would prevent a swap there.
- **What mattered and Nano missed:** the day-first date. The twin's own synthetic dates are rendered month-first (for example `02/18/2024`), which reinforces Gemini's assumption. Nano never overrode it.
- **What caught the error:** the deterministic semantic verifier, in all six runs, with 0 false alarms. Correction then needs the approved blind revision (shown in the hero journey), not Nano.
- **Cost:** about 18 s of on-device time per run, for no downstream gain on this scenario.

Classification: **Neutral** (Nano adds correct descriptive information; no accuracy improvement). Not negative: no wrong suggestion was applied, and the validator blocked the 5 wrong ones.

## Privacy finding during the experiment (false positive, explained)

The live body scan matched one term, `partner`, in each of the three D requests and failed those three test runs. We kept the failures as recorded and traced the match before interpreting anything:

- `partner` is a **hidden-set** value of `fase` (revision-feedback and holdout only). The twin never reads those records.
- After Nano's `organization` role is applied, the twin generator draws fictional company names. One of them is **"Copperfield Partners"**, and the substring scanner matched the generic word.
- C requests (no organization role) never matched. The replay's independent outbound-prompt checker reports the same single match for D and 0 for C. `EVAL-122` pins this: D's only match is `partner`, it comes from the fictional example, and no imported record contains it.

Conclusion: no source value left the browser. Limitation: substring scanning of short generic words gives false positives, and a fictional example can coincide with a real private value by chance. Zero detected strings is not proof of privacy, and a detected string is not proof of a leak; every match needs this kind of trace.

## Limitations

- One scenario, three trials, one model version. No statistical claim.
- Fictional data written by the team. The scenario was designed to give Nano a fair chance, not a guaranteed one.
- The reversed field-order case (where C would have to guess the wrong way) was not run; it would need a new frozen scenario.
- Nano's output schema can change only role and date order; we did not change the architecture to make it count for more.

## Reproduce

```bash
# Real runs (uses quota; the budget above is the one we used)
EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
EYES_LIVE_TESTS=1 EYES_LIVE_SEMANTIC_BENCHMARK=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_LIVE_SCENARIO=crm-nl-relations EYES_LIVE_NO_REVISION=1 EYES_LIVE_TRIALS=3 \
EYES_LIVE_EVIDENCE=live-evidence/sprint-12/nano-value.json \
pnpm exec playwright test -c playwright.live.config.ts tests/live/semantic-benchmark.spec.ts

# Offline replay of the committed evidence (no model, no network)
pnpm vitest run tests/evaluation/nano-value.test.ts
```
