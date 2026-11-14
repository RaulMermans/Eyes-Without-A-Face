# Production evidence

One folder per deployed release, named by the first 12 characters of its SHA. Rules: [../../deployment.md](../../deployment.md#production-acceptance-standard-permanent).

| File | Written by | Contents |
| --- | --- | --- |
| `release-manifest.json` | `pnpm test:production` (P-001) | tested URL, expected and served SHA, `build-info.json`, asset status, browser, time |
| `browser-results.json` | `pnpm test:production` | one row per deterministic check and browser: PASS / FAIL / SKIPPED, duration, safe details |
| `inference-results.json` | `pnpm test:production:real` (`EYES_LIVE_EVIDENCE`) | real-model runs: statuses, counts, provenance, hashes, alias-level model text, export result |
| `acceptance-results.json` | release engineer | the release status and each area's result, kind (REAL / DETERMINISTIC / SIMULATED) and evidence link |
| `failures.md` | release engineer | every failed or unrun check, its cause and the decision |
| `screenshots/` | `pnpm test:production` | viewport screenshots of fictional data only |

Never store tokens, API keys, request bodies or real records here. A body-scan or secret-scan match blocks the commit until it is traced.

| Release | Status | Notes |
| --- | --- | --- |
| [a548d7fbd7b8](a548d7fbd7b8/) | **RELEASE_FAILED** | Sprint 13 merge. The default guided journey cannot build (F-1). Fix in Sprint 14 |
