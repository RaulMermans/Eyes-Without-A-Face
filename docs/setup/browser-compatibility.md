# Browser compatibility (on-device inference)

| Requirement | Value |
| --- | --- |
| SDK | `firebase` 13.2.0 (`firebase/ai`) |
| Browser | Chrome desktop ≥ 139 |
| Flag | `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled |
| API | `LanguageModel.availability()` |
| Init | `GenerativeModel.initializeDeviceModel()` after a user gesture |

Playwright’s bundled Chromium is **not** assumed to support Gemini Nano. Live checks use installed Chrome (`pnpm test:live`, `channel: "chrome"`).

If the Prompt API is missing or the model is `unavailable`, the product fails closed. It does not call Gemini in the cloud.
