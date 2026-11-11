# Deployment

**Status (Sprint 5, 2026-11-11): nothing has been deployed.** Every deployment step below is an external side effect and requires explicit owner approval.

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
