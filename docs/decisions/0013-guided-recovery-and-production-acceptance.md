# 0013 — Guided recovery, category-name readiness and the production acceptance standard

Status: Accepted
Date: 2026-11-14

## Context

A user of the deployed Sprint 13 build (`a548d7f`) reached "Needs your attention — Gemini's answer was not a usable mapping". The only ways forward were "Prepare a new request" (the identical request) and the technical view.

Sprint 14 reproduced this with real Gemini through the guided UI ([evidence](../evidence/sprint-14/guided-diagnosis.json)):

- Helpdesk, the default destination, failed 3 of 3 runs.
- Marketing failed 1 of 1.
- Billing succeeded 1 of 1.

Each failure was `INVALID_ENUM_MAPPING` at `convert`. Replaying the answers through the unchanged `acceptProposal` traced the cause:

- The guided flow never offered the existing category-name opt-in (`discloseCategories`), so the status field reached Gemini as "category labels withheld", with placeholder labels in the examples.
- Helpdesk and Marketing *require* a value from a fixed list. No valid mapping existed for that request: a guessed `map_enum` is refused, and an omitted one leaves a required field empty.
- The validator was right. The product asked a question that could not be answered, then offered to ask it again.

The deployment itself had no recorded production acceptance. CI and local E2E (which use a simulated adapter) were green throughout.

## Decision

### 1. Diagnose with existing codes, in plain words

`diagnoseRejectedProposal` (`src/app/guided/recovery.ts`) reads the failed `acceptProposal` result and the approved disclosure. It returns:

- a kind (withheld categories, unknown category, unknown source field, unknown destination field, duplicate destination, unsupported operation, invalid parameters, unreadable answer, request mismatch);
- a title and plain sentences;
- the recommended options;
- whether the identical request can be expected to fail again.

It reuses the existing issue codes; no parallel taxonomy exists. It never shows values or raw model text, and it never changes the proposal.

### 2. No deterministic correction of model output

The observed failure cannot be corrected locally. Mapping `category_a` to a real label would be guessing meaning. Sprint 14 found no other recorded failure whose correction is provably semantics-preserving and unambiguous, so **no repair was added** and the AGENTS.md rule "never repair model JSON" stands. Any future repair needs a recorded failure, a proof, an allowlist entry, tests and a new ADR.

### 3. Readiness before sending; recovery after

`categoryNeed` detects a destination field from a fixed list whose only possible sources have their category names withheld:

- **Destination step:** an explicit per-field opt-in lists the names and the rare-label warning. It is off by default.
- **Approval card:** a warning that the request cannot produce a usable integration yet.
- **After a refusal:** "Share these names and prepare a new request". This applies the existing twin decision, which invalidates everything downstream, and prepares a **new** request for review. Nothing is approved or sent by that click.

When the cause is in the inputs, the identical request is not offered. For other refusals, "Ask Gemini again" needs a fresh approval and is offered at most once per identical request content (`ASK_AGAIN_LIMIT`). That count is derived from hashed telemetry, not new workflow state.

A cloud *correction request* carrying validation feedback was not added. The revision protocol (ADRs 0008/0009) applies to a valid initial mapping, and a new feedback contract for refused answers is not needed when the fix is in the inputs.

### 4. Input-state integrity and honesty fixes

These ship with the same change:

- Build uses the destination on screen; an empty, invalid or unapplied custom schema blocks it with a reason.
- Failed recovery steps are shown.
- "Next" is held while on-device analysis runs.
- The result states how fields were understood (Gemini Nano used, available but unused, unavailable, or simulated). It never calls a simulated run Gemini Nano.
- The two downloads are labelled by content.
- A reload warning protects unsaved work; nothing is persisted.

### 5. Production acceptance is part of done

A release moves through `CODE_READY → DEPLOYMENT_PENDING → DEPLOYED_UNVERIFIED → PRODUCTION_ACCEPTED`, or `RELEASE_FAILED`, on evidence only. The standard lives in [deployment.md](../deployment.md#production-acceptance-standard-permanent):

- `pnpm test:production`: deterministic checks on the public URL, no inference;
- `pnpm test:production:real`: one budgeted hybrid happy path;
- an evidence folder per SHA;
- rollback criteria.

## Consequences

- With the names shared, real Gemini built Helpdesk and Marketing integrations: 3 of 3 records transformed in each, and the exported package verified with plain `node` ([evidence](../evidence/sprint-14/guided-recovery.json)).
- Sharing category names is a real disclosure: they are values from the user's records. It is explicit, per field, visible in the exact prompt, and warned when a label is rare. Without it, those destinations stay unbuildable, and EYES now says so before anything is sent.
- The guided result is honest but often a **Draft**: meaning stays "not verified" unless trusted constraints exist. That is correct and is not hidden.
- Deployment is still owner-approved per SHA. The agent stops at `DEPLOYMENT_PENDING` without that approval.
