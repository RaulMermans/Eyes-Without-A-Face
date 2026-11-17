# 0018 — Integration Intent Plan: separate what connects from how to transform it

Status: Implemented on `sprint-18b-ai-first`; **not shipped** — the pre-registered live gate (Gate B-AI) FAILED on 2026-11-17 ([results](../evaluation/sprint-18b-intent-plan.md#run-2--resumed-and-complete-2026-11-17)). Production `c7220768` is unchanged. Original status: Accepted for implementation (Sprint 18B, Milestone 1). Shipping as the app's initial planner still depends on the pre-registered live evaluation ([sprint-18b-intent-plan.md](../evaluation/sprint-18b-intent-plan.md)).
Date: 2026-11-16

## Context

- **Sprint 18A (Gate A passed):** the concept-bearing twin raised correct correspondences 0.275 → 0.551. Every remaining rejected proposal was `INVALID_ENUM_MAPPING`, and the planner invented 16 values.
- **Sprint 18A.5 (ADR 0017, rejected):** a stricter prompt removed invented values (44 → 0) but cut correct mappings on mappable fields from 0.661 to 0.205. The planner could only say "write this field" or stay silent, so it stayed silent.
- **The structural cause** is the Mapping Proposal 1.0.0 contract. One operation must state the field match *and* every parameter. A model that knows "account status → `status`" but cannot see the category names has no honest way to say so.
- **The guided flow (Sprint 15–17A)** asks the user to choose a source for every destination field. 17A then blocks the cloud request whenever a required fixed-list field has no shared names. The user does the integration engineering; Gemini is optional.

## Decision

### 1. A new model-output contract: Integration Intent Plan 1.0.0

Schema: `src/domain/inference-output/schemas/integration-intent-plan.v1.schema.json`. Types: `src/plan/types.ts`. Spec: [docs/contracts/integration-intent-plan.md](../contracts/integration-intent-plan.md).

- **One entry per destination field.** Each entry states two separate claims:
  - **correspondence:** `target` ← `from` (disclosed aliases);
  - **transformation:** `transform` plus `inputFormat`, `separator` or `valueMap`.
- **Readiness** is one of `ready`, `needs_clarification`, `unsupported` or `no_source`.
  - `missing` codes say what blocks the field.
  - `evidence` codes say why the model believes the correspondence.
  - `confidence` is `high`, `medium` or `low`.
- **Closed vocabularies only.** There is no free text per field, and `summary` has at most 280 characters. This addresses the 18A.5 rationale overflow.
- **What the plan cannot express:**
  - a default value (there is no `default_if_missing` and no `unmapped: "default"`);
  - code;
  - more than 24 entries;
  - more than 4 aliases per entry.
- **A plan with zero executable fields is valid as a planning artifact.** It is never shown, stored or exported as an integration.

### 2. Validation judges each entry; nothing is repaired

`src/plan/validate.ts` validates the plan against the approved 1.1.0 disclosure.

- **The whole plan is rejected** for structural problems: not JSON, schema-invalid, executable content, prototype keys, or the wrong disclosure.
- **An entry is rejected** for an unknown target, an unknown alias (a hallucinated reference), an inconsistent entry, or a duplicate target (every entry for that target is rejected).
- **A translation can be rejected while the correspondence is kept** (`correspondence-only`). This happens when a `valueMap` uses labels that were never disclosed, or values outside the destination enum.
  - This is the core correction. The model's stated field match survives; its invented translation does not.
  - The entry is never rewritten into a different claim. The rejected part is dropped and reported as `INVENTED_CATEGORY_LABEL` or `INVALID_ENUM_VALUE`.
- **Unaddressed destination fields** are listed as unresolved, never as `no_source`.

### 3. Deterministic compilation through the existing gate

`src/plan/compile.ts` turns a validated plan plus the user's answers into a `CompiledIntegration`.

- **Gemini-authored operations** are compiled into a Mapping Proposal and passed through the **unchanged, frozen `convertProposal`**. The plan adds no second validator for operations.
- **User-declared operations** come only from explicit answers already held in `WorkspaceState`:
  - `categoryMeanings[target]` gives `map_enum` with `unmapped: "fail"`;
  - `semanticConfirmations[path]` gives the `parse_date` order;
  - `fieldMatches[target]` is an override, including "no field".
- **A field compiles only when all of these hold:**
  - its source exists;
  - its destination exists;
  - the transformation is supported and its parameters are valid;
  - its category labels are disclosed or translated by the user;
  - no default is involved;
  - local evidence does not contradict it.
- **Local date evidence.**
  - A slash-date `parse_date` whose order the local profile cannot prove, and which the user has not confirmed, becomes `needs_clarification("date-order")`.
  - An order that contradicts proven local evidence is a `semantic-disagreement`. EYES asks the user and never silently switches to the proven order.
- **Execution is unchanged:** `resolveAliases` → `executeMapping`, then the Reality Check, the acceptance policy and the semantic verifier.
  - The user's translations are trusted `user-declared` enum-meaning constraints (Sprint 15), so the verifier checks them.
  - Gemini's own translations are never trusted evidence.

### 4. Clarification is generated from the plan, never written by the model

`src/plan/clarify.ts` builds a prioritised question list from the compiled fields.

- **The four kinds of question:**
  - `translate-categories`;
  - `confirm-date-order`;
  - `choose-field`, with the model's candidates;
  - `missing-required-source`, answered by choosing a field or changing the destination. A default is never an answer.
- **Order:** required fields before optional ones. A field that is already executable is never asked about.
- **Answers are stored in the existing decision maps** through `applyFieldDecision`. No new answer store exists.
- **Question wording is application-owned.** Model text never reaches a question.

### 5. Failure categories and next actions

`src/plan/failures.ts` classifies every failure into exactly one of these categories:

- `incorrect-correspondence`, `missing-correspondence`, `invalid-parameters`, `missing-category-values`, `invented-values`;
- `semantic-disagreement`, `unsupported-operation`, `invalid-source-data`;
- `provider-failure`, `privacy-blocker`, `destination-incompatible`.

Each category has one next action: `ask-user`, `revise-with-model`, `review-records`, `change-destination`, `fix-source-data`, `new-request`, `map-manually` or `none`. A category without a meaningful next action is not allowed.

### 6. Bounded repair

- **Plan requests are capped.** At most `PLAN_REQUEST_LIMIT = 2` plan requests (the first plus one) are made per (source, destination) content. Each one is a NEW preview that the user approves.
- **An identical request is never offered** when the cause is in the inputs (`sameRequestWillFail`, Sprint 14).
- **A revised plan never replaces a better one.** `src/plan/compare.ts` returns `BETTER`, `NOT_BETTER` or `WORSE`, and only `BETTER` replaces the accepted plan.
- **The Sprint 7/8 blind revision stays as it is** (frozen prompts and schema). It is offered for a plan-based mapping only when no operation is user-declared. User-declared translations hold private labels, so they never enter a feedback payload.

### 7. One workflow state

- `ProposalState.plan: PlanReceipt | null`:
  - `validated` is the immutable validator output;
  - `compiled` is derived and recomputed by `recompilePlan` whenever an answer changes.
- `ProposalState.result` stays the single acceptance record that the engine, runtime, export and revision code read:
  - when the plan is executable, it is the compiled plan accepted by `acceptCompiledPlan`;
  - otherwise it is a `stage: "plan"` refusal.
- **No new workflow engine** and no parallel state. `deriveRuntime` and `guidedStatus` keep reading canonical state.

### 8. Model and privacy boundaries (unchanged unless stated)

- **The request is unchanged.** It is the same disclosure 1.1.0 payload, the same approval gate and the same single-use approval bound to the outbound prompt hash.
  - Only the instruction text (`src/inference/intent-prompt.ts`, new) and the response schema (`integration-intent-plan-1`) differ.
  - The frozen `prompts.ts` and `buildCloudPromptText` are untouched, so historical replays still rebuild their prompts.
- **Category names still leave the device only after the user's explicit, per-field choice.**
  - With the plan, withheld names no longer block the request.
  - Gemini states the field match; the user translates the names locally.
  - This **replaces the 17A rule** "never offer a request that cannot fill a required fixed-list field" for the plan planner. The request can now produce a useful plan for that field.
- **Defaults are never filled.** No customer id, email, status, amount, date, placeholder or constant comes from the model.
- **Provenance:**
  - the plan's operations are labelled Gemini (`IN_CLOUD`, real provenance);
  - user-declared operations are labelled "your answer";
  - the export names both. The Export Contract stays 1.1.0 with origin `gemini-cloud`, plus one owned limitation line stating how many destination fields were completed from the user's answers (a count only; no field names).
- **Gemini Nano:** no change in this milestone. It stays conditional and user-started, with no cloud fallback.

### 9. One AI-first journey

The guided flow becomes **Connect → Destination → Generate → Verify → Deliver**. It reorders the same `WorkspaceState`, with the primary action "Generate my integration".

- **Target-first manual mapping (Sprint 15/16B) becomes "Advanced: map fields yourself".**
  - It is a recovery route and is unchanged.
  - "A suggestion is never a decision" still holds there.
- **Gemini's correspondences are decisions the user can see and override.** They are not suggestions the user must confirm one by one, because an approved request delegated exactly this choice to Gemini.
  - The Result names who chose each match.
  - "Integration ready" still needs verified meaning (`honestVerdict`).

## Ownership (Sprint 18B Phase 2)

| Worker | Owns | Must not edit |
| --- | --- | --- |
| A — planner and inference | `src/plan/validate.ts`, `src/inference/intent-prompt.ts`, the response-schema selection, the plan-aware test adapters | `src/plan/types.ts`, the frozen files |
| B — compiler | `src/plan/compile.ts`, the `pipeline.ts` plan stage, the `run-actions.ts` plan path, `export-context.ts` | UI |
| C — UI | `src/app/App.tsx`, `src/app/guided/*`, `experience.ts`, E2E | `src/plan/*` |
| D — clarification and repair | `src/plan/clarify.ts`, `failures.ts`, `compare.ts` | UI, the compiler |
| E — source compatibility | `src/sources/`, `src/domain/profile/`, `src/twin/target-disclosure.ts` (fix only) | everything else |
| F — independent evaluation author | `tests/fixtures/eval-18b/` only | all code |

Ownership exception (lead-approved after review): Worker E's root-cause fix touched `src/privacy/leak-scan.ts` and added `src/phantom/fixed-text.ts`. The disclosure leak scan now ignores a match only when it lies entirely inside one exact application-owned twin segment (derived from `defaultDescriptor`, never hand-listed); see [docs/qa/sprint-18b-source-compat.md](../qa/sprint-18b-source-compat.md).

The lead architect owns `src/plan/types.ts`, this ADR, the pre-registration, integration and acceptance.

## Consequences

- **The Mapping Proposal 1.0.0 contract and its gate are unchanged.** Revisions, historical replays and the technical view keep working.
- **A plan whose required fields stay unresolved** is a clear, partial artifact: the user sees which questions remain. It is never a "DRAFT integration" unless something was executed and verified.
- **If the pre-registered live comparison fails,** the plan planner is not shipped. The app reverts to the Sprint 3 initial prompt, as ADR 0017 did.
