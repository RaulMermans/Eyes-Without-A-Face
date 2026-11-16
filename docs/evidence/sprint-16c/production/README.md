# Sprint 16C — production evidence

**Status: `PRODUCTION_ACCEPTED`.** `489c6baaf18bf22d146e583752eecc343ed3d986` was deployed with the owner's approval on 2026-11-16 at 14:06:49 UTC, and every required hosted check passed.

| Evidence | Where |
| --- | --- |
| 62-case matrix (production) | [results-production-489c6ba.json](results-production-489c6ba.json), [before-after.md](before-after.md) |
| Real Nano subset | [nano-results.json](nano-results.json) |
| Deterministic suite, real hybrid path, release status | [../../production/489c6baaf18b/](../../production/489c6baaf18b/acceptance-results.json) |
| Access automation | [../accessibility/automated-production.json](../accessibility/automated-production.json) |

The runbook that was used, kept for re-runs:

After an approved deployment, run in this order (from the repository root). Results go into this folder and `docs/evidence/production/489c6baaf18b/`.

```bash
# 0. Identity
curl -s https://eyes-without-a-face-b7281.web.app/build-info.json     # gitSha must be 489c6ba…, mode production, appCheckDebug false

# 1. Deterministic production acceptance (19+ checks, zero model requests)
EYES_EXPECTED_SHA=489c6baaf18bf22d146e583752eecc343ed3d986 pnpm test:production

# 2. The same 62 Sprint 16A cases, the unchanged oracle, against production
EYES_EXPECTED_SHA=489c6baaf18bf22d146e583752eecc343ed3d986 EYES_QA_RUN=production-489c6ba \
  pnpm exec playwright test -c playwright.qa-16a.config.ts
node scripts/qa/s16a/verify.mjs --run production-489c6ba --evidence docs/evidence/sprint-16c/production
node scripts/qa/s16b/compare.mjs --after production-489c6ba --evidence docs/evidence/sprint-16c/production   # vs Sprint 16A production
# Local baseline (25c5eeb, identical app code): PASS 43 · FAIL 4 · PARTIAL 7 · UNSUPPORTED 8 · ZIP verify 45/45

# 3. Automated cross-browser / access checks and the Scenario 2 dry-run on production
EYES_ACCESS_OUT=docs/evidence/sprint-16c/production/access pnpm exec playwright test -c playwright.qa-16c.config.ts

# 4. Real models (separate approval of the cloud budget: 1 request)
EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_RECOVERY=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 EYES_RECOVERY_ONLY=3 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_LIVE_EVIDENCE=docs/evidence/production/489c6baaf18b/inference-results.json pnpm test:production:real
EYES_LIVE_TESTS=1 EYES_LIVE_ON_DEVICE=1 EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
  pnpm exec playwright test -c playwright.qa-16a-nano.config.ts        # Nano subset (on-device, 0 cloud)
```

Any regression in privacy, explicit field decisions, semantic status wording or exported results blocks `PRODUCTION_ACCEPTED`. Rollback: Hosting release history → `c4a246c`, with the owner's approval.
