# Sprint 6 — Spectral Forensics: art direction, product experience, Integration Studio

**Date:** 2026-11-12  
**Branch:** `sprint-6`, from `main` @ `426ab27` (merge of PR #6, Sprint 5). The repository was verified **PUBLIC** (read-only check; no settings changed).  
**Scope:** design and product experience only. No change to the domain, inference, the disclosure gate, contracts, the mapping DSL or the engine.

## Outcome

The working Hybrid AI pipeline is unchanged. The interface now explains the privacy boundary visually:

- a product-led landing whose demo CTA is above the fold on desktop **and** mobile;
- a signature **Phantom transformation** (private cell ↔ phantom card, redacted by default, revealed locally on request);
- a **trust ledger** stating private / synthetic / approved / transmitted from live state;
- a **progressive disclosure review**;
- an **Integration Studio** that renders the real Mapping Contract as alias → operation → destination connections, with an inspector;
- a **Reality Check** whose findings link to the responsible operation.

All established suites pass. 14 new UX acceptance tests were added.

## Audit → changes

Full audit with screenshot references: [design/ux-audit.md](../design/ux-audit.md).

| Audit defect | Change |
| --- | --- |
| Mobile CTA below the fold (y ≈ 905 on 844) | Hero puts the CTA at y ≈ 484 on 390 × 844. Guarded by E2E-050 at 1440 and 390 |
| Workflow nav clipped / scrolled sideways at 390 | Five-column rail, never scrolls; sticky. Guarded by E2E-036 and E2E-059 |
| `map_enum` params overflow at 1440 | Params move to the inspector (enum-map table). Guarded by E2E-059 / E2E-036 overflow checks at 390, 768 and 1280 |
| Reality Check "op 2" vs mapping item 3 | One 1-based numbering (`opNumber`) everywhere. Guarded by E2E-056 |
| Privacy boundary not visible | Zone system (colour + line style + icon + label), trust ledger, hero boundary band |
| Synthetic table clipped silently | Per-alias examples on every card; the full table scrolls in its own container with a note |
| Mapping only as JSON | Integration Studio (three regions) |
| Failures not actionable | "Inspect operation #N in the studio" → selects it in the inspector → "Open local proposal editor" (existing edit path) |
| Disclosure has no summary | Receive / will-not-receive summary; exact prompt, hashes, schema version, request id, Phantom→request comparison and full payload behind one toggle |

## Design decisions

Art direction, the two explored workspace compositions ("Evidence board" node canvas vs "Instrument triptych") and the scored decision for **B** are recorded in [design/art-direction.md](../design/art-direction.md). Tokens, typography, grid, motion, icons and accessibility rules are in [design/design-system.md](../design/design-system.md).

## Changes by area

| Area | Files | Notes |
| --- | --- | --- |
| Tokens & fonts | `src/index.css`, `src/main.tsx`, `package.json` | Ink/bone/gold/cyan + pass/warn/fail. Legacy token names aliased. `@fontsource` Instrument Serif, IBM Plex Sans and IBM Plex Mono 5.3.0 (OFL-1.1, Latin subsets, self-hosted) |
| Primitives | `src/components/spectral.tsx`, `icons.tsx`, `ui/button.tsx`, `ui/badge.tsx`, `ErrorBanner.tsx`, `LoadingState.tsx` | Zone labels, status marks, panels, disclosure, field tokens, empty state; 12 icons. Buttons gain `approve`/`spectral`/`outline-ink` variants and sizes |
| Shell | `src/app/App.tsx`, `WorkflowProgress.tsx` | Ink header; step band; aside moved to a bottom "For engineers" section; `focusOperation` UI state; `goTo` scrolls the workspace into view |
| Landing | `src/app/Landing.tsx` | `ProductHero` (tagline preserved, CTA → existing `withCrmDemo`), boundary path diagram, `HowItWorks` |
| Source | `SourcePanel.tsx` | Private frame, dataset stat strip, local value column in the profile |
| Phantom Twin | `PhantomPanel.tsx`, `TrustLedger.tsx`, `DestinationPanel.tsx` | Transformation grid; "Reveal private source (this browser only)"; withheld indicator; on-device panel with real progress bar, retry state and per-card Nano agreement/difference; destination field chips. **On-device logic unchanged byte-for-byte** |
| Disclosure | `ReviewPanel.tsx` | Summary + advanced view. **Preview/approve/reject/revoke logic unchanged** |
| Integration Studio | `CloudMappingPanel.tsx`, `IntegrationStudio.tsx`, `mapping-connections.ts`, `view-model.ts` | **send/evaluate/validateEdit unchanged.** Studio is read-only over `AcceptProposalResult` (+ report when it ran this proposal). Rejected output is displayed best-effort and never repaired. Unwritten destination fields listed |
| Reality Check | `VerificationPanel.tsx` | Ink verdict slab, five-check panel, run panel, imported vs hidden groups, findings with next-step guidance and studio links. **`run()` unchanged** |
| Tests | `tests/e2e/ux.spec.ts` (new), `tests/e2e/phantom.spec.ts` (1 assertion), `tests/visual/capture.spec.ts`, `playwright.visual.config.ts` | See below |
| Docs | `docs/design/*` (new), this report, indexes | |

### Intentional test change

`E2E-031` asserted `proposal-operations` matched `/"f_\d{2}"/` (JSON-quoted). Operations now render as alias tokens, so the assertion is `/\bf_\d{2}\b/`. The neighbouring assertion that local names are absent is unchanged. No other existing assertion or selector was modified.

## Tests & evidence

### Deterministic suites (final run, `pnpm test:all`, exit 0)

| Suite | Baseline (`main` @ 426ab27) | Sprint 6 |
| --- | --- | --- |
| `pnpm lint` | PASS | PASS (0 warnings) |
| `pnpm typecheck` | PASS | PASS |
| `pnpm test:unit` | 134 passed | 134 passed |
| `pnpm test:contracts` | 22 passed | 22 passed |
| `pnpm test:privacy` | 33 passed | 33 passed |
| `pnpm build` | PASS | PASS |
| `pnpm test:e2e` | 47 passed | **61 passed** (47 + 14 new) |

### New UX acceptance tests (`tests/e2e/ux.spec.ts`)

| ID | Proves |
| --- | --- |
| E2E-050 ×2 | CTA fully above the fold at 1440 × 900 and 390 × 844; it starts the real workflow (fixture profiled, 3 reserved cases held); zero provider requests |
| E2E-051 | Private values are masked by default and revealed only in the private column; never in phantom cards, the disclosure summary, the exact prompt or the payload |
| E2E-052 | 6 private cells ↔ 6 phantom cards; withholding a field updates the card, the withheld indicator and the ledger truthfully |
| E2E-053 | Summary first; exact prompt hidden until the toggle (`aria-expanded`); SHA-256 and schema version shown; a seed change clears the approval and disables send |
| E2E-054 | One connection per operation with identical op / sources / destination, compared against the proposal text; the enum-map inspector matches params; "not run yet" before execution |
| E2E-055 | The simulated adapter is labeled as such (ledger says "no network"); a local edit becomes "Manually edited locally" |
| E2E-056 | Verdict FAIL with imported 3/3 vs hidden 0/3; groups; finding → studio navigation selects the same 1-based operation, now `executed-fail` |
| E2E-057 ×2 | Rejected ops render rejected with their rule (`UNKNOWN_ALIAS`), none as validated, no continue; malformed output is "not repaired", not visualized |
| E2E-058 | All five steps keyboard-operable with `aria-current`; visible focus outline |
| E2E-059 ×2 | Full journey at 390 and 768 with ≤ 1 px horizontal overflow; studio selectable without hover |
| E2E-060 | `prefers-reduced-motion` removes entrance animations |

### Visual QA

`pnpm test:visual` walks the journey at 1440, 1280, 768 and 390. Before: [design/screenshots/before/](../design/screenshots/before/) (28 captures from `main`). After: [design/screenshots/after/](../design/screenshots/after/) (28 captures). I reviewed each after-capture for hierarchy, alignment, overflow and clipping. Defects found during review and fixed: private cells stretching to phantom-card height (now top-aligned with profile facts); a `whitespace-pre` example overflowing 94 px at 390 (caught by E2E-036); and awkward wrapping of mapping rows on mobile (now two-line rows). A known capture artefact: full-page screenshots can show the sticky rail at the scroll position, so the capture script now scrolls to the top first.

Bundle: fonts add ~200 KB woff2 (Latin only). The JS chunk-size warning predates this sprint (Firebase SDK).

### Live (real Chrome, real Firebase config, `EYES_LIVE_TESTS=1 pnpm test:live`)

| Check | Result |
| --- | --- |
| LIVE-001/002/003/005/006/007/008 | **PASS (7)**: browser and Prompt API readiness, Firebase project/app, App Check readiness, no `generateContent` without approval, prompt fingerprint, on-device blocker recorded, console/layout |
| LIVE-004 / LIVE-009 (real Gemini `IN_CLOUD`) | **NOT RUN.** Needs `EYES_LIVE_CLOUD=1` plus a registered `EYES_APPCHECK_DEBUG_TOKEN`, which is not present in this shell. No paid request was made |
| LIVE-013 / nano-reliability (real Gemini Nano) | **NOT RUN.** Needs `EYES_CHROME_PROFILE` with the Nano component; not present |
| LIVE-018 | SKIPPED (opt-in) |

The live specs use only selectors this sprint preserved. The Sprint 4/5 real-inference evidence is still the latest live proof of `HYBRID_QUALIFIED`, and this sprint changed no inference code path.

## Risks / rollback

- **Approval UX.** The exact prompt is now one click away instead of shown by default. The gate is unchanged (same preview, hash binding, single use, invalidation). The summary is derived from the same `preview.payload`.
- **Private reveal.** "Reveal private source" displays local values in the page. This is local-only, as before ("Inspect first record"), and is never part of any payload, log or telemetry; E2E-028 and E2E-051 still pass.
- **Fonts.** Self-hosted from `node_modules`, so no CDN request is involved. If `@fontsource` is unavailable, CSS falls back to system serif/sans/mono.
- **Browser support.** The layout uses CSS grid with custom-property `grid-row`, `backdrop-filter` (progressive) and `<details>`. It was tested in Chromium only (the target is Chrome for Gemini Nano); Firefox and Safari were not tested.
- **Performance.** The animations are CSS-only and short; the stagger is bounded by field and operation counts (≤ 16 ops).
- **Not done.** No full screen-reader audit (NVDA/VoiceOver) was performed: semantics were checked by tests and review only. No independent user testing.
- **Rollback.** Revert the merge commit of this PR. No data, contract or config migration is involved.

## Sprint 7 readiness (not started)

| Item | Readiness |
| --- | --- |
| Fix & Retest | **Ready for UI.** The inspector, finding → operation links, `executionByOperation` and the existing local editor give the entry points. A reviewed correction payload (`disclosureSummary`) exists but is unused; a new disclosure review would be required |
| Portable integration export | Not started. The `export` contract and manifest builder exist; the workflow rail would need a sixth step |
| Additional test scenarios | The visual harness and the `__EYES_WITHOUT_A_FACE_TEST__` switches make new scenarios cheap |
| Independent developer usability testing | Ready to run. The landing and studio are self-explanatory per this audit, but that is untested with users |
| Hackathon submission | Blocked on the owner approvals carried over from Sprint 5 (deployment, video). New after-screenshots are available for the Devpost draft |
