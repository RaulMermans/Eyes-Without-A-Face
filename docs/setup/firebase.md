# Firebase setup (manual)

Do not create a Firebase project, enable billing, or deploy hosting unless the project owner authorizes it.

Verified against Firebase JS SDK **13.2.0** and https://firebase.google.com/docs/ai-logic/hybrid/web/get-started (2026-11-10).

## Minimal console steps

1. Create or select a Firebase project.
2. Register a Web app and copy the public config into `.env.local` (never commit it).
3. In **AI Services → AI Logic**, complete Get started.
4. Choose the **Gemini Developer API** to start (no billing required for the documented getting-started path).
5. Confirm App Check is **Enforced** for Firebase AI Logic.
6. Copy `.env.example` to `.env.local` and set:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_APP_CHECK_SITE_KEY=...
VITE_ENABLE_ON_DEVICE_INFERENCE=true
VITE_ENABLE_CLOUD_INFERENCE=true
```

7. Keep `VITE_APP_CHECK_DEBUG=true` only in local development. See [app-check.md](app-check.md).

## SDK usage in this repo

- Import Firebase only from `src/inference/firebase-live.ts`.
- On-device: `InferenceMode.ONLY_ON_DEVICE` then `initializeDeviceModel()` after a user gesture.
- Cloud: `InferenceMode.ONLY_IN_CLOUD`, default model `gemini-3.5-flash-lite`.
- Never `PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`.

## Local development without credentials

Leave `.env.local` unset. The app boots, adapters report unavailable, and no provider request is made.
