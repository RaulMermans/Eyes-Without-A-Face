# Deployment

**Status (2026-11-14, Sprint 14): `DEPLOYED_UNVERIFIED`.**

<https://eyes-without-a-face-b7281.web.app> serves `95a9564c90efd97085dea420b5dca3d62ff265cf`, deployed about 06:47 UTC with the owner's explicit approval of that exact SHA. No configuration change was made.

- **Passed:** every deterministic production check (17 / 17) and real Gemini Nano on the hosted build.
- **Not verified:** the real Gemini Cloud happy path. Two automated sessions were refused at the App Check exchange (HTTP 403). The app failed closed and sent nothing.
- **To finish:** one human run in a normal Chrome window ([evidence/production/95a9564c90ef/failures.md](evidence/production/95a9564c90ef/failures.md)).
- **Previous release** `a548d7f` was RELEASE_FAILED ([failures](evidence/production/a548d7fbd7b8/failures.md)).
- **Rollback target:** `b93e3ed`, the last PRODUCTION_ACCEPTED release.

## Production acceptance standard (permanent)

This applies to every release from Sprint 14 on. Rules: [AGENTS.md](../AGENTS.md) "Release lifecycle and production acceptance". **Tests passing does not mean the product works in production.**

### Release statuses

| Status | Means | Evidence needed |
| --- | --- | --- |
| `CODE_READY` | Implementation done; full regression, lint, typecheck and build pass | test totals in the sprint report |
| `DEPLOYMENT_PENDING` | Release artifact built from the exact SHA and verified; waiting for the owner | `build:release` + `verify:release` PASS on that SHA, approval package presented |
| `DEPLOYED_UNVERIFIED` | The approved deployment finished; acceptance not yet passed | deploy time, Hosting version, served `build-info.json` |
| `PRODUCTION_ACCEPTED` | The served SHA passed every required check below on the public URL | `docs/evidence/production/<sha12>/` complete, no open critical failure |
| `RELEASE_FAILED` | A critical production check failed | `failures.md`; fix forward or roll back (approval needed) |

### 1 · Before asking for approval (build verification)

From a clean checkout of the exact SHA:

```bash
git status --porcelain                         # empty
pnpm install --frozen-lockfile
pnpm test:all                                  # lint, typecheck, unit, contracts, privacy, evaluation, build, e2e
pnpm build:release                             # refuses a dirty tree, forces App Check debug off, stamps the SHA, runs verify-release
jq -r .gitSha dist/build-info.json             # must equal the SHA to approve
```

`verify-release` also checks the Firebase project and app, absence of debug tokens and credential patterns, source maps and `.env` files. Do not ask for approval if any of this fails.

### 2 · Approval package (owner decides)

Present, in one message: target project (`eyes-without-a-face-b7281`), domain (`eyes-without-a-face-b7281.web.app`), **exact SHA**, artifact identity (`dist/build-info.json`, file count, size), security or configuration changes (normally none), expected impact, and rollback. Deploy only after an explicit "yes" to that SHA. A sprint brief, PR approval or merge is not a deployment approval, and a different SHA needs a new one.

```bash
npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "<sprint> <sha12>"
```

Status is then `DEPLOYED_UNVERIFIED` until step 3 passes.

### 3 · Production acceptance (on the public URL)

**Deterministic checks — no inference, no cost:**

```bash
EYES_EXPECTED_SHA=<approved sha> pnpm test:production
```

`tests/production/production.spec.ts` (Chromium, with Firefox for the `@cross-browser` subset):

| ID | Check |
| --- | --- |
| P-001 | `build-info.json` SHA = approved SHA, production mode, no debug, clean; footer shows it; every referenced asset is HTTP 200 |
| P-002 | No debug token in the page; the model endpoint refuses a request without App Check (HTTP 401) |
| P-010…P-012 | JSON, CSV and XLSX demo imports normalize to 3 records × 6 fields, locally |
| P-013 | The read-only REST connector reads a public CORS API with one GET, as a snapshot (`EYES_PRODUCTION_REST=0` skips it) |
| P-014 | An invalid file explains itself and loads nothing |
| P-020 | Build stops at the exact request, with no private terms in it; declining sends nothing |
| P-021 | A destination that needs category names warns before anything is sent |
| P-022 | An invalid destination blocks Build with a reason |
| P-023 | Guided ↔ technical navigation keeps the prepared request |
| P-030, P-031 | No horizontal scroll at 390 px on any step; the keyboard reaches the file control |

