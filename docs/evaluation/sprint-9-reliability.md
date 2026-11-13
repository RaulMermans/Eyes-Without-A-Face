# Sprint 9 — reliability and hybrid-value evidence

Date: 2026-11-13. Model `gemini-3.5-flash-lite` (Firebase AI Logic, `ONLY_IN_CLOUD`, App Check debug token, localhost) and Gemini Nano (`ONLY_ON_DEVICE`, dedicated Chrome profile). Raw evidence: [docs/evidence/sprint-9/qualification.json](../evidence/sprint-9/qualification.json), copied unedited from `live-evidence/sprint-9/`.

## 1. Initial response validity (B1)

**Change.** Initial proposals now use the per-operation response schema that Sprint 7 introduced for revisions (`src/inference/response-schemas.ts`). The frozen `prompts.ts` is unchanged; only the selection changed.

**Offline replay (EVAL-090, deterministic).** The 20 real initial responses recorded in Sprint 8, read strictly (the decoder can emit only declared properties):

| Schema | Admits | Converter-valid admitted | Converter-invalid admitted |
| --- | --- | --- | --- |
| Flat (Sprint 4–8 initial) | 20 / 20 | 19 / 19 | 1 / 1 (CRM t4: extra `value`/`separator` on `map_enum`) |
| Per-operation (Sprint 9) | 19 / 20 | 19 / 19 | **0 / 1** |

This shows that the stricter schema excludes the recorded invalid shape and no recorded valid shape. It is a compatibility measurement, not a live rate.

**Live (Sprint 9 qualification, n = 5 initial requests).**

| | Sprint 8 (flat schema) | Sprint 9 (per-operation) |
| --- | --- | --- |
| Initial requests | 30 | 5 |
| Provider failures (500 / timeout) | 10 | **0** |
| Responses converter-valid | 19 / 20 (95 %) | 4 / 5 (80 %) |
| Kind of invalid response | extra params on `map_enum` (shape) | `map_enum` over the **placeholder** labels `category_a…c` of a withheld category (vocabulary) |

**Reading.** No validity improvement is measured: the samples are small, and the one Sprint 9 rejection is a vocabulary error that no response schema can express. The converter rejected it unchanged and nothing was repaired. The shape error class Sprint 8 saw did not recur in 5 requests, which is not proof that it is gone. Provider conditions were much better than in Sprint 8 (≈2 s instead of 13–45 s). That is the provider, not this sprint's work.

## 2. Failure handling (B2/B3), deterministic

- The verbatim Sprint 8 message `[500 ] … high demand` was classified as `NETWORK`. It is now `PROVIDER_OVERLOADED` (REL-001).
- Every failure category (timeout, overload, rate limit, App Check, invalid response, model unavailable, network, on-device runtime, cancellation, approval invalid, provenance) yields what happened, why it matters and what to do next, without raw provider text (REL-002, E2E-094).
- Recovery is a fresh preview with a new request id that the user approves again. Consumed approvals are never reused, nothing retries, a failed revision never resets the budget, and on-device failures never point to the cloud (REL-003, E2E-093, E2E-096).
- Live, Sprint 9 saw **no provider failure** in 9 requests, so recovery was exercised only with the labeled test adapter. It is **not live-verified**.

## 3. Hero-journey qualification (live, predeclared budget: 5 runs, ≤ 10 cloud requests, no retries)

