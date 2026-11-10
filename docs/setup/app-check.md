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

1. Keep the production site key in `.env.local`.
2. Set `VITE_APP_CHECK_DEBUG=true` (development builds only).
3. The runtime sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` **before** `initializeAppCheck`.
4. Load the app, open DevTools, copy the App Check debug token printed by the SDK.
5. Firebase Console → App Check → Apps → overflow menu on `eyes-without-a-face-web` → **Manage debug tokens** → register it.
6. Reload and retry cloud inference. Do not bypass enforcement.

The token is a credential:

- Never put it in `VITE_*`.
- Never commit it.
- Never paste it into Playwright traces, screenshots, CI logs, or issue reports.
- Never ship debug mode in a production build.

If App Check rejects a live request, keep the sanitized error (`APP_CHECK_REJECTED`) and fix the token or site key. Do not disable App Check.
