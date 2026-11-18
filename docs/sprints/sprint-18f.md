# Sprint 18F — Release candidate: a privacy-first assisted mapper

| Item | Value |
| --- | --- |
| Branch | `sprint-18b-ai-first` |
| Release status | **`CODE_READY` → `DEPLOYMENT_PENDING` once `build:release` passes.** Deploying needs the owner's approval of the exact SHA. Production stays `c7220768` until then |
| Product decision (owner, 2026-11-18) | Ship EYES as what the evidence supports: a **privacy-first assisted mapper**, not an autonomous one |
| Milestone 1 | **Not met** (original Gate D, unchanged) |
| Decisions | [ADR 0021](../decisions/0021-semantic-intelligence-recovery.md), [ADR 0022](../decisions/0022-answerable-questions-and-local-evidence.md) |
| Evidence | [confirmatory run](../evaluation/sprint-18f-confirmatory.md#results) |

## What ships (the configuration confirmed on fresh data)

The running app now uses, by default:
- **Destination semantics:** cloud-disclosure 1.4.0. The destination's own descriptions are sanitized, fail closed, and are shown in the review.
- **Ranked plans:** prompt v6 and plan 1.1.0, so Gemini lists alternatives for each field.
- **Local evidence that asks** (ADR 0022 B, C). When the on-device matcher, which sees the real field names, disagrees with Gemini or contradicts its pick, EYES asks one question instead of executing silently.
- **Answerable questions** (ADR 0022 A, every compile):
  - "Not the right field? Use another";
  - "Combine several fields";
  - no question that cannot be answered;
  - a labelled `trim` for padded text.

The model is still `gemini-3.5-flash-lite` at its default thinking. A dev test harness can switch each feature off. Library calls outside the running app (replays, scorers) keep their explicit historical defaults, so every historical replay still reproduces.

## What the evidence says (fresh, independently authored holdout; 18 completable scenarios)

| | Sprint 18C configuration | Shipped configuration |
| --- | --- | --- |
| Complete correct integrations | 1 / 18 | **9 / 18** |
| CRM → helpdesk / other domains | 0 / 9, 1 / 9 | 4 / 9, 5 / 9 |
| Incorrect among transformed records | 0.90 | **0.39** |
| Falsely verified records / false completes / invented values | 0 / 2 / 0 | **0 / 0 / 0** |
| Privacy findings / unauthorized requests | 0 / 0 | **0 / 0** |
| Answers per scenario (manual flow 11.6) | 7.3 | 8.6 |

**The honest product claim:**
- EYES completes about **half** of hard, unfamiliar integrations correctly with a few targeted questions.
- It **never labels a wrong record as verified, never invents values and never discloses private data**.
- It says plainly what still needs review. The outcome headline comes only from the local verifier (`honestVerdict`): "Structure verified" unless meaning is verified for every field.

## Known limitations (user-visible)

- **About half of integrations still need review.**
  - The usual cause is a field where Gemini and the local matcher agree on the wrong source. EYES cannot detect that.
  - The verifier then says "Structure verified", never "Integration ready".
- **More questions than the original target:** 0.74 × the manual flow, against a 0.6 × goal. This is the price of not executing uncertain matches.
- **Gemini blind revision is not offered on the default path.** It needs a 1.1.0 base reproduced byte for byte, and the shipped request is 1.4.0. Targeted questions now do that recovery work.
- **Provider reliability:** about 15 % of requests hit Google-side `INTERNAL` errors or timeouts. Recovery is one new request, approved again; there is no automatic retry.
- **Not done:** independent usability sessions and a manual screen-reader pass.

## Checks (this tree)

| Check | Result |
| --- | --- |
| lint, typecheck, build | PASS |
| unit / contracts / privacy / evaluation | 702 / 100 / 105 / 223 PASS (13 skipped by design: env-gated live scoring) |
| E2E | **172 / 172**, including E2E-193: the shipped configuration end to end to Deliver |
| Export runtime parity | PASS (EXP-001–007) |
