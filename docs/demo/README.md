# 90-second demo

Product walkthrough for the #BuildHybridAI 2026 submission video. The submission video may run to 3 minutes; the walkthrough targets 90 seconds.

**Rule:** show only what is verified on the recording machine at recording time. Each segment below lists the live check that must pass before it can be shown as real. Never record test-adapter output as Gemini.

## Verified status (2026-11-11)

| Capability | Status | Evidence |
| --- | --- | --- |
| Real on-device Gemini Nano through Firebase AI Logic (`ONLY_ON_DEVICE`) | **Verified** | LIVE-007, LIVE-013: `source=ON_DEVICE`, `simulated=false`, schema-valid, no `generateContent` request |
| Real cloud Gemini through Firebase AI Logic (`ONLY_IN_CLOUD`) | **Verified** | LIVE-004: `source=IN_CLOUD`, schema-valid. LIVE-009: valid proposal identical to the canonical mapping, aliases resolved locally, 3 imported records pass, 3 reserved hidden cases fail, no private terms in the request body |
| Local Phantom Twin, disclosure, alias resolution, Reality Check | Verified (deterministic) | `pnpm test:all` |

Both passed on 2026-11-11, so use **Script A**. Re-run `pnpm test:live` on the recording day; if cloud access breaks, fall back to **Script B**.

## Setup before recording

1. Use the dedicated Chrome profile where Gemini Nano is downloaded. On the EVO X3 that is `~/.cache/eyes-without-a-face/chrome-nano-profile`. Launch it the same way as `tests/live/fixtures.ts`:

   ```bash
   google-chrome --user-data-dir="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
     --enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput \
     http://127.0.0.1:5173/
   ```

2. `pnpm dev --host 127.0.0.1 --port 5173` with `.env.local` loaded (cloud and on-device flags `true`).
3. For Script A: the debug token must be registered, and the recording browser must use it. In DevTools, before the app loads, run `self.FIREBASE_APPCHECK_DEBUG_TOKEN = "<token>"` and reload. **Do not record DevTools while the token is visible.** A simpler option: register the token the SDK prints for this profile once, then record without DevTools open.
4. Close unrelated tabs and notifications. Use window size 1280×800 and zoom 110%.
5. Do a dry run once. The first on-device call warms the model.

## Script A — hybrid (only after cloud is verified)

| Time | Screen | Narration |
| --- | --- | --- |
| 00:00–00:12 | Source System step. Click **Load fictional CRM sample**. The records appear. | "Enterprise teams need integrations against systems they can't share. This CRM export is private, so it can't go to a cloud model." |
| 00:12–00:30 | Phantom Twin step. Point at the `f_01…f_06` aliases and synthetic examples. Click **Suggest field roles on-device**. Roles appear labeled *real on-device*. | "Everything here runs locally. A deterministic generator replaces every field with a meaningless alias and fictional examples. Gemini Nano, running in Chrome through Firebase AI Logic, classifies each field on the device. Nothing leaves the machine." |
| 00:30–00:45 | Disclosure Review. Click **Build exact outbound prompt**. Scroll the exact prompt and hash. Click **Approve this exact prompt**. | "Only this exact payload can go to the cloud: aliases, fictional examples and the destination shape. No real field names, no real values. I approve it, and the approval is bound to this SHA-256 hash and can be used once." |
| 00:45–01:05 | Cloud Mapping. Click **Send approved request to Gemini**. The proposal appears with the origin badge *Real Gemini output · IN_CLOUD*. | "Gemini in the cloud proposes a mapping using eight declarative operations. It never sees the data and can't execute code. The proposal is validated and converted to a mapping contract. Anything outside the allowlist is rejected, never repaired." |
| 01:05–01:22 | Reality Check. Click **Run Reality Check**. The verdict and stage statuses appear, the imported records pass, and a reserved hidden case fails with `UNMAPPED_ENUM` on an alias. | "Back on the device, aliases resolve to the real fields and the mapping runs deterministically on the private records. Hidden test cases were never profiled or disclosed, and one exposes a status value the mapping doesn't cover. The summary names the alias, not the value." |
| 01:22–01:30 | Pull back to the step bar. | "Eyes Without a Face: build integrations against private systems without exposing their original records to cloud AI." |

## Script B — factual alternate (current state)

Same flow, but stop after Disclosure Review for the cloud segment:

- 00:45–01:05: show the approved payload and hash, then say: *"In the full flow this exact payload goes to Gemini through Firebase AI Logic. In this recording, cloud access is waiting on App Check registration. The local pipeline is unchanged either way."*
- Run the Reality Check with **Manual local contract** selected. The active-mapping label says it is manual, so say "a manual mapping", never "Gemini's mapping".
- Do not click **Send approved request to Gemini** and do not use the simulated test adapter on camera.

## Recording instructions

- Record the browser window only (for example OBS window capture), at 1080p and 30 fps. Do not record the terminal or DevTools.
- Record narration separately and trim it to the timings above. Keep within 3:00 total including any intro.
- Upload to YouTube as public or unlisted, according to the Official Rules. Captions must be in English.
- Do not use fabricated or edited UI states. Every frame must come from a real run.

## Technical proof summary (for the submission text)

- **On-device:** Firebase AI Logic `InferenceMode.ONLY_ON_DEVICE` with Chrome's Prompt API (Gemini Nano). Output is constrained by a JSON Schema `responseConstraint` and validated with Ajv. Provenance comes from the SDK's `inferenceSource`, never from the requested mode.
- **Cloud:** Firebase AI Logic `ONLY_IN_CLOUD` with the Gemini Developer API and App Check (reCAPTCHA Enterprise). It receives only an allowlisted `CloudDisclosurePayload` 1.1.0. The exact prompt is approved by SHA-256, and each approval works once.
- **No automatic fallback** between modes: private data never falls back to the cloud.
- **Deterministic execution:** an eight-operation mapping DSL interpreter. The model output is data, never code.
- **Reality Check:** five independent stage statuses (contract, target schema, execution, output schema, hidden cases), with safe alias-level summaries.
- Tests: unit, contract, privacy and adversarial suites, deterministic Playwright, and an opt-in live suite (`docs/testing/playwright-live.md`).

## Screenshots

- `screenshots/on-device-role-suggestions.png` (LIVE-013): real Gemini Nano role suggestions on the fictional CRM twin.
- `screenshots/reality-check-real-gemini.png` (LIVE-009): Reality Check running the real Gemini `IN_CLOUD` proposal. Imported records pass, and hidden cases fail by alias.

Both contain only fictional data.
