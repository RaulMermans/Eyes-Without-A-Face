# 0016 — Concept-bearing Phantom Twin

Status: Accepted. Offline and live evidence both pass the pre-registered thresholds; Gate A passed on 2026-11-16 ([evaluation](../evaluation/sprint-18a-ai-value.md)).
Date: 2026-11-16

## Context

The cloud planner sees a source field only as alias + type + descriptor + synthetic examples. Descriptors came from 11 roles (`src/phantom/roles.ts`), so confusable fields were identical in the payload:

- date of birth = signup date = "Calendar date in YYYY-MM-DD format";
- customer number = invoice number = "Unique record identifier (opaque code)";
- `bedrijf` = `contactpersoon` = "Short text value" (Sprint 12).

On the independent dev split, only **14.9 %** of ground-truth source fields had a unique disclosed description (O1, T0). The cloud model could not be right for the right reason.

## Decision

### 1. A fixed concept vocabulary (`src/phantom/concepts.ts`)

- **Vocabulary.** There are 36 business meanings, and some take a qualifier (billing/shipping/work/personal/mobile/net/gross/…). The ground-truth labels of the evaluation set use the same list.
- **Compatibility.** Each concept declares the profile types it fits (`conceptCompatible`). The profile stays authoritative: a meaning that contradicts the observed type, the email format or a code shape is never stated.
- **Claims and provenance.** Every concept is a claim with provenance (`ConceptClaim`):

  | Evidence | Status | Disclosed tag |
  | --- | --- | --- |
  | `value-shape` (e.g. all labels are ISO currency codes, email format) | observed | `[observed]` |
  | `field-name` (multilingual lexicon over the local key) | hypothesis | `[inferred, unconfirmed]` |
  | `user` (`TwinFieldOverride.concept`) | confirmed | `[confirmed]` |
  | `on-device-model` (Nano suggestion applied by the user) | hypothesis | `[on-device suggestion, unconfirmed]` |

- **No guessing.** A bare `name`, `id`, `status` or `date` gets **no** concept. No concept is better than a guessed one.

### 2. The twin appends the meaning to the generated descriptor

`<role descriptor>; meaning: <phrase> (<qualifier>) [<tag>]`

- **The role text stays first,** so every consumer of the old prefix is unchanged. This includes the simulated proposer and the E2E suite.
- **`TwinOptions.concepts: false`** reproduces the pre-18A twin byte-for-byte. Only the evaluation baseline and historical replays use it (EVAL-121).
- **Overrides.** A user-written descriptor is never extended. `concept: null` suppresses an inferred meaning. An incompatible reviewed concept is `SEMANTICS_INCOMPATIBLE`.

### 3. Privacy: a meaning phrase never spells a field name or a private value

- **Wordings and the guard.** Each concept and qualifier has several fixed wordings. `withConcept` uses the first wording whose added words contain neither of these (case-insensitive):
  - a private value of at least 4 characters;
  - any local field-name segment of at least 4 characters, including nested parents.

  For example, a field named `city` gets "town or municipality", and a `billing.*` parent gets "invoicing".
- **Fail closed.** If every wording collides, the meaning is withheld. A local limitation is recorded, and the disclosure is not blocked.
- **Nothing else changes.** Leak scans, allowlists and checkers are unchanged; nothing was widened. The meaning is part of the reviewed disclosure preview, like any descriptor.
- **Personal-data concepts are flagged locally** (`TwinFieldView.personal`). These are birth date, names, email, phone and street address. Shareability is unchanged.

### 4. A concept is never semantic evidence

- Concepts inform the proposal only. `src/semantics` and `src/verification` do not read them (S18A-P-002).
- A user-confirmed concept is still not a `user-declared` constraint.
- The verifier remains the only judge.

## Consequences

- **Offline dev results:**

  | Metric | T0 | T1 |
  | --- | --- | --- |
  | O1 distinguishability | 0.149 | 0.915 |
  | O2 confusable-pair separation | 0.188 | 0.906 |
  | O3 concept precision | — | 1.000 |
  | O4 concept coverage | — | 0.957 |
  | O5 privacy findings | — | 0 |

  Held-out results are in the evaluation report.
- **Live result (holdout, real Gemini):** correct correspondences rose from 0.275 to 0.551. Valid proposals rose from 0.235 to 0.556. G1 was not worse in 9 of 9 comparable scenarios. There were 0 leaks.
  - All remaining G1 rejections are `INVALID_ENUM_MAPPING`, caused by withheld category names.
  - The planner still invents defaults (16 cases).
  - The bottleneck has moved from the twin to the planner.
- **Prompts and response schemas are unchanged.** `src/inference/prompts.ts` stays frozen.
- **Not in this increment:**
  - Nano concept suggestions (a new local prompt and schema);
  - concept-aware local suggestions in `field-plan.ts`, which would need a fresh held-out check, not the 16A data;
  - a review control for concepts in the guided UI.
- **The Sprint 12 freeze was amended** (`generate.ts` hash, with the reason recorded).
