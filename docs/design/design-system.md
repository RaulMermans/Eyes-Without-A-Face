# Design system — Black Halo (Spectral Forensics 2.0)

Sprint 10 evolves Sprint 6's Spectral Forensics into **Black Halo**, derived from the eye emblem: an iris-violet eye under a gold halo, on obsidian. Decision record: [ADR 0011](../decisions/0011-experience-architecture-black-halo.md). Exploration: [exploration/](exploration/).

Implementation:

- Tokens: [`src/index.css`](../../src/index.css), Tailwind v4 `@theme`.
- Primitives: [`src/components/spectral.tsx`](../../src/components/spectral.tsx).
- Runtime: [`src/app/RuntimeView.tsx`](../../src/app/RuntimeView.tsx), styled by the `rt-*` classes in `index.css`.
- Buttons: [`src/components/ui/button.tsx`](../../src/components/ui/button.tsx).

No component library, no visualization dependency, no new font.

## Colour roles

Token **names** keep their Sprint 6 semantic roles, so components did not change meaning when the values moved to a dark instrument surface.

| Token | Value | Role |
| --- | --- | --- |
| `bone` (= `obsidian`) | `#090A12` | Canvas |
| `panel` | `#10111C` | Panels and cards (Deep Ink) |
| `bone-2` | `#181928` | Hover / raised wells |
| `void` | `#05060B` | Deepest slabs: verdicts, code blocks, footer |
| `ink` | `#EEEAF7` | Primary text and solid "private" fills (Spectral White) |
| `ink-text` | `#B9B5CC` | Secondary text |
| `mute` | `#9C99B0` | Tertiary text, metadata |
| `ink-3` / `rule` | `#2B2C40` / `#272938` | Hairlines |
| `violet` | `#823DFF` | **Iris:** observation, selection, primary action fill |
| `violet-soft` | `#B88AFF` | Iris for text, focus ring, on-device AI |
| `gold` (= `gold-ink`) | `#E8BF72` | **Halo:** authorization, approval, cloud-bound |
| `cyan` (= `cyan-ink`) | `#7DD3DA` | Synthetic / Phantom Twin |
| `pass` / `warn` / `fail` | `#5CC48A` / `#F0A050` / `#FF7B7B` | Outcomes, always with an icon and a word |

**Measured WCAG contrast.** The ratios below are computed from the token values with the WCAG 2.x formula.

On `panel`:

| Token | Ratio |
| --- | --- |
| `ink` | 15.86 |
| `ink-text` | 9.42 |
| `mute` | 6.79 |
| `gold` | 10.84 |
| `cyan` | 10.90 |
| `violet-soft` | 7.25 |
| `pass` | 8.68 |
| `warn` | 8.80 |
| `fail` | 7.48 |

On `bone`, every ratio is higher. On `bone-2`, the lowest is `mute` at 6.29.

Fill buttons:

| Text on fill | Ratio |
| --- | --- |
| white on `violet` (primary button) | 5.17 |
| obsidian on `gold` (approve button) | 11.40 |
| obsidian on `ink` (selected mode) | 16.68 |

All pairs meet AA for normal text.

Sprint 10 caught one failure in review: Spectral White text on violet measured 4.37 : 1. Primary buttons therefore use white text.

`warn` (orange) and `gold` (halo) are both warm. They are never the only carrier: warnings use the alert icon and a word, while approval uses the seal icon and a double rule.

Legacy names (`paper`, `navy`, `local`, `cloud`, `danger`, `signal`) are aliased, so the diagnostic workspace inherits the palette.

## Zones

Colour is never the only carrier. Each zone has four independent carriers.

| Zone | Colour | Line | Icon | Label |
| --- | --- | --- | --- | --- |
| Private | Spectral White | solid + inset left rule (`frame-private`) | lock | "Private · this browser" |
| Synthetic | cyan | **dashed** + inset rule (`frame-synthetic`) | hollow eye | "Synthetic · generated locally" |
| On-device AI | violet-soft | solid | chip | "On-device AI" |
| Approval | gold | solid / **double** in the runtime | seal | "Your approval" / "You" |
| Cloud-bound | gold | **3 px double** (`frame-cloud`) / dashed chip | cloud | "Cloud-bound · approved only" |
| Verified | Spectral White | solid | gauge | "Verified locally · deterministic" |

## Live Intelligence Runtime

The runtime has three regions:

- **Lanes:** 17 stages from `deriveRuntime`.
- **Inspector:** the selected stage.
- **Activity timeline:** safe workflow events of this run, newest first.

The persistent **trust boundary** (`TrustLedger`) sits in the OBSERVE header, and the workbench sits below.

At ≥ 64 rem, each stage row places its node in the column where it executes:

- **This browser** — local and on-device stages.
- **Your approval** — the **halo**: a gold 3 px double-ruled band.
- **Gemini Cloud** — a faint diagonal hatch.

The run visibly crosses the halo twice when a revision happens. Below 64 rem the columns collapse and every row shows a zone chip instead (Local · On-device AI · You · Cloud).

