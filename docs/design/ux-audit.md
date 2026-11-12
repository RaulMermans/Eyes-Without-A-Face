# UX audit — Sprint 6 baseline

**Date:** 2026-11-12 · **Build:** `main` @ `426ab27` (Sprint 5 merge) · **Method:** Playwright (bundled Chromium) walking the fictional CRM journey through the real workflow. The cloud step used the labeled deterministic test adapter. Viewports: 1440 × 900, 1280 × 800, 768 × 1024, 390 × 844.

Evidence: [`screenshots/before/`](screenshots/before/). File names are `<state>-<viewport>.jpg`; the states are `01-landing`, `02-source`, `03-twin`, `04-review`, `05-mapping`, `06-reality` and `07-mapping-after-run`. Capture script: [`tests/visual/capture.spec.ts`](../../tests/visual/capture.spec.ts).

These are the auditor's judgments about the interface. They are not results from user testing.

## Answers to the audit questions

| # | Question | Finding |
| --- | --- | --- |
| 1 | Understand the product in 10 s? | **Partly.** The headline "Let AI design an integration for data it is never shown" is clear. The supporting paragraph is 7 lines of dense prose, and the step header card repeats it underneath (`01-landing-1440`). |
| 2 | Primary action obvious? | **Desktop: yes. Mobile: no.** At 390 × 844 the "Try the fictional CRM demo" button sits at y ≈ 905, **below the first screen** (`01-landing-390`). |
| 3 | Real records vs Phantom Twin? | **Weak.** The twin table shows aliases only. Seeing the correspondence needs a checkbox, and private values never appear next to their synthetic counterparts (`03-twin-1440`). |
| 4 | On-device vs cloud AI? | **Text-only.** Colour words ("Local", "Cloud") in the aside, plus a five-cell path strip with no visible privacy boundary. |
| 5 | Disclosure approval meaningful? | **Thorough but undifferentiated.** A wall of prompt text sits on the same level as the decision. "What Gemini will not receive" is one line (`04-review-1280`). |
| 6 | Understand the mapping without raw JSON? | **No.** Operations are a mono list with inline JSON params. The `map_enum` params **overflow the panel horizontally at 1440 px** (`05-mapping-1440`). |
| 7 | Reality Check outcome obvious? | **Yes, mostly.** The Sprint 5 verdict card works. The five stage statuses are plain words in a two-column `dl` with no hierarchy (`06-reality-1440`). |
| 8 | What failed and why? | **Partly.** Safe summaries exist. However, failures cite "op 2" (0-based) while the mapping list numbers that same operation **3** (1-based): an **inconsistent index**. There is no path from a failure to the operation. |
| 9 | Unnecessary interactions? | The disabled "Send approved request to Gemini" button stays on screen after use with no explanation. The diagnostic workspace and aside repeat on every step. |
| 10 | Coherent product? | Functional, but it reads as a stack of forms. A static "Processing path" aside takes ⅓ of the width on every step. Purple (emblem) and green/brown (status) have no shared logic. |

## Prioritized defects (demo- or use-blocking first)

1. **Mobile CTA below the fold** (390 × 844). Blocks the "no unnecessary navigation" target.
2. **Workflow nav clips at 390 px.** Step 3 is cut off, and the rail scrolls sideways (`01-landing-390`).
3. **Mapping params overflow** at 1440 px (`05-mapping-1440`).
4. **Operation index mismatch** between the Reality Check ("op 2") and the mapping list (item 3).
5. **The privacy boundary is not visible.** Nothing visual distinguishes private, synthetic, approved and transmitted data.
6. **Synthetic examples table clipped**: columns f_05 and f_06 are hidden at 1440 px with no affordance (`03-twin-1440`).
7. **Mapping is understandable only as JSON.** There is no source → operation → destination view and no inspector.
8. **Failures are not actionable.** There is no link to the responsible operation or to the existing local editor.
9. **Disclosure review lacks a summary.** The exact prompt is the default view, and what is withheld is not itemized.

All nine are addressed in Sprint 6 ([sprint-6.md](../sprints/sprint-6.md)). The fixes for items 1–4 and 6 are guarded by automated tests.
