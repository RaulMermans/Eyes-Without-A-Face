# Sprint 18A — Does a meaning-bearing Phantom Twin produce better AI integrations? (pre-registration)

**Status: PRE-REGISTERED.** Written and committed before the Sprint 18A implementation and before any model saw the evaluation set. Results are appended in [§ Results](#results) and never edit the sections above them. A change to a frozen input after the freeze is recorded with `node scripts/freeze-ai-value.mjs --amend "reason"` and reported.

All data is fictional.

## Question

The cloud planner (Gemini, `ONLY_IN_CLOUD`) sees each source field only through its Phantom Twin entry: alias, type, a generated descriptor and synthetic examples. Today that descriptor comes from an 11-role vocabulary (`src/phantom/roles.ts`). Two fields of the same role get the **same** descriptor:

- a date of birth and an account-creation date are both "Calendar date in YYYY-MM-DD format";
- a customer number and an invoice number are both "Unique record identifier (opaque code)";
- a company and a contact person in a non-English export are both "Short text value".

The existing evidence for this:

- **Sprint 12** (`crm-nl-relations`): Gemini picked `bedrijf` and `contactpersoon` correctly "because of ordering, not information".
- **Sprint 16A, D2:** 14 of 61 local pre-selections were wrong, including a date of birth used as a start date.

**Hypothesis H18A.** If each field carries a business meaning (a *concept*) drawn from a fixed vocabulary, labelled as observed, inferred or confirmed, the twin separates confusable fields. A cloud planner that sees that twin then picks the correct source field for more destination fields. This must hold without disclosing field names or values.

## Evaluation set

`tests/fixtures/ai-value-18a/` was written by an **independent author**: a separate agent that had no access to the implementation and worked from a written specification, before any 18A code existed.

| Split | Scenarios | Use |
| --- | --- | --- |
| `dev/` | 6 | Read by the engineer; the concept lexicon may be tuned on it and on existing committed fixtures. |
| `holdout/` | 10 | **Never opened** by the engineer. Only `scripts/eval-ai-value.mjs` reads it, and it prints aggregates only. Never used for tuning, prompts or feedback. If anyone inspects it and then changes the implementation, a fresh holdout is written. |

Every scenario has the following:

- **Size and naming:** 20–40 records, at most 20 source fields, and at least 5 source languages and several naming styles across the set.
- **Confusable pairs:** at least three, where only meaning tells the two fields apart.
- **Ground truth:**
  - `groundTruth`: destination field → source path or `null`;
  - `sourceConcepts` and `destinationConcepts`: one concept per field, from the vocabulary in § Concept vocabulary.

All of it was written from the author's intended meaning.

The 16A held-out data, the Sprint 8 scenarios and `crm-nl-relations` are **not** part of this evaluation.

## Configurations

| Config | Twin | Planner |
| --- | --- | --- |
| **T0** | Current descriptors (role vocabulary only). | — (offline) |
| **T1** | Concept-bearing descriptors from deterministic local evidence (field-name lexicon + value shapes). No model. | — (offline) |
| **G0** | T0 | Real Gemini Cloud initial proposal, no revision |
| **G1** | T1 | Real Gemini Cloud initial proposal, no revision |

T0/T1 are deterministic and run offline in the test suite. G0/G1 send real cloud requests and run **only after the owner approves the budget below**. A Nano configuration (concept suggestions from Gemini Nano, `ONLY_ON_DEVICE`) is a later increment and is not part of this registration.

## Metrics and thresholds

### Offline (T0 vs T1, holdout; computed by `scripts/eval-ai-value.mjs`)

| ID | Metric | Definition | Threshold for T1 |
| --- | --- | --- | --- |
| O1 | Distinguishability | Share of ground-truth destination fields with a non-null source whose correct source's disclosed `(type, descriptor)` is unique among the payload's fields. | ≥ T0 + 20 pp |
| O2 | Confusable separation | Share of the author's confusable pairs whose two fields get different disclosed descriptors. | ≥ T0 + 30 pp |
| O3 | Concept precision | Over all source fields where T1 states a concept, the share equal to the author's `sourceConcepts` label. A wrong meaning is worse than none. | ≥ 0.85 |
| O4 | Concept coverage | Share of ground-truth-referenced source fields that get a concept. | ≥ 0.50 (reported; not a pass condition on its own) |
| O5 | Privacy | Leak-scan findings (`findPrivateValueLeaks`) plus verbatim source keys in any payload (a key containing `_`, a digit or an inner capital, matched case-sensitively), plus synthetic collisions. | = 0 |

### Live (G0 vs G1, holdout; only with owner approval)

| ID | Metric | Definition |
| --- | --- | --- |
| L1 | **Correct correspondences (primary)** | Per ground-truth destination field: correct when the proposal's single operation writing it reads exactly the ground-truth source alias. If the ground truth is `null`, it is correct when no operation writes it. Scored from the parsed proposal, valid or not. Unparseable output scores 0 for the whole proposal. |
| L2 | First-attempt valid proposals | `convertProposal` accepts with no error. |
| L3 | Hallucinated references | Operations naming an alias or destination absent from the payload. |
| L4 | Invented values | `default_if_missing` or `unmapped=default` on a field whose ground truth is `null` or a category. |
| L5 | Provider failures | Counted as failures and never replaced. |

**Pass (live):**

- L1(G1) ≥ L1(G0) + 10 pp, pooled over trials;
- G1 is not worse than G0 in at least 7 of 10 scenarios (mean over trials);
- L2 and L3 no worse than G0;
- O5 = 0.

### Gate A decision rule

- The offline thresholds O1, O2, O3 and O5 are **necessary**. If any fails, T1 does not ship as the default.
- **Gate A passes only with the live pass.** Valid JSON and a successful SDK call are never evidence of success.
- If the live run is not authorized, Gate A is reported as **NOT RUN**, and the AI-first interface redesign (18B) does not start.

## Budget for the live run (requires owner approval)

| Item | Value |
| --- | --- |
| Requests | 10 holdout scenarios × 2 configs × 2 trials = **40 cloud requests**, `gemini-3.5-flash-lite` through Firebase AI Logic (`ONLY_IN_CLOUD`), the existing project and App Check debug token |
| Revision | No revision |
| Retries | None. A provider failure is recorded and not repeated |
| Stop rule | Stop when the 40 are done or on the first privacy finding |
| Approval | Every request goes through the in-app approval gate, and the harness approves exactly what it previews. |

## Concept vocabulary

The fixed vocabulary, shared by the twin and the ground-truth labels:

`customer-id, transaction-id, product-id, employee-id, other-identifier, given-name, family-name, person-name, organization-name, job-title, email, phone, street-address, city, postal-code, region, country, birth-date, created-date, start-date, end-date, modified-date, transaction-date, due-date, amount, currency-code, quantity, account-status, payment-status, order-status, priority, category, consent-flag, language-code, note, url, other`

The twin discloses only phrases from this vocabulary and never a field name or value. A concept inferred from a local field name is labelled as inferred and unconfirmed in the disclosed descriptor.

## Results

### Offline (T0 vs T1) — run 2026-11-16, implementation `e90b6c2`

- **Holdout scoring.** The holdout was scored **once**, after the implementation commit, by `node scripts/eval-ai-value.mjs`. Aggregates only: [ai-value-offline-holdout.json](../evidence/sprint-18a/ai-value-offline-holdout.json). The file records the implementation's file hashes and the holdout digest.
- **Dev scoring.** Dev numbers come from EVAL-181. The lexicon was tuned on dev only.

| Metric | Dev T0 | Dev T1 | **Holdout T0** | **Holdout T1** | Threshold (T1) | Holdout verdict |
| --- | --- | --- | --- | --- | --- | --- |
| O1 distinguishability | 0.149 | 0.915 | **0.127** | **0.658** | ≥ T0 + 0.20 | **PASS** (+0.531) |
| O2 confusable separation | 0.188 | 0.906 | **0.286** | **0.683** | ≥ T0 + 0.30 | **PASS** (+0.397) |
| O3 concept precision | — | 1.000 | — | **0.978** | ≥ 0.85 | **PASS** |
| O4 concept coverage | 0 | 0.957 | 0 | **0.595** | ≥ 0.50, reported | met |
| O5 privacy findings | 0 | 0 | 0 | **0** | = 0 | **PASS** |

Notes, reported as found:

- **The dev → holdout drop is real.** O1 falls from 0.915 to 0.658 and coverage from 0.957 to 0.595: the lexicon partly fits the dev names. The holdout figures are the claim.
- **A wrong meaning was rare.** Holdout precision is 0.978. A concept was stated only when the field name gave one, and the stated concept was almost always right; most of the remaining loss is fields with *no* concept.
- **One holdout scenario of 10 could not be built in either configuration.** Its failure is not the synthetic-collision privacy check, because O5 = 0. It contributes no ground-truth fields to O1, O3 or O4. It does count its confusable pairs as *not* separated in both T0 and T1 for O2, the same in both configurations. The cause was **not inspected**, to keep the holdout blind. A product defect may exist for some realistic inputs. The next increment must investigate it on a fresh case, never on this holdout.

**Offline verdict:** the necessary conditions O1, O2, O3 and O5 hold on the independent holdout. This shows the twin now *describes* fields distinguishably. It does not show that Gemini *maps* better.

### Live (G0 vs G1) — run 2026-11-16, owner-approved budget of 40 requests

**Setup.**

- Harness: [tests/live/ai-value.spec.ts](../../tests/live/ai-value.spec.ts).
- G0 is `main` @ `82400dd`, served from a temporary worktree on port 5175. G1 is this branch at `9df199b` + harness on port 5174.
- The run used the technical view, `gemini-3.5-flash-lite` (`ONLY_IN_CLOUD`), the registered App Check debug token and the in-app approval gate.
- Order was ABBA: G0 t1, G1 t1, G1 t2, G0 t2.
- There was no revision and no retry.
- Before any request, a rehearsal sent nothing (0 requests) on both the dev and holdout splits.

Raw evidence: [ai-value-live.json](../evidence/sprint-18a/ai-value-live.json). It holds alias-level model text, prompt hashes, statuses and timings, and no request bodies, records or tokens. Scored by EVAL-184 into [ai-value-live-summary.json](../evidence/sprint-18a/ai-value-live-summary.json).

**Budget used: 35 of 40 requests.**

- Holdout #1 fails at the build step in both apps and sends nothing. This is the same scenario as the offline build failure; it accounts for 4 unsent runs.
- One G0 run (#5, trial 1) failed in the harness at the destination step and sent nothing. It was **not** re-run after the results were seen, so G0 has n = 17 and G1 has n = 18.

**Proof of what was sent.** For all 35 requests, the SHA-256 of the sent prompt text equals that of the previewed prompt, which equals that of the offline reconstruction (G0 with `concepts: false`, G1 with concepts). The scored payload is therefore exactly the one sent.

| Metric | G0 | G1 | Pre-registered condition | Verdict |
| --- | --- | --- | --- | --- |
| **L1 correct correspondences** | **0.275** | **0.551** | G1 ≥ G0 + 0.10 | **PASS** (+0.276) |
| Scenarios where G1 is not worse (mean over trials) | — | **9 / 9** comparable (8 better, 1 tie) | ≥ 7 of 10 | **PASS** |
| L2 valid proposals (`convertProposal` ok) | 0.235 | 0.556 | G1 not worse | **PASS** |
| L3 hallucinated references | 1 | 0 | G1 not worse | **PASS** |
| L4 invented values (defaults on null or enum targets) | 23 | 16 | reported | still high |
| L5 provider failures | 0 / 17 | 0 / 18 | reported | — |
| Request-body privacy scan (coded keys, values ≥ 6 chars) | 0 | 0 | = 0 | **PASS** |
| Median request time | 4.7 s | 4.6 s | — | — |

Per-scenario L1, G0 → G1 (index only; #1 not buildable):

| #2 | #3 | #4 | #5 | #6 | #7 | #8 | #9 | #10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.25 → 0.70 | 0.33 → 0.56 | 0.30 → 0.70 | 0.22 → 0.67 | 0.27 → 0.36 | 0.35 → 0.35 | 0.25 → 0.55 | 0.18 → 0.46 | 0.31 → 0.69 |

**Evidence privacy trace.**

- The committed evidence contains no App Check token.
- A scan of the evidence for coded source keys and source values of 6 or more characters matched **6 distinct terms** (53 occurrences across entries). All 6 are destination field names or allowed values from the reviewed `target`, which the source shares by coincidence. They are approved disclosure, not source leakage.
- No source-only key or value appears.
- The in-run request-body scan, which excludes destination words by design, found 0.

**Sensitivity.** G0 is missing one run (#5 t1). Even if that run had been perfect, G0's L1 would stay below G1 − 0.10. The verdict does not depend on the missing run.

**What is still wrong.**

- **Every one of G1's 8 rejected proposals is `INVALID_ENUM_MAPPING`.** Category names are withheld by default, so Gemini writes `map_enum` with labels it cannot know. This is the Sprint 14 mechanism, not a twin-fidelity problem. G0's rejections were 13 `INVALID_ENUM_MAPPING`, 2 `DUPLICATE_DESTINATION` and 1 `UNKNOWN_ALIAS`.
- **The planner still invents values.** It made 16 default writes on targets whose truth is "no source", or on fixed-list targets. These are exactly the defaults the acceptance policy rejects, so they never pass as correct output, but they are a planner defect.
- **L1 of 0.551 means almost half of the destination fields are still wrong or missing.** The twin is no longer the main bottleneck. The planner's enum handling and abstention are.

**Gate A verdict: PASS.** The pre-registered live condition holds on an independent holdout, with privacy and validity no worse, and with proof of the exact payload sent. Caveats:

- n = 17 and 18 requests, on one model;
- the holdout is now **inspected** (evidence scored), so any further claim needs a fresh holdout;
- the mapping is better, not good.
