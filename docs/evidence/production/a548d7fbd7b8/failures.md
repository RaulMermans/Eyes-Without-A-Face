# Production failures — build a548d7fbd7b8 (Sprint 13 merge)

**Status: RELEASE_FAILED** (classified 2026-11-14 under the Sprint 14 production acceptance standard).

`a548d7f` was deployed to `live` after the Sprint 13 report (served `build-info.json`: `gitSha a548d7f…`, built 2026-11-13T20:39:52Z, production, `appCheckDebug: false`). No production acceptance was recorded for it before Sprint 14.

## F-1 — the default guided journey cannot produce an integration (critical)

- **Observed in production by a user:** "Needs your attention — Gemini's answer was not a usable mapping. EYES checked it locally and refused it." The only actions were "Prepare a new request" and "See why in technical details".
- **Reproduced (REAL Gemini, identical code on localhost, 2026-11-14):** fictional CRM, guided flow, one approved request per destination.
  - Helpdesk (the default destination): refused, 3 of 3 runs.
  - Marketing: refused, 1 of 1 run.
  - Billing: accepted, 1 of 1 run.
  - Evidence: [../../sprint-14/guided-diagnosis.json](../../sprint-14/guided-diagnosis.json), [../../sprint-14/guided-recovery.json](../../sprint-14/guided-recovery.json).
- **Failure stage:** `convert`, issue `INVALID_ENUM_MAPPING`. The answer was parseable JSON, used only supported operations, and every alias existed. It keyed `map_enum` on placeholder labels (`category_a/b/c`).
- **Root cause (UI / product flow, not the validator):** the guided flow never offered the existing category-name opt-in. The status field's names were withheld, so the request showed Gemini placeholders. Helpdesk and Marketing *require* a value from a fixed list, so no valid mapping existed for that request: a guessed map is refused, and an omitted map leaves a required field empty. Model behaviour (keying on placeholders despite the instruction) is contributory, not causal.
- **Deterministic check that fails on this build:** `P-021` in [browser-results.json](browser-results.json): no readiness warning before sending.
- **Fix:** Sprint 14, branch `sprint-14-guided-reliability` ([ADR 0013](../../../decisions/0013-guided-recovery-and-production-acceptance.md)). Needs an approved deployment.

## Passed on this build (deterministic, 16 of 17)

Identity and assets, App Check enforced (HTTP 401 without a token), JSON / CSV / XLSX / REST imports, approval gate with zero requests, Firefox degradation, mobile at 390 px, keyboard access. See [browser-results.json](browser-results.json).

## Not run on this build

- Real-model production acceptance: the failure was already observed by a user and reproduced on identical code. No further production requests were spent on a build known to fail.
