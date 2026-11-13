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

Copy `.env.example` to `.env.local` (gitignored). Read this app's public web configuration from the Firebase Console (Project settings → Your apps → `eyes-without-a-face-web` → SDK setup and configuration) or with `npx -y firebase-tools@15.35.0 apps:sdkconfig web 1:507051460368:web:086c755a2c003fb30b4795 --project eyes-without-a-face-b7281`:

```bash
VITE_FIREBASE_API_KEY=<from the Firebase Console or apps:sdkconfig>
VITE_FIREBASE_AUTH_DOMAIN=eyes-without-a-face-b7281.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=eyes-without-a-face-b7281
VITE_FIREBASE_STORAGE_BUCKET=eyes-without-a-face-b7281.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=507051460368
VITE_FIREBASE_APP_ID=1:507051460368:web:086c755a2c003fb30b4795
VITE_FIREBASE_MEASUREMENT_ID=G-ZXK5NMQ81M
VITE_ENABLE_ON_DEVICE_INFERENCE=true
VITE_ENABLE_CLOUD_INFERENCE=true
VITE_FIREBASE_APP_CHECK_SITE_KEY=<reCAPTCHA Enterprise site key from App Check → Apps>
VITE_APP_CHECK_DEBUG=true
```

Vite loads `.env.local` with higher priority than `.env`. Put the live values only in `.env.local`. A placeholder in `.env.local` will hide a real key in `.env`.

`VITE_*` values are public client identifiers, not service-account secrets. Sprint 12: the literal web API key and site key were removed from this page because the #BuildHybridAI Official Rules ask entrants not to include production API keys in the repository. The key remains in Git history (since `45971db`) and, by design, in every deployed web bundle; it is protected by App Check enforcement (verified 2026-11-13: a request without an App Check token is refused with 401). Whether to restrict the key in Cloud Console or rotate it is an owner decision. The App Check value is the registered reCAPTCHA Enterprise **site key** (Fraud Defense), not the secret key.

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
