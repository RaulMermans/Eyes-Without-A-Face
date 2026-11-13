# Agent guide — Eyes Without a Face

## Mission

Build a privacy-aware integration tool: private CRM JSON stays local; on-device inference may interpret structure; only an approved Phantom Twin may go to cloud Gemini; mapping execution and verification stay local and deterministic.

## Architecture constraints

- Application (React) / domain (contracts) / infrastructure (Firebase, files, config) stay separated.
- `src/domain` must not import React, Firebase, or browser-only APIs.
- Mapping execution must not depend on a model provider. Use `executeMapping` / `executeMappingBatch` in `src/domain/mapping`. Do not execute model-generated JavaScript.
- Do not use Firebase `InferenceMode.PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`. Automatic cloud fallback is forbidden.
- Do not execute model-generated JavaScript.
- Do not persist raw customer datasets.
- Do not add authentication or a backend unless a concrete requirement appears.
- Local development must run without Firebase credentials.
- Missing configuration must never trigger an unauthorized cloud call.
- Model mapping proposals reach the engine only through `convertProposal` (`src/proposal/convert.ts`) and `resolveAliases` (`src/proposal/resolve.ts`). Never modify the engine to accept invalid AI output, and never repair model JSON.
- Phantom aliases (`f_NN`) are the only field identifiers in cloud payloads. Keep alias bindings in `PrivateBindings`; never serialize, log, prompt, or export them.
- Destination schemas reach the cloud only as the reviewed `target` of a cloud-disclosure 1.1.0 payload. Never append text to an approved prompt.
- Label every proposal by origin (Gemini `IN_CLOUD`, simulated test adapter, manual edit). Never present deterministic or simulated output as Gemini or on-device AI.

## Release rules (Sprint 5)

- Deploy only output of `pnpm build:release` (clean tree, App Check debug forced off, Git SHA stamped, `verify-release` PASS). Never deploy `pnpm build` output: Vite loads `.env.local` in every mode.
- Deployment, reCAPTCHA domain changes, repository visibility changes, CI billing, and Devpost submission all need explicit owner approval.
- On-device failures: at most one user-initiated retry (`ON_DEVICE_USER_RETRY_LIMIT`), resuming unclassified fields. Never retry automatically, never fall back to the cloud.
- Do not offer UI steps that are not implemented.

## Interface rules (Sprint 6)

- Use the semantic tokens and primitives in `src/components/spectral.tsx`; see `docs/design/design-system.md`.
- Never distinguish private / synthetic / cloud-bound by colour alone: pair zone colour with line style, icon, and label.
- Presentation derives from workspace state; do not add parallel authoritative state. Visualizations must not show "validated" before validation ran.
- Operation numbers are 1-based everywhere (`opNumber`).
- No animation may suggest private data moving toward the cloud. Honour `prefers-reduced-motion`.

## Blind revision rules (Sprint 7)

- Failure feedback reaches the cloud only as Blind Revision Feedback 1.0.0 inside a cloud-disclosure 1.2.0 request built by `projectRevisionFeedback` + `buildRevisionPayload`, previewed, and approved through the existing gate. Never serialize a Reality Check report, engine messages, values, source names, or Nano rationales into any payload.
- At most one cloud revision per (approved disclosure, initial mapping). No automatic or recursive revision; the evaluator may recommend, only the user approves.
- Revised proposals go through `convertProposal` against the original 1.1.0 disclosure. Never repair them.
- Verdicts come only from `src/verification/outcomes.ts` under a versioned local acceptance policy. Quarantine is never a success; an unapproved fallback/default is `REJECTED_BY_POLICY`. Gemini never sets the policy.
- Gemini Nano may read bounded private context (`ONLY_ON_DEVICE` only). Its output is validated against the deterministic profile and changes the twin only after the user applies it. Never log, persist, or disclose the private prompt or rationale.
- Holdout cases are never profiled, disclosed, used for feedback, or used to tune prompts.

## Semantic verification rules (Sprint 8)

