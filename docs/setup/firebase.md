# Firebase setup (manual)

Do not create a second Firebase project, enable billing, or deploy hosting unless the project owner authorizes it.

This product uses the already registered project:

| Field | Value |
| --- | --- |
| Display name | Eyes Without A Face |
| Project ID | `eyes-without-a-face-b7281` |
| Web app | `eyes-without-a-face-web` |
| Plan | Spark (no-cost) |
| AI Logic | Gemini Developer API |
| Default cloud model | `gemini-3.5-flash-lite` |
| SDK | Firebase JS **13.2.0** |

Verified against https://firebase.google.com/docs/ai-logic/hybrid/web/get-started (2026-11-10).

## `.env.local`

Copy `.env.example` to `.env.local` (gitignored). Public web identifiers for this app:

```bash
VITE_FIREBASE_API_KEY=AIzaSyByyuA7tot2kRBMkaVDOVqhZPofYT_srug
VITE_FIREBASE_AUTH_DOMAIN=eyes-without-a-face-b7281.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=eyes-without-a-face-b7281
VITE_FIREBASE_STORAGE_BUCKET=eyes-without-a-face-b7281.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=507051460368
VITE_FIREBASE_APP_ID=1:507051460368:web:086c755a2c003fb30b4795
VITE_FIREBASE_MEASUREMENT_ID=G-ZXK5NMQ81M
VITE_ENABLE_ON_DEVICE_INFERENCE=true
VITE_ENABLE_CLOUD_INFERENCE=true
VITE_FIREBASE_APP_CHECK_SITE_KEY=<EXISTING_REGISTERED_SITE_KEY>
VITE_APP_CHECK_DEBUG=true
```

`VITE_*` values are public client identifiers, not service-account secrets. Replace the App Check placeholder with the **site key** already linked to App Check (Fraud Defense / reCAPTCHA Enterprise). Do not invent a key and do not use the secret key.

Live initialization compares `projectId`, `authDomain`, and `appId` to `src/config/expected-firebase.ts`. A different Firebase app is rejected.

## SDK usage in this repo

- Import Firebase only from `src/inference/firebase-live.ts`.
- On-device: `InferenceMode.ONLY_ON_DEVICE` then `initializeDeviceModel()` after a user gesture.
- Cloud: `InferenceMode.ONLY_IN_CLOUD`, model `gemini-3.5-flash-lite`.
- Never `PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`.
- `response.inferenceSource` is required. Missing provenance is `PROVENANCE_UNVERIFIED`.

## Local development without credentials

Leave `.env.local` unset. The app boots, adapters report unavailable, and no provider request is made.

Deterministic Playwright (`pnpm test:e2e`) forces empty Firebase env even if `.env.local` exists.
