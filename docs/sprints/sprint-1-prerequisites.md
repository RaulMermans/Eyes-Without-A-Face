# Sprint 1 prerequisites

Sprint 1 implementation is in [sprint-1.md](sprint-1.md). Live cloud and on-device proof remain blocked until the owner provisions Firebase and the machine has a downloadable on-device model.

## Required configuration (still owner-authorized)

1. Firebase project with Firebase AI Logic enabled (Gemini Developer API recommended to start).
2. Web app registered; public config copied into `.env.local` (not committed).
3. App Check enforced for AI Logic.
4. Local App Check debug token generated in the browser and safelisted in the console. Token stays private.
5. Feature flags `VITE_ENABLE_ON_DEVICE_INFERENCE` / `VITE_ENABLE_CLOUD_INFERENCE` enabled only with that configuration.

See [../setup/firebase.md](../setup/firebase.md) and [../setup/app-check.md](../setup/app-check.md).
