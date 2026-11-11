# Sprint 1 implementation report

Sprint 1 continues from commit `ab8169c` on `sprint-0` (clean working tree, remote `origin` present). Work landed on branch `sprint-1`. No Firebase project was created, no billing was enabled, and nothing was pushed or deployed.

## Delivered

- Live Firebase adapter module (`src/inference/firebase-live.ts`) using `InferenceMode.ONLY_ON_DEVICE` and `ONLY_IN_CLOUD`.
- App Check initialization with reCAPTCHA Enterprise when a site key is present; debug mode only in non-production builds.
- `CloudDisclosurePayload` schema, allowlist projection, SHA-256 fingerprint, request-scoped approval, centralized `submitApprovedCloudInference` gate.
- Hybrid AI diagnostic workspace with honest unavailable states.
- Official owner-supplied emblem in header, landing, favicon, apple-touch-icon, and og-image.
- Deterministic unit, contract, privacy, and Playwright suites.
- Opt-in `pnpm test:live` against installed Chrome.

## Live Hybrid AI

| Path | Result |
| --- | --- |
| Chrome Prompt API | Present (Chrome 158.0.8127.18) |
| On-device model | `unavailable` on this hardware — **BLOCKED** |
| Cloud Gemini | No Firebase project / `.env.local` — **BLOCKED** |

A green deterministic CI suite does **not** mean real Hybrid AI is working.

## Unauthorized external actions

None.