- Semantic constraints live in a local Semantic Verification Contract 1.0.0 (`src/semantics/`). Only `user-declared`, `source-contract`, `local-rule` or a *sufficient* `deterministic-observation` may be `trusted`. A model suggestion (Nano or Gemini) is never trusted.
- Never derive a constraint from ground truth (`expected`) or from holdout records. Observations read imported plus revision-feedback records only. `src/semantics/` must not import fixtures or evaluation code.
- Unknown is never a pass. Report `SEMANTIC_AMBIGUOUS`, `SEMANTIC_EVIDENCE_MISSING` and `SEMANTIC_UNVERIFIED` as such. Never present schema validity as correctness.
- Semantic feedback reaches the cloud only as Feedback 1.1.0 inside disclosure 1.3.0, through the same gate.
  - A constraint is sent only after an explicit per-constraint opt-in, and only with labels already approved for its alias.
  - Without a sendable semantic finding, the output must stay Feedback 1.0.0 / 1.2.0, byte-identical to Sprint 7.
- Revised mappings are judged by `src/revision/decision.ts`: ground-truth blind, with operation-level regressions. Never promote a revision automatically; a gain made only by holding records back is not `ACCEPTED`.
- Benchmark inputs are frozen in `docs/evidence/sprint-8/freeze-manifest.json`. Change a frozen file only with `node scripts/freeze-benchmark.mjs --amend "reason"`, and report the amendment. If you inspect a holdout and then change anything, create a fresh holdout.

## Export and reliability rules (Sprint 9)

- Portable packages are built only by `buildIntegrationPackage` (`src/export/package.ts`) from `exportCandidates` (workspace state). Status comes only from `exportEligibility`; never mark a draft or partially verified mapping as VERIFIED or production-ready.
- The package runtime is the app's engine, bundled by `scripts/build-runtime.mjs`. After changing anything it imports, run `node scripts/build-runtime.mjs` and commit the regenerated bundle (EXP-007 fails otherwise). Never add a second interpreter or generate code from a mapping.
- Packages contain alias-level mappings only. Never pack records, outputs of private records, source field names, alias bindings, prompts, rationales, engine messages, tokens or config. The privacy scan blocks; never weaken it to make an export pass.
- Provider failures go through `classifyUnknownError` and `guidanceForFailure`. Show raw provider text only as collapsed local detail. Recovery from a cloud failure is a NEW preview that the user approves again; a failed revision never resets the revision budget.
- Preflight sends nothing. CONFIGURED never means available; VERIFIED needs a real, unsimulated result in this session.

## Experience rules (Sprint 10)

- The product is organized as CONNECT / OBSERVE / OUTCOME (`src/app/experience.ts`). Modes are UI navigation only: switching modes never changes workflow state and never grants approval. Do not add a second workflow engine.
- "Build Integration" runs local steps only and stops at the disclosure approval. Never approve, send, retry or start on-device inference on the user's behalf.
- Build the disclosure preview only through `prepareDisclosureReview` (`src/app/disclosure-actions.ts`).
- The runtime is `deriveRuntime` (`src/app/runtime-model.ts`): a pure function of workspace state, the prepared twin, this run's safe workflow events and the local evaluators. Never record runtime state separately, and never mark a stage `completed` without the state that proves it. Optional stages that did not run are `skipped`. Unknown meaning is never a pass. No progress percentages and no invented steps.
- Runtime text, inspector and timeline carry codes, counts, durations, labels and short hashes only (PRV-RT-*). Never send runtime events anywhere.
- Black Halo tokens keep the Sprint 6 token names and roles. Measure contrast (≥ 4.5 : 1) before changing a colour.

## Acceptance rules (Sprint 11)

- OBSERVE presentation helpers (`RUNTIME_GROUPS`, `nextStep`, `lastCompletedStage`, `actionLabel`, `boundaryState`) are pure readings of `deriveRuntime`. Never add a stage, status or event to make the UI simpler. Collapsed phases hide stages; they never remove them.
- The on-device capability probe runs once per loaded source (`src/app/use-on-device.ts`). It is a local check, never inference. On-device interpretation still starts only on a user click.
- Twin changes go through `applyTwinOverride`, which always invalidates downstream. `InvalidationNotice` explains a cleared request; it never restores or reuses an approval.
- The OUTCOME headline comes from `outcomeVerdict`. Never headline "Verified locally." unless meaning was verified for every destination field.
- The Privacy Boundary may animate only through CSS transitions on real state changes. No loops, no animation on first paint, and nothing drawn from the private source across the boundary.
- Never record participant data, recordings or quotes in the repository. Never mark usability or screen-reader acceptance as passed without a real session.

## Release and evidence rules (Sprint 12)

