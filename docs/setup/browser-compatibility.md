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

## Sprint 4 finding: the blocker was the test launcher, not the hardware

Sprints 2–3 recorded `LanguageModel.availability() = unavailable` on Chrome 157 / Linux x86_64 (EVO X3, AMD Strix Halo). That happened only under Playwright's default Chromium arguments: `--disable-component-update`, `--disable-field-trial-config`, `--disable-background-networking`, and `--disable-features=…OptimizationHints…`. These stop the Optimization Guide from registering the Gemini Nano component.

Verified on 2026-11-11:

| Launch | `availability()` |
| --- | --- |
| Playwright defaults, fresh profile | `unavailable` |
| Dedicated persistent profile, no Playwright defaults, `--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput` | `downloadable` → model download (~4.0 GB, about 5 minutes) → `available` |

Chrome reported `performance_class 6` and 64 GB of shared VRAM for this device. After the download, Firebase AI Logic `ONLY_ON_DEVICE` returned `inferenceSource = ON_DEVICE` (LIVE-007, LIVE-013).

In a normal desktop Chrome profile, follow the Firebase steps instead. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome, and let `initializeDeviceModel()` download the model after a click.

The product never calls cloud Gemini when on-device is unavailable and never substitutes Ollama.

Minimum compatible test environment for on-device qualification: Chrome desktop ≥ 139 with `LanguageModel.availability()` returning `available` or `downloadable`, then a successful `ONLY_ON_DEVICE` generate with `inferenceSource = on_device`.
