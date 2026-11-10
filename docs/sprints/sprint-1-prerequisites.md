# Sprint 1 prerequisites

Sprint 1 can start only after the user authorizes Firebase project work.

## Required configuration

1. Firebase project with Firebase AI Logic enabled (Gemini Developer API recommended to start).
2. Web app registered; public config copied into `.env.local` (not committed).
3. App Check enforced for AI Logic.
4. Local App Check debug token generated in the browser and safelisted in the console. Token stays private.
5. Feature flags `VITE_ENABLE_ON_DEVICE_INFERENCE` / `VITE_ENABLE_CLOUD_INFERENCE` enabled only after adapters are implemented.

## Hardware / browser

- Chrome desktop ≥ 139
- `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled
- On-device model downloaded (`LanguageModel.availability()` → `available`)
- `GenerativeModel.initializeDeviceModel()` called after a user gesture

## Implementation work

- Import Firebase only from `src/inference/firebase-live.ts`.
- On-device adapter: `InferenceMode.ONLY_ON_DEVICE`.
- Cloud adapter: `InferenceMode.ONLY_IN_CLOUD`, default model `gemini-3.5-flash-lite` unless docs change.
- Never `PREFER_ON_DEVICE` / `PREFER_IN_CLOUD`.
- Structured output for Source/Phantom/Mapping contracts; validate with Ajv before use.
- Prompt construction must send Phantom Twin data only for cloud calls.
- Add a live-inference test profile that is not part of default PR CI.

## Contract changes

None required to start, unless Firebase structured-output experiments need additional mapping ops. Add ops by extending the versioned schema rather than accepting free-form JS.
