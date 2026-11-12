# Design system — Spectral Forensics

Implementation: tokens in [`src/index.css`](../../src/index.css) (Tailwind v4 `@theme`), primitives in [`src/components/spectral.tsx`](../../src/components/spectral.tsx), icons in [`src/components/icons.tsx`](../../src/components/icons.tsx), and buttons in [`src/components/ui/button.tsx`](../../src/components/ui/button.tsx). No component library and no visualization dependency.

## Colour roles

| Token | Value | Role | Use |
| --- | --- | --- | --- |
| `ink` | `#101820` | Structure, authority, **private space** | Header, hero, verdict slab, private frames, primary button |
| `ink-2` / `ink-3` | `#18232d` / `#2a3742` | Raised surface / rules on ink | |
| `ink-text` | `#c9c4b8` | Secondary text on ink | |
| `bone` | `#ede9df` | Page / reading surface | Body background, inputs |
| `bone-2` | `#e3ded1` | Recessed surface | Withheld cards |
| `panel` | `#f8f6f0` | Raised reading surface | Panels and cards |
| `gold` | `#b99a63` | Identity, **approval, cloud-bound** (decorative / on ink) | Hero CTA, approve button fill, boundary band |
| `gold-ink` | `#77592a` | Gold for text on bone (≈ 5.3 : 1) | Cloud zone labels, "required" |
| `cyan` | `#85d6db` | **On-device / synthetic** (on ink) | Hero emphasis, verdict readouts |
| `cyan-ink` | `#17636a` | Cyan for text on bone (≈ 5.7 : 1); focus ring | Aliases, synthetic frames |
| `pass` / `warn` / `fail` | `#2d6a48` / `#8a5a12` / `#a03030` | Verification outcomes, all ≥ 4.5 : 1 on bone | Always with an icon + word |
| `mute` | `#5b6169` | Secondary text (≈ 5.2 : 1 on bone) | |
| `rule` | `#d3ccbc` | Hairlines | |

Measured WCAG contrast (computed from the token values): on bone, `gold-ink` 5.34, `cyan-ink` 5.72, `pass` 5.30, `warn` 4.88, `fail` 5.85 and `mute` 5.16 : 1. On ink, `gold` 6.70, `cyan` 10.77, `ink-text` 10.29 and `bone` 14.76 : 1. Ink on gold (approve button) is 6.70 : 1. All meet AA for normal text.

Legacy names (`paper`, `navy`, `local`, `cloud`, `danger`, `signal`) are aliased to these, so the unchanged diagnostic workspace inherits the palette.

## Zones

The local/cloud distinction never depends on colour alone. Each zone has four independent carriers:

| Zone | Colour | Line | Icon | Label (`ZoneLabel`) |
| --- | --- | --- | --- | --- |
| Private | ink | solid + 4 px inset left rule (`frame-private`) | lock | "Private · this browser" |
| Synthetic | cyan-ink | **dashed** + inset rule (`frame-synthetic`) | hollow eye | "Synthetic · generated locally" |
| On-device AI | cyan-ink | solid | chip | "On-device AI" |
| Approval | gold-ink | solid | seal | "Your approval" |
| Cloud-bound | gold-ink | **3 px double** (`frame-cloud`) | cloud | "Cloud-bound · approved only" |
| Verified | ink | solid | gauge | "Verified locally · deterministic" |

`TrustLedger` (on the Phantom, Review and Mapping steps) states the four data conditions from live state: *private data · synthetic twin · approved for disclosure · actually transmitted*. The simulated adapter reads "simulated test adapter, no network".

## Typography

| Role | Family | Size / style |
| --- | --- | --- |
| Hero headline | Instrument Serif 400 (+ italic for the emphasized clause) | 2.6 rem → 4.6 rem, leading 1.02 |
| Step title (h2) / section display | Instrument Serif | 2.25–3 rem |
| Panel heading (h3) | IBM Plex Sans 600 | 1.125 rem |
| Body / controls | IBM Plex Sans 400/500 | 0.875–1 rem, leading 1.5–1.75 |
| Eyebrows, zone labels, metadata | IBM Plex Mono 400/500, uppercase, tracking 0.08–0.18 em | 10–11 px |
| Aliases, fields, operations, codes | IBM Plex Mono | 11–14 px |

The fonts are self-hosted from `@fontsource/*` 5.3.0. All three are **SIL OFL 1.1**. Only the Latin subsets (400/500/600, plus serif italic) are imported, about 200 KB of woff2 in total. Font files are not committed: they come from `node_modules` at build time. Nothing is requested from a third-party font CDN, so E2E-035's offline/blocked-host check still holds. Fallbacks are Georgia / system sans / ui-monospace.

