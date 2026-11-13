# Sprint 9 — Product completion, reliable hybrid experience, hackathon readiness

**Date:** 2026-11-13
**Branch:** `sprint-9`, from `origin/main` @ `2c593e7` (merge of PR #9, Sprint 8).
**Goal:** turn the validated prototype into a usable product: a developer can generate, inspect, verify, revise and **export** a privacy-aware integration, and a judge can understand it in three minutes.

## Outcome

| Gate | Status | Evidence |
| --- | --- | --- |
| A — portable export runs outside EYES, reproducibly, without private records | **PASS** | EXP-001…014 (system `unzip` + bare `node`, engine equivalence on fixtures and on real records via local bindings, tamper, privacy, byte-identical archives), E2E-090…092 (download from the real UI → run), live: 4 / 4 exports verified |
| B — provider failures are safe, understandable, recoverable; no approval bypass, no private-data fallback | **PASS (deterministic)**, live recovery **not exercised** (0 provider failures in 9 live requests) | REL-001…014, E2E-093…097 |
| C — understandable workflow with a usable final artifact | **PASS (internal audit)**; independent usability test **NOT PERFORMED** | [usability/README.md](../usability/README.md) |
| D — real, coherent, three-minute demo | **READY TO RECORD** (rehearsed live; not recorded) | [demo/hero-demo.md](../demo/hero-demo.md), live runs 1 and 3 |
| E — verified release artifact; reproducible, approval-gated deployment | **PASS** for the artifact; deployment **PENDING owner approval** | `build:release` + `verify:release` PASS; [deployment.md](../deployment.md) |
| F — hybrid value explained with limits visible | **PASS** | [evaluation/sprint-9-reliability.md §5](../evaluation/sprint-9-reliability.md) |

## What was built

### Export (Workstream A) — [contracts/export.md](../contracts/export.md), [ADR 0010](../decisions/0010-portable-integration-export.md)

- `src/export/runtime/runtime.ts`: a pure runtime over the app's own engine (`executeMappingBatch`, `validateContract`, `classifyRow`) plus alias binding. `scripts/build-runtime.mjs` bundles it into one committed, dependency-free `.mjs` with generated third-party notices. A freshness test fails on drift.
- `src/export/package/run.mjs`: the Node runner (`verify`, `fixtures`, `bindings-template`, `run`). Integrity is checked against the manifest. Bindings are validated before anything runs. Quarantined records are listed. Exit code 3 means "needs review".
- `src/export/package.ts`, `zip.ts`, `eligibility.ts`, `src/app/export-context.ts`: candidates derived from workspace state (the initial or the revised mapping, never promoted automatically). Eligibility is ground-truth blind. A value-free validation report, alias-level semantic declarations and a blocking privacy scan come before a deterministic ZIP.
- Export Contract **1.1.0** (1.0.0 still valid).
- The no-cloud path exports too: a hand-written contract is rewritten to aliases through the private bindings, and blocked if it uses unapproved labels or unknown fields.
- UI: **Export Integration** is the last action of the Reality Check step. It shows eligibility, reasons, what is never included, the contents, how to run, draft confirmation and the result with hashes.

### Reliability (Workstream B)

- Classifier: `PROVIDER_OVERLOADED` and `RATE_LIMITED`. Sprint 8's recorded `[500 ] … high demand` had been mislabeled `NETWORK`.
- `failure-guidance.ts` gives what happened / why it matters / what next for every category and stage, with raw provider text collapsed as local detail.
- Cloud mapping recovery: **Prepare a fresh request** builds a new preview with a new request id, and the user must approve it again. A manual fallback is one click away. **Stop waiting** discards a late answer and keeps the approval consumed. The pending state shows elapsed time and the 45 s limit, with no progress percentage.
- Revision failures are rendered as guidance. The budget is unchanged: a failed revision is never re-offered.
- Initial proposals use the per-operation response schema (selection in `response-schemas.ts`; the frozen `prompts.ts` is untouched).
- Runtime preflight on step 1 shows CONFIGURED / AVAILABLE / VERIFIED / UNAVAILABLE / UNVERIFIED and sends nothing.

### Product (Workstreams C, D)

The north-star tagline is now used everywhere. The landing path, step summary and a "Next" strip under the verdict lead to export. On-device failures gained why/next lines. Labels that called the inspected Sprint 8 holdout "independent" were corrected. Also delivered: hero demo runbook, judge evidence page, Devpost draft updated to measured claims, usability protocol and heuristic audit.

## Tests and evidence

| Suite | Baseline (`2c593e7`) | Sprint 9 |
| --- | --- | --- |
| lint / typecheck / build | PASS | PASS (generated runtime excluded from lint; verified by EXP-007) |
| unit | 170 | **217** |
| contracts | 32 | **43** |
| privacy | 60 | **66** |
| evaluation | 58 | **62** (EVAL-090) |
| E2E (Playwright, deterministic) | 75 | **89** |
| `build:release` + `verify:release` | — | **PASS** (clean tree, production, App Check debug off, SHA stamped) |

No existing assertion was weakened. Two tests changed deliberately: the smoke test follows the new tagline, and E2E-091 now expects the privacy scan to **block** a hand-written contract with unapproved labels before exporting it.

### Live (real Nano + real Gemini), predeclared 5 runs / ≤ 10 requests, no retries

See [evaluation/sprint-9-reliability.md](../evaluation/sprint-9-reliability.md):

- Runs 1, 3 (CRM) and 4 (support): `ACCEPTED`, exported `VERIFIED_WITH_EXCEPTIONS` (scenario quarantine policy), `node run.mjs verify` exit 0.
- Run 5 (support): `HUMAN_REVIEW_REQUIRED` → exported as a confirmed `DRAFT`, verify exit 0.
- Run 2 (CRM): the initial proposal mapped placeholder labels and was rejected unrepaired.
- 9 requests, 0 provider failures, 0 private terms in request bodies, about 2 s per request.
- Two spec failures in runs 4–5 were the live check's own false positive: `body` was matched inside the bundled ajv runtime. The spec was fixed and the evidence left unedited.
- A real preflight bug found live (on-device `UNAVAILABLE` before the probe returned) was fixed (REL-014).

### Simulated vs real

E2E-090…097 and the EXP/PRIV/REL tests use the labeled test adapter or deterministic code. They prove gates, wiring, export and recovery, not model quality. Recovery from real provider failures was **not** exercised live this sprint.

## Release and deployment

Read-only re-audit (2026-11-13): project and web app match; one Hosting site, `live` channel only, **no preview channels**; the site still serves Firebase's 404. App Check and reCAPTCHA settings were **not re-read** this sprint (no gcloud; credentials were not extracted from the CLI store). They were last verified on 2026-11-11 and must be rechecked before deploy. Nothing was deployed, no configuration was changed, nothing was published.

## Risks / rollback

- **Export portability:** Node ≥ 22 is required (ES2023, top-level await). The ZIP is about 0.4 MB, mostly ajv. Windows paths are untested.
- **Binding sensitivity:** the bindings file names source fields. It stays in the destination environment and is never exported, and the README warns about it.
- **Approved labels** may appear in a package (they were already disclosed); unapproved ones block the export. The scan is a substring and exact-match heuristic: zero findings is evidence, not proof.
- **Provider:** availability is not controllable. The Sprint 9 window was quiet; Sprint 8's was not.
- **Holdout:** inspected; no new generalization claim is made.
- **Rollback:** revert the Sprint 9 merge. Export 1.1.0 is additive; no state migration is needed. Hosting rollback is unchanged ([deployment.md](../deployment.md)).

## Sprint 10 / submission readiness (not started)

1. Owner approves the deploy SHA and re-reads App Check and reCAPTCHA settings, then option B (optionally C first). Run the post-deployment checklist in [deployment.md](../deployment.md).
2. Hosted verification on the approved domain in a normal Chrome window, including an export run on another machine.
3. Record the hero demo ([demo/hero-demo.md](../demo/hero-demo.md)) in a quiet provider window; genuine results only.
4. Independent usability test with ≥ 3 developers ([usability/README.md](../usability/README.md)).
5. Owner decisions: repository visibility, YouTube upload, Devpost submission after resolving every `TODO` in [submission/devpost-draft.md](../submission/devpost-draft.md) against the Official Rules.
