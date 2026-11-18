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

## Guided recovery rules (Sprint 14)

- A rejected proposal is explained by `diagnoseRejectedProposal` (`src/app/guided/recovery.ts`): existing issue codes only, plain words, no values, no raw model text. The validator stays the only judge; diagnosis never changes, repairs or promotes a proposal.
- No deterministic correction of model output exists. Add one only with a recorded failure, a proof that it preserves meaning and is unambiguous, an allowlist entry, tests and an ADR. Never translate placeholder category labels into real ones.
- Category names leave the device only after the user's explicit, per-field choice (`applyTwinOverride` → `discloseCategories`), shown with the names and the rare-label warning. Sharing prepares a NEW request for review; it never approves or sends.
- Recovery never offers the identical request when the cause is in the inputs (`sameRequestWillFail`). An identical re-ask needs a fresh approval and is offered at most `ASK_AGAIN_LIMIT` times per request content (counted from hashed telemetry).
- A recovery step that fails is shown (`guided-recovery-error`). No button may appear to do nothing.
- The guided destination is the one on screen: Build validates and applies the visible schema, or refuses with a reason.
- Never call a simulated on-device run "Gemini Nano" (`fieldUnderstanding`), and never claim Nano ran unless the on-device stage completed.

## Target-first mapping and local meaning (Sprint 15)

Decision: [ADR 0014](docs/decisions/0014-target-first-mapping-and-local-meaning.md). Code: `src/app/guided/field-plan.ts`.

- **Ask per destination field, never per source field.**
  - Offer only compatible candidates (at most three, plus "Choose another field").
  - Never list every category field for disclosure.
  - A disclosure checkbox appears only for the field the user chose. It is off by default.
- **Readiness is per destination field** (`planFields`, `categoryNeed`). A shared unrelated field never makes a required fixed-list field ready.
- **Name similarity is a hint, never evidence.**
  - Never pre-fill a category translation.
  - Never translate business states by language similarity.
  - An identical spelling is copied only on an explicit click.
- **A mapping built on this device** goes only through the existing hand-written route:
  - `localContract` → `mappingText`, with `mappingChoice: "manual"`;
  - then the canonical engine and export.
  - It is labeled "built on this device — no AI" and is never called Gemini. No new operation, no second engine.
- **The user's valid translation is a trusted user-declared `enum-meaning` constraint** (`meaningConstraints`).
  - Invalid declarations are dropped, never trusted.
  - A model suggestion never becomes trusted evidence.
  - Confirming one field never verifies another.
  - Never promote a status because a control was clicked: the verifier decides.
- **Field decisions go through `applyFieldDecision`.**
  - They clear a local result and any revision run.
  - They never rewrite or clear a prepared or approved cloud request.
- **The guided acceptance policy (`guidedPolicy`) comes only from the user's translations.** Unknown or set-aside values are quarantined, never transformed. A loaded scenario keeps its own policy.
- **Category names enter the downloaded package only after the explicit per-field opt-in** (`packageLabelSources`). Never widen the privacy scan in any other way.
- **`bindings.local.json` is a separate local download.** Never put it, or records, in the ZIP.

## Mapping integrity (Sprint 16B)

Report: [docs/qa/sprint-16b-mapping-integrity.md](docs/qa/sprint-16b-mapping-integrity.md). Code: `src/app/guided/field-plan.ts`, `src/export/provenance.ts`.

- **A suggestion is never a decision.**
  - A non-category destination field gets a rule only from the user's explicit choice (`fieldMatches[target]` = a path).
  - The best-ranked candidate is shown as `suggested` with a "Use …" button and builds nothing.
  - Never auto-apply, pre-select or bulk-confirm suggestions.
- **Three states per destination field:** no entry = undecided; a path = chosen; `null` = the user chose no field.
  - `null` survives every replan and hides the suggestion.
  - Required + `null` blocks the local build with a reason.
- **A suggestion needs specific evidence** (`SourceCandidate.specific`): email share, a date type, unique codes for an id-like field (never an email column), a numeric or boolean type, or a similar name.
  - Never suggest a field with no such evidence.
  - Do not tune ranking on the Sprint 16A held-out data.
