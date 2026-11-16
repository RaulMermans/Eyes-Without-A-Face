# Sprint 17A release candidate

**Status: `DEPLOYMENT_PENDING`.** Not deployed. Production serves `489c6ba` (`PRODUCTION_ACCEPTED`) until the owner approves this exact SHA.

## Identity

| Item | Value |
| --- | --- |
| Release candidate SHA | **`c7220768bed91ebbdfcf2eb75408a3ae62efeb10`** (branch `sprint-17a-hybrid-recovery`, parent `25f2ce2` on `main`) |
| Build | Clean, isolated checkout of that SHA. `pnpm install --frozen-lockfile`, then `pnpm build:release`. Public Firebase web config from the untracked `.env` / `.env.local`; App Check debug forced off |
| `dist/build-info.json` | `{"gitSha":"c7220768bed91ebbdfcf2eb75408a3ae62efeb10","dirty":false,"builtAt":"2026-11-16T17:20:00.931Z","mode":"production","appCheckDebug":false}` |
| `verify-release` | **PASS**: 31 files, 2,658 KiB, no local debug token |
| Artifact digest | SHA-256 of the sorted per-file SHA-256 list of `dist/`: `eedabb00b5119bfba596ef841fb24ec423127d5ea12bd94a3427fc592066b0f6` |

## Checks on this SHA

| Check | Result |
| --- | --- |
| Regression | **774 / 774 PASS**. Lint 0 warnings, typecheck, build. Unit 386, contracts 43, privacy 99, evaluation 84 (frozen), E2E 162 |
| Sprint 17A regressions | E2E-170, 173 and 175 failed on the old code and pass here. Controls E2E-170b, 171, 172 and 174 pass on both. Unit S17A-001/002: 8 / 8 |
| 62-case matrix, served locally (**LOCAL, not production evidence**) | See below |

**62-case matrix details** — `vite preview` of this `dist/` ([results-local-rc-c7220768bed9.json](local-rc/results-local-rc-c7220768bed9.json)):

- PASS 43 · FAIL 4 · PARTIAL 7 · UNSUPPORTED 8.
- **0 per-case discrepancies** against production `489c6ba` (Sprint 16C).
- 45 / 45 packages verify.
- 0 model requests; 0 canary leaks.

## Approval package

| Item | Value |
| --- | --- |
| Firebase project / domain | `eyes-without-a-face-b7281` / <https://eyes-without-a-face-b7281.web.app> |
| Exact SHA | `c7220768bed91ebbdfcf2eb75408a3ae62efeb10` |
| Artifact | 31 files, 2,658 KiB, digest `eedabb00…` |
| Configuration changes | **None**: Firebase, App Check, reCAPTCHA, Hosting rules and keys are unchanged |
| Security impact | None. Disclosure gate, approval binding, payloads, privacy scan, contracts and runtime are unchanged. The fix only *withholds* the approve action, and *narrows* what may be offered for sharing |
| Rollback | Hosting release history → `489c6ba` |
| Post-deploy acceptance | See below |

**Changed behaviour:**

- A request that preflight proves cannot fill a required fixed-list field is not offered for approval. The headline says “Not ready to send”, and the screen names the prerequisite and offers the routes.
- Sharing is offered only for the field the user chose.
- An incomplete mapping names its missing required fields and offers the local route.
- The date wording no longer implies meaning.

**Post-deploy acceptance:**

1. `EYES_EXPECTED_SHA=c7220768bed91ebbdfcf2eb75408a3ae62efeb10 pnpm test:production`. P-020 and P-021 are compatible with the change:
   - P-020 uses Billing, which has no fixed-list field, so it is never blocked.
   - P-021 asserts only the pre-send notice and 0 requests, and both still hold (the same flow is E2E-140's first test, which passes).
2. The 62-case matrix.
3. `pnpm test:production:real` (S14-REC-3 shares the names first: **1 approved cloud request**, which needs the owner's budget approval).

The commit that records this file is docs-only. It is not the SHA to deploy.
