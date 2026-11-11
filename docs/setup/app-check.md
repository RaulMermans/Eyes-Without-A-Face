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
