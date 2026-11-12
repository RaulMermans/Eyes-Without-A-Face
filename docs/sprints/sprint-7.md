# Sprint 7 — Blind Integration Intelligence

**Date:** 2026-11-12  
**Branch:** `sprint-7`, from `main` @ `fe5aeb1` (merge of PR #7, Sprint 6). The repository is public; I did not touch its settings.  
**Question:** Can a cloud model improve an integration through controlled feedback, without inspecting the private records that exposed its errors?

## Outcome

**Built and verified**

- A bounded, approval-gated, single-cycle blind revision runs end to end in the real app with real Gemini Nano and real Gemini `IN_CLOUD`.
- No private string appeared in any of the 20 recorded real request bodies (3 further attempts failed at the provider before evidence was written).
- Every reported count is reproduced offline from the recorded real outputs by the deterministic evaluator.

**Measured with real models (final run 3; preliminary — one run per scenario)**

- **Support tickets:** one real revision produced a **policy-compliance gain on the independent holdout**: correctly handled 1 → 2 of 6, invented values (rejected by policy) 2 → 1, 0 regressions. It is not a transformation-correctness gain.
- **CRM:** the revision was valid but made no change, so no gain. Gemini did not infer the other day/month order from a `date-format-mismatch` finding.
- **Billing:** the initial request timed out twice (no retry), so this pair is **blocked**. In run 2 both billing revisions were rejected by the unchanged converter.

**Gemini Nano with private context**

- Real on-device output across the three scenarios was mostly "agrees with the deterministic profile".
- Its one useful refinement, `unternehmen` → organization, produced **no measurable downstream gain**.
- It never resolved the ambiguous date order.
- In run 2 it proposed a harmful relabel (an email field as "identifier"). That led to a validator fix: proven formats are facts.
- **Ablation result: inconclusive to negative.**

**Not achieved:** a real correctness gain. The machinery shows one with a hand-written initial contract and the simulated reviser (E2E-070, EVAL-003), but those are labeled and are not model results.

## Architecture

The design is a deterministic workflow with bounded model reasoning (Evaluator–Optimizer, one cycle, human approval). There is no agent framework, no memory, no autonomous retries. See [ADR 0008](../decisions/0008-blind-revision.md).

```
private records ─┬─ profile ── (Nano, ONLY_ON_DEVICE, bounded private context → validated → user applies) ── Phantom Twin
                 │                                                                                            │
                 │                                                     approved disclosure 1.1.0 ── Gemini ── proposal 1
                 │                                                                                            │
                 └─ Reality Check (imported + revision-feedback cases) ── outcome classes under local policy ─┘
                                 │
                 Blind Revision Feedback 1.0.0 (allowlisted projection) ── disclosure 1.2.0 = 1.1.0 + feedback
                                 │                       (same gate · new approval · single use · budget 1)
                                 └──────────────────────────── Gemini ── proposal 2 ── convertProposal (unchanged)
                                                                                         │
                         same engine + policy ── before/after ── final holdout (both versions, only now)
```

## Changes

| Area | Files |
| --- | --- |
| Feedback contract | `src/domain/contracts/schemas/blind-revision-feedback.v1.schema.json`, `cloud-disclosure.v1.2.schema.json`, `kinds.ts`, `types.ts`, `validate-contract.ts` |
| Feedback projection and validation | `src/revision/feedback.ts` |
| Revision request | `src/revision/revision-payload.ts`. The base is byte-identical to the approved 1.1.0 payload |
| State machine and budget | `src/revision/run.ts` |
| Prompts and response schemas | `src/inference/prompts.ts`: `BLIND_REVISION_INSTRUCTIONS` v2 and `MAPPING_REVISION_JSON_SCHEMA` (revision only) |
| Live adapter | `src/inference/firebase-live.ts`: separate revision model instance (same model, `ONLY_IN_CLOUD`); per-purpose `responseConstraint` on the existing on-device session |
| Private on-device understanding | `src/private-semantics/semantics.ts`, `private-field-semantics.v1.schema.json`, `src/phantom/roles.ts` (`roleCompatible`, `dateOrderOverrideAllowed`), `generate.ts` (reviewed `role` / `dateFormat` overrides), `profile.ts` (`dateFormatAmbiguous`) |
| Exception layer | `src/verification/outcomes.ts`: policy, outcome classes, completion states |
| Evaluation | `src/evaluation/{scenarios,evaluate,benchmark}.ts`, `src/examples/scenarios/*.json` |
| Test adapters | `deriveTestRevision` (simulated, labeled); harness switches `revisionRawText`, `onDeviceSemantics`, `cloudCalls` |
| Privacy fix found by the benchmark | `src/privacy/leak-scan.ts`: approved category labels inside generated descriptors no longer cause a false `PRIVATE_VALUE_PRESENT` (the label `email` vs "Email address") |
| UX | `BlindRevisionPanel.tsx`, `PrivateUnderstanding.tsx`, scenario picker in `SourcePanel.tsx`, `workspace-state.ts` (`scenario`, `revision`; invalidated upstream), `demo.ts` (`withScenario`) |

### Experience

**Source step.** "Blind revision scenarios" loads one of three fictional scenarios. It shows the active policy and how many holdout cases are held back.

**Phantom step.** "Interpret private fields on-device" lists, for each field:

- what Nano said;
- whether that agrees with the profile, refines it, or is rejected, with a fixed-vocabulary reason;
- an **Apply to twin** button, for validated refinements only;
- the rationale, in a collapsed local-only disclosure.

**Reality Check step.**

- **Blind revision** shows the initial mapping under the policy, with its completion state, the counts per outcome class, and the revision budget.
- **Prepare Safe Revision** works locally and makes no network request. The review lists what is newly disclosed, what stays private, the cumulative position ("request 2 of at most 2; twin repeated byte-for-byte"), and the limits. The exact request and its SHA-256 are behind a toggle.
- **Approve & Request Revision** needs the "I reviewed exactly…" checkbox. **Decline** sends nothing.
- **Revised mapping** shows the provenance label, the validation status, and before/after per operation, with changed operations highlighted.
- **Run Revised Reality Check** produces a before/after table built from evaluator counts only.
- **Final holdout** is enabled only in a terminal state and evaluates both versions.

Completion states map to fixed criteria (`COMPLETION_CRITERIA`):

| State | Criteria |
| --- | --- |
| VERIFIED | Contract valid, engine ran, every record transformed with no rule, no quarantine, no failure |
| VERIFIED_WITH_EXCEPTIONS | No unresolved, incorrect or policy-rejected record; at least one rule-handled or quarantined record; quarantine share ≤ the policy maximum |
| PARTIALLY_VERIFIED | Engine ran, but something is unresolved, incorrect, rejected by policy, or quarantine exceeds the limit |
| REVISION_FAILED | The revised proposal was rejected before execution |
| BLOCKED | Nothing could be evaluated |

## Tests & evidence

### Deterministic suites (final `pnpm test:all`)

| Suite | Baseline (`fe5aeb1`) | Sprint 7 |
| --- | --- | --- |
| lint / typecheck / build | PASS | PASS (0 warnings) |
| unit | 134 | **163** |
| contracts | 22 | **26** |
| privacy | 33 | **42** |
| evaluation (new) | — | **16** |
| E2E | 61 | **69** |

New suites:

- `tests/unit/blind-revision.test.ts` (REV-001…004)
- `tests/unit/outcomes-and-semantics.test.ts` (OUT-001, NANO-001/002)
- `tests/unit/cloud-response-schema.test.ts` (revision schema ↔ `PARAM_KEYS`)
- `tests/contracts/blind-revision-contracts.test.ts` (CON-070)
- `tests/privacy/blind-revision-privacy.test.ts` (PRIV-070…073: canary, rare, long, unicode, nested, prompt injection, smuggled values, aggregation buckets, approval binding, replay, invented fallbacks, malformed/executable/unknown-alias/prototype revisions)
- `tests/evaluation/*.test.ts` (EVAL-001…003, EVAL-010 replay)
- `tests/e2e/blind-revision.spec.ts` (E2E-070…076)

No existing assertion was weakened, and no existing selector was changed.

### Live (real Chrome 157, dedicated Nano profile, real Firebase project, App Check debug token)

**Step 2, requalification of the Sprint 6 UI.**

- LIVE-001…008 and LIVE-013 passed, including real `IN_CLOUD` (LIVE-004) and real `ON_DEVICE` (LIVE-007, LIVE-013).
- LIVE-009 failed once with provider `500 high demand`. The approval was consumed and nothing was retried. One manual re-run passed (5 valid operations, hidden cases 3 of 3 failed, no private terms in request bodies).
- Evidence: [`docs/evidence/sprint-7/live-requalification.json`](../evidence/sprint-7/live-requalification.json).

**Blind revision benchmark.** Three runs, all recorded in [`docs/evidence/sprint-7/`](../evidence/sprint-7/):

| Run | Change before the run | Result |
| --- | --- | --- |
| 1 | — (prompt v1) | CRM revision **rejected** (`INVALID_PARAMS` ×5: an operation marked unaffected was corrupted). Support C/D blocked by provider 500 |
| 2 | Prompt v2: explicit per-op params, category guidance; new `UNAPPROVED_FALLBACK` finding | CRM revision valid but unchanged. Support and billing revisions **rejected** (`INVALID_PARAMS` ×10 each: `map_enum` params became `{default, value: null, separator: "string"}`). Nano relabelled an email field as "identifier" |
| 3 (final) | Revision-only per-operation response schema; Nano rule "proven email stays email" | See below |

The changes after runs 1 and 2 responded to output-format failures and one validator gap. The holdout was never used to choose a change. I committed in advance to run 3 being final.

**Run 3 (final).** Holdout counts are correctly handled / 6.

| Scenario | A deterministic (offline) | B Gemini | C Nano + Gemini | D + one revision | Revision outcome |
| --- | --- | --- | --- | --- | --- |
| CRM | 1/6 (0 incorrect, 5 unresolved) | 1/6 (3 incorrect) | 1/6 (3 incorrect) | 1/6 | Valid, no change; "no measurable change" |
| Support | 1/6 (5 unresolved) | 1/6 (2 incorrect, 2 rejected by policy) | 1/6 | **2/6** (rejected by policy 2 → 1) | `unmapped: default → fail` on priority; "improved, no regressions" |
| Billing | 3/6 | 5/6 (1 rejected by policy) | **BLOCKED**: initial request `TIMEOUT` ×2 | — | — |

| Measure | Run 3 |
| --- | --- |
| Real cloud requests | B: 1 per scenario. C/D: 2 (CRM, support); billing C/D 1 + 1 re-run, both timeouts |
| Approvals | 1 per request; the revision approval is separate |
| Private strings in request bodies | 0 / 7 recorded bodies (0 / 20 across all three runs) |
| Revision prompt size | ≈ 5.6–6 KB (twin + feedback) |
| Gemini `IN_CLOUD` latency (SDK) | Initial 2.1–22.2 s; revision 2.2–16.5 s |
| Nano private interpretation | 14.8–15.3 s for 6–7 fields; run 2 CRM hit `ON_DEVICE_RUNTIME_ERROR` after 5 of 6 fields |
| Replay | `tests/evaluation/live-replay.test.ts` reproduces every browser count from the recorded real outputs |

**Real-model findings**

1. **Silent wrong output.** Gemini's CRM and support proposals are schema-valid but wrong:
   - CRM: MM/DD assumed, so day and month are swapped (7 of 9 incorrect);
   - support: p1→low and p4→urgent, a reversed priority scale.
   Without ground truth they look like success. Blind feedback cannot carry them because nothing fails, so the deterministic baseline's "unresolved" is arguably safer.
2. **Policy feedback works.** `UNAPPROVED_FALLBACK` is the one category real Gemini acted on correctly.
3. **Format reliability is the bottleneck.** Two of four real revisions in runs 1–2 failed the converter until the response schema was constrained per operation.
4. **Nano adds little here.** Its private context did not beat deterministic profiling on these fixtures.

### What is simulated, real, blocked or unverified

| Item | Status |
| --- | --- |
| E2E-070…076 | **Simulated** test adapter (labeled in the UI, `cloudCalls` counted). They prove gates and wiring, not model quality |
| EVAL-003 gains (CRM date order fixed, fallback applied) | **Hand-written initial contract + simulated reviser.** Machinery evidence only |
| Run 3 B/C/D for CRM and support; Nano for all three scenarios | **Real** |
| Billing C/D, run 3 | **Blocked** (`TIMEOUT` ×2, not retried further) |
| Screen-reader audit, user testing, non-Chromium browsers | **Not done** |
| CI on GitHub | See the PR checks |

## Risks / rollback

- **Leakage.** Feedback reveals coarse facts: which operation failed, which category, a bucketed count. With tiny datasets the "1" bucket is exact. The prompt scan is a heuristic (substring match after removing public text); zero matches is evidence, not proof. Nothing here is called private, anonymous or information-theoretically secure.
- **Browser-local budget.** The budget lives in page memory. A reload or another browser starts again.
- **Model behaviour.** The revision quality is that of `gemini-3.5-flash-lite` with a constrained schema. The provider produced 500s and timeouts during this sprint; the app records them and never retries.
- **Nano.** Nano's private-context suggestions can be wrong. Only validated, profile-consistent refinements can be applied, and only by a click. Chrome's on-device service can crash mid-run.
- **Cost.** About 26 real cloud requests were made in this sprint (requalification and the three benchmark runs). There were no billing or settings changes.
- **Regressions.** The engine, the DSL, the converter and the 1.1.0 path are unchanged. The leak-scan change only exempts labels already approved in the same payload.
- **Rollback.** Revert the merge commit. Cloud-disclosure 1.2.0 and feedback 1.0.0 are additive; no data migration is involved.

## Sprint 8 readiness (not started)

| Item | Readiness |
| --- | --- |
| Reproducible Blind Integration Benchmark | **Foundation ready**: case-set separation, metrics, configurations A–D, a live spec, archived evidence, deterministic replay. Needs repeated runs per scenario, variance, and more scenarios |
| Wider evaluation datasets | Scenario JSON format and `validateScenario` are ready. Needs scenarios with semantic traps that feedback *can* express |
| Portable integration export | Not started |
| Independent usability testing | The revision journey is complete and responsive (390 / 768 tested), but it is untested with users |
| Final hackathon demonstration | The honest demo is support tickets: approve one revision; Gemini removes an invented fallback; the holdout improves with 0 regressions. CRM shows the limit (a valid revision, no gain). Deployment and video still need owner approval |

**Unproven**

- That blind revision reliably improves transformation *correctness* with real models.
- That Nano's private context adds downstream value.
- Any statistical claim.
