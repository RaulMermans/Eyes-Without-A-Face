# Sprint 11 — Release acceptance, usability validation and final experience polish

**Date:** 2026-11-13
**Branch:** `sprint-11`, from `origin/main` @ `522fa54` (merge of PR #11, Sprint 10).
**Goal:** prove that someone who did not build EYES can use it, and prepare the release. This is an experience and acceptance sprint. There are no new agents, providers, contracts, DSL operations, correction loops or infrastructure, and no gate changed.

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| A — independent usability validation | **OPEN: NOT PERFORMED** | No participants could be recruited or observed by the agent running this sprint. Facilitator kit: [usability/sprint-11-session-kit.md](../usability/sprint-11-session-kit.md). The results table in [usability/README.md](../usability/README.md) §5 is empty |
| B — compact runtime: current stage, location, action and completion without scrolling the runtime; all 17 stages inspectable | **PASS (automated + measured)** | E2E-110, RT-009/010; at 390 px the focus card is at y = 266 (the current row was at y = 1,067), and the next action sits in the first screen |
| C — the local-to-cloud transition is coherent without weakening consent | **PASS** | E2E-112/113, INV-001; live S11-HERO: Nano in CONNECT, 0 invalidations, approval still required |
| D — distinctive, coherent, faster to understand; accessibility preserved | **PASS (team judgment + automated)**; screen reader **UNVERIFIED** | Privacy Boundary, E2E-115, contrast table in [design-system.md](../design/design-system.md) |
| E — the developer understands what they received and how to use it | **PASS (automated)**; not yet user-validated | OV-001/002, E2E-114 |
| F — owner-approved deployment passed hosted acceptance | **PENDING: owner approval not given** | Read-only preflight and RC: [deployment.md](../deployment.md) |
| G — video script and submission materials complete and consistent | **Materials PASS**; video **NOT RECORDED**; Devpost **NOT SUBMITTED** | [demo/hero-demo.md](../demo/hero-demo.md), [submission/devpost-draft.md](../submission/devpost-draft.md) |

## Starting state (verified)

`origin/main` = `522fa54`. The baseline reproduced exactly: lint clean, typecheck clean, 231 unit, 43 contract, 69 privacy, 62 evaluation and 102 E2E tests, **507 in total**.

OBSERVE at the approval decision, measured by `tests/visual/observe-probe.spec.ts` ([before](../evidence/sprint-11/before/observe-metrics.json)):

| Width | Page height | Current stage row (y) | Next action (y) |
| --- | --- | --- | --- |
| 390 px | 5,638 px | 1,067 | 258 |
| 1440 px | 3,142 px | 709 | 116 |

The Sprint 10 open findings were confirmed in the code:

- All 17 rows rendered at equal weight at every width.
- Nano was reachable only through the Phantom Twin stage after "Step through". Applying a suggestion after Build cleared the request silently.
- The OUTCOME headline could read "Verified locally." for `VERIFIED` evidence whose meaning was unchecked or partly unknown. The state itself was correct.
- After export, the guidance was a single line.

## Changes

### B — compact OBSERVE

- **Focus card** (`runtime-focus`). It shows:
  - *Now*: the stage number of 17, the status in words, where it runs and the safe summary;
  - *Why it stopped* or *Needs your review*, when the stage failed or needs review;
  - *Last completed*;
  - *Next*, with **one** primary action whose label names it: "Review what crosses the boundary", "Send the approved request", "Run the Reality Check", "Prepare a fresh request", and so on.

  The next action can come from a later stage. For example, after a validated mapping it is the Reality Check.
- **Five phases** (`RUNTIME_GROUPS`):
  1. Understand locally
  2. Cross the boundary
  3. Verify locally
  4. Blind revision · optional
  5. Outcome and export

  Each heading shows a status tally. At ≥ 1024 px every phase is open: the rich view, with the three-zone lanes kept. Below that width, only the phase holding the current stage opens. The other phases are buttons with `aria-expanded`, and their stages stay in the DOM (`hidden`). The inspector's facts and the activity timeline collapse on phones.
- **Pure helpers only.** `groupTally`, `lastCompletedStage`, `nextStep`, `actionLabel` and `boundaryState` read `deriveRuntime`'s output. No stage, status, event or duration was added.
- **Timeline honesty.** An `ON_DEVICE_BLOCKED` capability check now reads "On-device AI unavailable in this browser", not "did not succeed". Real on-device failures still say they failed (RT-012).

After ([after](../evidence/sprint-11/after/observe-metrics.json)):

| Width | Page height | Focus card (y) | Next action (y) | Runtime list height |
| --- | --- | --- | --- | --- |
| 390 px | **4,958 px** (−12 %) | **266** | 528 (first screen) | 577 px (was 1,294) |
| 1440 px | 3,654 px | 180 | 321 | 1,451 px (phase headings added) |

On a phone, most of the remaining height is the decision panel itself: the disclosure review the user must read. Desktop grew by 512 px because of the focus card, the boundary band and the phase headings. The current stage now sits at y = 180 instead of 709, which is what Gate B asks for.

### C — Nano before the request

- The on-device capability probe moved to `src/app/use-on-device.ts`. It runs once per loaded source and is a local `availability()` check, never inference. PhantomPanel and CONNECT share it. Interpretation results are shared too (`UnderstandingStore`), so CONNECT and the twin stage show the same suggestions.
- CONNECT now reads **01 Source → 02 Destination → 03 Understand locally (optional) → 04 Build**. Step 03 offers *Interpret private fields on-device* before any request exists. A label reports the run kind: *deterministic so far* or *hybrid (on-device AI used)*. Nano still starts only on a click: Build never starts it, and nothing is approved or sent automatically.
- If Nano is unavailable, CONNECT says what is unavailable (with the reason), what still works, that the run is *deterministic, not hybrid*, and what to do next. Nothing is simulated (E2E-112b).
- **After preparation**, a twin or destination change still goes through `invalidateDownstream`; there is now `applyTwinOverride` for twin edits. `InvalidationNotice` then states:
  - the cause (twin, destination or another change);
  - whether an approval and results were cleared;
  - that nothing was sent.

  It offers **Prepare a new review**, which builds a new preview through `prepareDisclosureReview`. The user must approve it again (E2E-113).

### D — Black Halo signature: the Privacy Boundary Transformation

The trust ledger in OBSERVE becomes a five-part band: **Private source → Phantom Twin ‖ Your approval ‖ Approved cloud reasoning → Verified local outcome**. Each part keeps its ledger fact and test id.

- **State.** Each station's state comes from `boundaryState(stages)`. The twin shows *refined on-device* only after a successful on-device event (RT-011).
- **The gate is the halo.** Dashed and closed when nothing is approved, a gold double ring while waiting, a solid ring with an open aperture after one approval.
- **Motion.** The only motion is a CSS transition when `data-state` really changes: never on first paint, never looped, and removed under reduced motion (E2E-115).
- **No private line.** The private source's connector stops at the twin.
- **Restraint.** No particles, blur, 3D or loaders were added. Every state is written in words, and each zone pairs colour, line style, icon and label. All new colour pairs measure ≥ 5.17 : 1.

### E — outcome and export

- `outcomeVerdict` (`src/app/outcome-verdict.ts`) words the one primary verdict and leaves states untouched. "Verified locally." appears only when meaning was verified for every destination field. Otherwise the headline is "Verified for structure and policy. Meaning partly unknown."
- Quarantined records are always named as *not counted as transformed*.
- Each verdict carries a one-line *Next* and a **Go to export** (or **Go to draft export**) action.
- Export now opens with *what you receive*: an executable mapping, fictional fixtures only, local bindings needed for real data, not deployed, and the status it would carry.
- After download, a five-step hand-off uses the real runner commands: extract, `node run.mjs verify`, `bindings-template`, `run`, and inspect the results. Exit code 3 means some records need review. Export 1.1.0 is unchanged.

## Tests and evidence

| Area | Evidence | Result | Status |
| --- | --- | --- | --- |
| Lint / typecheck | `pnpm lint`, `pnpm typecheck` | 0 warnings, 0 errors | **VERIFIED** |
| Unit | `pnpm test:unit` | **251** (231 + 20: RT-009…012, INV-001, OV-001/002) | **VERIFIED** |
| Contract / privacy / evaluation | `pnpm test:contracts`, `:privacy`, `:evaluation` | 43 / 69 / 62, unchanged | **VERIFIED** |
| E2E | `pnpm test:e2e` | **113** (102 + 11: E2E-110…115) | **VERIFIED** |
| Total | — | **538** | **VERIFIED** |
| Visual regression | `tests/visual/capture.spec.ts` at 4 widths (6 / 6), committed set at 1440 / 390 in `design/screenshots/sprint-11-after/`; `observe-probe` metrics before/after | Captured; no overflow at 390 px (E2E-105, E2E-110) | **VERIFIED** (screenshots reviewed by the team, not by users) |
| Runtime truthfulness | RT-009…012; E2E-111 checks the gate, ledger and next action against `cloudCalls` at each checkpoint | Display equals state | **VERIFIED** (simulated adapters) |
| Real inference | Live S11-HERO, 1 run (budget 1 run, ≤ 2 requests), [evidence](../evidence/sprint-11/live-experience.json) | Nano 6 / 6 `real on-device` in CONNECT, 1 applied, run kind *hybrid*, 0 invalidation notices; at the approval the focus read `authorization` and the gate `awaiting`; Gemini `IN_CLOUD`, valid, 2.4 s; revision `ACCEPTED`; boundary final `open / reached / reached`; OUTCOME "Verified, with managed exceptions." (meaning partial) | **VERIFIED** (1 run; requalification, not a reliability measure) |
| Privacy (live) | Request-body scan | 2 cloud requests, **0** private terms | **VERIFIED** |
| Export verification | Live: revised package, `node run.mjs verify` exit 0 in a temp directory; hand-off shown; E2E-114 | `VERIFIED_WITH_EXCEPTIONS` | **VERIFIED** |
| Independent usability | — | No sessions | **NOT PERFORMED** |
| Accessibility (automated) | E2E-058, E2E-101, E2E-105 (4 widths), E2E-106, E2E-110b (keyboard toggles), E2E-115 (reduced motion); measured contrast | Pass | **VERIFIED** (automated only; not a WCAG conformance claim) |
| Screen reader | — | No NVDA / VoiceOver / Orca pass | **UNVERIFIED** |
| Release build | `pnpm build:release` + `pnpm verify:release` on `a9cf261` | PASS; debug token absent (independent check) | **VERIFIED** |
| Deployment | Read-only preflight | Site never released; no approval given | **PENDING** (owner) |
| Hosted verification | — | Not deployed | **BLOCKED** (needs deployment) |

**Changed existing tests.**

- E2E-101 now boots with a simulated *available* Nano (`onDeviceAvailable: true`). The probe now runs when the source loads. In the default harness Nano is disabled, so the stage truthfully reads "unavailable · not hybrid" instead of "optional · not run". Pinning availability keeps the test's purpose: an available but unused optional stage is `skipped`, never `completed`. Its assertions are unchanged.
- No privacy, authorization, verdict or export assertion changed.

**Security regression.** All Sprint 1–10 privacy suites pass unchanged (69). The live body scan found 0 private terms. Specific checks:

- No send happens before approval (E2E-111: `cloudCalls` 0 until Send).
- No stale approval survives an upstream change (E2E-113: a twin change after approval sets authorization to `not-started` and the gate to `closed`; a new review needs a new approval).
- The revision budget is unchanged (E2E-096).
- No unverified mapping is headlined as verified (OV-001).
- The release artifact contains no debug token.

## Risks and rollback

- **Usability (high).** No independent participant has used the product. Every UX claim is the team's judgment plus automated checks. The release targets in the kit are not results.
- **Accessibility (medium).** Structure and keyboard are checked automatically. A screen-reader pass is still needed for the phase toggles, the live headline and the boundary words.
- **Desktop length.** The rich desktop view is 512 px longer. If users find it heavy, collapsing all-not-started phases on desktop is a one-line policy change in `RuntimeView` (`isOpen`).
- **Probe timing.** The on-device capability check now runs at source load instead of when the twin stage opens. It is local and sends nothing, but it adds one timeline event per run.
- **Provider.** One live run is not a reliability measure; Sprint 9's 5-run figures remain the reliability evidence.
- **Deployment.** The preview-domain limit stands: a preview channel fails closed for cloud inference. Never add a wildcard or disable App Check.
- **Rollback.**
  - Code: revert the Sprint 11 commits on `main` (`git revert <merge-sha> -m 1`); no data migration exists.
  - Hosting: `hosting:disable` restores the never-released state; later releases roll back from the console. See [deployment.md](../deployment.md).

## Not done (explicitly)

No usability sessions, no manual screen-reader pass, no deployment, no App Check, reCAPTCHA or billing change, no video recording or upload, no Devpost submission, no merge. Sprint 12 was not started.
