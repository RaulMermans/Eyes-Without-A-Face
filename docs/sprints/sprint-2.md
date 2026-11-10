# Sprint 2 implementation report

Continues from `sprint-1.1` at `45971db`. Work is on branch `sprint-2`. No second Firebase project was created, billing was not enabled, App Check enforcement was not disabled, and the branch is not merged.

## Qualification

**Result: `CLOUD_BLOCKED / ON_DEVICE_BLOCKED`.** Details: [sprint-2-live-qualification.md](sprint-2-live-qualification.md).

Sprint 1.1 was blocked by a placeholder site key in `.env.local` (Vite prefers `.env.local` over `.env`). That precedence bug is fixed. App Check now initializes the local debug provider with the registered public site key. Live `ONLY_IN_CLOUD` still returns HTTP 403 until the owner safelists the debug token. On-device remains `LanguageModel.availability() = unavailable` on Chrome 157 Linux.

## Delivered

- Deterministic mapping engine: copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat.
- Batch execution with bounds and per-record status.
- Fictional CRM fixtures, expected outputs, and reserved edge cases (unmapped enum, incompatible type, explicit null).
- Browser workflow: import → inspect destination schema → edit mapping → execute → validate.
- Playwright E2E-016–E2E-024.
- Hybrid AI diagnostic workspace retained as an advanced view.

## Boundary

Gemini may later propose a Mapping Contract. `executeMapping` does not call a model provider and does not execute model-generated JavaScript.

## Unauthorized external actions

None.
