# Playwright live testing

Two suites stay separate.

## Deterministic CI (`pnpm test:e2e`)

Uses bundled Chromium and a Vite server whose Firebase env is forced empty. No Firebase credentials, no App Check debug tokens, no live Gemini.

Covers configuration failure, App Check unconfigured, missing/stale approval, payload edits, duplicate submission after success, unknown provenance, timeouts, malformed output, and branding/smoke.

## Real-browser live (`pnpm test:live`)

Opt-in: `EYES_LIVE_TESTS=1`. Uses installed Chrome (`channel: "chrome"`) on port 5174 and **does** load `.env.local`.

| ID | Check | Extra flag |
| --- | --- | --- |
| LIVE-001 | Chrome / Prompt API / model readiness | |
| LIVE-002 | Firebase project and web app id | |
| LIVE-003 | App Check status | |
| LIVE-004 | Approved synthetic `ONLY_IN_CLOUD` | `EYES_LIVE_CLOUD=1` |
| LIVE-005 | Unapproved path sends no `generateContent` | |
| LIVE-006 | Outbound prompt fingerprint | |
| LIVE-007 | `ONLY_ON_DEVICE` or recorded blocker | `EYES_LIVE_ON_DEVICE=1` for a passing generate |
| LIVE-008 | Console errors and responsive layout | |

Evidence lands in `test-results/sprint-2-live/` (gitignored). Do not store debug tokens or private records.

Playwright request interception cannot see every SDK request. Combine network watchers with the application disclosure gate.

This suite is **not** part of GitHub Actions or `pnpm test:all`.

## Sprint 3 additions

- The diagnostic workspace is collapsed by default. Live specs open it before reading its fields.
- `LIVE-009` runs the guided Phantom Twin journey against real Gemini: profile, twin, label opt-in, exact-prompt approval, `IN_CLOUD` proposal, conversion, alias resolution, and Reality Check. It records origin, provenance, proposal status, and Reality Check counts in `test-results/sprint-2-live/evidence.json`.
- `EYES_APPCHECK_DEBUG_TOKEN` (shell only) injects a pre-registered App Check debug token. See [../setup/app-check.md](../setup/app-check.md).
