# Art direction — Spectral Forensics

> **Superseded in Sprint 10 by Black Halo (Spectral Forensics 2.0).** See [ADR 0011](../decisions/0011-experience-architecture-black-halo.md), [design-system.md](design-system.md) and the [exploration](exploration/). The concept, zone grammar and the triptych decision below still apply; the palette and the page composition changed.

> **An instrument for revealing the structure of systems that cannot be seen.**
> Reveal what matters. Conceal what must remain private.

## Concept

EYES WITHOUT A FACE is about **structure without identity**: you can see a system's shape without seeing the people inside it. The interface works like a forensic instrument. It sits somewhere between a premium developer tool, a confidential lab notebook and an editorial investigation. It is dramatic through composition and restraint, not through effects.

Every major visual decision serves one of three ideas:

1. **There is a private system the cloud cannot inspect.** Private content is drawn in **ink**: solid frames with a heavy left rule and a lock. By default it is literally *faceless*: names and values are redaction bars until you reveal them locally.
2. **The app creates a fictional representation of it.** Synthetic content is **cyan** with **dashed** frames and a hollow-eye glyph. It is a phantom: visible, but not real.
3. **AI reasons over the approved representation, and deterministic software verifies locally.** Cloud-bound and approved content is **gold** in **double-rule** frames with a seal or cloud glyph. Verification is back in ink, with pass/warn/fail marks that always pair an icon with a word.

Colour is never the only carrier. Each zone also has a line style, an icon and a text label (see [design-system.md](design-system.md#zones)).

## Brand personality

Precise · confidential · candid · calm. The product says what it does not know ("Approval used", "simulated test adapter, no network", "It was not repaired"). It never celebrates a partial result: a hidden-case failure is presented as a **finding**, not as a crash and not as a success.

## What we avoided

Purple-gradient SaaS chrome, glassmorphism, neural-network decoration, glitch effects, terminal cosplay, and stock "AI" illustration. The emblem is the only ornament. It appears once, large, in the hero, and small in the header. The only background texture is a faint engineering grid on ink, used in the hero.

## Two compositions explored for the main workspace

Both were sketched against the real Integration Studio content: 5 operations, 6 aliases, 5 destination fields, and 3 hidden-case findings.

### A — "Evidence board" (node canvas)

A full-width canvas where alias nodes on the left are joined by curved SVG edges to destination nodes on the right. Clicking an edge opens a floating inspector.

- **Pros:** the most visually distinctive, and a strong demo screenshot.
- **Cons:** it needs edge routing (a dependency or ~400 lines of layout code). Hover and float interactions are hard to make keyboard- and screen-reader-accessible. It does not stack on mobile, where the canvas becomes a pan-and-zoom problem. With 16 operations (the contract maximum) the edges cross and become unreadable. It also implies a node *editor*, which the product deliberately is not.

### B — "Instrument triptych" (chosen)

Three fixed regions: **Source & Phantom** (left), **Mapping** (centre: one row per operation drawn as `alias ── op ──▶ destination`), and **Verification** (right: an inspector for the selected operation). Rows are buttons with `aria-pressed`. The connector line *is* the status: solid cyan means validated, solid green means ran clean, amber means findings, and dashed red with ✕ means rejected.

- **Pros:** every connection is a list item, so it is keyboard- and screen-reader-native and needs no hover. It stacks naturally on mobile (mapping → inspector → aliases). It scales linearly with the operation count, needs no dependencies, and reuses the same visual grammar as the Phantom transformation grid.
- **Cons:** it is less "graph-like", and many-to-one `concat` sources are shown as chips rather than converging edges.

### Decision

| Criterion | A | B |
| --- | --- | --- |
| Visual distinctiveness | ●●● | ●●○ |
| Usability (scan, select, compare) | ●●○ | ●●● |
| Technical clarity (maps 1:1 to the contract) | ●●○ | ●●● |
| Accessibility (keyboard, SR, no hover) | ●○○ | ●●● |
| Responsiveness | ●○○ | ●●● |
| Implementation complexity / risk | ●○○ | ●●● |
| Demonstration impact | ●●● | ●●○ |

**B wins.** It recovers distinctiveness through the boundary language (dashed vs double rules, drawn connector lines, the redaction-bar private column) rather than through a canvas. The same triptych logic shapes the Phantom step (private | link | phantom) and the Reality Check (imported | hidden).

## Signature moments

1. **Phantom transformation.** Private cells (ink, redacted) are aligned row-by-row with phantom cards (cyan, dashed), joined by drawn connector lines. "Reveal private source (this browser only)" restores names and values locally, which is the *face* returning. Withheld fields render with a broken (dashed grey) connector and "withheld · stays local".
2. **Privacy boundary in the hero.** The path diagram places stage 04 (Gemini) inside a gold double-ruled band labeled *"privacy boundary · only the approved twin crosses"* and *"back inside this browser"*. No motion crosses that boundary.
3. **Reality Check verdict.** An ink slab with a serif headline and two large instrument readouts, *Imported 3 / 3* and *Hidden 0 / 3*, followed by findings that link straight to the responsible operation in the studio.

## Visual examples

| Moment | Before | After |
| --- | --- | --- |
| Landing, 1440 | [before](screenshots/before/01-landing-1440.jpg) | [after](screenshots/after/01-landing-1440.jpg) |
| Landing, 390 | [before](screenshots/before/01-landing-390.jpg) | [after](screenshots/after/01-landing-390.jpg) |
| Phantom Twin | [before](screenshots/before/03-twin-1440.jpg) | [after](screenshots/after/03-twin-1440.jpg) |
| Disclosure review | [before](screenshots/before/04-review-1280.jpg) | [after](screenshots/after/04-review-1280.jpg) |
| Integration Studio | [before](screenshots/before/05-mapping-1440.jpg) | [after](screenshots/after/07-mapping-after-run-1440.jpg) |
| Reality Check | [before](screenshots/before/06-reality-1440.jpg) | [after](screenshots/after/06-reality-1440.jpg) |
| Studio, 390 | [before](screenshots/before/05-mapping-390.jpg) | [after](screenshots/after/07-mapping-after-run-390.jpg) |