- The public build is <https://eyes-without-a-face-b7281.web.app>. A new deployment needs the owner's approval of its **exact** SHA, even when an earlier deployment was approved. Hosted acceptance runs through `playwright.hosted.config.ts`, never with an App Check debug token.
- The Submission Period opened 2026-11-11 21:30 UTC. Sprints 0–4 are pre-existing work; never describe them as built during the period, and never rewrite commit dates ([docs/hackathon-history.md](docs/hackathon-history.md)).
- Do not commit literal API keys or site keys, even public web identifiers (Official Rules). Use placeholders.
- Experiment scenarios live in `EXPERIMENT_SCENARIOS`, never in the frozen `EVALUATION_SCENARIOS`. Freeze an experiment (`scripts/freeze-nano-value.mjs` pattern) and commit the freeze before any model run.
- A body-scan match is investigated and traced before any conclusion; never delete a failing run, never widen an allowlist to make it pass.
- Video upload, Devpost submission, repository settings, API-key restriction or rotation, and any Firebase configuration change need explicit owner approval.

## Guided flow and source rules (Sprint 13)

- The default page is the guided flow: Your data → Destination → Result ([ADR 0012](docs/decisions/0012-guided-flow-and-source-adapters.md)). The Sprint 10/11 experience is the technical view (`/#technical`). Both views share one `WorkspaceState`; switching changes no workflow state.
- Approve, reject, send, cancel, fresh request and local verification live in `src/app/run-actions.ts`. Do not reimplement them in a component.
- "Build integration" stops at the approval. "Approve and send" approves and sends exactly the previewed request, once. Never auto-approve, never pre-authorize, never combine the revision approval with the first one.
- The guided status comes only from `guidedStatus` (a reading of `deriveRuntime` and export eligibility). No percentages, no invented steps.
- Every input goes through the Source Adapter Layer (`src/sources/`) into one `NormalizedSource`, then `toImportedSource`. No per-format pipeline.
  - Never coerce CSV values automatically. Conversions are lossless and opt-in.
  - Never evaluate Excel formulas, run macros or fetch external links.
  - Messages carry row and column positions and names, never values.
- The REST connector is read-only: one GET after an explicit click, HTTPS public hosts only, no redirects, no proxy, browser CORS. A token lives only in the connect form's memory for one request. Never store, log, export or disclose it.
- Transformed-record downloads are explicit, local and separate from the portable package. Never add records to the ZIP.
- Do not label a destination as "connected": EYES does not write to destinations.

## Tool and data permissions

Allowed without extra authorization: local files in this repository, local tests, local Vite server, Playwright against localhost.

Not allowed without explicit user authorization: creating Firebase/Google Cloud projects, enabling billable APIs, deploying hosting, publishing the repository, force-pushing, or changing external systems.

## Coding conventions

- TypeScript strict mode. No enums (erasable syntax). Use `import type` under `verbatimModuleSyntax`.
- JSON Schema 2020-12 is canonical for contracts; keep TypeScript types aligned.
- Prefer small, tested modules over new packages.
- Do not add decorative controls that look functional but do nothing.
- Do not simulate successful inference.

## Required checks

Before claiming a task complete:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm test:privacy
pnpm test:evaluation
pnpm build
pnpm test:e2e
```

Do not skip failing tests, stub them empty, or weaken acceptance criteria to go green.

## Privacy rules

- Source contracts are `localOnly: true`.
- Phantom contracts must not embed private canaries or raw private records.
- Cloud inference may receive only a `CloudDisclosurePayload` built by allowlist projection, never a serialized Phantom Contract.
- Approval is single-use and bound to the exact outbound application prompt plus destination. Do not retry timed-out cloud calls.
- Do not claim inference provenance from the requested mode. Missing `inferenceSource` is `PROVENANCE_UNVERIFIED`.
- Export manifests set `includesPrivateSourceFixtures: false`.
- Private-data canary: `PRIVATE_CANARY_PII_DO_NOT_SHARE`.
- Engine messages may quote private values. Show the Reality Check's safe summaries by default, keep raw messages as local detail, and never send failures to Gemini without a separately reviewed and approved payload.
- Workflow telemetry (`src/observability/workflow-log.ts`) records codes, hashes, counts, and durations only.

## Sprint completion

Report PASS / FAIL / SKIPPED / BLOCKED / NOT RUN with evidence. Do not start the next sprint automatically.
