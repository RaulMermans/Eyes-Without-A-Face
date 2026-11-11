# Sprint 4 — Firebase integration, Hybrid AI qualification, demo readiness

**Date:** 2026-11-11  
**Branch:** `sprint-4`, from `origin/main` @ `0fef088`. Its tree is identical to Sprint 3 `b8a6d73`.  
**Classification:** **`LOCAL_PIPELINE_COMPLETE / CLOUD_BLOCKED`**. On-device is **verified**: real Gemini Nano through Firebase AI Logic. Cloud is blocked only by owner-side App Check registration.

## Headline results

1. **The on-device blocker was the test harness, not the hardware.** Playwright's default Chromium arguments disable component updates and `OptimizationHints`, so Chrome never registered Gemini Nano. In a dedicated persistent profile without those arguments, `availability()` moved from `unavailable` to `downloadable`. The model then downloaded (4.0 GB, about 5 minutes) and became `available`. Firebase AI Logic `ONLY_ON_DEVICE` then returned `inferenceSource = ON_DEVICE`.
2. **The on-device output is constrained, not repaired.** The first real Nano reply was free text, which was correctly rejected as `INVALID_STRUCTURED_OUTPUT`. The SDK's `onDeviceParams.promptOptions.responseConstraint` now carries a JSON Schema that mirrors `field-interpretation.v1`. The reply is still strictly validated afterwards, and a unit test guards the mirror against drift.
3. **Cloud stays blocked by App Check (HTTP 403).** A debug token was generated into `~/.config/eyes-without-a-face/appcheck-debug-token` (mode 600, outside Git, never printed). The owner must register it in the Firebase Console. Neither the CLI nor MCP can do this, and the CLI is not logged in.
4. **Security defect fixed:** live Playwright traces captured the injected App Check debug token through `addInitScript` arguments. Traces are now off whenever a token is set. The two affected local trace files were deleted. They were never committed or uploaded.
5. **Reality Check status defect fixed.** `mappingValid` ignored `INVALID_TARGET_SCHEMA` per record, and it counted batch-level refusals as contract failures. The report now carries five independently computed stage statuses (`pass` / `fail` / `not_evaluated`) and an overall verdict.

## Changes

| Area | Change |
| --- | --- |
| Firebase CLI | `.firebaserc` sets default `eyes-without-a-face-b7281`. CLI 15.35.0 works. **No authorized account**: `projects:list` / `apps:list` need the owner's `firebase login`. |
| Firebase MCP | `.mcp.json` registers `npx -y firebase-tools@latest mcp` for Claude Code. Verified over stdio: server `firebase` 0.3.0, 66 tools. `firebase_get_environment` resolves the project from `.firebaserc` and reports `Authenticated User: <NONE>`, `Billing Enabled: No`. The Cursor plugin config (`.cursor/`, untracked) is left alone, so nothing is registered twice. |
| App Check | Token prepared (see above). LIVE-004 and LIVE-009 still 403. |
| On-device | `tests/live/fixtures.ts`: an opt-in dedicated Chrome profile (`EYES_CHROME_PROFILE`). Adds `responseConstraint`, LIVE-013 (guided-flow on-device suggestions), and stronger LIVE-007 evidence. |
| Reality Check | `src/verification/reality-check.ts`: `statuses`, `overall`, and the standalone `mappingContractStatus` / `targetSchemaStatus`. The UI shows all five plus the verdict. Telemetry `ok` now follows the verdict. |
| Privacy tests | `tests/privacy/adversarial.test.ts` checks that private values in `UNMAPPED_ENUM` / `INVALID_EMAIL` / `INVALID_DATE` messages never reach the safe tiers. It also covers prompt-injection field names (absent from the outbound prompt; aliases only) and prototype-pollution field names (refused at profiling). No new leak was found. |
| Live privacy | LIVE-009 scans real `generateContent` request bodies for private terms, keeping only counts. |
| CI | The workflow adds `sprint-4`. |
| Release | `LICENSE` (Apache-2.0) and the `package.json` license field. Docs: `docs/deployment.md`, `docs/setup/firebase-cli-mcp.md`, `docs/demo/` (storyboard, narration, recording, proof summary, safe screenshot), and `docs/hackathon-history.md`. Updated the browser-compatibility, App Check, live-testing and requirements docs. |

No engine semantics changed. No Firebase resources were created. Nothing was deployed. Billing was not touched.

## Evidence (2026-11-11, EVO X3, Linux x86_64, Chrome 157.0.8103.38, firebase 13.2.0)

| Check | Result |
| --- | --- |
| Baseline (before changes) | `pnpm test:all` PASS: 112 unit, 22 contract, 23 privacy, 41 E2E |
| After changes | lint, typecheck and build PASS; 121 unit, 22 contract, 28 privacy, 41 E2E (with new status assertions) |
| LIVE-001 | Prompt API available, model `available` (dedicated profile) |
| LIVE-002 | `eyes-without-a-face-b7281`, app `1:507051460368:web:086c…` |
| LIVE-004 | **BLOCKED**: `APP_CHECK_REJECTED`, HTTP 403 from App Check token exchange, after 1.4 s. No `generateContent` request |
| LIVE-005 / 006 / 008 | PASS |
| LIVE-007 | **PASS**: `source=ON_DEVICE mode=ONLY_ON_DEVICE simulated=false schema=true`, 3.6 s inference, 0 cloud inference URLs |
| LIVE-009 | **BLOCKED**: same 403. 0 `generateContent` requests, so the body scan had nothing to inspect |
| LIVE-013 | **PASS**: 6 phantom fields classified on-device in the guided flow (19 s), all labeled real on-device, 0 cloud URLs, 0 page errors |
| Token in artifacts | 0 matches after the fix. Traces are disabled |

Evidence JSON is in `test-results/sprint-4-live/` (gitignored, cleared by every Playwright run).

## GitHub / CI

- The repository exists and is **private**. Default branch `main`. PRs #1–#3 are merged; `main` contains Sprint 3.
- Every Actions run fails within 3 s with **"The job was not started because recent account payments have failed or your spending limit needs to be increased."** That is an account billing block on private-repository minutes. It is **not** a workflow or test failure, and CI has never actually executed. Public repositories get standard runners free, so publishing the repository would likely unblock CI without billing changes (owner decision).

## Secret and history scan

- No `.env`/`.env.local`, no private keys, and no debug token in any commit.
- `docs/setup/firebase.md` (since commit `45971db`) contains the Firebase web API key and the reCAPTCHA Enterprise **site** key. Both are public browser identifiers by design, protected by App Check, and not secrets. History was not rewritten. Restricting the API key to the Hosting/localhost referrers in Google Cloud Console is recommended before publishing.
- Largest tracked file: `src/assets/brand/eyes-emblem-original.png` (628 KB).

## Remaining owner actions

1. `npx -y firebase-tools@latest login`. Then `projects:list`, `apps:list`, `hosting:sites:list` (Gate A).
2. Firebase Console → App Check → Apps → `eyes-without-a-face-web` → Manage debug tokens → add the UUID from `~/.config/eyes-without-a-face/appcheck-debug-token` (Gate B). Then run:

   ```bash
   EYES_APPCHECK_DEBUG_TOKEN="$(cat ~/.config/eyes-without-a-face/appcheck-debug-token)" \
   EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
   EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" pnpm test:live
   ```

   If LIVE-004 and LIVE-009 pass with `source=IN_CLOUD`, the status becomes **`HYBRID_QUALIFIED`**.
3. Read the Devpost Official Rules in a browser (automated fetches get HTTP 403).
4. Decide on publishing the repository, which also likely unblocks CI.
