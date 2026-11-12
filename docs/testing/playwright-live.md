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

Evidence lands in `test-results/sprint-4-live/` (gitignored; earlier sprints used `sprint-2-live/`). Do not store debug tokens or private records.

Playwright request interception cannot see every SDK request. Combine network watchers with the application disclosure gate.

This suite is **not** part of GitHub Actions or `pnpm test:all`.

## Sprint 3 additions

- The diagnostic workspace is collapsed by default. Live specs open it before reading its fields.
- `LIVE-009` runs the guided Phantom Twin journey against real Gemini: profile, twin, label opt-in, exact-prompt approval, `IN_CLOUD` proposal, conversion, alias resolution, and Reality Check. It records origin, provenance, proposal status, and Reality Check counts in `test-results/sprint-2-live/evidence.json`.
- `EYES_APPCHECK_DEBUG_TOKEN` (shell only) injects a pre-registered App Check debug token. See [../setup/app-check.md](../setup/app-check.md).

## Sprint 4 additions

- **Dedicated Chrome profile (`EYES_CHROME_PROFILE`, shell only).** Playwright's default Chromium arguments (`--disable-component-update`, `--disable-features=…OptimizationHints…`, `--disable-field-trial-config`) stop Chrome from registering the Gemini Nano component. On this hardware they made `LanguageModel.availability()` return `unavailable`. With `EYES_CHROME_PROFILE=<dir>` set, `tests/live/fixtures.ts` launches installed Chrome with a persistent, test-only user-data directory and no Playwright defaults, so the ~4 GB model is downloaded once and reused. Never point it at a personal profile.
- `LIVE-007` records duration, the real result, and asserts no `generateContent` request.
- `LIVE-013` runs real `ONLY_ON_DEVICE` role suggestions in the guided Phantom Twin step.
- `LIVE-009` also covers LIVE-014 to LIVE-017. It scans every real `generateContent` request body for private CRM terms, keeping only counts and matched term names, never bodies. It asserts no page errors, and that a valid proposal leaves at least one reserved hidden case failing.
- Traces are disabled whenever `EYES_APPCHECK_DEBUG_TOKEN` is set. Sprint 4 found that Playwright traces record `addInitScript` arguments, which captured the injected token.
- `workers: 1`, because a persistent profile can be held by only one browser.

```bash
# on-device (after a one-time model download in the dedicated profile)
EYES_LIVE_TESTS=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" pnpm test:live

# cloud (after the debug token is registered in the Firebase Console)
EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live

# both
EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" pnpm test:live
```

| ID | Sprint 4 check | Covered by |
| --- | --- | --- |
| LIVE-010 | Firebase control plane | CLI / MCP (manual, see [../setup/firebase-cli-mcp.md](../setup/firebase-cli-mcp.md)) |
| LIVE-011 | App Check token accepted | LIVE-004 / LIVE-009 |
| LIVE-012 | Real `IN_CLOUD` response | LIVE-004 |
| LIVE-013 | Real `ON_DEVICE` response | LIVE-007, LIVE-013 |
| LIVE-014 | Gemini proposal drives alias resolution and execution | LIVE-009 |
| LIVE-015 | Request bodies hold only the approved fictional representation | LIVE-009 body scan |
| LIVE-016 | Reserved hidden case fails for real | LIVE-009 |
| LIVE-017 | Guided walkthrough with no page errors | LIVE-009, LIVE-013 |

## Sprint 5 additions

### On-device reliability study (opt-in, never in CI)

```bash
EYES_LIVE_TESTS=1 EYES_LIVE_RELIABILITY=1 EYES_RELIABILITY_ATTEMPTS=10 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_RELIABILITY_CHROME_LOG_DIR="$HOME/.cache/eyes-without-a-face/chrome-logs" \
pnpm test:live tests/live/nano-reliability.spec.ts
```

Each attempt launches a **fresh Chrome process** on the dedicated profile and runs the guided Phantom Twin on-device step (6 real Nano calls), which is the *cold* run. It then reloads the page in the same process and runs again, the *warm* run. Per run it records the outcome, latency, error text, whether the one user-initiated retry recovered, and the count of cloud `generateContent` requests, which must be 0. Results go to `test-results/sprint-5-reliability/runs.json` (gitignored). The optional Chrome log directory must be outside the repository.

Do not edit `src/` while it runs. The dev server hot-reloads, which disturbs the page under test.

### Deterministic coverage of the new states (`pnpm test:e2e`)

`tests/e2e/release.spec.ts` adds E2E-040 to E2E-043:

- first-use landing and demo entry point;
- on-device recovery: retry resumes the remaining fields, a second failure blocks, no cloud request;
- cloud unavailable: the approval stays unused and the walkthrough finishes on the labeled manual path;
- the Reality Check verdict never reads as success when hidden cases fail.

Test-only harness switches `onDeviceAvailable` and `onDeviceRuntimeFailures` simulate availability and Chrome model-service failures. Their results are labeled *simulated test adapter*.
