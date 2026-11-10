# Sprint 1.1 implementation report

Continues from `sprint-1` at `87ede9c`. Work is on branch `sprint-1.1`. No second Firebase project was created, billing was not enabled, and nothing was pushed, merged, or deployed.

## Qualification

**Result: not HYBRID_QUALIFIED.** Current evidence is `CLOUD_BLOCKED / ON_DEVICE_BLOCKED`.

| Path | Result | Evidence |
| --- | --- | --- |
| Firebase web config | PASS | Live UI shows `eyes-without-a-face-b7281` / `1:507051460368:web:086c755a2c003fb30b4795` |
| App Check live request | BLOCKED | Site key still the placeholder `<EXISTING_REGISTERED_SITE_KEY>`; debug token not safelisted |
| Cloud Gemini `ONLY_IN_CLOUD` | BLOCKED | `APP_CHECK_REJECTED` when `EYES_LIVE_CLOUD=1` |
| On-device Gemini Nano | BLOCKED | Headed Chrome 157 on Linux x86_64, Prompt API available, `LanguageModel.availability()` = `unavailable`, `MODEL_UNAVAILABLE`, no cloud fallback |
| Provenance / disclosure hardening | PASS | Unit, privacy, and deterministic Playwright |

After the owner pastes the registered reCAPTCHA Enterprise site key and safelists the local debug token, re-run `EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live`. If that cloud call succeeds with `source=IN_CLOUD` while on-device remains unavailable, report `CLOUD_QUALIFIED / ON_DEVICE_BLOCKED`.

## Delivered

- Connected the owner-registered project `eyes-without-a-face-b7281` / web app `eyes-without-a-face-web`.
- App Check debug-provider workflow (development only) and reCAPTCHA Enterprise in production builds.
- Provenance taken only from `response.inferenceSource`; missing/unknown/mismatched sources fail closed.
- Disclosure approval bound to payload bytes, outbound prompt fingerprint, destination, purpose, and request id; single-use ledger; no automatic cloud retries.
- Deterministic Playwright suite expanded; live suite remapped to LIVE-001–LIVE-008 against installed Chrome.

## Unauthorized external actions

None.
