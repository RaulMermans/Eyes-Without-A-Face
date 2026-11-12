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

## Sprint 5: on-device startup and runtime reliability

**Experimental configuration.** The EVO X3 qualifies only with `OptimizationGuideOnDeviceModel:BypassPerfRequirement/true` plus the Prompt API features, in a dedicated profile. These are experimental Chrome capability flags, not a supported production configuration. Visitors on stock Chrome may get `unavailable`. The app then runs in manual/deterministic mode and never shows a hybrid badge.

### What fails, and why

The Sprint 4 `SDK_INIT_FAILED: kErrorUnknown` was investigated with Chrome's own logs (`--enable-logging --vmodule=*on_device_model*=1,…`) and the OS crash reporter:

- The failure is **not** model initialization. `initializeDeviceModel()` only triggers a download when the model is `downloadable`. Every `generateContent()` call creates a new `LanguageModel` session (Firebase AI 3.0.0 `ChromeAdapterImpl.createSession`) and destroys the previous one.
- After several successful prompts, Chrome logs `Unexpected on_device_model service disconnect`. Apport records a **SIGILL** in `chrome --type=utility --utility-sub-type=on_device_model.mojom.OnDeviceModelService`, which runs the `nano_v3_gpu_high_tier_model` recipe on the AMD Strix Halo GPU (`/dev/dri/renderD128`). SIGILL in Chrome is a deliberate crash on a failed internal check. This is a native failure in Chrome's model service on this Linux/AMD path; application code cannot prevent it.
- Chrome restarts the service when the next session is created. A later prompt in the same browser process can succeed, but the same process failed again within a few prompts. A fresh browser process recovered.

- **A second failure mode: hung prompts.** In one cold run, a prompt produced no answer and no error for about 2.5 minutes. The app's 90 s on-device timeout did not fire, because Firebase AI 3.0.0's Chrome adapter does not pass the request `AbortSignal` to `LanguageModel.prompt()`. The UI would have waited indefinitely. The same browser process answered normally after a page reload.

### What the app does

- Chrome `kError*` failures are classified as `ON_DEVICE_RUNTIME_ERROR` with an honest explanation, instead of the catch-all `SDK_INIT_FAILED`.
- The adapter drops its cached model after such a failure, so the next attempt starts a fresh session.
- Both on-device and cloud calls are raced against their abort signal (`src/inference/abort.ts`), so the 90 s on-device and 45 s cloud timeouts are effective. An on-device `TIMEOUT` is recoverable by the same single retry. A cloud `TIMEOUT` is never retried, because the approval is consumed.
- The Phantom Twin step offers **one user-initiated retry**. The retry resumes with the fields that are not yet classified, so successful calls are never repeated. A second failure blocks on-device mode for that page and asks the user to restart Chrome. There is no automatic retry and no cloud fallback.
- The suggest button is disabled while a run is in flight (no duplicate `IN_FLIGHT` failures), and progress shows the real per-field count.

Measurements are in [../sprints/sprint-5.md](../sprints/sprint-5.md). Reproduce them with `tests/live/nano-reliability.spec.ts`; see [../testing/playwright-live.md](../testing/playwright-live.md).

### Demo-day mitigations

- Start a fresh Chrome on the dedicated profile shortly before recording, and do one warm-up run.
- Close other Chrome windows that might use built-in AI, so the GPU model service isn't shared.
- If a crash happens on camera, click the retry once. If it fails again, restart Chrome. Never switch to the simulated adapter on camera.
