# 0011 — Experience architecture (CONNECT / OBSERVE / OUTCOME) and Black Halo

Status: Accepted
Date: 2026-11-13

## Context

The [Sprint 10 audit](../design/sprint-10-experience-audit.md) found five problems:

- The visible five-step wizard exposed the internal pipeline as the product (X1).
- Ten clicks separated the demo from a verdict (X2).
- The outcome sat 2,900 px below the verdict (X4).
- The process itself was not observable (X7).
- The interface read as two visual products (X12).

The workflow, gates and engines are correct and must not change.

## Decision

### 1. Three experience modes over one state machine

The modes are **CONNECT**, **OBSERVE** and **OUTCOME**. They are UI navigation state (`src/app/experience.ts`). They are not workflow state. All of them read the same `WorkspaceState`, and switching modes discards nothing.

The five existing stages remain the workbench inside OBSERVE. Their nav keeps its accessible name "Workflow".

### 2. Build Integration stops at the first required decision

It runs only local steps:

- source and destination validation;
- deterministic profile and twin (already derived);
- disclosure preview, through the same `prepareDisclosureReview` the review panel uses.

It then opens OBSERVE at the approval. It never approves, never sends, and never runs Gemini Nano. Nano reads private context and stays a user action.

### 3. The runtime is derived, never recorded

`deriveRuntime` (`src/app/runtime-model.ts`) is a pure function of:

- workspace state;
- the prepared twin;
- the safe workflow log (`src/observability/workflow-log.ts`);
- the adapter availability.

It produces 16 stages, each with a status (`not-started · running · completed · awaiting-approval · blocked · failed · skipped · requires-review`), an execution zone and a safe summary.

- Optional stages that did not run are `skipped`, with a reason. They are never `completed`.
- Upstream invalidation clears the state the stages read, so dependent stages revert automatically.
- The activity timeline maps existing safe events (codes, counts, durations, hashes). No new telemetry and no remote sink.

### 4. Direction A — Black Halo Instrument

Selected over Direction B — Spectral Editorial ([exploration](../design/exploration/)).

| Criterion | A — Instrument (lanes) | B — Editorial (chapters) |
| --- | --- | --- |
| Brand fit (eye + halo) | ●●● halo = approval band, iris = focus | ●●● emblem as hero art |
| First-time comprehension | ●●○ | ●●● |
| Runtime storytelling | ●●● stages placed in their execution zone; the boundary is spatial | ●●○ 16 stages collapse to 6 chapters; skipped/failed stages disappear |
| Privacy clarity | ●●● every row says where it ran | ●●○ the approve action sits beside a headline, away from the disclosure |
| Accessibility | ●●● rows are buttons in a list; status in text | ●●○ large serif density, decorative glow |
| Responsive | ●●○ lanes collapse to zone chips at < 768 px | ●●● |
| Implementation complexity | ●●○ | ●●● |
| Three-minute demo impact | ●●● a gold double-ruled band that the run visibly crosses twice | ●●○ |

**A wins.** B's editorial serif is kept only where it already belonged (landing headline, Outcome verdict). B's chapter compression would hide skipped and failed stages, which this product must show.

### 5. Palette

- One obsidian surface family for the whole product.
- **Iris violet:** observation, selection, on-device AI.
- **Halo gold:** authorization and cloud-bound content.
- **Cyan:** synthetic.
- **Spectral white solid frames:** private.

Zones keep their line styles (solid / dashed / double) and icons, so colour is never the only carrier. The emblem asset is unchanged.

## Consequences

- About 40 E2E selectors move from "step rail on every page" to "OBSERVE workbench". Assertions are unchanged.
- Every colour token changes value. The token names stay, so components keep their semantic roles. The contrast table is in [design-system.md](../design/design-system.md).
- Export moves from the bottom of the Reality Check to OUTCOME. `ExportPanel` is unchanged.

## Alternatives rejected

- **A node/graph canvas** — rejected again for the reasons in [art-direction.md](../design/art-direction.md).
- **A guided auto-run that approves on the user's behalf** — forbidden.
- **A separate presentation event bus** — a second source of truth.
