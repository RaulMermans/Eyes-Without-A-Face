# Sprint 16B release candidate

**Status: `DEPLOYMENT_PENDING`.** Not deployed. Production serves `c4a246c` (`PRODUCTION_ACCEPTED`) until the owner approves this exact SHA.

| Item | Value |
| --- | --- |
| Release candidate SHA | **`25c5eeb45f23e1d3d6750d51f4621290ebdff2a8`** (branch `sprint-16b-mapping-integrity`) |
| App code vs. the first candidate `ed92f2a` | Identical: `git diff ed92f2a 25c5eeb -- src public index.html package.json pnpm-lock.yaml vite.config.ts firebase.json` is empty. The later commit adds docs, evidence and QA scripts |
| Build | `pnpm build:release` from a clean tree (only the untracked, unrelated `.cursor/` folder present) |
| `dist/build-info.json` | `{"gitSha":"25c5eeb45f23e1d3d6750d51f4621290ebdff2a8","dirty":false,"builtAt":"2026-11-16T13:01:55.116Z","mode":"production","appCheckDebug":false}` |
| `verify-release` | **PASS**: 31 files, 2,653 KiB; no local debug token in `dist` |
| Artifact digest | SHA-256 of the sorted per-file SHA-256 list of `dist/`: `aec1e049bc9138dd6c90a561607d5004218d044e1c15a25bf3a621b34b93bcee` |
| Regression on `25c5eeb` | Lint (0 warnings), typecheck, build, and **759 / 759 tests PASS** (unit 378, contracts 43, privacy 99, evaluation 84, E2E 155). QA reproductions 4 / 4 |
| LOCAL 62-case matrix on this artifact | See below. **LOCAL, not production evidence** |

**How the LOCAL run was served:** `vite preview` of this `dist/`, from a server started at 14:02:04 CET, after the 14:01:55 CET build.

**LOCAL results** ([results-local-rc-25c5eeb45f23.json](results-local-rc-25c5eeb45f23.json), [before-after.md](before-after.md)):

- PASS 43 · FAIL 4 · PARTIAL 7 · UNSUPPORTED 8
- Pre-selected fields: 0 / 246
- Rules without an explicit decision: 0
- "Integration ready" over wrong data: 0
- Model requests: 0
- ZIP leaks: 0
- Packages that verify: 45 / 45

## Approval package

| Item | Value |
| --- | --- |
| Firebase project | `eyes-without-a-face-b7281` |
| Domain | <https://eyes-without-a-face-b7281.web.app> |
| Exact SHA | `25c5eeb45f23e1d3d6750d51f4621290ebdff2a8` |
| Artifact | The `pnpm build:release` output above (31 files, 2,653 KiB, digest `aec1e049…`) |
| Changed behaviour | See the list below |
| Configuration changes | **None**: Firebase, App Check, reCAPTCHA, Hosting rules and keys are unchanged |
| Risk | One more explicit click per non-category field. Wrong suggestions are still possible but never applied silently. The `VERIFIED` package status remains structural |
| Rollback | Firebase Console → Hosting → release history → roll back to `c4a246c` (the last `PRODUCTION_ACCEPTED` release) |
| Deploy command (only after approval) | `npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "sprint-16b 25c5eeb45f23 (owner-approved)"` |

**Changed behaviour:**

- No field is mapped silently. Each non-category field needs an explicit choice or a "Use …" click, and "No field" is honoured.
- The result headline says "Structure verified" unless meaning was verified for every field.
- The export privacy scan judges text by where it came from. Ordinary words no longer block a safe ZIP; real leaks still do.
- Columns that can't be mapped are listed with the reason and a rename example.

**After deployment:**

1. Run `EYES_EXPECTED_SHA=25c5eeb45f23e1d3d6750d51f4621290ebdff2a8 pnpm test:production`.
2. Run the 62-case matrix against production.
3. Run `pnpm test:production:real` within the documented budget: 1 approved cloud request plus Nano.
4. Store the evidence in `docs/evidence/production/25c5eeb45f23/`.

The commit that records this file is docs-only. It does not change the app and is not the SHA to deploy.