- **Decisions belong to a destination.**
  - Use `withDestination` for every destination change.
  - It keeps a decision only when that field's name, type, format, allowed values and required flag are unchanged.
- **Never headline "Integration ready" unless meaning was verified for every destination field.**
  - Otherwise say "Structure verified" and who chose the field matches (`honestVerdict`).
  - The export status VERIFIED is structural (Export Contract unchanged) and must be explained as such.
- **The export privacy scan judges by provenance (`src/export/provenance.ts`).**
  - Only application-owned text may be masked: owned`` template literals, `appCode` values, and exact JSON paths in `JSON_PROVENANCE`.
  - Sentences are recognised by skeletons derived from the same tables that build them (`ELIGIBILITY_TEXT`, `LIMITATION_TEXT`).
  - Never mask by bare key name or word list.
  - Never mask labels, approved fallback/default values, fixture outputs or anything else user-derived.
  - Secrets, canaries and field names are judged on the full text.
  - A file without provenance is scanned as before.
  - Packaged bytes must not change because of scanning.
- **Fields the mapping cannot use are listed on the data screen** (`excludedFields`), with the reason and a rename example.
  - Never hide them silently.
  - Never rename a user's columns.

## Hybrid journey recovery (Sprint 17A)

Report: [docs/qa/sprint-17a-hybrid-recovery.md](docs/qa/sprint-17a-hybrid-recovery.md).

- **Never offer a request that preflight proves unusable.**
  - `cloudBlockedTargets(plan)` lists required fixed-list destination fields a request cannot fill: no chosen field (`choose-source`), no category-like field (`no-source`), or names that are not shareable or not shared.
  - While any is listed:
    - "Approve and send" is disabled;
    - the headline says "Not ready to send";
    - `approval-blocked` names each prerequisite;
    - the routes are: choose the field, share only that field's names (a NEW request), build on this device, or change the destination.
  - Uncertainty Gemini can resolve (which field gives an id, an email or a date) never blocks.
- **Offer sharing only for a field the user chose for a required target.**
  - Never offer a bulk share of unchosen fields' names.
  - Never share automatically.
- **Name an incomplete mapping.** `unwrittenRequiredTargets(contract, destination)` lists required destination fields no operation writes.
  - The Result names them, explains that no record can be valid, and offers the local route.
  - Never add, repair or infer a missing operation.
  - The validator, contracts and export eligibility are unchanged.
- **An unambiguous date format never establishes meaning.** Say which field was read and that EYES can't tell whether it means the destination field.

## AI integration program and concept-bearing twin (Sprint 18A)

Decisions: [ADR 0015](docs/decisions/0015-ai-integration-engineer-program.md), [ADR 0016](docs/decisions/0016-concept-bearing-phantom-twin.md). Assessment: [docs/program/master-transformation-assessment.md](docs/program/master-transformation-assessment.md).

- **Stages 18A–18E are gated by evidence.**
  - Gate A passed live on 2026-11-16 ([evaluation](docs/evaluation/sprint-18a-ai-value.md)). 18B starts only on the owner's go.
  - Do not start 18C+ (connectors, backend, writes, scheduling) before its ADR and owner approval.
  - Never describe a later stage as shipped.
- **A concept is a claim, never evidence** (`src/phantom/concepts.ts`).
  - Only fixed wordings from `CONCEPT_SPECS` and `QUALIFIER_PHRASES` may reach a descriptor.
  - A name-derived concept is disclosed as `[inferred, unconfirmed]`.
  - `src/semantics` and `src/verification` never read concepts.
  - A bare `name`, `id`, `status` or `date` gets no concept: never add a guess to raise coverage.
- **A meaning wording must not contain a private value or a local field-name segment (≥ 4 characters).**
  - Add alternative wordings instead.
  - Never widen a scan or checker.
- **`TwinOptions.concepts: false` exists only for the evaluation baseline and historical replays.**
  - Never expose it in the product.