Every check counts page errors and asserts **zero** `generateContent` requests. It writes `browser-results.json`, `release-manifest.json` and `screenshots/`.

**Real models — fixed inference budget:**

```bash
EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_RECOVERY=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 EYES_RECOVERY_ONLY=3 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_LIVE_EVIDENCE=docs/evidence/production/<sha12>/inference-results.json pnpm test:production:real
```

`S14-REC-3` runs one hybrid happy path:

- real Gemini Nano on the device, with zero cloud requests while it runs;
- the user's explicit category-name choice;
- **one** approved Gemini request, through production reCAPTCHA App Check;
- local verification;
- `node run.mjs verify` on the exported package in a clean directory.

It asserts zero private terms in the request body and `nano-used` on the result. The config refuses a debug token and localhost.

| Budget per release | Requests |
| --- | --- |
| Real hybrid happy path | 1 cloud request (+ on-device, free) |
| Verifying a critical fix found during acceptance | at most 2 more, declared in `failures.md` before they are sent |
| Never | loops until a run passes; provoking provider failures in production |

Reuse earlier real evidence only for an unchanged build and path. A changed release needs its own run.

**Failure paths** are proven by deterministic fault injection in `pnpm test:e2e`:

- invalid file and invalid destination;
- declined disclosure;
- invalid model proposals of every diagnosis kind (E2E-140…142);
- provider unavailable;
- failing recovery preparation (E2E-142);
- stale destination (E2E-145);
- export (E2E-130).

Production repeats only the deterministic subset above.

**Record:** `acceptance-results.json` (status and each area as REAL / DETERMINISTIC / SIMULATED, with evidence links) and `failures.md` (every failed or unrun check). Layout: [evidence/production/README.md](evidence/production/README.md).

### 4 · Rollback criteria

Stop the release, and roll back or fix forward (owner approval either way) when any of these happens:

- the primary hosted journey is unusable;
- private data is exposed unexpectedly;
- App Check is broken or disabled;
- a stale approval is accepted;
- mapping validation can be bypassed;
- critical exports are corrupted.

Rollback: Firebase Console → Hosting → release history → **Rollback** to the last `PRODUCTION_ACCEPTED` release. Today that is `b93e3ed` (Sprint 12 hosted acceptance). Never change Firebase or App Check configuration silently.

## Sprint 12 deployment record

### Read-only preflight (2026-11-13, before approval)

| Item | Result | How |
| --- | --- | --- |
| Project | `eyes-without-a-face-b7281` (507051460368), ACTIVE; **billing not enabled** (Spark) | Firebase MCP `get_project`, `get_environment` |
| Web app | `eyes-without-a-face-web`, `1:507051460368:web:086c755a2c003fb30b4795`, ACTIVE | Firebase MCP `list_apps` |
| Hosting | site `eyes-without-a-face-b7281`, channel `live` only, never released (`/` and `/build-info.json` → 404) | `firebase-tools@15.35.0 hosting:channel:list`; HTTP GET |
| App Check enforcement for Firebase AI Logic | **ENFORCED.** `POST …/models/gemini-3.5-flash-lite:generateContent` with the public API key and no App Check token → `401 UNAUTHENTICATED "Firebase App Check token is invalid."` The prompt carried no data | HTTP probe (no inference ran) |
| reCAPTCHA allowed domains | **Not re-read** (no gcloud; CLI credential store not used to mint tokens). Last read 2026-11-11: exactly the two Hosting domains. Indirect evidence after deployment: attestation succeeds on `web.app` | — |
| Firebase AI Logic | Real `IN_CLOUD` answers (debug token on localhost; production reCAPTCHA on the hosted build) | live runs |

### Release artifact

`pnpm install --frozen-lockfile`, full regression (lint, typecheck, 251 unit, 43 contract, 69 privacy, 62 evaluation, 113 E2E: **538 pass**), then `pnpm build:release` + `pnpm verify:release` **PASS** on `b93e3ed` with a clean tree: `mode: production`, `appCheckDebug: false`, 29 files, 1,985 KiB, local debug token absent (also checked independently; also absent from every commit in history). The bundle's canary string is the privacy guard's detection constant; the `FIREBASE_APPCHECK_DEBUG_TOKEN` code is the SDK's debug path, which the production build refuses at runtime.

### Approval and deployment