Node **shape** encodes status, and the row also states it in words.

| Status | Node |
| --- | --- |
| Completed | filled disc (violet-tinted for on-device) |
| Running | ring + pulsing core (static under reduced motion) |
| Awaiting approval | gold double ring with a halo glow |
| Requires review | diamond |
| Failed | square with ✕ |
| Blocked | square with bar |
| Skipped | dashed circle with a slash |
| Not started | small dotted circle |

The **iris** next to the OBSERVE headline mirrors the run: a gold double ring while it waits for you, a violet pulse while running, and a red ring when halted. It is decorative (`aria-hidden`), and the headline says the same thing in words. A polite live region announces headline changes.

## Typography

| Role | Family | Use |
| --- | --- | --- |
| Brand statements | Instrument Serif 400 / italic | Landing headline and the Outcome verdict only |
| Product UI headings | IBM Plex Sans 500–600, tight tracking | OBSERVE/CONNECT headlines (1.5–1.9 rem), stage titles, panels |
| Body / controls | IBM Plex Sans 400/500 | 0.875–1 rem |
| Technical readouts | IBM Plex Mono | Stage numbers, statuses, hashes, durations, aliases, eyebrows |

The fonts are self-hosted via `@fontsource/*` 5.3.0 (SIL OFL 1.1). No new font packages and no third-party font CDN.

## Layout

- Container `max-w-7xl`, with a 16 px gutter at ≤ 640 px and 24 px above.
- The header is sticky. It holds the wordmark (uppercase sans) and the CONNECT / OBSERVE / OUTCOME switch (`nav[aria-label=Experience]`, `aria-current="page"`).
- **CONNECT:** a source and destination column, plus a sticky Build column at ≥ 64 rem. Below that a fixed bottom bar repeats **Build Integration**.
- **OBSERVE:** a headline band, then the trust ledger, then lanes (1.55 fr) next to the inspector and timeline (1 fr, sticky), then the workbench.
- **OUTCOME:** a serif verdict, the overview `dl`, before/after, the privacy outcome, then Export.
- Radii are 2–3 px; the pill-shaped mode switch is the only exception. Lines are 1 px hairlines.
- Spectral illumination is one fixed radial violet glow behind the top of the page, and nothing else.

## Components

| Component | File | Notes |
| --- | --- | --- |
| `ConnectView` | `src/app/ConnectView.tsx` | Composes `SourcePanel` and `DestinationPanel`; one primary action |
| `RuntimeView`, `RuntimeNode` | `src/app/RuntimeView.tsx` | Pure presentation of `deriveRuntime` and `timelineEntries` |
| `deriveRuntime`, `currentStage`, `runHeadline`, `timelineEntries` | `src/app/runtime-model.ts` | Pure; no state, no network |
| `OutcomeView` | `src/app/OutcomeView.tsx` | `exportCandidates`, `summarizeOutcomes`, `diffContracts`, `ExportPanel` |
| `prepareDisclosureReview` | `src/app/disclosure-actions.ts` | The single implementation of "build the preview", shared by Review and Build Integration |
| `WorkflowProgress` | `src/app/WorkflowProgress.tsx` | Workbench tabs inside OBSERVE (`nav[aria-label=Workflow]`, `aria-current="step"`) |
| `TrustLedger` | `src/app/TrustLedger.tsx` | Rendered once, in OBSERVE |
| Spectral primitives | `src/components/spectral.tsx` | Unchanged API |

**UI state.** The new UI state is the experience mode, the picked runtime stage (it follows the run unless the user picks another one), `runStartedAt` (set when a new source object arrives), and the build-in-progress flag. All of it is navigation or presentation. Workspace state stays authoritative.

## Motion

| Moment | Animation |
| --- | --- |
| Running stage node, running iris | opacity pulse, 1.6–1.8 s; only while state says `running` |
| Awaiting approval | static gold double ring (no motion needed to read it) |
| Row / mode switch hover and selection | 160 ms colour transitions |
| Phantom cards, connectors, verdicts | unchanged Sprint 6 `materialize` / `draw-line` / `reveal-up` |

No progress percentage exists, because there is no measured progress to show. Nothing moves across the halo. `prefers-reduced-motion: reduce` removes every animation and transition, including pseudo-elements (E2E-106).

## Accessibility rules

- One `h1` (wordmark). Each mode has one `h2`; the workbench stage title is a second `h2` inside OBSERVE.
- Runtime rows are `button`s in an `ol`, with `aria-pressed` and `aria-describedby` pointing at their status line. They are operable with Tab and Enter/Space and never need hover.
- The visible focus ring is 2 px `violet-soft`.
- Status is always shape or icon plus a word. Long identifiers wrap. The scrollable timeline is focusable (`tabIndex=0`).
- No horizontal page overflow at 1440 / 1280 / 768 / 390 px in any mode (E2E-105). The landing CTA stays above the fold at 390 × 844.
