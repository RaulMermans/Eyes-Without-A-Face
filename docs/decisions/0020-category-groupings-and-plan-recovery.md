# 0020 — Category groupings, plan-question recovery and the Sprint 18C gate

Status: Accepted (implementation); the product default still needs Gate C (live)
Date: 2026-11-17
Builds on: [ADR 0016](0016-concept-bearing-phantom-twin.md), [ADR 0018](0018-integration-intent-plan.md), [ADR 0019](0019-optional-destination-absent-input.md)

## Context

- **Field names never leave the device**, so a category field's meaning claim is Gemini's only way to tell two category fields apart.
  - Before this decision, every plan, tier, channel, source, segment, type, course or department field had the same claim: "classification".
  - Account status and lifecycle stage fields often had no claim at all.
  - A destination with two fixed-list fields (for example a membership tier and a status) therefore gave Gemini two or more indistinguishable candidates. On the Sprint 18B holdout, category correspondence was 0.25 ([evaluation](../evaluation/sprint-18b-intent-plan.md)).
- **The 18B oracle treated "None of your fields gives X" as unanswerable.** The guided picker offered only EYES's ranked candidates, so a user could not name a field EYES did not rank.
- **The plan request had no output cap.** Observed plans were at most 3.1 KB.
- **Provider HTTP 500s in 18B were clustered in time.** In P2 trial 1, 5 of 10 requests failed. In P2 trial 2, 1 of 10 failed, the same rate as P0 (2 of 19). This does not show that the decoder schema causes them.

## Decision

1. **Category groupings** (`src/phantom/concepts.ts`). A `category` claim carries one of seven fixed qualifiers, read from the local field name:
   - plan-tier: "plan or membership tier", or "service level purchased"
   - channel: "channel, medium or origin", or "route or source"
   - segment, department, gender, offering, kind
   
   The rules are the ADR 0016 rules:
   - fixed wordings only;
   - `[inferred, unconfirmed]`;
   - fail closed when a wording contains a private value or a field-name segment;
   - never trusted evidence.
   
   The channel wording is deliberately neutral, because a preferred contact channel is not an acquisition origin.
2. **Lifecycle.** A name containing "lifecycle" is an account status. A third wording, "standing of the relationship", is used when a label collides with the first two (for example a label "Customer"). A bare `status` or `stage` still gets no claim.
3. **Legacy switch.** `TwinOptions.labelCategories: false` also turns off 1 and 2. Historical replays (18A, 18A.5, 18B) reproduce their recorded prompts unchanged (EVAL-191 and the 18A / 18A.5 replays pass). Never expose it in the product.
4. **"Choose another field."** A plan question's picker lists Gemini's candidates, then EYES's ranked candidates, then, under "Choose another field", every other usable field (`PlanReview`). The Sprint 15 rule "candidates plus 'Choose another field'" now holds on the plan path. Nothing is pre-selected and nothing is applied without a choice.
5. **Output cap.** `maxOutputTokens: 8192` on the intent-plan model (`PLAN_MAX_OUTPUT_TOKENS`). This bounds cost per request. A truncated answer fails validation as `MALFORMED_PLAN` and is never repaired.
6. **Not changed:**
   - prompt v5 and the decoder schema `integration-intent-plan-1`, kept so that P0 and P1 differ only in the corrective changes;
   - the validator, compiler, `convertProposal`, the engine, the verifier, the acceptance policy and export eligibility.

## Evaluation

[Sprint 18C pre-registration](../evaluation/sprint-18c-reliability.md):
- an independent fresh holdout;
- P0 = `cb26d64` against P1 = the 18C candidate;
- Gate C thresholds on end-to-end completion, false verification, correspondence non-inferiority, provider reliability and clarification burden.

Until Gate C passes live, production `c7220768` stays the shipped experience.

## Known limitation (recorded, not changed)

- **ADR 0019 omits an optional field when any input is missing**, even if another input is present but invalid. Example: a `concat` of a number and a missing value. Browser and portable runtime agree (`tests/contracts/optional-absent-parity-0019.test.ts`, case 10b).
- **Changing this needs an ADR 0019 amendment and a runtime rebuild.**