- Approval package presented to the owner: target URL, exact SHA, project, App Check status, no configuration changes, impact, rollback.
- **Owner approved** "Approve live deploy" for `b93e3ed` → `live`.
- `npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "sprint-12 b93e3edbb997 (owner-approved)"` → release complete (2026-11-13, ~13:00 UTC). 29 files.
- No App Check, reCAPTCHA, billing, permission or domain change was made.

### Hosted acceptance (2026-11-13)

| # | Check | Result | Status |
| --- | --- | --- | --- |
| 1 | `build-info.json` SHA = approved SHA; footer shows it | `b93e3edbb997…`, footer `build b93e3edbb997` | **VERIFIED** |
| 2 | HTTPS | HTTP/2 200, HSTS `max-age=31556926; includeSubDomains; preload`; `http://` → 301 to `https://`; `firebaseapp.com` also serves | **VERIFIED** |
| 3 | App Check enforced, no debug token | 401 without a token (above); production reCAPTCHA attestation succeeded in both hosted runs with no debug token; token absent from hosted JS | **VERIFIED** |
| 4 | No cloud inference before approval | 0 `generateContent` before **Send approved request** (both runs) | **VERIFIED** |
| 5 | Real Gemini Cloud after approval | `real Gemini output · IN_CLOUD`, valid, 2.5 s and 2.4 s; 2 requests per run, each approved | **VERIFIED** |
| 6 | Gemini Nano on the supported Chrome | 6 / 6 fields `real on-device` in CONNECT (Chrome 157, dedicated Nano profile) | **VERIFIED** |
| 7 | Unsupported environments degrade honestly | Chromium 158 without Nano and Firefox 159: *Deterministic, not hybrid*, stage `skipped`, 0 requests, 0 page errors | **VERIFIED** |
| 8 | Full journey CONNECT → OBSERVE → OUTCOME → EXPORT | 2 / 2 runs: semantic failure detected, revision `ACCEPTED`, *Verified, with managed exceptions.* | **VERIFIED** |
| 9 | Export executes outside the app | `node run.mjs verify` exit 0 in a fresh temp directory with only `PATH` set (2 / 2) | **VERIFIED** |
| 10 | Request bodies | 4 bodies, 0 private terms | **VERIFIED** |

Evidence: [evidence/sprint-12/hosted-acceptance.json](evidence/sprint-12/hosted-acceptance.json), [hosted-degradation.json](evidence/sprint-12/hosted-degradation.json), [screenshots](demo/screenshots/sprint-12-hosted/). Specs: `playwright.hosted.config.ts`, `tests/live/sprint11-experience.spec.ts`, `tests/live/hosted-degradation.spec.ts`.

**Limits of this acceptance.** The runs were driven by Playwright from one machine (Linux, Chrome 157 with a dedicated profile). reCAPTCHA scored that session high enough; a different network or automation setup may score lower. A human run in a normal Chrome window is still the recording path ([demo/hero-demo.md](demo/hero-demo.md)). Two runs are a requalification, not a reliability measure.

### What a new deployment would change

Sprint 12 changes the app in one place: the Source step's scenario picker now also lists the fictional experiment scenario `crm-nl-relations` (`src/evaluation/scenarios.ts`, `src/app/SourcePanel.tsx`). Everything else is docs, tests and evidence. The deployed `b93e3ed` is the product to demo. **Redeploying is optional**; if wanted, approve the exact merge SHA of the Sprint 12 PR and repeat the procedure below.

### Rollback

- To the pre-Sprint-12 state (never released): `npx -y firebase-tools@15.35.0 hosting:disable --project eyes-without-a-face-b7281`.
- After a later release: Firebase Console → Hosting → release history → **Rollback** to the version deployed from `b93e3ed` (deployed 2026-11-13).
- Keep the site, the Firebase project and the free-tier quota available until judging ends (2026-12-16).

## Sprint 11 read-only preflight (2026-11-13)

| Item | Result | How |
| --- | --- | --- |
| Project | `eyes-without-a-face-b7281` (507051460368), ACTIVE; billing **not enabled** | Firebase MCP `get_project`, `get_environment` |
| Web app | `eyes-without-a-face-web`, `1:507051460368:web:086c755a2c003fb30b4795`, ACTIVE | Firebase MCP `list_apps` |
| Hosting channels | `live` only; expires never; **no preview channels** | `firebase-tools@15.35.0 hosting:channel:list` |
| Served content | `/` → 404 "Site Not Found"; `/build-info.json` → 404. No release has ever been made | HTTP GET |
| Firebase AI Logic | Works from localhost with the registered debug token: real `IN_CLOUD` answer in the Sprint 11 live run | [evidence/sprint-11/live-experience.json](evidence/sprint-11/live-experience.json) |
| App Check enforcement, reCAPTCHA allowed domains | **Not re-read** (no gcloud on this machine; the CLI credential store was not used to mint tokens). Last verified 2026-11-11: ENFORCED; exactly the two Hosting domains | — |

