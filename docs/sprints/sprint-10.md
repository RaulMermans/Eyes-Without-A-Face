# Sprint 10 — Experience architecture, Live Intelligence Runtime, Black Halo

**Date:** 2026-11-13
**Branch:** `sprint-10`, from `origin/main` @ `86ee30a` (merge of PR #10, Sprint 9).
**Goal:** make the existing hybrid workflow feel simpler than the technology underneath it. Organize it as **CONNECT → OBSERVE → OUTCOME**, make the run observable from canonical state, and evolve the identity into **Black Halo**. No new AI, no new contracts, no change to any gate.

## Outcome

| Gate | Status | Evidence |
| --- | --- | --- |
| Actual UX audit before redesign | **DONE** | [design/sprint-10-experience-audit.md](../design/sprint-10-experience-audit.md); 28 + 1 screenshots and metrics in `design/screenshots/sprint-10-before/` |
| Two directions explored, one selected with reasoning | **DONE** | [design/exploration/](../design/exploration/), [ADR 0011](../decisions/0011-experience-architecture-black-halo.md) |
| A — CONNECT / OBSERVE / OUTCOME over the unchanged state machine | **PASS** | E2E-100, E2E-102, E2E-104 |
| B — runtime is understandable and reflects canonical state only | **PASS** | RT-001…008 (14 unit), E2E-101, E2E-107, live S10-HERO |
| C — outcome understandable; export without an unrelated screen | **PASS** | E2E-100, E2E-103, export E2E-090…092 (export now in OUTCOME) |
| D — Black Halo derived from the existing emblem; contrast AA | **PASS** | [design-system.md](../design/design-system.md) (measured ratios) |
| Privacy gates unchanged; no new disclosure | **PASS** | PRV-RT-001/002, all Sprint 1–9 privacy suites, live: 0 private terms in 2 request bodies |
| Responsive + keyboard + reduced motion | **PASS (automated)**; screen reader **UNVERIFIED** | E2E-105 (4 widths × 3 modes), E2E-058, E2E-101, E2E-106 |
| F — independent usability validation | **NOT PERFORMED** | [usability/README.md](../usability/README.md): protocol adapted, no participants |
| Real inference requalified on the new journey | **PASS (1 run)** | [evidence/sprint-10/live-experience.json](../evidence/sprint-10/live-experience.json) |

## Experience architecture

The modes are UI navigation (`src/app/experience.ts`); workflow state is unchanged. Every canonical stage maps to a moment:

| Moment | What the user does | Canonical stages and state it composes |
| --- | --- | --- |
| **CONNECT** | Choose a source (fictional CRM demo, a file, paste, or advanced scenarios). Choose a destination (preset or custom JSON Schema). Press **Build Integration** | Source import · profile (derived) · twin (derived) · destination text. Build Integration then validates the destination and runs `prepareDisclosureReview` (local). |
| **OBSERVE** | Watch the run, read why it is waiting, inspect any stage, act in the workbench | All five workbench stages (Source, Phantom Twin, Disclosure Review, Cloud Mapping, Reality Check incl. semantic verification and blind revision), plus the 17-stage runtime, the trust ledger and the timeline |
| **OUTCOME** | Read the verdict, evidence, before/after and privacy outcome; **Export Integration** | `exportCandidates` → `exportEligibility`, `summarizeOutcomes`, `decideRevision`, `diffContracts`, `ExportPanel` (unchanged) |

**Build Integration** stops at the first decision that needs the user: the disclosure approval. If a preview already exists, Build reuses it rather than replacing a pending request (E2E-100b). It never approves, never sends, and never starts Gemini Nano, which reads private context and stays a user action on the Phantom Twin stage.

## Live Intelligence Runtime

- `src/app/runtime-model.ts` is a **pure** derivation. Its inputs are workspace state, the prepared twin, this run's safe workflow events (`subscribeWorkflowEvents` was added to the in-memory log), adapter availability and the local evaluators.
- It produces 17 stages: the 16 required stages, plus *Gemini revision request*, so that the second boundary crossing is visible.
- Every status comes from state:
  - Optional stages that did not run are `skipped` with a reason, never `completed`.
  - Unavailable Nano says "this session is not hybrid".
  - A semantic PASS over partial coverage is `requires-review`.
- Upstream invalidation clears the state the stages read, so dependent stages revert (RT-006, E2E-102).
- `RuntimeView` places each stage in its execution zone: This browser · **Your approval (the halo)** · Gemini Cloud.
  - Rows are keyboard-operable buttons. The inspector shows purpose, where it runs, who is responsible, what it reads and produces, validation, the measured duration, notes, and the next step.
  - The timeline shows codes, counts, durations and short hashes only.
- Workbench stages now open contextually from the runtime ("Open in the workbench"). The Integration Studio and every Sprint 6–9 panel are reused unchanged.

## Black Halo

- **Tokens.** Obsidian, Deep Ink, Iris Violet / Soft Violet, Halo Gold, Spectral White, a restrained cyan for synthetic, and distinct pass/warn/fail.
  - The token names are unchanged, so every component kept its semantic role.
  - All text pairs measure ≥ 4.5 : 1. The one failure found in review was violet buttons at 4.37 : 1; it was fixed by using white text (5.17 : 1).
- **Typography.** Plex Sans hierarchy for product UI. Plex Mono for readouts. Instrument Serif only for the landing headline and the Outcome verdict.
- **Brand.** The emblem asset is unchanged. The iris next to the OBSERVE headline mirrors the run state as a decorative mirror; the headline carries the meaning.
- **Motion.** Motion appears only while a stage is actually `running`, and is removed under reduced motion (E2E-106).

## Other changes

- `prepareDisclosureReview` (`src/app/disclosure-actions.ts`) is now the single implementation of "build the preview". `ReviewPanel` uses it, and destination notes moved into `ReviewState.targetNotes`.
- `TrustLedger` renders once, in the OBSERVE header. It was previously repeated on three steps (audit X8).
- `VerificationPanel` no longer embeds Export. Its "Next" strip and a closing button open the OUTCOME (X4, X13). The records grid aligns to content (X6).
- In CONNECT, "Advanced sources" holds the evaluation scenarios and edge cases without sprint jargon (X11). On narrow screens, a fixed bottom bar repeats **Build Integration** (testid `build-integration-mobile`).
- The visual capture harness walks the new journey, plus the hero revision, at four widths.

## UX audit resolution

| Finding | Status |
| --- | --- |
| X1 wizard as organizing idea | **Resolved:** three modes; stages are the OBSERVE workbench |
| X2 six clicks to the first decision | **Resolved:** demo → Build Integration = **2 clicks** (E2E-100) |
| X3 destination after twin | **Resolved:** CONNECT asks for both |
| X4 outcome buried at y = 2,941 | **Resolved:** OUTCOME mode; export is part of it |
| X5 three vocabularies | **Resolved:** one eligibility headline; Structure / Meaning / Records rows; unknown ≠ verified |
| X6 dead area | **Resolved** (`items-start`) |
| X7 process not observable | **Resolved:** runtime, inspector, timeline |
| X8 repeated ledger | **Resolved** |
| X9 on-device honesty | **Resolved:** skipped + reason; "not hybrid" when unavailable (E2E-107) |
| X10 mobile decision depth | **Improved:** "Review what crosses the boundary" sits directly under the headline. The 390 px OBSERVE page is long (≈ 5,600 px) because all 17 stages are listed; see Risks |
| X11 technical concepts early | **Resolved** (advanced sources, single engineering section) |
| X12 two visual products | **Resolved:** one obsidian surface |
| X13 "Next" points down | **Resolved** |

Before / after (full set in `design/screenshots/sprint-10-before/` and `sprint-10-after/`):

| Moment | Before | After |
| --- | --- | --- |
| Landing 1440 | [before](../design/screenshots/sprint-10-before/01-landing-1440.jpg) | [after](../design/screenshots/sprint-10-after/01-landing-1440.jpg) |
| Landing 390, first screen | [before](../design/screenshots/sprint-10-before/01-landing-390.jpg) | [after](../design/screenshots/sprint-10-after/01-landing-fold-390.jpg) |
| Source → CONNECT | [before](../design/screenshots/sprint-10-before/02-source-1440.jpg) | [after](../design/screenshots/sprint-10-after/02-connect-1440.jpg) |
| Review → OBSERVE at the approval | [before](../design/screenshots/sprint-10-before/04-review-1440.jpg) | [after](../design/screenshots/sprint-10-after/03-observe-awaiting-approval-1440.jpg) |
| Reality Check + export → OUTCOME | [before](../design/screenshots/sprint-10-before/08-reality-export-1440.jpg) | [after](../design/screenshots/sprint-10-after/07-outcome-1440.jpg) |
| Revision (hero) | — | [observe](../design/screenshots/sprint-10-after/09-observe-revised-1440.jpg) · [outcome](../design/screenshots/sprint-10-after/10-outcome-revised-1440.jpg) |
| Mobile approval | [before](../design/screenshots/sprint-10-before/04-review-390.jpg) | [after](../design/screenshots/sprint-10-after/03-observe-awaiting-approval-390.jpg) |

## Tests and evidence

| Suite | Baseline (`86ee30a`, verified) | Sprint 10 |
| --- | --- | --- |
| lint / typecheck / build | PASS | PASS (0 lint warnings) |
| unit | 217 | **231** (+ RT-001…008) |
| contracts | 43 | 43 |
| privacy | 66 | **69** (+ PRV-RT-001/002) |
| evaluation | 62 | 62 |
| E2E | 89 | **102** (+ E2E-100…107) |
| `build:release` + `verify:release` | PASS | see the release section in the PR (run on the committed tree) |

**Changed tests.** Existing E2E tests were changed only in how they navigate:

- `openStage` opens OBSERVE, then picks the stage in the `Workflow` nav (scoped, because runtime rows are buttons too).
- `openOutcome` reaches Export.
- Two heading checks (E2E-036, E2E-058) now use `exact: true`, because the runtime headline can also contain "Phantom Twin".
- The smoke test asserts the `Experience` nav, where the Workflow nav used to be on first paint.
- E2E-040 checks that the demo lands in CONNECT and that OBSERVE shows the source as done.

No assertion about privacy, gates, verdicts or export content changed.

**Live requalification (real Nano + real Gemini), predeclared budget 1 run / ≤ 2 requests.** `tests/live/sprint10-experience.spec.ts` on `crm-eu-accounts`, 2026-11-13. The spec recorded:

- 6 / 6 Nano rows real on-device; 1 suggestion applied.
- Build Integration sent **0** requests.
- The runtime at approval matched state; every stage after the authorization was `not-started`.
- Real Gemini answered in 4.9 s with a valid proposal (the runtime read `real Gemini output · IN_CLOUD`).
- The semantic mismatch was detected (stage 11 `failed`).
- One approved revision came back `ACCEPTED`.
- OUTCOME `VERIFIED_WITH_EXCEPTIONS`; the revised package exported; `node run.mjs verify` exit 0.
- **2** cloud requests, **0** private terms in request bodies.

One run is a requalification of the new UI path, not a reliability measurement. Sprint 9's 5-run figures remain the reliability evidence.

## Risks and limits

- **Mobile length.** OBSERVE at 390 px lists all 17 stages (honest, but long). Collapsing not-started stages is a P1 candidate.
- **Nano after Build.** Applying a Nano suggestion after Build Integration changes the twin and, by the existing rules, clears the prepared request. The hero runbook therefore interprets on-device first.
- **Event-backed stages.** On-device and Export statuses come from the in-memory safe log, scoped to the current source load. A page reload starts a new run (nothing persists, by design).
- **Assistive technology.** Screen-reader behaviour was checked only structurally (roles, names, live region). No manual NVDA / VoiceOver pass was possible in this environment: **UNVERIFIED**.
- **Usability.** Independent usability testing was **NOT PERFORMED**.

## Not done (explicitly)

No deployment, no video, no Devpost submission, no merge. Sprint 11 was not started.
