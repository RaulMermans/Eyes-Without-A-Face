# 0017 — Initial planner prompt v4 and initial response schema 2

Status: Accepted subject to the pre-registered live comparison ([evaluation](../evaluation/sprint-18a5-planner.md)).
Date: 2026-11-16

## Context

The Sprint 18A live run, with the concept-bearing twin, left two planner defects. The acceptance policy already rejected both outputs, so they never passed as correct. They still cost the user a usable proposal, or hid a gap behind a constant.

- **Every rejected proposal was `INVALID_ENUM_MAPPING` (8 of 8).** Category names are withheld by default, and Gemini wrote `map_enum` with labels it had never seen.
- **There were 16 invented values:** `default_if_missing`, or `map_enum` with `unmapped: "default"`.

## Decision

1. **Prompt v4** (`src/inference/planner-prompt.ts`) applies to initial (disclosure 1.1.0) requests only. It tells the planner:
   - choose sources by meaning, and read the 18A tags;
   - write a destination only from a source with that meaning;
   - never invent a value, even for a required field;
   - use `map_enum` only from a field with disclosed `enumValues`, with `unmapped: "fail"`;
   - leave withheld-label targets unwritten;
   - name every unwritten target in the rationale.
2. **Initial response schema 2** (`mapping-response-initial-2`) is the per-operation schema without `default_if_missing`, with `map_enum.unmapped` limited to `"fail"` and no `default` param. Constrained decoding therefore cannot emit an invented value.
3. **What is unchanged:**
   - the converter, resolver, engine, acceptance policy, verifier and revision prompts and schema;
   - the frozen `src/inference/prompts.ts`.

   `buildOutboundApplicationRequest` selects v4 for 1.1.0 only. `buildCloudPromptText` still produces the Sprint 3 text, so the Sprint 8 and 12 replays are unaffected. Nothing is repaired, and a default that reaches the converter still converts and is still judged by the policy.
4. **No contract change.** A structured list of unresolved targets would need Mapping Proposal 1.1.0. That belongs to the clarification increment (A.6). Until then, the existing `unwrittenRequiredTargets` and the guided recovery name what is missing.

## Consequences

- **Expected trade-off:** valid proposals that leave category targets unwritten, instead of invalid proposals. The Sprint 14 and 17A recovery (share that field's names, or translate on this device) then takes over.
- The pre-registered comparison P0 vs P1 on a fresh independent holdout decides acceptance.
- `tests/evaluation/response-schema-compat.test.ts` EVAL-090 records that the Sprint 9 initial schema was replaced. EVAL-186 proves schema 2 only narrows it on every recorded real answer.
