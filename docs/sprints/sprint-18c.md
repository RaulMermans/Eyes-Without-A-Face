# Sprint 18C — AI reliability, end-to-end qualification, Milestone 1

| Item | Value |
| --- | --- |
| Branch | `sprint-18b-ai-first` |
| Release status | **CODE_READY**. This is not a release candidate: Gate C **FAILED** live. Production `c7220768` is unchanged and nothing was deployed |
| Milestone verdict | **MILESTONE_1_GATE_FAILED** |
| Decision | [ADR 0020](../decisions/0020-category-groupings-and-plan-recovery.md) |
| Evaluation | [sprint-18c-reliability.md](../evaluation/sprint-18c-reliability.md) (pre-registered, frozen at `a08149b`) |
| Usability | [sprint-18c-protocol.md](../usability/sprint-18c-protocol.md) (**NOT PERFORMED**) |

## What changed

**A — planner inputs**
- Category claims carry a fixed grouping: plan or tier, channel, segment, department, gender, offering or kind.
- "lifecycle" is an account status, with a third collision-safe wording.
- All of this is gated by `labelCategories: false`, so the historical replays still reproduce their recorded prompts.

**A3 / C — uncertain matches and recovery (ADR 0020 §7, `62b6a32`, after the gate)**
- A single-field Gemini match below high confidence is asked, never executed. Category matches that await a translation are exempt.
- The plan-question picker lists every other usable field under "Choose another field" (E2E-185).

**B — provider controls**
- Plan requests have `maxOutputTokens` 8192.
- The 18B HTTP 500s were clustered in time: 5 of 10 in one trial, 1 of 10 in the next, the same rate as P0. The decoder schema was therefore kept unchanged, so P0 and P1 differ only in the corrective changes.
- Live result: P1 had 32 / 32 HTTP 200 and 0 HTTP 400.
- Unchanged: the 45 s timeout, the size caps, classified errors, no automatic retry, single-use approval.

**D — ADR 0019 qualification**
- 13 parity cases cover the browser engine, the portable runtime bundle and a real ZIP replay (`tests/contracts/optional-absent-parity-0019.test.ts`): no divergence and no dropped records.
- One edge case is recorded but not changed: a missing input omits an optional `concat` even when the other input is present and invalid.

**E — evaluation**
- A fresh independent set: 4 dev and 16 holdout scenarios. The author never saw the implementation.
- The author's expected samples are computed by their own script, independently of EYES's engine.
- Also built: a frozen scorer `eval-18c.ts`, harness set `c`, a freeze, and zero-request rehearsals.

**F — usability**
- The independent protocol for 3 or more participants is ready. It was **not performed**.

## Checks (`62b6a32` + docs)

| Check | Result |
| --- | --- |
| lint, typecheck | PASS |
| unit | 656 PASS |
| contracts | 100 PASS |
| privacy | 105 PASS |
| evaluation | 154 PASS, 5 skipped by design (env-gated holdout runs) |
| build | PASS |
| E2E | 168 / 168 PASS |

## Live evaluation (66 owner-approved requests out of 80)

**Gate C: FAIL** on E1, E2, E3 and M3.

| | P0 (`cb26d64`) | P1 (`a08149b`) |
| --- | --- | --- |
| Complete integrations | 1 / 24 | **0 / 24** |
| Wrong among transformed records | 0.915 | **1.0** |
| False completes | 0 | **1** |
| Category correspondence | 0.388 | **0.398** |

**What passed:**
- correspondence non-inferiority (M1, M2);
- 0 invented values;
- 0 falsely verified records;
- provider success 1.0 with 0 HTTP 400;
- manual field choices 2.5 against a baseline of 9.4;
- 0 privacy findings, 0 prompt mismatches, 0 unauthorized requests.

**Root cause (aggregate trace).**
- Correspondence accuracy is about 53 %. The model's own confidence separates right from wrong (high 86 %, low 21 %), but every match was executed.
- 25 of 31 usable P1 plans had 3 or more wrong fields, so every record of those integrations was wrong.
- **The engine, the verifier and the privacy layer did their part.** No wrong record was labelled verified: the verdict said "Structure verified", never "Integration ready".

**Correction after the run.** Uncertain matches now become questions. An exploratory replay on the inspected holdout gives:
- complete integrations: 3 / 24;
- wrong among transformed records: 0.64;
- false completes: 0;
- clarification answers: 7.3, against 7.9 allowed.

This is not evidence, and it is far from the 0.70 target.

## Not done

- Independent usability sessions and a screen-reader session: not run.
- Gemini Nano in the plan path: not started.
- Production qualification: not started, because the gate failed.

## Next (highest-impact blocker: correspondence accuracy)

1. **Ask the planner for a ranked candidate list per destination field, not one pick.** Compile only an unambiguous high-confidence top candidate. The user then confirms among 2–3 named candidates. This turns wrong matches into short choices.
2. **Give the planner the destination's own field descriptions.** The disclosure target carries only names and types today. This needs a disclosure-contract version and a privacy review.
3. Pre-register a successor on a **fresh** holdout. The 18C holdout is inspected.

Until a successor passes, production `c7220768` stays the shipped experience.
