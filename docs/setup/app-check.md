# App Check setup

Firebase AI Logic setup enforces App Check. This product does not bypass that enforcement to make a demo look successful.

Do not add `localhost` to reCAPTCHA allowed domains. Do not inject a standalone reCAPTCHA script. Use the Firebase App Check SDK with `ReCaptchaEnterpriseProvider`.

## Production

1. The web app is already registered with Fraud Defense / reCAPTCHA Enterprise.
2. Set `VITE_FIREBASE_APP_CHECK_SITE_KEY` to that public site key.
3. Leave `VITE_APP_CHECK_DEBUG=false`.
4. Production builds ignore the debug flag. If it is set, initialization throws.

## Localhost debug workflow

Official SDK workflow:

1. Keep the production site key in `.env.local`. Vite prefers `.env.local` over `.env`; a placeholder in `.env.local` wins.
2. Set `VITE_APP_CHECK_DEBUG=true` (development builds only). Production builds throw if the debug flag is on.
3. The runtime sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` **before** `initializeAppCheck`.
4. Load the app, open DevTools, copy the App Check debug token printed by the SDK.
5. Firebase Console → App Check → Apps → overflow menu on `eyes-without-a-face-web` → **Manage debug tokens** → register it.
6. Reload and retry cloud inference. Do not bypass enforcement.

### Fixed token for the live Playwright suite

Playwright starts a fresh browser profile on every run, so an SDK-generated token changes each time and the token registered from your normal browser does not apply. To qualify the cloud path with `pnpm test:live`:

1. Generate a UUID v4 into a private file outside the repository, without printing it:

   ```bash
   mkdir -p ~/.config/eyes-without-a-face && chmod 700 ~/.config/eyes-without-a-face
   (umask 077; node -e 'process.stdout.write(crypto.randomUUID())' > ~/.config/eyes-without-a-face/appcheck-debug-token)
   ```

   Sprint 4 already created this file on the development machine (mode 600) and registered it on 2026-11-11 as `sprint-4-live-tests (EVO X3, local only)`.
2. Firebase Console → App Check → Apps → `eyes-without-a-face-web` → **Manage debug tokens** → **Add debug token** → paste the UUID.
3. Run with the token in a non-`VITE_` shell variable:

   ```bash
   EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
   EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live
   ```

The live spec injects it as `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before the app loads. Playwright traces would record that init-script argument, so `playwright.live.config.ts` turns tracing off whenever the variable is set. `firebase-live.ts` keeps a pre-set string token instead of overwriting it with `true`. The variable is not read by Vite, not written to evidence, and must not be committed. Revoke the token in the console when qualification is done.

The token is a credential:

- Never put it in `VITE_*`.
- Never commit it.
- Never paste it into Playwright traces, screenshots, CI logs, or issue reports.
- Never ship debug mode in a production build.

If App Check rejects a live request, keep the sanitized error (`APP_CHECK_REJECTED`) and fix the token or site key. Do not disable App Check.

## Sprint 5: production attestation and token lifecycle

### Production (hosted) builds

- Build with `pnpm build:release`. It forces `VITE_APP_CHECK_DEBUG=false` even if `.env.local` enables debug, and `scripts/verify-release.mjs` refuses any bundle with debug mode or a debug token.
- Attestation uses reCAPTCHA Enterprise (score-based, `minValidScore` 0.5). The key's allowed domains are only `eyes-without-a-face-b7281.web.app` and `eyes-without-a-face-b7281.firebaseapp.com`. **Preview channel hosts are not covered.** See [../deployment.md](../deployment.md#production-app-check-and-preview-channels-the-constraint).
- Automated browsers tend to get low reCAPTCHA scores. Verify hosted App Check in a normal, interactively used Chrome window, not under Playwright.
- Enforcement for Firebase AI Logic is the App Check service `firebaseml.googleapis.com`, which is **ENFORCED**. Keep it enforced.

### Development debug token lifecycle

| Stage | Action |
| --- | --- |
| Stored | `~/.config/eyes-without-a-face/appcheck-debug-token` (mode 600, outside Git). Never in `VITE_*`, never in docs, screenshots, traces, CI logs or videos |
| Registered | App Check → `eyes-without-a-face-web` → debug token `sprint-4-live-tests (EVO X3, local only)` |
| Checked | `scripts/verify-release.mjs` confirms the token value is absent from `dist/`. The Sprint 5 history scan confirms it is absent from every commit |
| Revoke | When no further live runs are planned (after the demo recording and any hosted verification), delete it: Firebase Console → App Check → Apps → Manage debug tokens → delete, or `DELETE https://firebaseappcheck.googleapis.com/v1/projects/507051460368/apps/1:507051460368:web:086c755a2c003fb30b4795/debugTokens/<id>` with the CLI's OAuth session |
| Recovery | To run the live suite again later, generate a new UUID into the same private file and register it under a new display name. Nothing in the repository changes |

Do not revoke during active qualification without that recovery step ready. The recording and live suite depend on it until a hosted production build is verified.
