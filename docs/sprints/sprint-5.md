# Sprint 5 — Release candidate, production verification, judge-ready experience

**Date:** 2026-11-11  
**Branch:** `sprint-5`, from `origin/main` @ `e1d4b03` (merge of PR #5)  
**Release status:** **`RELEASE_CANDIDATE_READY`**. `HOSTED_VERIFIED` and `SUBMISSION_READY` are **BLOCKED** on owner approvals (deployment, repository visibility, video).

Environment for all live evidence: EVO X3, Linux x86_64 (Ubuntu 26.04), AMD Strix Halo (Radeon 8060S), Chrome 157.0.8103.38, `firebase` 13.2.0 (`@firebase/ai` 3.0.0), dedicated Chrome profile with experimental on-device flags ([browser-compatibility.md](../setup/browser-compatibility.md)).

## Headline results

1. **The intermittent `SDK_INIT_FAILED: kErrorUnknown` is a native Chrome crash, not an initialization or app bug.** Chrome logs `Unexpected on_device_model service disconnect`. Apport records **SIGILL** in the `OnDeviceModelService` utility process, which runs `nano_v3_gpu_high_tier_model` on the AMD GPU. It is now classified as `ON_DEVICE_RUNTIME_ERROR`, with one user-initiated retry that resumes the remaining fields.
2. **A second, previously invisible failure: hung on-device prompts, and an on-device timeout that never fired.** `@firebase/ai` 3.0.0 does not pass the request `AbortSignal` to `LanguageModel.prompt()`, so the 90 s timeout was silently ignored. The UI would have waited indefinitely. The app now races every model call against its signal *and* attaches the signal to Chrome's `create()`/`prompt()` options, so a timeout cancels the real prompt. After that change, the single retry recovers.
3. **A production build from a developer machine would have shipped App Check debug mode.** Vite loads `.env.local` in every mode. The existing `dist/` contained `VITE_APP_CHECK_DEBUG:"true"`, and the production app would therefore have refused all cloud calls. New `pnpm build:release` forces debug off, refuses a dirty tree, stamps the Git SHA, and runs `verify-release`.
4. **Hosting was never released.** The Hosting API shows no versions or releases, and the URL serves Firebase's 404. The Sprint 4 docs' "older release of unknown revision" was wrong. **The reCAPTCHA key does not allow preview-channel hosts**, so production App Check cannot pass on a preview channel without a key change ([deployment.md](../deployment.md)).
5. **CI had a latent failure that billing was hiding.** `pnpm/action-setup@v4` with `version: 10` plus `packageManager: pnpm@10.28.0` fails with "Multiple versions of pnpm specified". This is fixed. Runs still do not start because of the account billing block.
6. **Judge-facing UX.** There is one entry point ("Try the fictional CRM demo") with a plain explanation of the Phantom Twin and where each step runs. Only implemented steps are shown, with completion marks. A verdict card separates *3 / 3 imported records transformed* from *0 / 3 hidden cases covered*. Cloud-unavailable no longer burns the approval. Internal "Sprint N" jargon is removed.

## Changes

| Area | Change |
| --- | --- |
| On-device reliability | `errors.ts`: `ON_DEVICE_RUNTIME_ERROR` for Chrome `kError*`. `retry-policy.ts`: `ON_DEVICE_USER_RETRY_LIMIT = 1` and `isRecoverableOnDeviceFailure` (runtime error, init failure, timeout). `abort.ts`: `raceAbort`. `firebase-live.ts`: per-request signal on the SDK-held `createOptions`/`promptOptions`, dropping the cached model after a recoverable failure, and on-device-specific timeout text. `PhantomPanel`: in-flight guard, real per-field progress, a resumable single retry, then a blocked state with "restart Chrome" guidance. No automatic retry and no cloud fallback |
| Release build | `scripts/build-release.mjs`, `scripts/verify-release.mjs`, `pnpm build:release` / `verify:release`. `AppConfig.buildSha` is shown in the footer |
| UX | Landing intro and demo CTA, five-step path strip, step completion marks, verdict card, cloud-unavailable state, origin badge, footer. Export removed from the workflow (not implemented). Demo loader shared via `src/app/demo.ts` |
| Tests | `tests/unit/on-device-recovery.test.ts` (11). `tests/privacy/release-artifact.test.ts` (5). `tests/e2e/release.spec.ts` (E2E-040 to E2E-043, 6 tests). Smoke/navigation tests updated for five steps. Live: `nano-reliability.spec.ts` (study harness), LIVE-013 now requires all 6 fields, new LIVE-018 (cloud denied by App Check). Test harness switches `onDeviceAvailable`, `onDeviceRuntimeFailures` |
| CI | Workflow: removed the conflicting pnpm `version`, added `permissions: contents: read`, and triggers set to `main` + `sprint-5` |
| Docs | README rewritten (problem → mechanism → demo → evidence → run). Updated: deployment, App Check lifecycle, browser compatibility (crash and hang analysis), security model and pre-publication audit, live testing, demo storyboard, hackathon history and requirements, architecture note, AGENTS release rules. New Devpost draft |
| Screenshots | `docs/demo/screenshots/` regenerated from **real** runs (LIVE-009 `IN_CLOUD`, LIVE-013 `ON_DEVICE`) plus the deterministic landing page. Verified: fictional data only, no token |

No new Firebase resources. Nothing deployed. Repository visibility, billing and App Check settings were not changed.

## Evidence

### Deterministic suites

| | Baseline (`e1d4b03`) | Sprint 5 |
| --- | --- | --- |
| Unit | 123 | **134** |
| Contract | 22 | **22** |
| Privacy | 28 | **33** |
| Playwright E2E | 41 | **47** |
| Lint, typecheck, build | pass | pass |

### On-device reliability study

Each attempt = a fresh Chrome process (cold run), then a page reload in the same process (warm run). Each run classifies 6 twin fields on-device, i.e. 6 real Nano calls through Firebase AI Logic `ONLY_ON_DEVICE`.

| Run | Code | Runs usable | First-try | Failures and classification | Cold median / max | Warm median / max | Cloud `generateContent` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | Sprint 4 | 17/20 | 17/20 | Attempt 5 cold + warm: Chrome model-service crash (SIGILL), same process. Attempt 3 warm: harness timeout during my hot-reload edits, no model error in Chrome's log | 18.8 s / 19.8 s | 14.4 s / 15.4 s | 0 |
| A | + retry | — | — | **Discarded**: the harness read incremental suggestions as complete | — | — | 0 |
| B | + fixed harness | 19/20 | 19/20 | Attempt 1 cold: prompt hung about 2.5 min, timeout never fired (defect found) | — | — | 0 |
| C | + effective timeout | 18/20 | 18/20 | 2 cold hangs → `TIMEOUT` at 90 s; retry **did not** recover (the abandoned prompt still occupied the service); next warm runs 84–88 s | — | — | 0 |
| **D** | **final** | **20/20** | **19/20** | Attempt 2 cold hung → `TIMEOUT` at 90 s → **single retry recovered** the remaining fields (109 s total); the following warm run took a normal 14.6 s | **18.5 s / 20.5 s** | **14.6 s / 17.1 s** | **0** |

Observations, which are operational evidence and not statistical guarantees:

- Target (≥ 9/10 usable for demo readiness): met in the final run, with 19/20 first try and 20/20 after the user retry.
- Hangs occurred only in **cold** browsers: 4 of 30 cold runs across B–D, 0 of 30 warm runs. A warm-up run before recording is part of the demo checklist.
- Native crashes: one crashing browser process in the baseline. None in B–D (60 runs, about 360 prompts).
- Page errors: 0 in every run. Cloud inference requests during on-device steps: 0 in every run.

### Live Firebase AI Logic suite (localhost, App Check debug provider)

| Check | Result |
| --- | --- |
| Hybrid pass (`EYES_LIVE_ON_DEVICE=1 EYES_LIVE_CLOUD=1`, dedicated profile) | **10 / 10 PASS** (LIVE-018 skipped by design) |
| LIVE-004 cloud | `IN_CLOUD`, `simulated=false`, schema-valid, 1.88 s inference |
| LIVE-007 on-device | `ON_DEVICE`, `simulated=false`, schema-valid, 4.6 s, 0 cloud URLs |
| LIVE-009 guided cloud flow ×3 | `IN_CLOUD` 1.95 / 1.96 / 2.10 s. Proposal **Valid · 5 operations** every time. Reality Check 3 imported pass, **3 / 3 hidden cases fail** (`UNMAPPED_ENUM`, `TYPE_MISMATCH`, `NULL_VALUE`). 1 `generateContent` request per run to `firebasevertexai.googleapis.com`, **0 private terms** in its body, 0 page errors |
| LIVE-013 guided on-device flow ×3 | **6 / 6** fields `(real on-device)` each time, 19.1 / 17.5 / 18.0 s, 0 cloud URLs, 0 page errors |
| Degraded pass (stock Playwright Chrome, no debug token, `EYES_LIVE_CLOUD_DENIED=1`) | **8 / 8 PASS** |
| LIVE-001 / LIVE-007 without Nano | Prompt API present, model `unavailable` → `MODEL_UNAVAILABLE`, explicit "will not fall back to cloud Gemini" |
| LIVE-018 cloud denied | App Check exchange **HTTP 403** → `APP_CHECK_REJECTED`, **0** `generateContent` requests, no proposal. The guided twin step shows "On-device AI unavailable — manual/deterministic mode" |
| Debug token in evidence, screenshots, traces | 0 matches (tracing off when a token is set) |

Cloud inference success rate this sprint: 4 / 4 real requests (1 diagnostic + 3 guided). Mapping validation pass rate: 3 / 3 guided proposals. Hidden-case detection: 3 / 3 per run.

### Firebase / Hosting / App Check (read-only)

See [deployment.md](../deployment.md#verified-current-state-read-only-inspection-2026-11-11). Hosting has no releases. App Check is ENFORCED on `firebaseml.googleapis.com`. The reCAPTCHA Enterprise key allows only `eyes-without-a-face-b7281.web.app` and `.firebaseapp.com`, with `minValidScore 0.5`. There is one debug token. API key restrictions were not readable (API Keys API disabled).

### Release build

Recorded in the "Release build verification" section below, after the commit.

### Security

Full-history audit: [../security/README.md](../security/README.md#pre-publication-audit-2026-11-11-all-11-reachable-commits). No secrets, tokens, private data or generated artifacts in any of the 11 reachable commits. Open owner items: API key restrictions, author email visibility, emblem rights.

### GitHub / CI

- The repository is **private**. GitHub detects the license (`apache-2.0`). Description is set, topics are empty, homepage is empty.
- Actions is enabled (`allowed_actions: all`). Every run since Sprint 4 is either `queued` indefinitely or failed within seconds with *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* That is an account billing block, not a test failure, and it is unchanged.
- The workflow's latent pnpm-version conflict is fixed, so the first run on an unblocked runner should get past `pnpm/action-setup`.

## Not done (by design or blocked)

- **Hosting deploy and production App Check on a hosted domain:** BLOCKED on owner approval. The plan and checklist are ready.
- **Repository publication and CI run:** BLOCKED on owner approval and account billing.
- **Video:** not recorded. The storyboard is final.
- **Devpost:** draft only, not submitted. The Official Rules are still unreadable to automation (HTTP 403).
- **C6 local correction:** already available. "Edit the proposal locally" re-validates the edited contract under the manual-edit label and the Reality Check re-runs. No cloud correction requests.
