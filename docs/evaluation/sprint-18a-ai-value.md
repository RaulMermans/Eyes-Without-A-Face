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

### Live (G0 vs G1)

**NOT RUN.** It needs owner approval of the budget above: 40 cloud requests, no retries, no revision. Gate A is therefore **not passed**, and 18B does not start.
