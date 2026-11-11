# Sprint 3 readiness (historical)

Superseded by [sprint-3.md](sprint-3.md) and [sprint-4-readiness.md](sprint-4-readiness.md). Note: Sprint 3 did require one contract change, cloud-disclosure 1.1.0 for the destination description ([ADR 0007](../decisions/0007-target-disclosure-and-proposal-boundary.md)).

Do not start Sprint 3 automatically.

## What Sprint 2 must prove first

- Local `executeMapping` / `executeMappingBatch` against a destination JSON Schema.
- Browser import → map → execute without network.
- Cloud Gemini qualification with `inferenceSource = IN_CLOUD`, or an honest `CLOUD_BLOCKED` with the remaining owner action (safelist App Check debug token).
- On-device remains `ON_DEVICE_BLOCKED` until Chrome reports a downloadable Prompt API model.

## Remaining before Phantom Twin generation

1. If live cloud is still blocked: owner safelists the localhost App Check debug token printed by the Firebase SDK (never commit it).
2. Connect approved `ONLY_IN_CLOUD` mapping proposals to the Mapping Contract schema, then run them through the existing local engine — do not execute model JavaScript.
3. On-device structure interpretation can stay diagnostic until hardware/Chrome supports `LanguageModel`.
4. Export packaging is still unimplemented.
5. Official hackathon rules were still unpublished as of 2026-11-10. Re-check https://firebasehybridaihackathon.devpost.com/rules on or after 11 November 2026. Pre-event code in this repository is not automatically submission-eligible.

## Contract changes for Sprint 3

None required to pipe a valid mapping proposal into `executeMapping`. If Gemini returns ops outside the eight-op allowlist, reject the proposal. Do not widen the DSL to expressions.
