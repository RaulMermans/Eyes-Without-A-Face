# Sprint 4 — Firebase integration, Hybrid AI qualification, demo readiness

**Date:** 2026-11-11  
**Branch:** `sprint-4`, from `origin/main` @ `0fef088`. Its tree is identical to Sprint 3 `b8a6d73`.  
**Classification:** **`HYBRID_QUALIFIED`**. Real on-device (Gemini Nano) and real cloud (Gemini) inference are both verified through Firebase AI Logic. A real Gemini proposal drives alias resolution, local execution and the Reality Check.

## Headline results

1. **The on-device blocker was the test harness, not the hardware.** Playwright's default Chromium arguments disable component updates and `OptimizationHints`, so Chrome never registered Gemini Nano. In a dedicated persistent profile without those arguments, `availability()` moved from `unavailable` to `downloadable`. The model then downloaded (4.0 GB, about 5 minutes) and became `available`. Firebase AI Logic `ONLY_ON_DEVICE` then returned `inferenceSource = ON_DEVICE`.
2. **The on-device output is constrained, not repaired.** The first real Nano reply was free text, which was correctly rejected as `INVALID_STRUCTURED_OUTPUT`. The SDK's `onDeviceParams.promptOptions.responseConstraint` now carries a JSON Schema that mirrors `field-interpretation.v1`. The reply is still strictly validated afterwards, and a unit test guards the mirror against drift.
3. **App Check resolved and cloud verified.** A debug token was generated into `~/.config/eyes-without-a-face/appcheck-debug-token` (mode 600, outside Git, never printed). After the owner's `firebase login`, it was registered through the App Check REST API. Real `ONLY_IN_CLOUD` calls then returned `inferenceSource = IN_CLOUD`.
4. **Security defect fixed:** live Playwright traces captured the injected App Check debug token through `addInitScript` arguments. Traces are now off whenever a token is set. The two affected local trace files were deleted. They were never committed or uploaded.
5. **Reality Check status defect fixed.** `mappingValid` ignored `INVALID_TARGET_SCHEMA` per record, and it counted batch-level refusals as contract failures. The report now carries five independently computed stage statuses (`pass` / `fail` / `not_evaluated`) and an overall verdict.
6. **Cloud response schema bug found by the first real Gemini call.** `MAPPING_PROPOSAL_JSON_SCHEMA` declared `params` as an object with no properties. Gemini's constrained decoding could therefore only emit `params: {}`, and the converter correctly rejected the proposal (5 × `INVALID_PARAMS`). The schema now declares every param the converter accepts and restricts `op` to the allowlist. A unit test ties it to `PARAM_KEYS`. Gemini's next proposal was valid and identical to the canonical mapping. Validation was not relaxed.

## Changes

| Area | Change |
| --- | --- |
| Firebase CLI | `.firebaserc` sets default `eyes-without-a-face-b7281`. CLI 15.35.0. After the owner logged in, these all succeeded: `projects:list` (project number 507051460368), `apps:list` (`eyes-without-a-face-web`), `hosting:sites:list` (`eyes-without-a-face-b7281`), and `hosting:channel:list` (`live`, last release 2026-11-10 18:20, revision unknown). |
| Firebase MCP | `.mcp.json` registers `npx -y firebase-tools@latest mcp` for Claude Code. Verified over stdio: server `firebase` 0.3.0, 66 tools. `firebase_get_environment` resolves the project from `.firebaserc` and reports `Authenticated User: <NONE>`, `Billing Enabled: No`. The Cursor plugin config (`.cursor/`, untracked) is left alone, so nothing is registered twice. |
| App Check | Token prepared and registered through the API (`sprint-4-live-tests (EVO X3, local only)`). Accepted. |
| Cloud schema | `src/inference/prompts.ts` declares params in `responseJsonSchema`; `PARAM_KEYS` is exported from `convert.ts`. New test `cloud-response-schema.test.ts`. LIVE-009 records the alias-level proposal and any issues. |
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
| After changes | `pnpm test:all` PASS: 123 unit, 22 contract, 28 privacy, 41 E2E |
| LIVE-010 control plane | PASS: CLI read access to project, app, Hosting site and channels. The MCP server is verified over stdio and uses the same credentials |
| LIVE-001 | Prompt API available, model `available` (dedicated profile) |
| LIVE-002 | `eyes-without-a-face-b7281`, app `1:507051460368:web:086c…` |
| LIVE-004 (LIVE-011, LIVE-012) | **PASS**: `source=IN_CLOUD mode=ONLY_IN_CLOUD simulated=false schema=true`, 4.5 s inference |
| LIVE-007 | **PASS**: `source=ON_DEVICE mode=ONLY_ON_DEVICE simulated=false schema=true`, 4.0 s inference, 0 cloud inference URLs |
| LIVE-009 (LIVE-014 to LIVE-017) | **PASS**: `IN_CLOUD`, 2.5 s. Proposal `Valid · 5 operations · aliases resolved locally`, identical to `crm/mapping-contract.json`. Reality Check: 3 imported records pass (expected outputs), 3 of 3 reserved hidden cases fail (`UNMAPPED_ENUM`, `TYPE_MISMATCH`, `NULL_VALUE`, shown by alias). One `generateContent` request to `firebasevertexai.googleapis.com`, **0 private terms** in its body, 0 page errors |
| LIVE-013 | **PASS**: 6 phantom fields classified on-device in the guided flow (18 s), all real, 0 cloud URLs |
| LIVE-005 / 006 / 008 | PASS |
| Full live run | **10 / 10 PASS** (44.5 s) |
| Flakiness | 1 of 5 runs: LIVE-013 hit `SDK_INIT_FAILED: kErrorUnknown` from Chrome's on-device model service. The app showed `ON_DEVICE_BLOCKED` with no cloud fallback. The test now fails fast and records the blocker. |
| Token in artifacts | 0 matches; tracing disabled |

Evidence JSON is in `test-results/sprint-4-live/` (gitignored, cleared by every Playwright run). Safe screenshots are in `docs/demo/screenshots/`.

## GitHub / CI

- The repository exists and is **private**. Default branch `main`. PRs #1–#3 are merged; `main` contains Sprint 3.
- Every Actions run fails within 3 s with **"The job was not started because recent account payments have failed or your spending limit needs to be increased."** That is an account billing block on private-repository minutes. It is **not** a workflow or test failure, and CI has never actually executed. Public repositories get standard runners free, so publishing the repository would likely unblock CI without billing changes (owner decision).

## Secret and history scan

- No `.env`/`.env.local`, no private keys, and no debug token in any commit.
- `docs/setup/firebase.md` (since commit `45971db`) contains the Firebase web API key and the reCAPTCHA Enterprise **site** key. Both are public browser identifiers by design, protected by App Check, and not secrets. History was not rewritten. Restricting the API key to the Hosting/localhost referrers in Google Cloud Console is recommended before publishing.
- Largest tracked file: `src/assets/brand/eyes-emblem-original.png` (628 KB).

## Remaining owner actions

1. Read the Devpost Official Rules in a browser (automated fetches get HTTP 403).
2. Decide on publishing the repository, which also likely unblocks CI.
3. Revoke the debug token after recording, if no further live runs are needed (Console, or `DELETE` through the App Check API).
4. Approve, or skip, a fresh Hosting deploy from a known commit. The current `live` release has an unknown revision.
