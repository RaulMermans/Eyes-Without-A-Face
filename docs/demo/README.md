# 90-second demo

Canonical walkthrough for the #BuildHybridAI 2026 submission video. The video may run to 3:00; the product walkthrough targets **90 seconds**.

**Rule:** show only what is verified on the recording machine at recording time. Every frame comes from a real run: real UI, real Gemini Nano, real Gemini cloud, real local execution. Never record the simulated test adapter, never patch the UI, and never show a debug token, DevTools with a token, `.env.local`, or a terminal.

**No video has been recorded or uploaded yet.** Do not reference a YouTube URL until one exists.

## Verified status

| Capability | Status | Evidence |
| --- | --- | --- |
| Real on-device Gemini Nano (`ONLY_ON_DEVICE`) | Verified, EVO X3 dedicated profile | LIVE-007, LIVE-013; Sprint 5 reliability study ([../sprints/sprint-5.md](../sprints/sprint-5.md)) |
| Real cloud Gemini (`ONLY_IN_CLOUD`, App Check enforced) | Verified on localhost with the debug provider | LIVE-004, LIVE-009 (Sprint 4 and Sprint 5 re-runs) |
| Real cloud Gemini from a hosted production build | **Not yet**: needs owner-approved deployment ([../deployment.md](../deployment.md)) | — |
| Phantom Twin, disclosure, alias resolution, Reality Check | Verified (deterministic) | `pnpm test:all` |

## Storyboard and narration (Script A — hybrid)

| Time | Screen and exact clicks | Narration (English) |
| --- | --- | --- |
| 00:00–00:12 | Landing. Point at the five-step strip. Click **Try the fictional CRM demo**. The structure profile and "3 reserved hidden cases" appear. | "A developer needs to integrate a private CRM. A cloud model could write the mapping, but these customer records can't leave the machine." |
| 00:12–00:30 | Click **Continue to Phantom Twin**. Point at aliases `f_01…f_06` and the fictional examples. Click **Suggest field roles on-device**. The roles appear, each labeled *(real on-device)*. | "So we build a Phantom Twin: meaningless aliases and fictional values. Gemini Nano runs on this device through Firebase AI Logic and classifies each field. Nothing has left the browser." |
| 00:30–00:45 | Tick **Disclose 3 category labels** on the status field (a deliberate, visible choice). Click **Continue to disclosure review** → **Build exact outbound prompt**. Scroll the prompt briefly, show the SHA-256 line, then click **Approve this exact prompt**. | "This is the exact request the app will send: aliases, fictional examples, a minimal target shape. No real values, no real field names. I approve this one request; any change invalidates it." |
| 00:45–01:05 | Click **Continue to Cloud Mapping** → **Send approved request to Gemini**. The badge *Real Gemini output · IN_CLOUD* appears, then **Valid · 5 operations · aliases resolved locally**. | "Gemini in the cloud proposes a declarative mapping from eight allowed operations. It can't run code. The SDK reports IN_CLOUD, and our validator accepts the proposal without repairing anything." |
| 01:05–01:22 | Click **Continue to Reality Check** → **Run Reality Check**. The verdict card shows **3 / 3 imported records transformed** and **0 / 3 reserved hidden cases covered**. Scroll to one transformed record, then to `UNMAPPED_ENUM · f_03`. | "Back on the device, aliases resolve to the real fields and the mapping runs on the private records: all three transform. But three hidden cases the model never saw break it: an unknown status, a malformed email, a missing one. We found that before production, without showing the model the data." |
| 01:22–01:30 | Scroll to the top; the header and tagline are visible. | "Eyes Without a Face. Build for systems your AI cannot see." |

### Exact click path (rehearse it)

1. `Try the fictional CRM demo`
2. `Continue to Phantom Twin`
3. `Suggest field roles on-device` (wait for 6 roles)
4. `Disclose 3 category labels` (status field, `f_03` at the default seed)
5. `Continue to disclosure review`
6. `Build exact outbound prompt`
7. `Approve this exact prompt`
8. `Continue to Cloud Mapping`
9. `Send approved request to Gemini`
10. `Continue to Reality Check`
11. `Run Reality Check`

