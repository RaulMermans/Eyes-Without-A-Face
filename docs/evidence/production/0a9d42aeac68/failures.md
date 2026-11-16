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

## Owner-requested check — fictional "Meridian Circle" source (120 records, 18 fields, nested)

Run on 2026-11-16 against the live `0a9d42a`, with Playwright (headless Chromium) and the local build path. **0 model requests.** The source file stays outside the repository.

The answers used by the test (business choices made for the test only):

- `status` ← `account_state`, translated: activo → active, inactivo → inactive, pendiente → prospect, reactivado → active, suspendido → set aside;
- `email` ← `contact.email`.

| Step | Result |
| --- | --- |
| Import | 120 records, 18 fields, no page errors |
| Status question | 3 of 19 compatible fields shown (`account_state` first); no sharing checkbox until chosen, then 1, unchecked |
| Field matches | id ← record_id, createdAt ← contract.signed_at, organization ← organization (suggested). **email: no suggestion** (PF-2) |
| Build on this device | Draft: **102 transformed, 15 set aside** (suspendido, as chosen), **3 need attention** (malformed emails); status meaning ✓ checked against the declaration |
| Transformed data download | 102 records, OK |
| Reusable integration (.zip) | **Blocked by the privacy scan** (PF-3) |

### PF-2 — email not suggested when a few values are malformed

- **Observation.** 116 of 120 `contact.email` values are valid; four are not (`not-an-email`, empty, missing, truncated).
- **Cause.** The profiler sets `format: email` only when every value is valid, so `rankCandidates` has no email evidence. `contact.email` ties with every other text field and no suggestion is made.
- **Impact.** The user must pick the field by hand. Nothing incorrect happens.
- **Proposed fix.** Rank by the local share of email-shaped values ("116 of 120 look like emails"), shown as a reason. The profile, disclosure and validation stay unchanged.

### PF-3 — export privacy scan: false positives on common words (pre-existing, not a leak)

- **Traced offline** with the same code and data. The scan's lowercase substring rule matched record values against text EYES itself writes:
  - `design` (an `organization_type` value) inside the README/manifest sentence "…may fail enum mappings by design." (`src/export/package.ts:322`);
  - `studio` (a `billing.plan_code` value) inside a synthetic fixture name built from the generator vocabulary "… Studio" (`src/phantom/synthetic.ts:12`).
- **What was not hit.** No record value, field name or binding was in the package. The scan failed closed as designed.
- **Not a Sprint 15 regression.** It predates Sprint 15 and would block any mapping (Gemini's too) for this file.
- **Not changed during acceptance.** The scan must never be weakened to make an export pass. Fix options need the owner's decision:
  1. Remove the collisions at the source, without touching the scan. Reword app-authored package text that contains a private value, or keep it out of the scanned text. Make the synthetic generator never emit a word equal to a private value.
  2. Do nothing, and document that some real datasets cannot be exported.

### Status of PF-2 and PF-3 (fixed on the branch, not yet deployed)

- **PF-2.** `rankCandidates` counts email-shaped values locally. At least 80 % of present values counts as evidence ("117 of 119 values look like email addresses").
  - Regression tests: S15-022 and S15-023.
- **PF-3, option 1 (owner instruction "fix what you have witnessed").** The privacy scan is unchanged.
  - The package sentence "…by design." is reworded.
  - The twin's example generator now rejects any synthetic string that *contains* a private value of 4 or more characters (the scan's own rule). Before, it rejected only exact matches. This is stricter, never looser.
  - Regression test: PRV-S15-005, with a fictional Meridian-like fixture. All three new tests fail on the previous code.
- **Freeze amendment.** `src/phantom/generate.ts` is pinned by the Sprint 12 Nano-value freeze, so the freeze was amended with `node scripts/freeze-nano-value.mjs --amend "…"` and the reason recorded. The change is proven output-neutral: synthetic examples are byte-identical before and after for every picker scenario (with and without twin overrides) and for the CRM demo. EVAL 84 / 84.
- **Offline check on the Meridian file (unchanged scan).** The package builds.
