# Sprint 16B evidence

Report: [../../qa/sprint-16b-mapping-integrity.md](../../qa/sprint-16b-mapping-integrity.md).

| File | What |
| --- | --- |
| `results-local-rc-<sha12>.json` | The 62 Sprint 16A cases on the LOCAL release candidate, verified by `scripts/qa/s16a/verify.mjs`. **Not production evidence.** Counts, codes and hash prefixes only |
| `before-after.json`, `before-after.md` | `scripts/qa/s16b/compare.mjs`: Sprint 16A production (before) vs the release candidate (after), with the acceptance gates |
| `release-candidate.md` | Exact SHA, `build-info.json`, artifact identity and the LOCAL run on that artifact |
| `screenshots/` | Crops of the release candidate's UI, without record previews (they contain canaries) |

Reproduce: see [../sprint-16a/README.md](../sprint-16a/README.md). Then:

```bash
pnpm build:release && pnpm preview --host 127.0.0.1 --port 4173 --strictPort &
EYES_QA_TARGET=local EYES_QA_RUN=local-rc-<sha12> pnpm exec playwright test -c playwright.qa-16a.config.ts
node scripts/qa/s16a/verify.mjs --run local-rc-<sha12> --evidence docs/evidence/sprint-16b
node scripts/qa/s16b/compare.mjs --after local-rc-<sha12>
```