- **The Sprint 18A evaluation set is frozen** (`docs/evidence/sprint-18a/ai-value-freeze.json`).
  - Never open `tests/fixtures/ai-value-18a/holdout/`. Score it only with `node scripts/eval-ai-value.mjs`, which writes aggregates only.
  - Tune the lexicon on `dev/` only.
  - The holdout was scored offline and live on 2026-11-16; treat it as **inspected**. Any new claim needs a fresh holdout written by an independent author before the change.

## Planner prompt v4 (Sprint 18A.5) — rejected

Decision: [ADR 0017](docs/decisions/0017-planner-prompt-v4.md) (Rejected).

- `src/inference/planner-prompt.ts` (v4, initial schema 2) is **not wired**. It exists only so the 18A.5 evidence replays.
  - Never import it into the app.
  - A successor needs a new ADR, a fresh holdout and a pre-registration.
- The app's initial proposals use the Sprint 3 instructions and the Sprint 9 per-operation schema.
- A planner prompt must never allow an empty operation list or an unbounded rationale, and must not trade correct mappings for abstention (18A.5 finding).
- Revisions keep their frozen prompts and schema.
- Do not edit `MAPPING_PROPOSAL_INSTRUCTIONS` or `buildCloudPromptText`: historical replays rebuild their recorded prompts from them.
- The 18A.5 holdout (`tests/fixtures/ai-value-18a5/holdout/`) was scored on 2026-11-16 and is **inspected**. Never tune on it.

## Integration Intent Plan (Sprint 18B) — implemented, not shipped

Decision: [ADR 0018](docs/decisions/0018-integration-intent-plan.md). Report: [docs/sprints/sprint-18b.md](docs/sprints/sprint-18b.md).

- **Gate B-AI failed live on 2026-11-17.** Do not merge the branch as the product default or deploy it without a successor that passes a fresh pre-registered holdout. The 18B holdout (`tests/fixtures/eval-18b/holdout/`) is **inspected**.
- **Plans compile only through `src/plan/compile.ts`.**
  - Gemini operations always pass the frozen `convertProposal` gate.
  - User operations come only from `fieldMatches`, `categoryMeanings` and `semanticConfirmations`.
  - Never compile a default.
  - Never treat a zero-operation plan as an integration.
- **Decoder schemas sent to Gemini carry no nested array bounds.** The provider refuses them (HTTP 400 "too many states"). Bounds belong in the canonical schema.
- **The harness legacy planner (`initialPlanner: "mapping-proposal-sprint3"`) is for planner-independent technical-view tests only.** Production never reads it.
- **Category detection accepts real-world labels** (`profileRecords`). A field is a category when it has ≤ 12 labels of ≤ 32 characters and each label is used about twice or more.
  - Labels stay withheld by default.
  - A category is described as "Category field with N distinct values" (the count only, never a label), plus its meaning claim when there is one. Never claim a lifecycle or status meaning that the evidence does not give.
  - `labelCategories: false` reproduces both pre-18B behaviours (token-only detection, "Lifecycle status category"). It exists only for historical replays (18A, 18A.5, 18B evidence). Never expose it in the product.
- **An absent input for an optional destination field omits that field** ([ADR 0019](docs/decisions/0019-optional-destination-absent-input.md)). The record goes on.
  - Required fields still refuse the record.
  - Never fill an omitted field.
- **The leak scan ignores a match only inside an exact application-owned twin segment** (`src/phantom/fixed-text.ts`). Never add a word list.

## AI reliability (Sprint 18C) — Gate C failed, not shipped

Decision: [ADR 0020](docs/decisions/0020-category-groupings-and-plan-recovery.md). Report: [docs/sprints/sprint-18c.md](docs/sprints/sprint-18c.md).

- **Gate C failed live on 2026-11-17** (complete integrations 0 / 24).
  - Do not ship the plan path as the product default without a successor that passes a fresh pre-registered holdout.
  - The 18C holdout (`tests/fixtures/eval-18c/holdout/`) is **inspected**. Never tune on it.
- **An uncertain Gemini match is a question.**
  - `compileIntentPlan` never executes a single-field correspondence below `high` confidence. It asks with Gemini's pick listed first.
  - Only a category match awaiting the user's translation is exempt.
  - Never lower this bar to raise completion.