## Grid and spacing

- Container: `max-w-7xl` (80 rem) with a 16 px gutter at ≤ 640 px and 24 px above.
- Spacing scale: Tailwind 4 px base. Panels use `p-5`/`p-6`, sections are separated by `space-y-5`, and inline gaps are 2–3.
- Step header: a 2-column editorial band (title | summary) over a hairline.
- Transformation grid (`.transform-grid`): `0.85fr | 3rem | 1.15fr` at ≥ 64 rem. On narrow screens cells interleave as private → phantom per field (explicit `grid-row` via CSS custom properties).
- Integration Studio: `0.85fr | 1.45fr | 1fr` at ≥ 80 rem (`xl`). Below that it stacks in the order **mapping → inspector → aliases** (CSS `order`).
- Radii: 2–3 px only. Hairlines are 1 px `rule`. Emphasis comes from inset left rules, not shadows.

## Components

| Component | File | Notes |
| --- | --- | --- |
| `ProductHero`, `HowItWorks` | `src/app/Landing.tsx` | Shown only on the Source step before a dataset loads |
| `WorkflowProgress` | `src/app/WorkflowProgress.tsx` | Sticky five-column rail, `aria-current="step"`, done marks with sr-only text; never scrolls sideways |
| `TrustLedger` | `src/app/TrustLedger.tsx` | Four data states, derived only |
| `Panel`, `PanelHeader`, `ZoneLabel`, `StatusMark`, `StatusIcon`, `Eyebrow`, `Disclosure`, `FieldToken`, `EmptyState` | `src/components/spectral.tsx` | Presentation only |
| Phantom transformation | `src/app/PhantomPanel.tsx` | Private cell / connector / phantom card; on-device `InferencePanel` |
| `IntegrationStudio`, `ProposalPipeline` | `src/app/IntegrationStudio.tsx` | Read-only visualization of the canonical contract |
| `buildConnections` | `src/app/mapping-connections.ts` | Pure: `AcceptProposalResult` + report → connection rows |
| View helpers | `src/app/view-model.ts` | `executionByOperation`, `unmappedTargets`, `opNumber` (the single 1-based numbering), `formatSample` |
| `VerdictCard`, `RowGroup` | `src/app/VerificationPanel.tsx` | Imported vs hidden groups; findings link to the operation |

Rules: presentation components hold no domain logic. Existing workspace state is authoritative; the only new UI state is the selected operation (`focusOperation` in `App`). Every control performs a real action.

## Motion

| Moment | Animation | Duration |
| --- | --- | --- |
| Phantom cards appear (generation / seed change) | `materialize`: fade, 6 px rise, 3 px blur → sharp, staggered 60 ms | 520 ms |
| Field connectors / mapping lines | `draw-line`: scaleX 0 → 1 from the source side | 480 ms |
| Connections, findings, verdict | `reveal-up`, staggered 50 ms | 380 ms |
| On-device progress | width transition on a real `done / total` bar | 300 ms |

Easing is `cubic-bezier(0.2, 0.7, 0.1, 1)` (`--ease-instrument`). **Nothing animates across the privacy boundary.** No motion suggests private records moving toward the cloud, and the cloud band in the hero is static. Under `prefers-reduced-motion: reduce` all animations and transitions are removed (verified by E2E-060).

## Iconography

Twelve glyphs drawn on a 16 px grid with a 1.5 px stroke, square caps and miter joins (`icons.tsx`): lock, phantom eye, chip, seal, cloud, gauge, check, cross, dash, alert, arrow and search. They are always `aria-hidden`; the adjacent text carries the meaning.

## Accessibility rules

- One `h1` (wordmark), one `h2` per step, `h3` per panel, `h4` per region.
- Visible 2 px focus ring (`cyan-ink`; `cyan` on ink surfaces).
- Status is always icon + word. Raw status values stay in text for assistive tech and tests.
- Mapping connections and inspector work without hover: buttons with `aria-pressed` and an `aria-live` inspector.
- Long identifiers wrap (`overflow-wrap:anywhere`). Wide data tables scroll inside their own container, never the page.
- Hidden values on the private side use `role="img" aria-label="hidden value"`. Real local names appear in accessible text only on local-only views, never in cloud-bound views or telemetry.
- Touch targets are ≥ 40 px for primary controls (`min-h-10`).
