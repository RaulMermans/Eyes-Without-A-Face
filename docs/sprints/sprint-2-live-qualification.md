# Sprint 2 live qualification

**Date:** 2026-11-10  
**Command:** `EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live`  
**Browser:** Google Chrome 157.0.0.0, Linux x86_64  
**Project:** `eyes-without-a-face-b7281` / app `1:507051460368:web:086c755a2c003fb30b4795`  
**Model configured:** `gemini-3.5-flash-lite` via Firebase AI Logic (`ONLY_IN_CLOUD`)

## Result

**`CLOUD_BLOCKED / ON_DEVICE_BLOCKED`**

Not `HYBRID_QUALIFIED`. Not `CLOUD_QUALIFIED`.

## Evidence

| Check | Status | Evidence |
| --- | --- | --- |
| LIVE-001 capability | PASS (diagnostic) | Prompt API `available`; `LanguageModel.availability()` = `unavailable` |
| LIVE-002 Firebase init | PASS | Project and web app ids match the registered app |
| LIVE-003 App Check config | PASS | `Local debug provider (token is not stored in VITE_* )`. Site key is no longer a placeholder |
| LIVE-004 cloud generate | BLOCKED | `APP_CHECK_REJECTED` HTTP 403 `appCheck/fetch-status-error`. Duration 1296 ms. No `inferenceSource` |
| LIVE-005 unapproved path | PASS | No `generateContent` URLs |
| LIVE-006 prompt fingerprint | PASS | Payload and outbound hashes present; prompt 1708 chars |
| LIVE-007 on-device | BLOCKED | `MODEL_UNAVAILABLE`; no cloud fallback |
| LIVE-008 UI | PASS | No page errors |

Firebase MCP was not authenticated in this session, so the App Check debug token could not be registered from the agent.

## Remaining owner action (App Check)

Do not disable enforcement. Do not put the token in `VITE_*` or Git.

1. Run `pnpm dev` and open the app on localhost.
2. Open DevTools → Console and copy the App Check debug token printed by the Firebase SDK.
3. Firebase Console → App Check → Apps → `eyes-without-a-face-web` → Manage debug tokens → register that token.
4. Reload the app.
5. Re-run `EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live`.

If LIVE-004 then shows `source=IN_CLOUD` and `simulated=false`, record `CLOUD_QUALIFIED / ON_DEVICE_BLOCKED`.

## On-device recommendation

Retest on Chrome desktop ≥ 139 where `LanguageModel.availability()` returns `available` or `downloadable` (typically a machine that can download Gemini Nano). Playwright Chromium and this Linux Chrome 157 host are not sufficient. Do not substitute Ollama or cloud inference.
