# App Check setup

Firebase AI Logic setup enforces App Check. This product does not bypass that enforcement to make a demo look successful.

## Production

1. Create a reCAPTCHA Enterprise site key for the deployed origin.
2. Register it as the App Check provider for the web app.
3. Set `VITE_FIREBASE_APP_CHECK_SITE_KEY` in the hosting environment.
4. Leave `VITE_APP_CHECK_DEBUG=false`.

Production builds ignore the debug flag. If it is set, the UI reports that debug mode is blocked.

## Localhost debug workflow

Official SDK workflow (do not add `localhost` to reCAPTCHA allowed domains):

1. Set `VITE_APP_CHECK_DEBUG=true` in `.env.local` (development only).
2. Keep the reCAPTCHA site key configured.
3. Load the app, open DevTools, and copy the **App Check debug token** printed by the SDK.
4. In Firebase Console → App Check → Apps → Manage debug tokens, safelist that token.

The token is a credential:

- Never put it in `VITE_*`.
- Never commit it.
- Never paste it into Playwright traces, screenshots, or issue reports.
- Never ship it in a production build.

`src/inference/firebase-live.ts` sets `window.FIREBASE_APPCHECK_DEBUG_TOKEN = true` only when the debug flag is on and the build is not production. It does not store or log the generated token.
