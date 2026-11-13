# Sprint 10 experience audit (before redesign)

**Date:** 2026-11-13 · **Build:** `sprint-10` at `86ee30a` (Sprint 9 merge, unchanged) · **Auditor:** the team (internal heuristic audit; **not** user research).

**Method.**
- Playwright (bundled Chromium) walked the fictional CRM journey through the real workflow at 1440 × 900, 1280 × 800, 768 × 1024 and 390 × 844. The cloud step used the labeled deterministic test adapter.
- The capture harness `tests/visual/capture.spec.ts` produced 28 screenshots in [`screenshots/sprint-10-before/`](screenshots/sprint-10-before/).
- The measurement probe `tests/visual/audit-probe.spec.ts` produced [`audit-metrics.json`](screenshots/sprint-10-before/audit-metrics.json) and `08-reality-export-1440.jpg`.

Reproduce:

```bash
VISUAL_OUT=docs/design/screenshots/sprint-10-before pnpm test:visual
```

Run this before checking out Sprint 10 code.

## Measured baseline

| Metric | Value | Evidence |
| --- | --- | --- |
| Clicks from "Load sample" to the approval decision | 6 | probe `clicksToApprovalDecision` |
| Clicks from "Load sample" to the Reality Check verdict | 10 | probe `clicksToVerdict` |
| Reality Check page height at 1440 | 3,988 px | probe `realityPageHeight` |
| Export panel top at 1440 | y = 2,941 px (3.3 screens down) | probe `exportPanelTop` |
| `<details>` disclosures on the Reality Check step | 8 | probe `realityDetailsCount` |
| Landing page height at 390 | 4,128 px | probe `landing-390.pageHeight` |
| Mobile CTA bottom at 390 × 844 | 564 px (above the fold) | probe `landing-390.ctaBottom` |
| Horizontal overflow, landing 1440 / 390 | 0 / 0 px | probe |

## Findings

Severity: **Critical** blocks the journey or misleads about privacy · **High** obstructs comprehension of the core story · **Medium** causes friction · **Low** is polish.

### X1 — The five-step wizard is the product's organizing idea
- **Current behavior.** A sticky five-column rail, a "Step N of 5" header, and a two-paragraph step description sit on every screen. The step description repeats the hero body (`01-landing-1440`, `06-reality-1440`). The internal pipeline (Source → Twin → Review → Cloud → Reality) is what the user navigates, not what they want (connect, watch, get a result).
- **Severity.** High.
- **Proposed change.** Organize the product around three moments: CONNECT / OBSERVE / OUTCOME. Keep the five stages as a workbench inside OBSERVE, opened contextually.
- **User benefit.** A first-time user sees three understandable moments instead of five technical ones.
- **Implementation risk.** Medium. About 40 E2E selectors use the Workflow nav. Keeping the nav (label "Workflow") inside OBSERVE limits the churn.

### X2 — Six clicks of navigation before the only required decision
- **Current behavior.** Load → Continue → (category checkbox) → Continue → Build prompt → Approve. "Continue" and "Build exact outbound prompt" are not decisions. Building the preview is local and sends nothing (probe: 6 clicks).
- **Severity.** High.
- **Proposed change.** CONNECT gets one primary action, **Build Integration**. It validates the source and destination, profiles, generates the twin and builds the disclosure preview locally, then stops at the approval.
- **User benefit.** About 2 clicks to the first meaningful decision.
- **Implementation risk.** Low, provided the existing preview builder is reused (no second implementation) and approval is never automated.

### X3 — The destination is specified after the twin is generated
- **Current behavior.** The destination JSON Schema editor lives under the Phantom Twin step (`03-twin-1440`). "What do you want to produce?" is answered only at step 2.
- **Severity.** Medium.
- **Proposed change.** CONNECT asks for source **and** destination together. A preset ("Helpdesk contact — fictional CRM destination") is selected by default, and the schema editor is behind a disclosure.
- **User benefit.** The user understands input → output before starting.
- **Implementation risk.** Low. The same `destinationText` state is used, and the same `invalidateDownstream` rule applies.

### X4 — The outcome is buried
- **Current behavior.** After the verdict, the page continues through five checks, run details, semantic panel, records, hidden cases and blind revision. Export Integration starts at y = 2,941 px of 3,988 (`08-reality-export-1440`).
- **Severity.** High.
- **Proposed change.** A dedicated OUTCOME moment: verdict first, then evidence, privacy outcome, before/after, and **Export Integration** as the prominent final action.
- **User benefit.** "Does my integration work, and can I take it with me?" is answered on one screen.
- **Implementation risk.** Low. It reuses `exportCandidates`, `exportEligibility` and `ExportPanel` unchanged.

### X5 — Three vocabularies for one outcome
- **Current behavior.** The same run is shown as "FAIL · gaps found…" (verdict slab), "Meaning: Unknown" (slab footer and semantic panel) and "Partially verified · draft export only" (export panel), all at once (`08-reality-export-1440`).
- **Severity.** High.
- **Proposed change.** The OUTCOME overview leads with the export-eligibility state, which already combines structure, policy and meaning. Under it, three separately labeled rows: **Structure** (Reality Check), **Meaning** (semantic verifier, unknown ≠ pass) and **Records** (outcome counts under policy).
- **User benefit.** A single answer plus its evidence, with schema validity never presented as correctness.
- **Implementation risk.** Low. The counts come only from `summarizeOutcomes` / `exportEligibility`.

