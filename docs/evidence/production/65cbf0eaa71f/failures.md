# Production acceptance notes — 65cbf0eaa71f (Sprint 18F)

Deployed 2026-11-18 with the owner's approval of this exact SHA. Served `build-info.json` = 65cbf0eaa71f4634e3c65c5302fcdc060db5c0ab.

## Stale checks (no product defect)

The previous production release was `c7220768` (Sprint 17A). Sprint 18B (ADR 0018) changed the guided flow on purpose. That change had never been deployed, so three acceptance checks still described the 17A flow.

**Behaviour changed by Sprint 18B:**
- **withheld category names no longer block sending** (ADR 0018 §8; local E2E-183 "replaces the 17A rule");
- **the on-device mapping route is a collapsed "Advanced" section** (local E2E-180);
- **downloads live on the Deliver step.**

| Check | First result | Cause | Change |
| --- | --- | --- | --- |
| P-021 | FAIL: expected a blocking category notice | 17A rule | Now asserts the 18B rule: Approve is enabled, the request carries no category label, 0 requests |
| P-024 | FAIL: the question was hidden | the advanced section is collapsed | Opens "Advanced", and continues to Deliver before downloading |
| S14-REC-3 | FAIL, timeout at the share-categories checkbox (inside the collapsed section). **0 cloud requests sent**; Nano had completed | 18B layout | Opens "Advanced" to share; after the plan, answers the questions EYES asks from the demo's documented truth, as a user would |

After the changes:
- deterministic checks: **19 / 19 PASS** against the public URL;
- the real-model check is re-run **once**, using the release's single cloud request (unused by the first attempt).

No product code was changed and nothing was redeployed.

## S14-REC-3, second attempt (the release's 1 cloud request)

- **Result.** Real Gemini Nano completed in 31 s, with 0 cloud requests during it. Then **1** approved Gemini request went through production App Check: **0 leaks**, 1 question answered, outcome `PARTIALLY_VERIFIED` (3 transformed, 0 needing attention, structure verified, meaning `unknown`), understanding `nano-used`.
- **Failure.** The export step failed, which is harness staleness again: `exportAndVerify` looked for the export button on Verify, but it lives on Deliver since Sprint 18B. With Nano running, the 240 s test timeout was also too tight.
- **Declared before sending:** **1 additional cloud request** (within the "at most 2 more" rule) for a re-run with two changes:
  - `exportAndVerify` continues to Deliver;
  - the test timeout is 420 s.
- No product change.

## S14-REC-3, third attempt (declared 2nd additional request; the last one allowed)

- **Second attempt.** The hybrid path passed again: Nano in 29 s, 1 request, 0 leaks, outcome `PARTIALLY_VERIFIED`, `nano-used`.
- **What hung:** the export click. The category names had been shared, so the package export stays disabled until the explicit per-field label opt-in (`package-labels-include`, Sprint 15 privacy rule) is ticked. Local E2E-180 ticks it; the harness did not.
- **Declared before sending: 1 more cloud request** (the last of the 2 allowed) for a re-run that ticks the opt-in. No product change.

## Result: PRODUCTION_ACCEPTED (2026-11-18)

- **Deterministic checks:** 19 / 19 PASS (`browser-results.json`).
- **S14-REC-3 (third attempt): PASS.**
  - Real Gemini Nano (15 s), then 1 approved Gemini request through production App Check, with 0 leaks.
  - 1 question answered; outcome `PARTIALLY_VERIFIED`: 3 transformed, 0 needing attention, structure verified, `nano-used`.
  - Exported package: `node run.mjs verify` exit 0 in a clean directory.
- **Cloud requests during acceptance: 3** (the release's 1 plus the 2 declared re-runs). Each failure was harness staleness; no product defect was found.
