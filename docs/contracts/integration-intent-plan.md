# Integration Intent Plan 1.0.0

Decision: [ADR 0018](../decisions/0018-integration-intent-plan.md).

| Item | Location |
| --- | --- |
| Schema | `src/domain/inference-output/schemas/integration-intent-plan.v1.schema.json` |
| Types | `src/plan/types.ts` |
| Validator | `src/plan/validate.ts` |
| Compiler | `src/plan/compile.ts` |
| Clarification | `src/plan/clarify.ts` |
| Failures | `src/plan/failures.ts` |
| Comparison | `src/plan/compare.ts` |

## What it is

The plan is alias-level model output, answering an approved cloud-disclosure 1.1.0 request. It is **not executable**: only the compiler turns it into a Mapping Contract 1.0.0, through the unchanged `convertProposal` gate.

```json
{
  "fields": [
    { "target": "email",  "status": "ready", "from": ["f_04"], "transform": "normalize_email",
      "confidence": "high", "evidence": ["format", "meaning"], "missing": [] },
    { "target": "status", "status": "needs_clarification", "from": ["f_09"], "transform": "map_enum",
      "confidence": "high", "evidence": ["meaning"], "missing": ["category-labels"] },
    { "target": "opened_at", "status": "needs_clarification", "from": ["f_02", "f_07"], "transform": "parse_date",
      "confidence": "medium", "evidence": ["type"], "missing": ["field-meaning"] },
    { "target": "region", "status": "no_source", "from": [], "transform": "none",
      "confidence": "high", "evidence": [], "missing": ["no-matching-source"] }
  ],
  "summary": "Four destination fields; status needs the category meaning; opened_at has two date candidates."
}
```

## Entry rules (validator)

| `status` | `from` | `transform` | Extra |
| --- | --- | --- | --- |
| `ready` | 1 alias (`concat`: 2–4) | not `none` | `parse_date` needs `inputFormat`. `concat` needs `separator`. `map_enum` needs `valueMap`. `missing` is empty. |
| `needs_clarification` | 0–4 aliases. With `field-meaning`, these are the candidates. | any | `missing` is non-empty |
| `unsupported` | 0–4 aliases (the needed inputs, kept as the correspondence) | any | `missing` contains `unsupported-transform` or `business-rule` |
| `no_source` | empty | `none` | `missing` contains `no-matching-source` or `destination-value` |

The validator treats each problem as follows.

**Whole plan rejected (`MALFORMED_PLAN`):**

- the text is not JSON or is over 65,536 bytes;
- the plan is schema-invalid;
- it contains executable content or prototype keys.

**Whole plan rejected (`DISCLOSURE_MISSING_TARGET`):** the disclosure is not 1.1.0 with a target.

**Entry rejected:**

- `UNKNOWN_TARGET_FIELD`;
- `UNKNOWN_ALIAS`;
- `INCONSISTENT_ENTRY`;
- `DUPLICATE_TARGET` (every entry for that target is rejected).

**Translation rejected, correspondence kept (`correspondence-only`):**

- `INVENTED_CATEGORY_LABEL`: a `valueMap` key that is not a disclosed label of the alias. This includes any key when the labels were withheld.
- `INVALID_ENUM_VALUE`: a `valueMap` value outside the destination enum.

Destination fields the plan does not mention are listed in `unaddressed`. They are unresolved, never treated as "no source".

## Compiled readiness (compiler)

The model's `status` is a claim. The compiler computes the readiness in force from three inputs: the validator verdict, the local profile (evidence only, never correction) and the user's answers.

| Situation | Readiness | Operation |
| --- | --- | --- |
| `ready`, accepted, and every rule holds | `ready` | Gemini operation, accepted by `convertProposal` |
| `map_enum` with withheld or invented labels; the user translated the labels | `ready` | `map_enum` from the user's translation, `unmapped: "fail"` (origin `gemini+user`) |
| same, not yet translated | `needs_clarification` (`category-labels`) | none; the correspondence is kept |
| slash `parse_date` with an unproven order; the user confirmed one | `ready` | `parse_date` with the user's order (`gemini+user`) |
| same, not yet confirmed | `needs_clarification` (`date-order`) | none |
| order contradicts proven local evidence | `needs_clarification`, failure `semantic-disagreement` | none, until the user confirms an order |
| `fieldMatches[target]` set by the user to a different field | follows the user's field | rule as in Sprint 15 (origin `user`) |
| `fieldMatches[target]` set to the same field as an executable Gemini operation | `ready` | the Gemini operation is kept (origin `gemini`); confirming a match never discards a validated operation |
| `fieldMatches[target] = null` | `no_source` | none |
| `no_source` (or the user chose "no field"), and required | `no_source` | none; question `missing-required-source`; never a default |
| unaddressed by the plan, or its entry was rejected | `needs_clarification` | none; question `choose-field` (reason `unaddressed` or `rejected-entry`); never a default |

`complete` is true only when every required destination field has an operation. A `CompiledIntegration` with zero operations has `aliasContract: null`. It is a planning artifact, never an integration.

## Privacy

- **The plan is alias-level.** Local paths and private labels appear only in `Clarification.localPaths`, in the user's answers and in user-declared operations. None of these is ever sent, logged or exported without the existing per-field label opt-in (`packageLabelSources`).
- **Model text is never shown as evidence.** `summary` appears only as collapsed model text. Questions use application-owned copy (`CLARIFICATION_COPY`).
