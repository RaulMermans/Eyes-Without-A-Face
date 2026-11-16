# Sprint 15 — End-to-end experience, guided mapping and semantic trust

**Date:** 2026-11-16
**Branch:** `sprint-15-end-to-end-experience`, from `origin/main` @ `bfbf654` (merge of PR #15, Sprint 14).
**Goal:** an unfamiliar user completes a real integration without learning how EYES works internally — simple, without becoming technically dishonest.

Decision: [ADR 0014](../decisions/0014-target-first-mapping-and-local-meaning.md).

**Release status: `DEPLOYED_UNVERIFIED`.** `0a9d42a` (head of PR #16) was deployed on the owner's explicit instruction.

- **Passed on the public URL:** 19 / 19 deterministic checks, real Gemini Nano, and the exported integration run outside the app.
- **Not verified:** real Gemini Cloud. The automated session was refused at App Check (403), with 0 requests.
- **To finish:** one human run ([evidence](../evidence/production/0a9d42aeac68/acceptance-results.json)).

## Starting state (verified)

- **`origin/main`:** `bfbf654`. CI green on `main` (run 43567991795).
- **Production:** `build-info.json` serves `95a9564c90ef…` (production mode, `appCheckDebug: false`).
- **Missing record.** The Sprint 14 acceptance record (`cd2a904`: 17 / 17 deterministic checks, real Nano passed, real cloud refused at App Check for automated sessions) was on the Sprint 14 branch but not on `main`. It is carried onto this branch unchanged.
- **Baseline:** 688 tests (339 unit, 43 contract, 83 privacy, 84 evaluation, 139 E2E). All passed before any change.

## Verified UX problems (Phase 1)

| # | Problem | Evidence | Kind |
| --- | --- | --- | --- |
| 1 | `categoryNeed()` treated Helpdesk as ready when *any* category field was shared, related or not | code audit; S15-005 fails on the old rule | **bug** |
| 2 | With a realistic source, Helpdesk listed every category field for disclosure | production screenshot (owner); reproduced with a 13-category fictional source | **bug (UX)** |
| 3 | No guided way to say which field gives `status`, or what `pendiente` means | code audit: only the technical editor could do it | gap |
| 4 | The guided "Draft" on the demo came from the reserved edge-case test records (an email that is a number, a missing email), but read as if the user's records had failed ("2 record(s) are unresolved") | local run, screenshot | **bug (UX)** |
| 5 | "Meaning: not verified" with no explanation or action | Sprint 14 report risk; code audit | gap |
| 6 | Unknown category values were described as "held for review" on screen, but the strict policy counted them as failures | found while writing E2E-150 | **bug** (fixed in `guidedPolicy`) |
| 7 | The ZIP alone was the reusable outcome, and its bindings file had to be written by hand | code audit | gap |

## Changes

### A — Target-first questions (P0)

- **One question per fixed-list destination field.** "Which field in your data gives **status**?"
  - It offers up to three ranked candidates and "Choose another field". With one compatible field, it names it.
  - Candidates are ranked deterministically from structure: a short list of values, a count close to the number of allowed values, values spelled like allowed values, formats, unique codes, presence in every record. A similar name is shown as "a hint, not proof".
- **The disclosure checkbox appears only for the chosen field,** off by default, with the names and the rare-label warning. The 13-field list is gone.
- **Readiness is computed per destination field.** An unrelated shared field never satisfies a required field. Several required fixed-list fields are independent.

### B — Guided field mapping (P0)

- **Local translation table** (value → allowed value, or "Set aside for review").
  - Every value starts undecided.
  - Identical spellings are copied only on an explicit click.
- **"Field matches" table:** destination ← source, the rule in plain words, and the one missing answer (a field, a translation, or a date order).
- **The mapping summary is always visible** above "Build on this device".
- **Build on this device:**
  - It builds a Mapping Contract 1.0.0 from the user's answers only (existing operations).
  - It runs it through the existing hand-written route and the canonical engine.
  - It is labeled "built on this device from your answers — no AI". Nothing is sent, and it never needs an approval.
- **Overrides:** `applyFieldDecision` rebuilds a local result at once and clears any revision run. It never touches a prepared or approved cloud request.

### C — Actionable meaning (P0)

- **Each valid translation becomes a trusted user-declared `enum-meaning` constraint** for the **existing** verifier. It applies to the user's local mapping and to Gemini's.
  - A Gemini translation that agrees passes.
  - One that disagrees is `SEMANTIC_MISMATCH`: "Contradicts what you declared", with "Build on this device with your answers".
- **"Meaning, field by field"** says, per destination field, what EYES checked, what it cannot establish, and the one answer that would resolve it (translation or date order). Plain copies say honestly that only their format can be checked.
- **After an answer:** "Checked again: meaning is now verified for N of M fields (was K)", read from the canonical report.
- **The guided acceptance policy comes only from the user's translations.** Set-aside or unknown values are quarantined, never transformed. More than half set aside is never "ready".

### D — Outcome-first result (P0)

- **Order:** next step → counts → checks → plain-language "why it is a draft" → meaning → **Your data → destination** (up to three of the user's records, before and after, actual engine output, local only) → downloads → collapsed details.
- **Downloads:**
  - "Download transformed data (JSON)" is the primary action. One sentence separates it from the reusable integration.
  - An explicit opt-in puts category names into the .zip when a local mapping needs them. Without it, the unchanged privacy scan blocks the package.
  - An optional `bindings.local.json`, generated locally, lets `node run.mjs run` work on the user's files. It is never inside the .zip.
- **Fallbacks:** the on-device path is offered after a decline, a provider failure, a refused answer, and before sending a request that cannot work.

### E — Journey audit (P1)

- **Covered by tests:**
  - JSON, CSV and XLSX journeys (E2E-154);
  - a 13-category source (E2E-151);
  - a destination change and a field correction (E2E-151);
  - decline and refusal (E2E-153);
  - set aside (E2E-155);
  - mobile at 390 px (E2E-155);
  - keyboard (E2E-155).
- **Unchanged and still passing:** the Sprint 13 / 14 guided, recovery, Nano, REST and interruption behaviour (151 E2E).
- **Not done:**
  - a field-based editor for custom destinations (deferred);
  - session persistence (still none, by design);
  - hybrid mappings (Gemini plus local rules in one contract), which would need mixed-origin provenance (ADR 0014, deferred).

### F — Independent usability testing (P1)

**NOT PERFORMED.** No participant was available to the agent. Participants must not be simulated. A ready-to-run protocol, task, measures and fictional dataset are in [usability/sprint-15-protocol.md](../usability/sprint-15-protocol.md).

### Accessibility

- **Controls.** Questions are `fieldset` / `legend` with native radios, selects and checkboxes, each with an accessible name. Result sections have headings. "Checked again" is `role="status"`; the local-build blocker is `role="alert"`.
- **Layout.** No horizontal scroll at 390 px (E2E-155). The keyboard path works from question to translation to build (E2E-155).
- **Manual screen-reader pass: NOT PERFORMED.**

## Tests & evidence

| Suite | Sprint 14 | Sprint 15 | New |
| --- | --- | --- | --- |
| Unit | 339 | **360** | S15-001…021 |
| Contracts | 43 | **43** | — |
| Privacy | 83 | **89** | PRV-S15-001…004 (6 cases) |
| Evaluation | 84 | **84** | — (frozen, unchanged) |
| E2E | 139 | **151** | E2E-150…155 (12 cases) |
| **Total** | **688** | **727** | +39 |

- **Existing assertions:** no assertion was weakened, skipped or amended. No frozen file changed.
- **Production suite:** P-024 is new (local build, zero `generateContent`). It runs only against the deployed URL, after an approved deployment.
- **Model evidence this sprint:**
  - **Deterministic:** all of the above.
  - **Simulated:** the labeled test adapter in E2E.
  - **Genuine model runs:** **none**. No real Gemini Nano or Gemini Cloud request was made in Sprint 15.

## Risks

- **Usability.** Unvalidated by independent users. Translating many categories is manual by design (no guessing). The demo stays a Draft because of its reserved edge cases, now explained.
- **Semantics.**
  - Plain copies (id, email, organization) can only be checked for format. Their meaning stays "unknown"; that is honest, and visible.
  - A user can declare a wrong meaning. EYES verifies against the declaration, not against truth.
- **Privacy tradeoffs.**
  - Sharing category names with Gemini, or putting them in the .zip, is the user's explicit, per-field choice.
  - `bindings.local.json` contains field names, labeled as such.
- **Production blockers.**
  - The approved deployment of this SHA has not happened.
  - Real cloud inference on hosted builds is refused for automated sessions at App Check (Sprint 14 PF-1). A human run is required for `PRODUCTION_ACCEPTED`.

## Rollback

- **Code:** revert the merge of this PR. The Sprint 14 guided flow returns. No contract, schema, engine, runtime bundle or frozen benchmark changed.
- **Hosting (approval-gated):**
  - *Today:* `95a9564` stays live.
  - *After a Sprint 15 deployment:* if acceptance fails, roll back to `95a9564` (Console → Hosting → release history), or to `b93e3ed`, the last `PRODUCTION_ACCEPTED` release.

## Release verification

Recorded in the PR description and the final handoff: exact SHA, `build:release` / `verify:release`, and the deployment approval package.
