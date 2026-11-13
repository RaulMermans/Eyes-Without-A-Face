# 0010 — Portable integration export

Status: Accepted
Date: 2026-11-13

## Context

Through Sprint 8, a verified mapping existed only inside the browser tab. A developer could not take the result away and run it. Export Contract 1.0.0 described a manifest but no runnable artifact.

Constraints: no second mapping interpreter, no execution of model output, no private records or alias bindings in the artifact, and honest status labels.

## Decision

1. **Ship the app's own engine.** `src/export/runtime/runtime.ts` wraps `executeMappingBatch`, `validateContract` and `classifyRow` and adds only alias binding. It is bundled into one dependency-free ES module (`scripts/build-runtime.mjs`) and committed. A test rebuilds it and fails on drift. Every package pins the runtime and runner by SHA-256; the runner refuses a mismatching runtime.
2. **Alias-level mapping, local binding.** The package carries the mapping over Phantom aliases and an empty bindings template. Binding aliases to real fields happens in the destination environment, is validated before anything runs, and never travels with the export. Field names are sensitive metadata. There is no "export with bindings" option.
3. **Fixtures are the reviewed twin examples** (the approved disclosure's `syntheticExamples` when one exists). The engine's results on them are recorded at export time; `run.mjs verify` must reproduce them byte for byte (value-free fingerprint).
4. **Eligibility is computed, never asserted.** `exportEligibility` re-classifies rows without ground truth, adds semantic and revision verdicts and hidden-case coverage. Partially verified mappings export only as a confirmed `DRAFT`.
5. **A blocking privacy scan** runs over every data-bearing file before download. App-owned static code is exempt from the value scan (identical for every export) but not from secret patterns.
6. **Export Contract 1.1.0** (additive; 1.0.0 stays valid).

## Consequences

- A judge or developer can download, unzip anywhere and run `node run.mjs verify` with no install (EXP-001, E2E-090).
- The ZIP is about 0.4 MB, mostly the bundled ajv validator.
- Adding a mapping operation now also requires `node scripts/build-runtime.mjs`; the freshness test enforces it.
- Approved category labels may appear in the package (they were already disclosed); unapproved labels block the export.

## Alternatives rejected

- Generating executable code from the mapping or from Gemini output: forbidden by AGENTS.md.
- An npm package dependency: adds a publish step and supply-chain surface for a hackathon artifact.
- Exporting resolved (field-name) contracts: would leak source structure.
