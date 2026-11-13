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

## Sprint 7 blind revision benchmark

`tests/live/blind-revision.spec.ts` is opt-in, uses quota, and runs each fictional scenario twice:

- **B:** a real Gemini proposal; the revision is declined; then the holdout.
- **C/D:** real Gemini Nano private interpretation with the validated suggestions applied, a real Gemini proposal, one approved real Gemini revision, then the holdout.

It scans every real `generateContent` body for private strings. It records alias-level proposal text, counts and timings to `test-results/sprint-7-live/blind-revision-evidence.json`. Nano rationales and request bodies are never stored.

```bash
EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
EYES_LIVE_TESTS=1 EYES_LIVE_BLIND_REVISION=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
pnpm test:live tests/live/blind-revision.spec.ts
```

About 9 cloud requests per full run. Nothing is retried automatically. Playwright empties `test-results/` on every run, so copy the evidence file before running anything else. Archived runs: [../evidence/sprint-7/](../evidence/sprint-7/).

## Sprint 8 semantic benchmark

`tests/live/semantic-benchmark.spec.ts` is opt-in and uses quota. Per trial and scenario it runs:

- **B:** a real Gemini proposal, semantic verification, the revision declined, then the holdout.
- **C/D:** real Nano with validated suggestions applied, a real Gemini proposal, semantic verification. Then the spec authorizes every trusted constraint behind a semantic finding, approves one real Gemini revision, and runs the re-evaluation, the local acceptance check and the holdout.

The predeclared budget is in `docs/evidence/sprint-8/freeze-manifest.json`: trials 1–5, at most 60 cloud requests, no retries. Evidence is written outside `test-results/` (Playwright empties that directory), to `EYES_LIVE_EVIDENCE` (default `live-evidence/sprint-8/semantic-benchmark.json`, git-ignored). It is archived to `docs/evidence/sprint-8/live-semantic-benchmark.json`.

```bash
EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
EYES_LIVE_TESTS=1 EYES_LIVE_SEMANTIC_BENCHMARK=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_LIVE_TRIALS=1 EYES_LIVE_FIRST_TRIAL=1 \
pnpm test:live tests/live/semantic-benchmark.spec.ts
```

`EYES_LIVE_SCENARIO=<id>` restricts a run to one scenario.

## Sprint 12 additions: hosted acceptance and the Nano-value experiment

**Hosted acceptance** (`playwright.hosted.config.ts`) runs the opt-in live specs against a **deployed** build: no web server, and no App Check debug token (the config throws if one is set), so attestation is production reCAPTCHA Enterprise on an allowed domain.

```bash
# Real hybrid journey on the public URL (uses quota: ≤ 2 cloud requests per run)
EYES_HOSTED_URL=https://eyes-without-a-face-b7281.web.app \
EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT11=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
EYES_LIVE_EVIDENCE=live-evidence/sprint-12/hosted.json \
EYES_LIVE_SCREENSHOTS=docs/demo/screenshots/sprint-12-hosted \
pnpm exec playwright test -c playwright.hosted.config.ts --project=hosted-chrome tests/live/sprint11-experience.spec.ts

# Browsers without Nano: honest deterministic path, nothing sent (no quota)
EYES_LIVE_TESTS=1 EYES_LIVE_HOSTED=1 pnpm exec playwright test -c playwright.hosted.config.ts \
  --project=hosted-chromium-no-nano --project=hosted-firefox
```

Use `--project=name` (with `=`): a bare `--project name path` treats the path as another project name. Headed Firefox crashed at launch on the Sprint 12 machine, so the Firefox project is headless.

**Nano-value experiment:** `tests/live/semantic-benchmark.spec.ts` with `EYES_LIVE_SCENARIO=crm-nl-relations EYES_LIVE_NO_REVISION=1` (the experiment scenario runs only when selected; without a selection the Sprint 8 set is unchanged). Protocol, budget and results: [../evaluation/sprint-12-nano-value.md](../evaluation/sprint-12-nano-value.md).
