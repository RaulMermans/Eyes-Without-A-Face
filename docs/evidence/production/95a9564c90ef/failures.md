# Production failures — build 95a9564c90ef (Sprint 14)

Deployed 2026-11-14 ~06:47 UTC with the owner's explicit approval of this exact SHA. Served `build-info.json` = `95a9564c90efd97085dea420b5dca3d62ff265cf`.

## PF-1 — real hybrid run: App Check attestation refused (automated session)

- **Run 1 (S14-REC-3, 06:47:56Z):** Playwright, installed Chrome, dedicated Nano profile, no debug token.
  - Real Gemini Nano interpreted 6 / 6 fields on the device in 15.2 s, with 0 cloud requests.
  - On "Approve and send", the page showed **"App Check refused this app"**. **0 `generateContent` requests** were sent: the app failed closed, before inference.
  - The approval was consumed, and the UI said so and offered a fresh request.
- **Cost:** 0 cloud inference requests (the refusal happens at the App Check token exchange).
- **Declared before sending (budget rule):** at most **one** diagnostic re-run of the same path, recording only the status codes of the App Check and reCAPTCHA exchanges. If App Check passes, it sends the 1 budgeted Gemini request. If it fails again, no further production attempts are made by the agent; a human run in a normal Chrome window is the remaining check.
- **Run 2 (declared diagnostic, 06:48:53Z):** the same path.
  - Real Nano again: 6 / 6 fields in 14.7 s, 0 cloud requests.
  - Attestation exchange status codes: `recaptcha/enterprise/reload 200`, `recaptcha/enterprise/clr 200`, then **`content-firebaseappcheck…:exchangeRecaptchaEnterpriseToken 403`**.
  - The page showed `APP_CHECK_REJECTED` ("App Check refused this app"), with 0 `generateContent` requests ([screenshot](screenshots/real-app-check-refused.png)).

### Classification

- **What is proven:** App Check is **enforced and failing closed** in production. reCAPTCHA Enterprise issued a token, and the App Check exchange refused it, for this automated Chrome session. No request reached Gemini, nothing was retried, and the failure message is the classified, actionable one (real production failure-path evidence).
- **What is not proven:** the cause of the 403. The likely cause is a reCAPTCHA score below the key's `minValidScore 0.5` for a Playwright-driven session (Sprint 12 recorded the same risk). The 403 alone does not distinguish a low score from another attestation problem.
- **Why not a configuration break:** no Firebase, App Check or reCAPTCHA configuration was changed in Sprint 14, and the build carries the same site key (`verify-release` checks it). The same domain and key served a real Gemini answer to a human user on `a548d7f` (the incident report).
- **Decision:** not a rollback criterion. App Check is not broken or disabled; the deterministic journey passes 17 / 17; the previous release is worse. The release stays live. **Status: `DEPLOYED_UNVERIFIED`.** The agent makes no further production attempts.

### Remaining check — a human run (completes acceptance)

In a normal Chrome window, on <https://eyes-without-a-face-b7281.web.app>, footer `build 95a9564c90ef`:

1. **Your data:** JSON demo.
2. **Destination:** Helpdesk; tick "Share the 3 category names of account_state".
3. **Result:** Build integration → Approve and send. Expect "Draft — not fully verified" or better, `mapping: REAL GEMINI OUTPUT · IN_CLOUD`, and Transformed 3.
4. **Downloads:** Download integration (.zip), then `unzip … && node run.mjs verify` → exit 0.

Record the result in `acceptance-results.json`. That costs 1 cloud request, within this release's budget: 0 of 1 used, because both automated runs stopped at App Check.
