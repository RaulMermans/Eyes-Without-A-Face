# Sprint 16A evidence

Report: [../../qa/sprint-16a-real-world-production.md](../../qa/sprint-16a-real-world-production.md).

| File | What |
| --- | --- |
| `dataset-manifest.json` | Seeds, dimensions, expectation and SHA-256 of every generated source; the dataset hash of the exact run (canaries are crypto-random, so regenerating changes only canary strings and these hashes) |
| `preflight/` | `pnpm test:production` against the served SHA before the matrix (19/19) |
| `results-production.json` | Per-case verification by `scripts/qa/s16a/verify.mjs`: oracle comparison, runner replay, ZIP integrity and privacy scan. Values are counts, codes and hash prefixes only. |
| `scorecard.json`, `matrix.md` | Triage + metrics by `scripts/qa/s16a/scorecard.mjs` |
| `nano-results.json` | Genuine Gemini Nano subset (4 cases, on device, 0 cloud requests) |
| `failures.md` | Prioritized defects and limitations, reproductions, minimal fixes |
| `screenshots/` | Crops of the deployed UI at the failing step. No record previews (these hold canaries) |

Not committed (gitignored `qa-artifacts/`): the generated sources, ground truth, the private canary registry, raw downloads (transformed records, ZIPs, bindings) and full-page screenshots. Regenerate with `node scripts/qa/s16a/generate.mjs`.

## Reproduce

```bash
node scripts/qa/s16a/generate.mjs                                   # 62 cases → qa-artifacts/sprint-16a
EYES_EXPECTED_SHA=<served sha> pnpm exec playwright test -c playwright.qa-16a.config.ts
node scripts/qa/s16a/verify.mjs --run production                    # → results-production.json
node scripts/qa/s16a/scorecard.mjs --run production                 # → scorecard.json, matrix.md
EYES_LIVE_TESTS=1 EYES_LIVE_ON_DEVICE=1 EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
  pnpm exec playwright test -c playwright.qa-16a-nano.config.ts     # genuine Nano subset
pnpm exec vitest run -c vitest.qa-16a.config.ts                     # domain reproductions (D1, D3)
```

Public snapshots (USGS CSV, TfL JSON) are fetched into `qa-artifacts/sprint-16a/public/` before generation:

```bash
curl -s "https://api.tfl.gov.uk/Line/Mode/tube/Status" -o qa-artifacts/sprint-16a/public/tfl-tube-status.json
curl -s "https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2026-11-01&endtime=2026-11-03&minmagnitude=2.5&limit=200&orderby=time-asc" -o qa-artifacts/sprint-16a/public/usgs-eq.csv
date -u +%FT%TZ > qa-artifacts/sprint-16a/public/retrieved-at.txt
```