## Sprint 11 release candidate and owner approval package

**Release candidate verified:** `pnpm build:release` + `pnpm verify:release` **PASS** on `a9cf261f9adda9ddd977c1cbcfb879ac447a9ed3` (clean tree; `mode: production`; `appCheckDebug: false`; the local debug token absent from `dist` (also checked independently); 29 files, 1,985 KiB; the >500 kB chunk warning predates Sprint 11). The fictional demo datasets intentionally contain the privacy canary; this is expected and accepted by `verify-release`.

**What to approve (each line separately):**

| Decision | Exact value |
| --- | --- |
| Target | Firebase project `eyes-without-a-face-b7281`, Hosting site `eyes-without-a-face-b7281`, channel `live` → <https://eyes-without-a-face-b7281.web.app> |
| Git SHA | The **merge commit of the Sprint 11 PR** into `main`. Rebuild from it with `pnpm build:release`; `dist/build-info.json` `gitSha` must equal it. Do not deploy the `a9cf261` build unless you approve that SHA explicitly |
| External configuration changes | **None required** for option B: `web.app` is already an allowed reCAPTCHA domain. Before deploying, re-read in the console that App Check is ENFORCED for Firebase AI Logic and that the key lists exactly the two Hosting domains (no wildcard, no localhost). No billing change |
| Expected impact | First public release: a static site. No backend, no database, no logging sink. Cloud inference runs only after a user approval in the page, through App Check |
| Optional | Option C first (7-day preview channel): verifies assets and on-device only; cloud is expected to fail closed (`APP_CHECK_REJECTED`) because the preview host is not an allowed domain. Do **not** add the preview host or a wildcard |

**Commands after approval** (from a clean checkout of the approved SHA):

```bash
git checkout <approved-merge-sha> && git status --porcelain --untracked-files=no   # must be empty
pnpm install --frozen-lockfile && pnpm test:all && pnpm build:release
jq -r .gitSha dist/build-info.json                                                  # must equal <approved-merge-sha>
npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "sprint-11 $(git rev-parse --short HEAD)"
```

**Hosted acceptance (nothing is claimed before it runs):** follow the 9-step post-deployment checklist below. In short:

1. `build-info.json` SHA equals the approved SHA.
2. App Check is enforced and there is no debug token.
3. A real `IN_CLOUD` mapping is produced, with one `generateContent` per approval.
4. Request bodies contain no private terms.
5. Nano runs on the qualifying profile, and a non-Nano Chrome says "deterministic, not hybrid".
6. Firefox loads the app.
7. Export, then `node run.mjs verify` on a clean machine.
8. Console clean.
9. Record the URL, SHA, deploy time and Hosting version in `docs/sprints/sprint-11.md` (or the next report).

**Failure policy:** record the evidence and classify the failure. Never bypass App Check and never change Firebase configuration silently. Roll back (below) or prepare a narrow fix, and ask again before any further external change.

**Rollback:** `live` has never served a release, so `npx -y firebase-tools@15.35.0 hosting:disable --project eyes-without-a-face-b7281` restores the exact pre-deployment state. After later releases, use Console → Hosting → release history → **Rollback** to the previous version.

## Sprint 9 read-only re-audit (2026-11-13)

| Item | Result | How |
| --- | --- | --- |
| Project | `eyes-without-a-face-b7281` (507051460368), ACTIVE | Firebase MCP `get_project` |
| Web app | `eyes-without-a-face-web`, `1:507051460368:web:086c755a2c003fb30b4795`, ACTIVE | Firebase MCP `list_apps` |
| Hosting site / channels | one site; channel `live` only; **no preview channels** | CLI `hosting:sites:list`, `hosting:channel:list` (firebase-tools 15.35.0) |
| Served content | `https://eyes-without-a-face-b7281.web.app/` → **404 "Site Not Found"**; `/build-info.json` → 404 | HTTP GET |
| App Check enforcement, reCAPTCHA domains, debug tokens | **Not re-read this sprint** (no gcloud on this machine; the CLI credential store was deliberately not used to mint tokens). Last verified 2026-11-11 (table below) | — |
| API key restrictions | Not inspected (API Keys API disabled, unchanged) | — |

