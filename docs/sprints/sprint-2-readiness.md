# Sprint 2 readiness

Do not start Sprint 2 automatically.

## What Sprint 1.1 must prove first

- Disclosure projection, exact outbound prompt approval, destination binding, and single-use authorization.
- Adapters wired to Firebase `ONLY_ON_DEVICE` / `ONLY_IN_CLOUD` with reported `inferenceSource`.
- On-device unavailability fails closed (no cloud fallback).
- Live cloud proof against project `eyes-without-a-face-b7281` once App Check accepts the request.

## Remaining before mapping execution

1. Owner pastes the registered reCAPTCHA Enterprise **site key** into `.env.local` (placeholder is not usable).
2. Owner safelists the App Check **debug token** printed in the local browser console.
3. A real `ONLY_IN_CLOUD` call succeeds with `inferenceSource = in_cloud`.
4. Obtain hardware/Chrome where `LanguageModel.availability()` is `available` and verify `inferenceSource === on_device`. Until then report `ON_DEVICE_BLOCKED`, not `HYBRID_QUALIFIED`.
5. Keep mapping execution local and provider-independent (`src/domain/mapping/operations.ts` still throws).

## Contract changes for Sprint 2

None required to start mapping interpretation. Extend mapping ops via the versioned schema if needed. Do not accept free-form JavaScript.

## Can mapping start?

Only after cloud qualification is evidenced and the disclosure gate remains the only cloud path. On-device blockage does not block a local deterministic mapping engine, but it does block claiming Hybrid AI.

Official hackathon rules were still unpublished as of 2026-11-10. Re-check https://firebasehybridaihackathon.devpost.com/rules on or after 11 November 2026 before submission work.
