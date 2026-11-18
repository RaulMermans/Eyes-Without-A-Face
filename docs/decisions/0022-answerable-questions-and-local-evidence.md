# 0022 — Answerable questions, user field combinations, labelled trim, and local evidence that asks

Status: Accepted (implementation). **Not shipped.** The local-evidence policy stays dev-only until a fresh, independently authored holdout confirms it. The other corrections below apply to every compile
Date: 2026-11-18
Builds on: [ADR 0020](0020-category-groupings-and-plan-recovery.md), [ADR 0021](0021-semantic-intelligence-recovery.md), [Sprint 18E report](../evaluation/sprint-18e-disagreement.md)

## Context

The failure dissection replays the 125 recorded real Gemini answers that still reproduce byte-identically:
- 18C holdout, 18D dev, 18D holdout. The holdouts are consumed and are **development data**; they are never proof again.
- Harness: `tests/evaluation/diagnose-18d.test.ts`.

**Integrations failed less because of model choice than because of five mechanical gaps:**
1. **Silent wrong picks.** Gemini executed a confident pick that the local matcher disagreed with. Gemini was wrong on 89–100 % of the clear disagreements (Sprint 18E).
2. **Unanswerable questions:**
   - a category translation or date question about the WRONG field, with no way to name the right one;
   - a translation question for a free-text destination;
   - a required field Gemini called "unsupported", which got no question at all.
3. **Combined values** (a full name) could not be answered: the picker takes one field.
4. **`copy` vs `trim`.** EYES's own local rule trimmed padded `string` fields but not padded repeated-name fields (profiled `enum`), and Gemini cannot see padding at all.
5. **Missing local vocabulary**, including other-party fields (a manager's email, a keyholder's phone), opposed qualifiers (excl. vs incl. tax), and single name parts offered for a whole name.

## Decision

**A. Applies to every compile:**
1. **Answerable questions.** A category translation for a non-enum destination, or a required field Gemini called `unsupported`, becomes a choose-field question with Gemini's pick first. The user's choice builds the Sprint 15 rule. Nothing of Gemini's is repaired.
2. **"Not the right field? Use another"** on translation and date questions (`PlanReview`). The choice goes through `onMatch`, exactly like every other field choice.
3. **Combine several fields** on field questions for text destinations:
   - 2–4 source fields in order, plus a separator from the fixed list `COMBINE_SEPARATORS`;
   - nothing pre-selected, applied only on click;
   - stored in a new local decision map `fieldCombinations`, handled by `applyFieldDecision` and dropped by `withDestination` like `fieldMatches`;
   - compiled as the existing `concat` operation through the unchanged gate, origin `user`.
   
   No new operation and no new engine.
4. **Labelled `trim`.**
   - `deriveRule` trims a padded `enum`-profiled text field, as it already did for `string`.
   - A Gemini `copy` from a padded text source into a plain text destination compiles as `trim`, with `CompiledField.refinement = "trim-padded-whitespace"` shown on the field.
   - Justification for this deterministic correction (AGENTS.md, Sprint 14 rule):
     - **recorded failures:** 17 fields;
     - **proof:** only leading and trailing whitespace changes, and only when the local profile observed it;
     - **the same rule EYES already applies** to fields the user chooses;
     - **covered by tests.**

**B. Local-evidence policy** (`CompileInput.local.askOnLocalEvidence`, `src/plan/agreement.ts`; dev harness only):
1. **Ask on every disagreement** between Gemini's single pick and the local top-1, and on any contradicted pick, whatever Gemini's confidence. This includes a contradicted part of Gemini's combination.
   - The first version asked only on *clear* disagreements. Extending it to unsure ones raised complete integrations from 45 to 49 / 95.
2. **Ask on Gemini's "no source"** when the local matcher has any candidate: 49 → 55 / 95.
3. **Agreement never upgrades a match.** The measured variant that executed agreed medium- or low-confidence picks lost 5 complete integrations, so it was rejected.

**C. Local matcher** (ranking evidence only; never executes):
1. Contradictions:
   - `different-party`: manager or administrator, staff, broker or agent, guardian or parent, emergency contact;
   - `opposed-qualifier`: incl/excl, gross/net, HT/TTC, primary/secondary, billing/shipping, home/work, start/end, min/max;
   - `name-part`: a first- or last-name field offered for a whole person-name destination while the other part exists.
2. General vocabulary added: compound and regional forms of company name, mobile phone, colour, guardian and employer.

**Rejected:**
- adding "account → organization" (it would hurt account-status matching);
- adding "keyholder" to the party list for one decoy (overfitting);
- executing agreed uncertain picks (lost completions).

## Results (exploratory replay, 95 completable scenario-answers, simulated user `runOracle18d`)

| | 18C rule (with A applied) | 18C rule, the original | ADR 0022 (A + B + C) |
| --- | --- | --- | --- |
| Complete correct integrations | 26 / 95 | 11 / 95 | **66 / 95 (0.695)** |
| Wedge / general | 8 / 27, 18 / 68 | 5 / 27, 6 / 68 | **19 / 27 (0.704), 47 / 68 (0.691)** |
| Per set: 18C holdout / 18D dev / 18D holdout | | | consistent: 0.67 / 0.67 / 0.69 |
| Incorrect among transformed records | 0.63 | 0.69 | **0.22** |
| Falsely verified records / invented values | 0 / 0 | 0 / 0 | **0 / 0** |
| False completes | 6 | 4 | **1** (another party's phone: an alarm keyholder) |
| Answers per scenario (manual flow 12.36) | 7.01 | 6.35 | 8.70 (**0.70×**, above the earlier 0.6× bound) |
| Wrong Gemini picks intercepted / right picks asked | — | — | 124 / 55 |

**The simulated user (`runOracle18d`)** answers only what the app asks, truthfully:
- it uses "Not the right field" when a question shows the wrong field;
- it uses "Combine several fields" for a combined value;
- it maps identical labels to themselves.

**These numbers are tuned on the data they are measured on.** Expect them to shrink on fresh data. Only a new independently authored holdout can support a claim.

## Consequences

- `CompiledField.refinement` is new and optional. `PlanAnswers.fieldCombinations` and `WorkspaceState.fieldCombinations` are new.
- The AGENTS.md rule "without `CompileInput.local`, compiling is byte-identical to Sprint 18C" is replaced: decision A applies to every compile. Historical replays are unaffected because they score recorded results; rescoring them with today's tree can differ.
- **Known residuals:**
  - an `email` answer key that keeps the original case where Gemini normalizes (8 fields; a ground-truth convention);
  - optional fields no evidence finds (6);
  - agreements that are both wrong (about 8 % of agreements);
  - question load 0.70× the manual flow.
