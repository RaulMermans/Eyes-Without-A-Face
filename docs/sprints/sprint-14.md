# Sprint 14 — Guided reliability, intelligent recovery and production acceptance

**Date:** 2026-11-14
**Branch:** `sprint-14-guided-reliability`, from `origin/main` @ `a548d7f` (merge of PR #14, Sprint 13).
**Goal:** make the guided product work for a first-time user when Gemini succeeds, explain itself when it fails, and recover without losing work or weakening a gate. Make production acceptance a permanent part of done.

Decision: [ADR 0013](../decisions/0013-guided-recovery-and-production-acceptance.md). Standard: [deployment.md § Production acceptance standard](../deployment.md#production-acceptance-standard-permanent).

**Release status: `DEPLOYED_UNVERIFIED`.**

- **Deployed:** `95a9564c90efd97085dea420b5dca3d62ff265cf`, with the owner's explicit approval of that exact SHA (2026-11-14, about 06:47 UTC).
- **Passed:** every deterministic production check (17 / 17) and real Gemini Nano on the hosted build.
- **Not verified:** the real cloud happy path on the hosted build. Automated sessions were refused at the App Check exchange (HTTP 403); the app failed closed and sent nothing. One human run completes acceptance.

## Starting state (verified)

- `origin/main` = `a548d7f`; CI green on `main` (run 43500838666).
- `https://eyes-without-a-face-b7281.web.app/build-info.json` serves `a548d7f…` (production, `appCheckDebug: false`, built 2026-11-13T20:39:52Z). The Sprint 13 build was deployed after its report; no production acceptance was recorded.
- Baseline: 654 tests (320 unit, 43 contract, 78 privacy, 84 evaluation, 129 E2E). All passed before any change.

## A — The production incident

### Reproduction (REAL Gemini, guided UI, fictional CRM)

| Destination | Runs | Result | Stage · code |
| --- | --- | --- | --- |
| Helpdesk (default) | 3 (incl. S14-REC-1 first send) | **refused 3 / 3** | `convert` · `INVALID_ENUM_MAPPING` |
| Marketing | 1 | **refused 1 / 1** | `convert` · `INVALID_ENUM_MAPPING` |
| Billing | 1 | accepted, Draft | — |

For each refused answer:

- **Provenance:** `IN_CLOUD`, HTTP 200, `finishReason STOP`, about 2.3–2.8 s.
- **Shape:** parseable JSON with only supported operations; every alias existed.
- **The defect:** `map_enum` was keyed on `category_a / category_b / category_c`. Aliases never resolved, because conversion stopped first. Nothing ran on any record.

Evidence: [evidence/sprint-14/guided-diagnosis.json](../evidence/sprint-14/guided-diagnosis.json). The answers are replayed offline in `tests/unit/sprint14-recovery.test.ts` (S14-001…005).

### Root cause

- **Faulty component: the guided product flow (UI).** It is not the validator, the parser or the prompt.
- **Mechanism.** The guided flow builds the twin with no overrides, and never offers the existing per-field "share category names" decision. So `account_state` is disclosed as "category labels withheld", with placeholders in the examples.
- **Why the destinations fail.** Helpdesk (`status`) and Marketing (`lifecycleStage`) *require* a value from a fixed list. No valid mapping exists for that request: a guessed `map_enum` is refused (correctly), and leaving it out makes every record fail the required field.
- **Contributing:** model quality. Gemini keyed on placeholders despite "Use map_enum only with source labels listed in a field's enumValues". A better prompt cannot fix this; the information is missing.
- **The UI made it worse.** "Needs your attention", plus "Prepare a new request", re-offered **the identical request**, which fails the same way.
- **Privacy boundary:** unchanged. The validator was right to refuse.

### Failure taxonomy (existing codes only)

`diagnoseRejectedProposal` maps the existing `ProposalIssueCode` and `ResolutionIssueCode` values to nine kinds:

- withheld categories;
- unknown category;
- unknown source field;
- unknown destination field;
- duplicate destination;
- unsupported operation;
- invalid parameters;
- unreadable answer;
- request mismatch.

Provider failures keep the Sprint 9 `guidanceForFailure` categories: timeout, overloaded, rate limit, App Check, invalid response, model unavailable, not configured, network, cancelled. Rejection by the user stays `rejected`. No parallel classification was created.

## B — Recovery

| Before | After |
| --- | --- |
| "Needs your attention" for any failed stage | The status names the problem. For example "One field couldn't be matched" or "We couldn't build this integration" for a refused answer. A provider failure uses its classified title ("Gemini is overloaded right now") |
| Two lines and "Prepare a new request" | **What happened · Why it was refused · What was protected · What you can do**, then issue codes under a collapsed "Technical details of the refusal" |
| The identical request re-offered | **Withheld categories:** the identical request is *not* offered ("Sending the same request again would fail the same way"). "Share these names and prepare a new request" is offered, listing the user's category names and a rare-label warning. It applies `applyTwinOverride` (invalidating downstream) and builds a NEW preview; nothing is approved or sent |
| — | **Other kinds:** "Ask Gemini again (new approval)", at most once per identical request content (`ASK_AGAIN_LIMIT = 1`, counted from hashed telemetry), then "change an input" |
| `prepareFreshReview` failure ignored (dead button) | Shown as `guided-recovery-error`, with links to data, destination and technical details |
| — | **Before sending:** the Destination step shows the per-field category opt-in (off by default) when the destination needs it; the approval card warns that the request cannot produce a usable integration yet |

- **Deterministic correction: none added.** The observed failure is not repairable without guessing. No other recorded failure has a provably meaning-preserving repair. The "never repair model JSON" rule stands (ADR 0013 §2).
- **Cloud correction:** the fix is in the inputs, so recovery is a fresh, exact, re-approved request. No new feedback contract, no extra agent, no automatic retry.
- **Progress kept:** the source, destination, twin decisions and runtime events stay. Approvals are invalidated by any input change.

## C — First-time-user audit and fixes

| Area | Finding | Status |
| --- | --- | --- |
| C2 destination | **Confirmed stale state.** In "Your own", an invalid or unapplied edit left the previous schema active and summarised, and Build used it. Selecting "Your own" with an empty editor kept the previous example | **Fixed.** Build validates and applies the schema on screen or refuses with a reason. The summary is hidden while edits are unapplied. `aria-invalid` is set (E2E-145) |
| C2 (found by test) | Clicking Build blurred the editor; the blur applied the schema, the summary appeared and pushed the button down, and the click missed | **Fixed:** blur no longer applies; Build does |
| C3 Nano | Availability was hidden inside a collapsed section. Nothing said whether Nano had run. "Next" stayed enabled while Nano was still running, so a run could finish after the request was built (found by the real S14-REC-3 run) | **Fixed.** Visible availability line (including "checking"). "Next" is held while on-device analysis runs. The result's "How your fields were understood" line reads `nano-used` / `nano-available` / `nano-unavailable` / `nano-failed` / `simulated`, from the runtime stage only; a simulated run is never called Gemini Nano |
| C1 REST | A read was not described as a snapshot | **Fixed:** "a one-time snapshot… later changes in the API are not picked up" |
| C4 progress | Status had no wrong-state cases left after the change; no percentages. "Needs your attention" removed for proposal and provider failures | Done |
| C5 result | Transformed vs meaning was implicit | One sentence: transformed = a valid destination record; meaning is the separate check. Draft stays Draft |
| C6 exports | The transformed-data download was hidden inside "Preview" | A **Downloads** section with two labelled cards: transformed data (your records, local) and reusable integration (.zip, no records) |
| C7 interruption | Reload silently lost everything | `beforeunload` warning while a source is loaded, plus "Nothing is saved" on the data step. Still no persistence (E2E-148) |

## D — Accessibility

- Failure, recovery and status messages use `role="alert"` / `role="status"`. The invalid schema textarea is `aria-invalid` with `aria-describedby`. The new controls are native buttons and checkboxes.
- No horizontal scroll at 390 px; checked by E2E and on production (P-030). Reduced motion is unchanged.
- **Manual screen-reader pass: NOT PERFORMED.** No WCAG conformance is claimed.

## E — Production acceptance standard (permanent)

- **Rules:** AGENTS.md "Release lifecycle and production acceptance". **Procedure:** deployment.md. **Pointer:** CLAUDE.md.
- **Statuses:** `CODE_READY → DEPLOYMENT_PENDING → DEPLOYED_UNVERIFIED → PRODUCTION_ACCEPTED`, or `RELEASE_FAILED`.
- **`pnpm test:production`** (`playwright.production.config.ts`, `tests/production/`): P-001…P-031, deterministic, against the public URL only. It refuses a debug token and localhost, asserts zero `generateContent` calls, and writes `browser-results.json`, `release-manifest.json` and screenshots.
- **`pnpm test:production:real`** (`playwright.production-real.config.ts`): S14-REC-3, one hybrid happy path. Real Nano, then one approved request, then export and `node run.mjs verify`.
- **Exercised safely on the live `a548d7f`:** 16 / 17 PASS.
  - Identity, assets, App Check enforced (HTTP 401 without a token), the four source formats, the approval gate, Firefox, mobile and keyboard all pass.
  - **P-021 FAIL:** no category readiness on that build.
  - Record: [evidence/production/a548d7fbd7b8/](../evidence/production/a548d7fbd7b8/).

## Tests & evidence

| Suite | Sprint 13 | Sprint 14 | New |
| --- | --- | --- | --- |
| Unit | 320 | **339** | S14-001…032 (19) |
| Contracts | 43 | **43** | — |
| Privacy | 78 | **83** | PRV-S14-001…005 |
| Evaluation | 84 | **84** | — (frozen; unchanged) |
| E2E | 129 | **139** | E2E-140…148 (10) |
| **Total** | **654** | **688** | +34 |

- **Unchanged:** all existing assertions. No test was weakened, skipped or amended, and no frozen file changed.
- **Harness additions (test-only):**
  - per-call simulated outputs (`cloudOutputs`);
  - a `beforeunload` handler that E2E-148 asserts.
- **Real-model evidence:** [evidence/sprint-14/README.md](../evidence/sprint-14/README.md) has the ledger.
  - **7 cloud requests against a declared cap of 6. Exceeded by one** because of a counting error, reported.
  - One real Nano qualification with 0 cloud requests.

## Risks

- **Category names are a real disclosure.** They are values from the user's records. Sharing is explicit, per field, visible in the exact prompt and warned for rare labels. A user can still share a sensitive label.
- **Draft results.** In the guided flow, meaning is "not verified" unless trusted constraints exist. Users may read Draft as failure. That is honest, but it is an unvalidated UX risk.
- **Provider limits:** the free-tier quota, timeouts (Sprint 8 saw 5 / 8 revision timeouts), and reCAPTCHA scoring of automated sessions.
- **Not validated by people:** no participant sessions, no manual screen-reader pass.

## Rollback

- **Code:** revert the merge of this PR. The previous guided flow returns.
- **Hosting:**
  - *Today:* `a548d7f` is live and RELEASE_FAILED. The last `PRODUCTION_ACCEPTED` release is `b93e3ed`, available as Console → Hosting → release history → Rollback (approval needed).
  - *After a Sprint 14 deployment:* roll back to `b93e3ed` likewise if acceptance fails.

## Release, deployment and production acceptance

| Step | Result | Kind |
| --- | --- | --- |
| Full regression on `95a9564` | 688 / 688 pass, lint and typecheck clean | DETERMINISTIC |
| `pnpm build:release` + `verify:release` on `95a9564` (clean tree) | **PASS**: production, `appCheckDebug: false`, local debug token absent, 31 files, 2,599 KiB | DETERMINISTIC |
| Owner approval | Explicit approval of `95a9564…` for `live` (approval package: target, domain, SHA, artifact, no config change, impact, rollback) | — |
| Deploy | `firebase-tools@15.35.0 deploy --only hosting`: 31 files, release complete | — |
| Served build | `build-info.json` = `95a9564c90ef…`, footer `build 95a9564c90ef` | REAL |
| `pnpm test:production` | **17 / 17 PASS** (Chromium and Firefox): identity, assets, App Check enforced (401), JSON / CSV / XLSX / REST, invalid inputs, approval gate with 0 requests, category readiness (P-021, failed on `a548d7f`), navigation, mobile, keyboard | DETERMINISTIC (P-002, P-013 REAL network) |
| Real Gemini Nano on the hosted build | **PASS**: 6 / 6 fields, 15.2 s and 14.7 s, 0 cloud requests | REAL |
| Real Gemini Cloud on the hosted build | **NOT VERIFIED**: 2 automated attempts, both `exchangeRecaptchaEnterpriseToken` **403** → `APP_CHECK_REJECTED`, **0 requests sent**. The second was a diagnostic attempt declared before it ran. No further attempts | REAL |
| Production failure path | **PASS (real):** "App Check refused this app", nothing run, data kept, fresh request offered | REAL |
| Export run on the hosted build | NOT RUN (needs a cloud mapping); verified on the same code locally (exit 0) | REAL (local) |

Evidence: [evidence/production/95a9564c90ef/](../evidence/production/95a9564c90ef/) (`release-manifest.json`, `browser-results.json`, `inference-results.json`, `acceptance-results.json`, `failures.md`, `screenshots/`).

**Why not `PRODUCTION_ACCEPTED`:** the genuine cloud journey was not observed on the deployed build.

**Why not `RELEASE_FAILED`:**

- App Check is enforced and fails closed, which is correct.
- No configuration changed, and the same key served a human session on the previous build.
- The deterministic journey passes.
- The previous release is worse.

The most likely cause is a low reCAPTCHA score for automated sessions; this is inferred, not proven.

**To reach `PRODUCTION_ACCEPTED`:** one human run in a normal Chrome window, 1 cloud request ([failures.md, "Remaining check"](../evidence/production/95a9564c90ef/failures.md)).

**After this deployment:** the commits that record it change documentation and the live test spec only (attestation status codes in evidence). The deployed application code is `95a9564`. If PR #15 is merged, its merge SHA differs from `95a9564`. Deploying the merge SHA needs its own approval; the deployed content would be equivalent.