### X6 — Large dead area on the Reality Check
- **Current behavior.** At 1440 the imported-records column ends early, leaving roughly 300 px of empty space before Blind revision (`08-reality-export-1440`, between the record cards and "Blind revision").
- **Severity.** Low.
- **Proposed change.** Align the records grid to its content (`items-start`).
- **User benefit.** Less scrolling.
- **Implementation risk.** Very low.

### X7 — The process is not observable
- **Current behavior.** What has run, where, and how long it took exists only as raw JSON in "For engineers → Workflow telemetry" (collapsed, bottom of every page). Nothing shows why the app is waiting.
- **Severity.** High (missed opportunity for the core story).
- **Proposed change.** A Live Intelligence Runtime: 16 stages derived from canonical state, each placed in its execution zone (This browser · Your approval · Gemini Cloud), plus an inspector and an activity timeline built from the existing safe telemetry.
- **User benefit.** Where data is processed and why execution is waiting become visible without logs.
- **Implementation risk.** Medium. Status must come from state, and skipped stages must never appear as completed. A pure derivation function plus unit tests mitigates this.

### X8 — The trust ledger is repeated per step with no persistent home
- **Current behavior.** `TrustLedger` renders on the Twin, Review and Cloud steps, but not on Source or Reality Check. Its presence depends on the step.
- **Severity.** Low.
- **Proposed change.** Show the ledger once, persistently, in the OBSERVE header as the trust boundary summary.
- **User benefit.** The privacy state is always one glance away.
- **Implementation risk.** Low.

### X9 — On-device availability is explained only on step 1, collapsed
- **Current behavior.** "Runtime check" is a collapsed disclosure under the source panel. When Nano is unavailable, the twin step still reads "Gemini Nano on-device" in the landing path strip.
- **Severity.** Medium.
- **Proposed change.** The runtime's on-device stage shows *Skipped · unavailable in this browser* with the reason, and never a completed state. The runtime check stays available in CONNECT.
- **User benefit.** Honest hybrid status.
- **Implementation risk.** Low.

### X10 — Mobile approval decision is deep in the page
- **Current behavior.** At 390 the Approve button sits at about y = 2,700 of a 3,128 px page (`04-review-390`). The four-row trust ledger and destination block come first.
- **Severity.** Medium.
- **Proposed change.** The OBSERVE header states the waiting reason and links to the review. The ledger moves to the runtime header (one compact block). The review content is unchanged (all material disclosure remains before the button).
- **User benefit.** Shorter path to the decision without hiding disclosure.
- **Implementation risk.** Low.

### X11 — Technical concepts on the first screen
- **Current behavior.**
  - The first workspace screen offers "Load reserved edge cases as source".
  - It shows a scenario picker labeled "inspected in Sprint 8; development data".
  - It shows a "For engineers / Processing path" section and three engineering disclosures (`01-landing-1440`).
- **Severity.** Medium.
- **Proposed change.** CONNECT shows the demo, file import and paste options. Scenarios and edge cases move under "Advanced sources", relabeled without sprint jargon. Engineering disclosures move to a single "Engineering details" disclosure.
- **User benefit.** Less to parse at first contact.
- **Implementation risk.** Low (test ids preserved).

### X12 — Two visual products
- **Current behavior.** A dark ink hero with a violet/gold emblem, then a bone-paper working surface (`01-landing-1440`). The emblem's violet iris appears nowhere else in the UI. Cyan, gold and bone carry the zones.
- **Severity.** Medium (brand).
- **Proposed change.** Black Halo: one obsidian instrument surface across the whole product. Iris violet marks observation and selection (runtime focus, on-device AI). Halo gold marks authorization and cloud-bound content. Cyan stays for synthetic. Zones keep their line styles and icons.
- **User benefit.** A coherent identity derived from the emblem.
- **Implementation risk.** Medium. All colour tokens change, so contrast must be re-verified (done in the token table in `design-system.md`).

### X13 — "Next" strip points down the page instead of forward
- **Current behavior.** The verdict's Next strip says "3 · Export Integration ↓", an in-page anchor 2,300 px below.
- **Severity.** Low.
- **Proposed change.** "See the outcome →" switches to OUTCOME.
- **User benefit.** Forward motion that matches the mental model.
- **Implementation risk.** Low.

### X14 — Accessibility baseline (no defect found, kept as a gate)
- **Current behavior.**
  - Overflow is 0 px at 1440 and 390.
  - The CTA is above the fold at 390 × 844 (564 px).
  - The workflow rail is keyboard-operable (E2E-058).
  - Zones pair colour with icon, line style and label.
- **Severity.** —
- **Proposed change.** Keep all of these as release gates for the new shell, and add keyboard and screen-reader semantics for runtime selection.
- **User benefit.** No regression.
- **Implementation risk.** —

## Resolution status

See [../sprints/sprint-10.md](../sprints/sprint-10.md#ux-audit-resolution) for which findings were resolved, with after-screenshots in [`screenshots/sprint-10-after/`](screenshots/sprint-10-after/).
