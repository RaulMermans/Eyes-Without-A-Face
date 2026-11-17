# Sprint 18B — Milestone 1: AI-first integration engineer

| Item | Value |
| --- | --- |
| Branch | `sprint-18b-ai-first` |
| Release status | **CODE_READY**, not a release candidate: the pre-registered AI gate (Gate B-AI) **FAILED**. Production `c7220768` is unchanged and nothing was deployed. |
| Decision | [ADR 0018](../decisions/0018-integration-intent-plan.md) |
| Evaluation | [sprint-18b-intent-plan.md](../evaluation/sprint-18b-intent-plan.md) |
| Source compatibility | [docs/qa/sprint-18b-source-compat.md](../qa/sprint-18b-source-compat.md) |

## What was built

- **Integration Intent Plan 1.0.0** (`src/plan/`). Gemini states, for each destination field, the correspondence and the transformation separately.
  - **Validator:** judges each entry. A rejected translation keeps its field match. Nothing is repaired.
  - **Compiler:** every Gemini operation passes the unchanged `convertProposal` gate. Operations from the user's answers come only from the existing decision maps. No default is ever compiled.
  - **Clarification:** four question kinds, required fields first.
  - **Failure classification:** 11 categories, each with exactly one next action.
  - **Plan comparison:** a worse plan never replaces a better one; at most 2 requests per content.
- **Prompt v5 and a decoder schema.** The planner is chosen by `INITIAL_PLANNER`. The harness-only legacy switch keeps planner-independent technical-view tests on the Sprint 3 path.
- **Guided flow:** Connect → Destination → Generate → Verify → Deliver.
  - One primary action, "Generate my integration".
  - Verify lists each field's match (by Gemini or by you) and the questions.
  - Manual mapping is under "Advanced: map fields yourself".
  - Withheld category names no longer block a plan request (this replaces the 17A rule).
  - The revision is hidden once user-declared translations exist.
- **Source compatibility.** The cause of the build failure seen in two earlier holdouts was found on fresh data: private labels collided with EYES's own fixed twin wording in the leak scan. The fix is a precise owned-segment scan. The fresh holdout builds 10 / 10 on this branch, against 9 / 10 on `main`.
- **Evaluation.**
  - An independent set: 4 dev and 10 holdout scenarios.
  - A pre-registration, a freeze, a frozen scorer with an oracle user, and live harness set `b`.

## Checks (on `0194e92` / `10a17be`)

| Check | Result |
| --- | --- |
| lint | PASS |
| typecheck | PASS |
| unit | 625 PASS |
| contracts | 87 PASS |
| privacy | 105 PASS |
| evaluation | 130 PASS, 3 skipped by design |
| build | PASS |
| E2E | 167 / 167 PASS, run on the merged UI tree before the decoder-schema fix; that fix changes only the schema sent to the provider |

## Live evaluation (51 owner-approved requests)

**Gate B-AI: FAIL** on M1, M2, M3, M9, E1 and E2. See the evaluation for the full table.

**What worked:**
- invented values and invalid enum translations fell from 17 to 0;
- manual mapping operations fell from 10.9 to 4.2 per scenario;
- 0 false completes;
- 0 privacy findings.

**What failed:**
- 30 % provider HTTP 500 on plan requests;
- mappable correctness 0.482 against 0.673. Counting answered requests only, it is 0.683 against 0.755;
- no end-to-end success in either configuration.

**First live attempt:** every plan request was refused with HTTP 400 because the decoder schema had nested array bounds. The cause was diagnosed on dev data and fixed in `0194e92`.

## Not done

- **Workstream C (Gemini Nano):** not started.
- **Independent usability sessions (Gate B):** not run.
- **Visual and accessibility audit beyond the existing E2E:** not done.
- **Scorer note:** S2 also requires every scenario to be sent; reported, not changed. An earlier E2 "defect" claim was the lead's misreading and is corrected.

## Next

1. **Traced on dev** ([evaluation § Trace](../evaluation/sprint-18b-intent-plan.md#trace-why-records-stay-unresolved-dev-split-2026-11-17)). The profile's category rule rejects real-world labels, so Gemini cannot see category fields and plans stay incomplete. Fix category detection first.
2. Reduce provider errors: a smaller decoder schema, or a two-step request.
3. Pre-register a successor on a fresh holdout. This holdout is inspected.

Until a successor passes, the shipped experience stays production `c7220768`.