The channel table's "Last Release Time" (2026-11-10 18:20 local) is the channel creation time recorded below; the URL still serves Firebase's 404, so no release exists.

## Sprint 9 release candidate

`pnpm build:release` + `pnpm verify:release` **PASS** on a clean tree (29 files, 1.9 MB, `mode: production`, `appCheckDebug: false`, debug token absent, build SHA stamped). The exact SHA to deploy is the commit the owner approves (normally the merge of the Sprint 9 PR); rebuild from it, never deploy a build of another commit. The export runtime is a separate lazy chunk (`eyes-mapping-runtime-*.js`, about 400 kB) loaded only when the user exports.

### Owner approval checklist (each line is a separate approval)

- [ ] Approve the exact commit SHA to deploy.
- [ ] Re-read App Check enforcement for `firebaseml.googleapis.com` (must be ENFORCED) and the reCAPTCHA key domains (must be exactly the two Hosting domains, no wildcard) in the console.
- [ ] Approve option C (7-day preview channel, expected to fail closed for cloud) — optional.
- [ ] Approve option B (first release to `live`).
- [ ] Do **not** add preview hosts to reCAPTCHA unless separately approved; never a wildcard; never disable enforcement.
- [ ] Decide whether to revoke the local debug token `sprint-4-live-tests` after recording (it does not affect production).

### Post-deployment verification (run on the deployed build; nothing is claimed before)

1. `GET /build-info.json` → `gitSha` equals the approved SHA; footer shows `build <sha12>`.
2. Normal Chrome window, approved domain: Runtime check shows Firebase CONFIGURED, App Check CONFIGURED; `self.FIREBASE_APPCHECK_DEBUG_TOKEN` undefined.
3. Hero journey (docs/demo/hero-demo.md) on `crm-eu-accounts`: approve → `Real Gemini output · IN_CLOUD`; exactly one `generateContent` request with an `X-Firebase-AppCheck` header; Runtime check turns cloud VERIFIED.
4. Network tab: request bodies contain aliases and fictional examples only (search for a record value, e.g. a customer email: 0 hits).
5. Nano on the qualifying profile: `ON_DEVICE` suggestions, no `generateContent` during them. In a Chrome without Nano: on-device UNAVAILABLE, deterministic path works, no hybrid claim.
6. Unsupported browser (e.g. Firefox): app loads, on-device UNAVAILABLE, no error loop.
7. Export Integration → unzip on another machine/directory → `node run.mjs verify` exit 0.
8. Console: no errors, no record values, no tokens.
9. Record URL, SHA, `build-info.json`, deploy time and Hosting version in `docs/sprints/sprint-9.md` (or the Sprint 10 report).

### Rollback

Unchanged (below): disable or roll back the `live` release; `live` was empty before, so `hosting:disable` restores the pre-deployment state. The export feature has no server side and nothing to roll back beyond the static release.

## Verified current state (read-only inspection, 2026-11-11)

| Item | Value | How verified |
| --- | --- | --- |
| Firebase project | `eyes-without-a-face-b7281` (number 507051460368) | CLI `projects:list` |
| Web app | `eyes-without-a-face-web`, `1:507051460368:web:086c755a2c003fb30b4795` | CLI `apps:list` |
| Hosting site | `eyes-without-a-face-b7281`, default URL <https://eyes-without-a-face-b7281.web.app> | CLI `hosting:sites:list` |
| Channels | `live` only, created 2026-11-10 17:20 UTC | CLI `hosting:channel:list` |
| Releases / versions | **None.** The Hosting API returns no versions and no releases, and the URL serves Firebase's "Site Not Found" 404 | Hosting REST `versions`, `channels/live/releases`; HTTP GET |
| App Check enforcement | `firebaseml.googleapis.com` (Firebase AI Logic): **ENFORCED** | App Check REST `services` |
| App Check provider | reCAPTCHA Enterprise, site key `6Lfwqh…7Wjo` (public), token TTL 3600 s, `minValidScore 0.5` | App Check REST `recaptchaEnterpriseConfig` |
| reCAPTCHA allowed domains | `eyes-without-a-face-b7281.web.app`, `eyes-without-a-face-b7281.firebaseapp.com` (no wildcard, no localhost) | reCAPTCHA Enterprise REST `keys` |
| Debug tokens | 1: `sprint-4-live-tests (EVO X3, local only)` | App Check REST `debugTokens` (token values are input-only and never returned) |
| API key restrictions | **Not inspected.** The API Keys API is disabled in the project; reading it would require enabling a service | `apikeys.googleapis.com` → `SERVICE_DISABLED` |

