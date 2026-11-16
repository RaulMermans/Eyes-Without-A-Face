# Production failures — build 0a9d42aeac68 (Sprint 15)

Deployed 2026-11-16 with the owner's explicit instruction to renew production with the new deployment. The deployed artifact is `0a9d42a`, head of PR #16 (not yet merged), `verify-release` PASS. Served `build-info.json` = `0a9d42aeac68a792203c190d3ccc922661b543ff`.

## PF-1 — real hybrid run: App Check attestation refused (automated session). Same as Sprint 14 PF-1.

- **Run (S14-REC-3, 07:52Z).** Playwright, installed Chrome, dedicated Nano profile, no debug token.
  - Real Gemini Nano interpreted 6 / 6 fields on the device in 37.0 s, with 0 cloud requests.
  - On "Approve and send", the attestation exchange returned:
    - `recaptcha/enterprise/reload 200`
    - `recaptcha/enterprise/clr 200`
    - **`exchangeRecaptchaEnterpriseToken 403`**
  - The app showed `APP_CHECK_REJECTED` and sent **0** `generateContent` requests.
- **Budget.** 1 cloud request allowed, 0 used. No diagnostic re-run: Sprint 14 already ran one for this identical cause (PF-1 of `95a9564c90ef`), and the rules forbid looping until a run passes.
- **Classification.** App Check is enforced and fails closed. The 403 is consistent with a low reCAPTCHA score for automated Chrome. No Firebase, App Check or reCAPTCHA configuration changed in Sprint 15.
- **Not a rollback criterion.** Every deterministic check passes, the export runs independently, and nothing private was exposed.

## Remaining check — a human run (completes acceptance)

Use a normal Chrome window on <https://eyes-without-a-face-b7281.web.app>, footer `build 0a9d42aeac68`.

1. **Your data:** JSON demo.
2. **Destination:** Helpdesk. Tick "Let Gemini translate them: share the 3 category names of account_state".
3. **Result:** Build integration → Approve and send. Expect:
   - `mapping: REAL GEMINI OUTPUT · IN_CLOUD`;
   - Transformed 3.
4. **Meaning:** under "Meaning, field by field", click "Say what each value means" for status and answer active_customer → active, inactive_customer → inactive, prospect → prospect. Expect status ✓ "Checked".

Record the result in `acceptance-results.json`. It costs 1 cloud request.