| Run | Scenario | Nano | Initial | Meaning (local) | Approved disclosure in revision | Revision | Local decision | Export | `node run.mjs verify` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CRM | real, 1 applied (`f_06` organization) | valid, 2.0 s | `SEMANTIC_MISMATCH` (dates read MM/DD) | observed date order `DD/MM/YYYY` | real, 1.9 s | **ACCEPTED** (8 improved / 0 regressed; clean 0 → 8) | `VERIFIED_WITH_EXCEPTIONS`, revised | exit 0 |
| 2 | CRM | real, no rows recorded | **rejected** (placeholder labels) | — | — | not sent | — | — | — |
| 3 | CRM | real, 1 applied | valid, 1.9 s | `SEMANTIC_MISMATCH` | observed date order | real, 2.7 s | **ACCEPTED** (8 / 0; 0 → 8) | `VERIFIED_WITH_EXCEPTIONS`, revised | exit 0 |
| 4 | Support | real, 0 applied | valid, 2.0 s | `SEMANTIC_POLICY_CONFLICT` | owner-declared priority order | real, 2.6 s | **ACCEPTED** (2 / 0; 7 → 8) | `VERIFIED_WITH_EXCEPTIONS`, revised | exit 0 |
| 5 | Support | real, 1 applied | valid, 1.7 s | `SEMANTIC_POLICY_CONFLICT` | owner-declared priority order | real, 2.2 s | `HUMAN_REVIEW_REQUIRED` (1 / 0; 7 → 7) | **`DRAFT`** (confirmed), revised | exit 0 |

- **Requests:** 9 `generateContent`, 0 private terms in any request body, 0 cloud requests during Nano interpretation.
- **Exports:** 4 / 4 packages verified with plain `node` in a fresh temporary directory. Labels followed the local decision (`HUMAN_REVIEW_REQUIRED` → `DRAFT`).
- **`VERIFIED_WITH_EXCEPTIONS`, not `VERIFIED`:** the scenarios' acceptance policies quarantine malformed records. Quarantined records are listed, never counted as transformed.
- **Spec assertion failure in runs 4–5:** the live check searched every package file for private terms. It matched the field name `body` inside the bundled ajv runtime (`thenBody`/`elseBody`). That file is app-owned, identical in every export and hash-pinned. The match was reproduced offline, and the data-bearing files contained no term. The spec now requires static files to be byte-identical to the committed ones and scans only data files. The recorded evidence was not edited.
- **Not shown:** these runs are qualification of the journey, not a benchmark. The Sprint 8 holdout is inspected (development data), so no new holdout claim is made.

## 4. Preflight (B4)

The runtime check was read at page load in every live run, before the local probe returned. It showed on-device `UNAVAILABLE` on a Nano-capable profile. That was wrong, and it is fixed: an unfinished probe is now `UNVERIFIED` (REL-014). Firebase, App Check and cloud read `CONFIGURED`, never "available", until a real result arrived.

## 5. Hybrid value, narrowly (Workstream F)

**Positioning.** Local intelligence for private understanding. Cloud intelligence for integration design. Deterministic verification for correctness and safety.

| Question | Evidence | Answer |
| --- | --- | --- |
| Can deterministic software apply a known correction? | Sprint 8 control P matched or beat every Gemini revision (CRM 9 vs 9, support 7 vs 6) | **Yes, and it should.** Once the constraint is known, a rule can patch it |
| Can the system build an integration for an unfamiliar private structure without showing records to the cloud? | Sprint 9 runs 1, 3, 4: the twin and approved disclosure only → a Gemini mapping → local detection of a wrong meaning → one blind revision → an exported package that runs elsewhere | **Demonstrated in 3 of 5 live runs**: 1 rejected initial proposal, 1 human-review draft. This is the product capability, and P cannot do it: P needs an initial mapping to patch |
| What does Nano add? | Deterministic profile already types every field; Nano's only applicable suggestion was a role refinement (`organization`) on CRM `f_06` (runs 1, 3; Sprint 8 the same). It changed the descriptor Gemini saw | **No measured effect on correctness.** No paired run without Nano was made in Sprint 9; Sprint 8's ablation found 0 change in the mapping from that suggestion. Nano never proposed the date order, which is what mattered |
| What decides correctness? | Local semantic verifier + local decision (all ACCEPTED/HUMAN_REVIEW verdicts above) | Deterministic code, from owner declarations or sufficient local observation |

Nano's role remains *optional private interpretation*. Its measured contribution to accuracy is zero on these fixtures, and the product says so.
