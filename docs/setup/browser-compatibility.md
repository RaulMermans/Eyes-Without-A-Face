# Browser compatibility (on-device inference)

| Requirement | Value |
| --- | --- |
| SDK | `firebase` 13.2.0 (`firebase/ai`) |
| Browser | Chrome **desktop** ≥ 139 |
| Flag | `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled |
| API | `LanguageModel.availability()` |
| Init | `GenerativeModel.initializeDeviceModel()` after a **user gesture** |
| Disk | Enough free space for Gemini Nano download (multi-GB) |

Playwright’s bundled Chromium is **not** assumed to support Gemini Nano. Live checks use installed Chrome (`pnpm test:live`, `channel: "chrome"`).

Linux Chrome may report Prompt API `available` while the model stays `unavailable`. Sprint 2 rechecked this on Chrome 157.0.0.0 / Linux x86_64: Prompt API `available`, `LanguageModel.availability()` = `unavailable`, `MODEL_UNAVAILABLE`, no cloud fallback. That is a hardware/runtime blocker, not an application fallback. The product must not call cloud Gemini and must not substitute Ollama.

Minimum compatible test environment for on-device qualification: Chrome desktop ≥ 139 with `LanguageModel.availability()` returning `available` or `downloadable`, then a successful `ONLY_ON_DEVICE` generate with `inferenceSource = on_device`.
