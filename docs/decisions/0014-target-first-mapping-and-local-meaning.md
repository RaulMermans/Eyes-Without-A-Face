# 0014 — Target-first field questions, on-device mapping and user-declared meaning

Status: Accepted
Date: 2026-11-16

## Context

Sprint 14 fixed the production incident by offering a per-field category-name opt-in. A production screenshot then showed the next problem. With a realistic source, choosing Helpdesk listed about 13 category fields and asked which names to share with Gemini, most of them unrelated to the destination.

The Sprint 15 audit confirmed three defects:

1. **Readiness was too broad (A3).** `categoryNeed()` treated the destination as ready if *any* category field was shared. Sharing `country` unblocked Helpdesk `status`.
2. **No guided control of correspondence (B).** The engine could run any valid contract, but the guided user could not say "status comes from account_state, and *pendiente* means *prospect*" without the technical workbench.
3. **"Draft" was not actionable (C).** On the demo, the user's own records all pass. The Draft label comes from the reserved edge-case test records, and Gemini's `map_enum` has no trusted constraint (`SEMANTIC_EVIDENCE_MISSING`). The guided view showed "Meaning: not verified" and an engine-level reason ("2 record(s) are unresolved") that read as if the user's records had failed.

## Decision

### 1. Ask per destination field, offer only candidates (`src/app/guided/field-plan.ts`)

- **`rankCandidates`** gates by type and format, then orders by structural evidence:
  - a short list of values;
  - a count close to the number of allowed values;
  - values spelled like allowed values;
  - email or date format;
  - unique codes for identifiers;
  - presence in every record.

  A similar name adds one point and is labeled "a hint, not proof". It is never the only reason.
- **`planFields`**, per destination field, returns the source in use, the deterministic local rule it implies, and what is missing (`source`, `translation`, `date-order`, `unsupported`). The source in use is one of:
  - the user's choice;
  - the only compatible field;
  - for non-enum fields, the best-ranked one, shown as "suggested".
- **Readiness is per field.** A required fixed-list field is ready for Gemini only when *its* source field's names are shared. It is ready on the device only with a complete user translation. `categoryNeed` keeps its shape and the Sprint 14 tests, but now lists only relevant fields.
- **The UI asks one question per fixed-list field.** It shows up to three candidates plus "Choose another field". The disclosure checkbox appears only for the field the user picked, off by default.

### 2. On-device mapping through the existing hand-written route

- **`localContract`** builds a Mapping Contract 1.0.0 from the plan's rules, using only the existing operations: `copy`, `trim`, `normalize_email`, `parse_date`, `map_enum`.
- **The canonical route.** The contract becomes `mappingText` with `mappingChoice: "manual"`. That is the route the technical view already runs: `runLocalVerification` → `runRealityCheck`, `exportCandidates` → `aliasManualContract`.
- **Labeling.** The mapping id prefix `guided-local-` lets the UI say "built on this device from your answers — no AI". Export origin stays `hand-written`. Nothing is labeled Gemini.
- **No guessing.** Translations start undecided. Even labels identical to an allowed value need an explicit click ("Use the values spelled exactly like an allowed value").
- **Mapping Contract.** No new operation and no second engine.

### 3. The user's translation is trusted evidence, for any mapping

- **`meaningConstraints`** turns each valid translation into one `enum-meaning` constraint (`trust: "trusted"`, `evidence: user-declared`, `undeclared: "review"`) in the existing Semantic Verification Contract 1.0.0.
- **Dropped declarations.** A declaration is dropped, never trusted, when:
  - a value is not allowed by the destination;
  - its source is not a field of the data;
  - its target is not a fixed-list field of the destination on screen.
- **The existing verifier judges every mapping against it, Gemini's included.** Agreement gives `SEMANTIC_PASS`. Disagreement gives `SEMANTIC_MISMATCH`, so the export goes Draft. A set-aside value that still became output gives `SEMANTIC_POLICY_CONFLICT`.
- **Not trusted.** Model suggestions and schema validity never become trusted evidence. Confirming one field never verifies another: plain copies stay "unknown", and the UI says why.
- **Date order** reuses the Sprint 8 `semanticConfirmations` (user-declared date constraints).

### 4. A user-set guided acceptance policy

- **`guidedPolicy`.** It is `STRICT_POLICY` unless the user translated a field. Then a record whose value was set aside, or is not in the translation, is quarantined (`UNMAPPED_ENUM` for that field). That is exactly what the translation screen promises.
- **Threshold.** `maxQuarantineRate: 0.5`. More than half of the records set aside is never "ready".
- **Scope.** A loaded evaluation scenario keeps its own frozen policy (`activePolicy`). No model sets any rule.

### 5. Invalidation (`applyFieldDecision`)

- **What a decision clears.** A field decision clears a result built on this device (the UI rebuilds it at once, locally) and any blind revision run.
- **What it never touches.** It never rewrites or clears a prepared or approved cloud request: the decision is not part of the request.
- **Category sharing** still goes through `applyTwinOverride`, which invalidates downstream.

### 6. Category names inside the downloaded package

- **Why it is needed.** A map built on this device carries the user's labels, which the unchanged privacy scan blocks. The default package therefore cannot be exported.
- **The opt-in.** An explicit checkbox, off by default, lists the names. It adds only that field's labels to `approvedLabels` for the package (`packageLabelSources`).
- **What stays the same.** The scan itself is unchanged. Approving another field's names does not unblock the package (PRV-S15-003).

### 7. Outcome first

- **Order.** The Result leads with:
  - the next step;
  - the counts and checks;
  - "Meaning, field by field" (what EYES knows, what it cannot establish, the one answer that would resolve it);
  - a before → after view of up to three of the user's records (actual engine output, local only);
  - the two downloads, each explained in one sentence.
- **Draft explained.** A Draft caused only by the built-in test cases says so in plain words.
- **Bindings file.** An optional `bindings.local.json` download fills the alias → field file the runner needs. It is generated locally and is never inside the ZIP.

## Consequences

- An unfamiliar user can finish Helpdesk with nothing sent to any model. The result honestly says "no AI".
- A Gemini mapping can reach `SEMANTIC_PASS` for a fixed-list field only after the user states what the values mean.
- The demo's reserved edge cases still make the demo a Draft: an email that is a number, a missing email. That is correct and now explained.
- **Not done:** a hybrid mapping where Gemini designs some fields and the user's local rules others. It would need mixed-origin provenance in the contract and package. Deferred.
