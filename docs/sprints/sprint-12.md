# Sprint 12 — Final competition readiness: production, hybrid value, demonstration, submission

**Date:** 2026-11-13
**Branch:** `sprint-12`, from `origin/main` @ `b93e3ed` (merge of PR #12, Sprint 11).
**Goal:** a release and evidence sprint. Ship the product publicly, validate it under real conditions, answer what local AI adds, and prepare a submission that withstands scrutiny. Feature freeze: no new agents, providers, DSL operations, orchestration, backend or memory. No gate changed.

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| A — public URL completes CONNECT → OBSERVE → OUTCOME → EXPORT with genuine inference | **VERIFIED** | Owner-approved deployment of `b93e3ed`; 2 / 2 hosted runs with real Nano and real Gemini through production App Check; [deployment.md](../deployment.md) |
| B — independent developers tested EYES | **NOT PERFORMED** | No participants could be recruited or observed by the agent; kit updated for remote sessions on the public build ([usability/README.md](../usability/README.md) §6) |
| C — clear, reproducible answer about Nano's contribution | **VERIFIED: neutral** | Pre-registered experiment, 6 cloud requests, replayed by EVAL-122; [evaluation/sprint-12-nano-value.md](../evaluation/sprint-12-nano-value.md) |
| D — a non-specialist understands the failure EYES detects | **READY** (team judgment; not user-tested) | [submission/business-impact.md](../submission/business-impact.md), hosted screenshots |
| E — truthful three-minute demonstration | **SCRIPT READY**; **NOT RECORDED**, not uploaded, not verified | [demo/hero-demo.md](../demo/hero-demo.md), [demo/captions.srt](../demo/captions.srt) |
| F — complete, evidence-backed submission | **READY FOR OWNER REVIEW**; **NOT SUBMITTED** | [submission/devpost-draft.md](../submission/devpost-draft.md), [hackathon-requirements.md](../hackathon-requirements.md) |

## Starting state (verified)

`origin/main` = `b93e3ed`. The baseline reproduced exactly: lint and typecheck clean, 251 unit, 43 contract, 69 privacy, 62 evaluation, 113 E2E: **538**. `https://eyes-without-a-face-b7281.web.app` returned Firebase's 404 (never released). The repository was already **public** with Apache-2.0 detected (earlier docs said private).

## A — production deployment and hosted acceptance

1. **Read-only preflight.** Project, web app, Hosting channel and billing (not enabled) re-read. **App Check enforcement verified for the first time since Sprint 5:** a Firebase AI Logic request with the public API key and no App Check token is refused with `401 "Firebase App Check token is invalid."` before any inference. reCAPTCHA domains were not re-read (no gcloud; no token minting).
2. **Artifact.** Full regression, then `build:release` + `verify:release` PASS on `b93e3ed`. The debug token was absent from `dist` and from every commit in history.
3. **Approval.** The owner received the approval package (URL, SHA, project, App Check, no config changes, impact, rollback) and approved "live deploy" of exactly `b93e3ed`.
4. **Deployed** with `firebase-tools@15.35.0 deploy --only hosting`. No App Check, reCAPTCHA, billing or permission change.
5. **Hosted acceptance:** all 10 checks VERIFIED (table in [deployment.md](../deployment.md)).
   - Build SHA and footer match. HTTPS with HSTS. 0 requests before approval.
   - Real Gemini `IN_CLOUD` in 2.4–2.5 s. Nano 6 / 6 `real on-device`.
   - Chromium-without-Nano and Firefox degrade honestly.
   - Revision `ACCEPTED` in 2 / 2 runs; export `node run.mjs verify` exit 0 in 2 / 2.
   - 0 private terms in 4 request bodies.
   - Attestation was production reCAPTCHA Enterprise with no debug token.

New tooling: `playwright.hosted.config.ts` (refuses a debug token), `tests/live/hosted-degradation.spec.ts`, and opt-in screenshots in the hero spec (`EYES_LIVE_SCREENSHOTS`).

## B — independent developer validation

**NOT PERFORMED.** No external developer used EYES during the sprint. The facilitator kit now targets the public URL (no install), adds remote-session guidance, timing measures and a recruitment note. No participant data exists in the repository. Automated runs are not presented as usability evidence.

## C — what does Gemini Nano add?

A fresh fictional scenario, `crm-nl-relations` (Dutch CRM → helpdesk requesters), aims at the two things Nano's validated output can change:

- the **role** of non-English fields (`bedrijf` vs `contactpersoon`, both generic `text` to the English rules);
- the **order** of ambiguous dates (`sinds`, day-first).

Ground truth, hypotheses, budget and input hashes were frozen and committed (`05343e8`) before any model saw the scenario.

| | Result |
| --- | --- |
| A vs B (local) | Nano labelled `bedrijf` organization and `contactpersoon` person-name in 3 / 3 runs; 8 / 8 applicable suggestions matched ground truth; 5 wrong suggestions blocked by validation; date order resolved 0 / 3; median 17.9 s |
| C vs D (downstream) | Mappings **identical** in 3 / 3 pairs; holdout correct transformations 0 vs 0 (Δ 0, 0, 0); every run parsed dates month-first; the local verifier flagged 3 / 3 wrong dates in all 6 runs, 0 false alarms |
| Classification | **Neutral**: correct private understanding, no measured accuracy gain. In C, Gemini assigned the indistinguishable fields correctly because alias order matched destination order (not tested in reverse) |
| Budget | 6 / 6 cloud requests, 3 / 3 Nano runs, 0 provider failures, no retries |

**Privacy finding, traced.** The live body scan matched `partner` in the three D requests and failed those runs (kept as recorded). The match is the fictional twin example "Copperfield Partners", drawn once Nano's organization role is applied. The source value `partner` exists only in hidden sets the twin never reads. EVAL-122 pins the trace. This is a scanner false positive, documented as a limitation.

## D — business impact

[business-impact.md](../submission/business-impact.md) narrates one real failure from the hosted app:

- `03/02/2026` (3 February) is read month-first. The engine writes `2026-03-02`, which is schema-valid and wrong; days > 12 are refused.
- The failure is caught locally and corrected by one approved blind revision: transformed **0 → 7**, no regressions, 1 record quarantined and not counted.
- The page explains what that means for tenure, renewals, SLAs and audits, and states what is not claimed: no savings, no adoption, no user results.

## E — demonstration

The final storyboard and script follow the brief's timeline on the hosted build, with on-screen actions, narration and captions (SRT). It includes:

- a recording checklist and evidence-integrity rules (one continuous take, labeled cuts and speed-ups);
- provider-failure handling;
- a YouTube description template;
- seven real hosted-run screenshots. One blank capture was discarded, and the Reality Check screenshot is captioned as the stage, not the failure.

Status: SCRIPT READY · NOT RECORDED · NOT UPLOADED · NOT VERIFIED.

## F — competition compliance

- **Official Rules read in full** for the first time (HTTP 200; 403 in earlier sprints). [hackathon-requirements.md](../hackathon-requirements.md) records the deadline (2026-11-30 2:00 PM PT), requirements, judging criteria and a compliance table.
- **Pre-existing work corrected.** The period opened 2026-11-11 21:30 UTC (22:30 CET). Sprints 3 and 4 (incl. first real Nano and cloud inference) were committed *before* that and are now disclosed as pre-existing. In-period work since `e1d4b03`: +18,946 / −1,006 hand-written source lines. No history was rewritten. README no longer says "built during the hackathon period".
- **API key.** The rules forbid production API keys in the repository. The literal web API key and site key were replaced by placeholders in `docs/setup/firebase.md`. The key stays in Git history and in the deployed bundle by design, protected by enforced App Check. Restriction or rotation is an owner decision.
- **Devpost draft** rewritten with all required sections, testing instructions, the routing-by-sensitivity explanation (the challenge text describes availability fallback; EYES deliberately does not fall back), the Nano finding and the in-period summary.
- **Evidence page** rewritten for judges: production, real inference, the Nano experiment, privacy and deterministic proofs, limits.

## Changes to the application

One: the Source step's scenario picker also lists `crm-nl-relations` (`EXPERIMENT_SCENARIOS` in `src/evaluation/scenarios.ts`, used by `SourcePanel`). The frozen Sprint 8 set (`EVALUATION_SCENARIOS`) and its replay are unchanged. No engine, contract, gate, prompt or verifier change. The deployed `b93e3ed` does not include the extra scenario; redeploying is optional.

## Tests and evidence

| Area | Evidence | Result | Status |
| --- | --- | --- | --- |
| Lint / typecheck | `pnpm lint`, `pnpm typecheck` | 0 warnings, 0 errors | **VERIFIED** |
| Unit / contract / privacy | `pnpm test:unit`, `:contracts`, `:privacy` | 251 / 43 / 69, unchanged | **VERIFIED** |
| Evaluation | `pnpm test:evaluation` | **84** (62 + 22: EVAL-120 validity and freeze, EVAL-121 configuration A, EVAL-122 replay and privacy trace) | **VERIFIED** |
| E2E | `pnpm test:e2e` | 113, unchanged | **VERIFIED** |
| Total | — | **560** | **VERIFIED** |
| Visual regression | `pnpm test:visual` | capture 6 / 6 and OBSERVE probe pass; `audit-probe` fails identically on `main` (a Sprint 10 probe of the pre-OUTCOME flow, waits for `export-panel`): **pre-existing**, not a Sprint 12 regression. Picker at 390 / 1440: no overflow | **VERIFIED** (with one pre-existing failure) |
| Release artifact | `build:release` + `verify:release` | PASS on `b93e3ed` (deployed); re-run on the Sprint 12 head before the PR | **VERIFIED** |
| Hosted verification | 10-point checklist | All pass | **VERIFIED** |
| App Check | tokenless probe; production attestation | 401 without token; reCAPTCHA succeeds on `web.app` | **VERIFIED** |
| Real inference (hosted) | 2 runs | Nano 6 / 6, Gemini valid, revision `ACCEPTED` ×2 | **VERIFIED** (2 runs; not a reliability measure) |
| Unsupported browsers (hosted) | Chromium 158 without Nano, Firefox 159 | honest deterministic path, 0 requests, 0 errors | **VERIFIED** |
| Export execution | hosted runs | `node run.mjs verify` exit 0, 2 / 2 | **VERIFIED** |
| Nano comparison | 3 paired trials, frozen | Neutral | **VERIFIED** |
| Privacy (live) | 10 request bodies | 0 private source values; 3 scanner matches traced to a fictional example | **VERIFIED** (with explained false positive) |
| User testing | — | — | **NOT PERFORMED** |
| Screen reader | — | — | **NOT PERFORMED** |
| Demo video | — | script ready | **NOT RECORDED** |
| Devpost | — | draft ready | **PENDING** (owner) |

Environment for real runs: Linux, Chrome 157 with the dedicated Nano profile, `gemini-3.5-flash-lite`, Firebase AI Logic. Hosted runs used no debug token; the experiment used the registered debug token on localhost.

## Risks and rollback

- **Usability (high).** No independent participant. All UX claims are team judgment plus automated checks.
- **Provider.** Two hosted and six experiment requests succeeded, but Sprint 8 saw a third of requests fail. Film with time to spare.
- **reCAPTCHA scoring.** Automated hosted runs passed attestation; a human recording in a normal Chrome window is expected to pass too, but a low score fails closed with `APP_CHECK_REJECTED`.
- **Quota.** Spark plan, no billing. Judges' use runs on the free tier through 2026-12-16.
- **Eligibility.** The rules require significant updates during the period. The evidence is strong, but the judgment belongs to the sponsor. The owner must confirm no Contest Entity or government employment and no Google/Devpost support.
- **API key in history.** Mitigated (removed from the tree, App Check enforced); restriction or rotation is open.
- **Nano narrative.** Neutral result; the submission says so. A judge expecting `PREFER_ON_DEVICE` fallback needs the routing-by-sensitivity explanation.
- **Rollback.**
  - Hosting: `hosting:disable` (back to never released) or Console rollback.
  - Code: revert the Sprint 12 merge; no data migration.

## Not done (explicitly)

No usability session, no screen-reader pass, no video recording or upload, no Devpost submission, no API-key restriction or rotation, no reCAPTCHA/App Check/billing change, no merge, no second deployment. Sprint 13 was not started.