Earlier docs described the `live` channel as holding "an older release of unknown revision". That was wrong: the channel has never served a release. The first deployment therefore overwrites nothing.

## Release build

```bash
pnpm build:release   # clean tree required
```

`scripts/build-release.mjs`:

1. refuses a dirty working tree, so a deployed build always matches a commit;
2. forces `VITE_APP_CHECK_DEBUG=false` through the process environment. This matters because Vite loads `.env.local` in every mode, and a developer `.env.local` with debug on would otherwise bake debug mode into the bundle, and the production app then refuses cloud inference;
3. stamps `VITE_BUILD_SHA`, shown in the app footer, and writes `dist/build-info.json`;
4. runs `scripts/verify-release.mjs`, which fails on: a non-production build, debug mode, the wrong Firebase project or app, a missing site key, inference flags off, unexpected inlined variables, a literal debug-token assignment, the local debug token value anywhere in `dist`, source maps, `.env` files, traces, or credential patterns.

`pnpm build` on its own is for CI and local checks. Never deploy its output.

## Production App Check and preview channels: the constraint

reCAPTCHA Enterprise accepts tokens only from the key's allowed domains. A Hosting **preview channel** is served from `eyes-without-a-face-b7281--<channel>-<hash>.web.app`, a different host that is not covered by `eyes-without-a-face-b7281.web.app`. On a preview channel, App Check attestation will therefore fail, and cloud inference will be refused (`APP_CHECK_REJECTED`) unless that exact host is added to the key.

Options, each needing owner approval:

| Option | External changes | Proves production App Check? |
| --- | --- | --- |
| **A. Preview, then add its host** | Create a preview channel. Add the exact preview host to the reCAPTCHA key's allowed domains. Remove it again when the channel expires | Yes, on the preview host |
| **B. Deploy to `live`** | Create the first release on `live` (currently empty, so nothing is overwritten) | Yes, on the already-allowed `web.app` host |
| C. Preview only | Create a preview channel | No. It verifies assets and the on-device path only; the cloud is expected to fail closed |

**Recommendation: B** after a short C. Option C costs nothing and confirms that the hosted bundle loads and fails closed. B then uses a domain that is already allowed, so no key configuration changes. Never add a wildcard such as `web.app` to the key.

Do not disable App Check enforcement to make a preview work.

## Procedure (after approval)

```bash
git checkout <approved-commit> && git status --porcelain   # must be empty
pnpm install --frozen-lockfile
pnpm test:all
pnpm build:release
# C — short preview (7 days):
npx -y firebase-tools@15.35.0 hosting:channel:deploy sprint5-rc --expires 7d --project eyes-without-a-face-b7281
# B — live (only with separate approval):
npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "sprint-5 $(git rev-parse --short HEAD)"
```

Record in `docs/sprints/sprint-5.md`: URL, full Git SHA, `dist/build-info.json`, deploy time and the Hosting version name.

### Hosted verification checklist

1. `GET /build-info.json` matches the deployed SHA, and the footer shows `build <sha>`.
2. In a normal Chrome window (not automation; reCAPTCHA scores automated browsers low, `minValidScore` 0.5), run the demo. App Check acquires a token with no debug token anywhere: `self.FIREBASE_APPCHECK_DEBUG_TOKEN` is undefined.
3. Disclosure Review → approve → Send. The proposal origin shows `Real Gemini output · IN_CLOUD`. The Network tab shows exactly one `generateContent` request, carrying an `X-Firebase-AppCheck` header.
4. Reality Check: 3 / 3 imported, 0 / 3 hidden cases covered.
5. On the EVO X3 qualifying profile, the twin step shows on-device available and role suggestions labeled *(real on-device)*, with no `generateContent` request.
6. In a Chrome without Nano, the twin step shows `ON_DEVICE_BLOCKED` with the manual/deterministic mode and no hybrid claim.
7. No private data is uploaded: Hosting serves static files only. There is no backend, database or logging sink.

## Rollback

- Preview channel: `npx -y firebase-tools@15.35.0 hosting:channel:delete sprint5-rc --project eyes-without-a-face-b7281`, or let it expire.
- Live: Firebase Console → Hosting → release history → **Rollback**, or `hosting:disable` to take the site offline. Since `live` was empty before, disabling restores the pre-Sprint-5 state.
- A reCAPTCHA domain added for option A: remove it from the key's allowed domains.