- **Category groupings are fixed wordings** (`CATEGORY_QUALIFIERS`). They are `[inferred, unconfirmed]` and fail closed on any collision. A wording must not assert more than the name gives: "channel" is neutral, not "acquisition".
- **Plan questions offer every usable field** under "Choose another field". Never pre-select one.
- **Provider failures are not mapping failures.** In an evaluation, a provider failure may get one re-approved request, never an automatic retry.

## Semantic intelligence recovery (Sprint 18D) — implemented, not shipped

Decision: [ADR 0021](docs/decisions/0021-semantic-intelligence-recovery.md). Pre-registration: [sprint-18d-semantic-intelligence.md](docs/evaluation/sprint-18d-semantic-intelligence.md).

- **Model configurations come only from `CLOUD_MODELS`** (`src/inference/cloud-models.ts`).
  - The product default is `gemini-3.5-flash-lite` at its default thinking.
  - Another configuration only in a dev build through `__EYES_EVAL_CONFIG__`, which never switches to simulated adapters.
  - The model and thinking level are part of the approved destination. Never fall back between models; never pick a model the approval did not name.
- **Destination descriptions reach the cloud only in cloud-disclosure 1.4.0**, after `sanitizeTargetDescription`, shown in the review.
  - Never forward a description verbatim, never widen the sanitizer or the leak scan to let one through.
  - A dropped description is a local note, never an error.
  - Never edit 1.0.0–1.3.0 schemas.
- **The Local Semantic Matcher (`src/matching/`) is local-only ranking evidence.**
  - Never send its candidates, scores or paths anywhere; never treat it as trusted semantic evidence; never execute a field because it agrees with Gemini.
  - It may order question candidates and, under the opt-in policy, turn a confident Gemini match into a question.
- **Plan 1.1.0 alternatives are candidates, never operations.** Plan 1.0.0 stays exact.
- **Without `CompileInput.local`, compiling must stay byte-identical to Sprint 18C** (historical replays).
- **The 18D holdout and the author's `author/specs_holdout_*.py` are sealed.** Never open them; score only through the frozen scorer. Stage 1 tunes on dev only. Every live stage needs the owner's budget approval; the default budget is zero.
- Valentine and Transformers.js are offline benchmarks (`scripts/bench/`). Never add them to the app bundle without an ADR that beats the local matcher on fresh evidence.

## Release lifecycle and production acceptance (Sprint 14 — permanent, every sprint)

**Tests passing does not mean the product works in production.** Procedure, commands, budget and evidence layout: [docs/deployment.md](docs/deployment.md#production-acceptance-standard-permanent).

- Every change ends in exactly one evidence-backed status: `CODE_READY` → `DEPLOYMENT_PENDING` → `DEPLOYED_UNVERIFIED` → `PRODUCTION_ACCEPTED`, or `RELEASE_FAILED`. Report it in every sprint report. Never write `PRODUCTION_ACCEPTED` without passing checks run against the deployed URL and the served SHA.
- Deploying is an external side effect. It needs the owner's explicit approval of the exact SHA, after the approval package (target, domain, SHA, artifact, configuration changes, impact, rollback). A sprint brief, PR approval or merge is not deployment approval. A different SHA needs a fresh approval.
- Only `pnpm build:release` output from a clean tree is deployed, after the full regression and `verify:release`.
- After deployment: `pnpm test:production` (deterministic, no inference) and `pnpm test:production:real` (one hybrid happy path within the declared inference budget) against the public URL — never localhost, never a debug token. Store evidence in `docs/evidence/production/<sha12>/`.
- Failure paths are verified by deterministic fault injection locally (E2E), not by provoking provider failures in production. Never loop real requests until one passes; report failures as failures.
- Roll back or stop on: broken core journey, unexpected private-data exposure, App Check disabled or broken, an accepted stale approval, a validation bypass, corrupted exports. Rollback is also approval-gated.

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

A release additionally needs `pnpm build:release`, the owner's deployment approval and production acceptance (see "Release lifecycle" above). Report the release status even when nothing was deployed (`CODE_READY` or `DEPLOYMENT_PENDING`).

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
