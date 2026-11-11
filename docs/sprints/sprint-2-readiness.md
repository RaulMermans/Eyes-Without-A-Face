# Sprint 2 readiness

Do not start Sprint 2 automatically.

## What Sprint 1 proved

- Disclosure projection and request-scoped approval are implemented and tested.
- Adapters are wired to the real Firebase SDK APIs.
- On-device unavailability fails closed (Prompt API present, model `unavailable`, no cloud fallback).
- Official branding is integrated.

## What remains before mapping execution

1. Provision a Firebase project with AI Logic + App Check (owner authorization required).
2. Verify a real `ONLY_IN_CLOUD` call against a synthetic `CloudDisclosurePayload`.
3. Obtain hardware/Chrome where `LanguageModel.availability()` is `available` and verify `inferenceSource === on_device`.
4. Keep mapping execution local and provider-independent (`src/domain/mapping/operations.ts` still throws).

## Contract changes for Sprint 2

None required to start mapping interpretation. Extend mapping ops via the versioned schema if needed. Do not accept free-form JavaScript.

## Problems to resolve first

- Live cloud proof is blocked on missing project configuration.
- Live on-device proof is blocked on model `unavailable` for the current machine.
- Official hackathon rules page was still unpublished as of Sprint 0 notes; re-check before submission work.
