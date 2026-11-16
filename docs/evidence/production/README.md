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
| [95a9564c90ef](95a9564c90ef/) | **DEPLOYED_UNVERIFIED** | Sprint 14, owner-approved. Deterministic 17/17 PASS, real Nano PASS; real cloud blocked by App Check 403 for the automated session (failed closed). Needs one human run (PF-1) |
| [0a9d42aeac68](0a9d42aeac68/) | **DEPLOYED_UNVERIFIED** | Sprint 15 first deployment. Real cloud refused at App Check; the owner's file found PF-2 and PF-3 |
| [c4a246cee432](c4a246cee432/) | **PRODUCTION_ACCEPTED** (superseded) | Sprint 15. 19/19 deterministic, real Nano + 1 real cloud request, Meridian export run independently. Rollback target for 489c6ba |
| [489c6baaf18b](489c6baaf18b/) | **PRODUCTION_ACCEPTED** (live) | Sprint 16B code (merge of PR #19), accepted in Sprint 16C on 2026-11-16: 19/19 deterministic, 62-case matrix equal to the local baseline, 45/45 exports verified, access automation 13/13, real Nano 4/4 + hybrid path with 1 approved real cloud request. Human usability and screen reader NOT RUN |
