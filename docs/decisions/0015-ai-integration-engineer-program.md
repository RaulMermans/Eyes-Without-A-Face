# 0015 — AI integration engineer: hybrid workflow-agent architecture and a gated program (18A–18E)

Status: Accepted (architecture and sequencing). Each later stage still needs its own ADR before implementation.
Date: 2026-11-16

## Context

The product goal changes from a "privacy-aware transformation engine" to "an AI integration engineer for private data":

> Connect your systems → tell EYES what you want → EYES builds and verifies the integration → approve → it works.

The Sprint 18 audit ([master assessment](../program/master-transformation-assessment.md)) found three things.

**The deterministic half is strong and validated.** It covers:

- the canonical engine and the Mapping DSL;
- proposal conversion and alias resolution;
- the Phantom Twin and the allowlist disclosure projection;
- single-use approval bound to the outbound prompt hash;
- the Reality Check, the acceptance policy and semantic verification;
- one bounded blind revision with a ground-truth-blind decision rule;
- the portable export with a provenance-aware privacy scan;
- the guided flow;
- the Source Adapter Layer.

**The AI half adds little measurable value today.**
- Nano was neutral (Sprint 12). Cloud mappings were right "because of ordering, not information".
- Gemini made schema-valid but wrong date and priority mappings (Sprint 8). Wrong local pre-selections included a date of birth used as a start date (Sprint 16A).
- No real usability session has been run.

**Nothing exists for connected integrations.** There is:

- no destination writer;
- no persistence;
- no versioning or rollback;
- no scheduling;
- no drift detection.

The browser-only architecture (ADR 0003) cannot hold credentials for unattended runs.

## Decision

### 1. One hybrid workflow-agent, not a multi-agent system

| Responsibility | Owner |
| --- | --- |
| Interpreting the private source (meaning, relationships, date order, sensitivity) | Gemini Nano, `ONLY_ON_DEVICE`, validated against the deterministic profile |
| Designing the mapping and repair proposals from the approved twin | Gemini Cloud, `ONLY_IN_CLOUD`, through the existing disclosure gate |
| Permissions, approvals, state transitions, execution, validation, verdicts, idempotency, export, writes | Deterministic code only |

- **There is one bounded reasoning component per side.** A second agent is added only if an experiment shows a material gain.
- **Models never authorize anything.** They never execute code, never set the acceptance policy and never certify their own output. Proposals reach the engine only through `convertProposal` → `resolveAliases`.
- **Single sources of truth carry forward unchanged:**
  - one engine (`src/domain/mapping`);
  - one source normalization (`NormalizedSource`);
  - one workflow state (`WorkspaceState` + `deriveRuntime`);
  - one approval model (`src/twin/authorization*`);
  - one verifier pipeline (`outcomes.ts`, `src/semantics`);
  - one export builder.

  New capabilities extend these; they do not run beside them.

### 2. Stages are gated by evidence, in order

| Stage | Product state | Gate (must pass before the next stage starts) |
| --- | --- | --- |
| **18A** AI intelligence and mapping reliability | State 1 groundwork | **Gate A:** the pre-registered AI-value experiment shows better correspondences or less user effort on an independent holdout, with no privacy or correctness loss ([evaluation](../evaluation/sprint-18a-ai-value.md)) |
| **18B** One AI-first experience | State 1 | **Gate B:** real, independent usability sessions reach a valid AI-generated integration without hand-mapping every field |
| **18C** Real connector pair | State 2 | **Gate C:** a sandbox source → destination run, every write approved and independently verified |
| **18D** Durable execution | State 2 | **Gate D:** repeated runs, recovery from controlled failures, zero duplicate writes |
| **18E** Governed repair | State 3 | **Gate E:** controlled schema drift → tested, approved repair, with no leak and no corrupted records |

- A stage that fails its gate stops the sequence. EYES never advertises a later stage's capability.
- The hackathon release (accepted production SHA) stays untouched until the owner approves a replacement SHA.
- Stages 18C and later are post-hackathon scope.

### 3. 18C+ needs a backend, and that is a separate decision

Persistent credentials, scheduled runs and destination writes cannot live in a static browser app. Before any 18C code, an ADR must choose:

- the execution service;
- credential storage and isolation;
- the tenancy model;
- the first connector pair (proposed: CSV or read-only source → a CRM contacts sandbox).

ADR 0003 ("no backend unless a concrete requirement appears") stays in force until then. Writing to a destination is that concrete requirement.

### 4. 18A starts with the twin's information content

The cloud planner can only be as right as the twin lets it be. 18A therefore starts with the information content of the twin ([ADR 0016](0016-concept-bearing-phantom-twin.md)), before any prompt work:

- Prompt and response-schema changes touch frozen files (`src/inference/prompts.ts`).
- They come later, and only when the experiment shows that the twin is no longer the bottleneck.

## Consequences

- 18A ships no UI redesign. 18B waits for Gate A.
- A Gate A run needs live cloud requests. The budget is pre-registered, and the owner approves it before the run.
- Each stage ends with the release status rules in `AGENTS.md`.