## Preparation checklist

- [ ] `git rev-parse --short HEAD` noted. Recording uses a committed revision (the footer shows the build).
- [ ] **Preferred: record on the hosted production build** once it is approved and verified. No debug token exists in that build.
- [ ] If recording on localhost: the debug token is registered and injected **before** recording, off camera, then the page is reloaded with DevTools closed. Never record DevTools.
- [ ] Fresh Chrome on the dedicated Nano profile, started within the last few minutes. One full warm-up run done. Other Chrome windows closed.
- [ ] `pnpm test:live` (with `EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1`) passed today.
- [ ] Window 1280×800, zoom 110%, notifications off, bookmarks bar hidden, no personal tabs.
- [ ] English captions prepared from the narration above.

## Fallback plan

| Situation | Action on camera | Never do |
| --- | --- | --- |
| On-device run stops with `ON_DEVICE_RUNTIME_ERROR` | Click **Retry once on-device**. It resumes the remaining fields. If it fails again, stop, restart Chrome and re-record the segment | Switch to the simulated adapter; edit the frame |
| On-device unavailable on the day | Record **Script B** below. Say "on this machine the on-device model is unavailable; the app switches to deterministic mode and never sends the data to the cloud instead" | Claim on-device inference |
| Cloud fails (`APP_CHECK_REJECTED`, network) | Stop. The approval is consumed. Fix it off camera and re-record from Disclosure Review | Retry the same approval; show the error as "success" |
| Proposal rejected by the validator | That is a real result. Either show it ("the validator refuses invalid AI output") or re-record | Hand-edit the proposal and call it Gemini's |

## Script B — degraded but honest

For when cloud or on-device is unavailable. On-device unavailable: the twin step shows **On-device AI unavailable — manual/deterministic mode**; narrate it as such. Cloud unavailable: the mapping step shows **Cloud Gemini is not available in this build** and the approval stays unused. Open **No cloud? Use a hand-written contract**, run the Reality Check, and call it "a hand-written mapping", never "Gemini's mapping".

## Recording recommendations

- Capture the browser window only (OBS window capture), 1080p / 30 fps. Record narration separately and fit it to the timings.
- A 3:00 video could be: 0:00–0:15 title and problem, 0:15–1:45 the walkthrough above, 1:45–2:30 the technical proof (architecture diagram, `IN_CLOUD`/`ON_DEVICE` provenance, privacy test results), 2:30–3:00 limitations and close.
- Upload to YouTube (public or unlisted, as the rules require) with English captions.

## Screenshots

`docs/demo/screenshots/` holds only fictional data. Regenerate them from a real run after UI changes; they must never show tokens or DevTools.

- `on-device-role-suggestions.png`: real Gemini Nano role suggestions (LIVE-013).
- `reality-check-real-gemini.png`: Reality Check on a real `IN_CLOUD` proposal (LIVE-009).

## Technical proof appendix

- **On-device:** Firebase AI Logic `InferenceMode.ONLY_ON_DEVICE` → Chrome Prompt API (Gemini Nano). Output is constrained with a JSON Schema `responseConstraint` and validated with Ajv. Provenance is the SDK's `inferenceSource`.
- **Cloud:** Firebase AI Logic `ONLY_IN_CLOUD`, Gemini Developer API (`gemini-3.5-flash-lite`). App Check (reCAPTCHA Enterprise) enforced on `firebaseml.googleapis.com`. Receives only an allowlisted `CloudDisclosurePayload` 1.1.0. The exact prompt is approved by SHA-256, one request per approval.
- **No automatic fallback** between modes. On-device failures allow at most one user-initiated retry.
- **Deterministic execution:** an eight-operation mapping DSL interpreter. Model output is data, never code.
- **Reality Check:** five independent stage statuses and a verdict that separates imported-record success from hidden-case coverage.
- **Tests:** unit, contract, privacy (including adversarial and release-artifact checks), deterministic Playwright, and the opt-in live suite plus reliability study.
