# Evidence — what was measured, and how

One page for judges. Every line names its source. **Real** = live Gemini via Firebase AI Logic; **simulated** = the labeled test adapter (proves wiring and gates, never model quality); **deterministic** = local code and tests.

## Real inference

| Claim | Result | Source |
| --- | --- | --- |
| On-device Gemini Nano runs locally | `inferenceSource = ON_DEVICE` on every Sprint 8 and 9 trial; 0 cloud requests during on-device steps | Sprint 5, 8, 9 live suites; [evidence/sprint-9/qualification.json](../evidence/sprint-9/qualification.json) |
| Cloud Gemini runs only after approval | `IN_CLOUD`, one `generateContent` per approval; budget ≤ 2 per mapping | same |
| Request bodies contain no private data | 0 private terms in 47 real request bodies (Sprint 8: 38, Sprint 9: 9) | live body scans |
| Gemini makes schema-valid but wrong mappings | CRM dates read `MM/DD`, support priority scale inverted | Sprint 7–8 evidence |
| Local verification catches them | CRM 20/20, support 36/36 flagged, 0 false alarms | [sprints/sprint-8.md](../sprints/sprint-8.md), replayed by EVAL-081 |
| A blind revision can fix the meaning | Sprint 8 holdout: support 0 → 6, CRM 1 → 9 of 10. Sprint 9 live: 3 of 5 runs `ACCEPTED` (clean 0 → 8, 0 → 8, 7 → 8) | Sprint 8 report; [evaluation/sprint-9-reliability.md](../evaluation/sprint-9-reliability.md) |
| Exported packages run outside the app | 4 / 4 live exports: `node run.mjs verify` exit 0 in a fresh directory, no install | Sprint 9 live qualification |

## Deterministic proof

| Claim | Test |
| --- | --- |
| The package runner equals the app's engine (fixtures and real records via local bindings) | EXP-002 (clean room: system `unzip`, bare `node`) |
| Bindings are validated before anything runs; missing, unknown, duplicate, foreign → exit 2, no output | EXP-003 |
| A modified package fails verification | EXP-004 |
| No record value, field name, binding, canary or secret in any extracted file | EXP-005, PRIV-090…093, E2E-090/091 |
| Byte-identical archives for the same state; committed runtime is fresh | EXP-006, EXP-007 |
| Export status follows verification (draft needs confirmation; hidden-case failures or semantic mismatch are never VERIFIED) | EXP-010…014 |
| Provider failures are classified and explained; recovery needs a fresh approval; no automatic retry; revision budget unchanged | REL-001…003, E2E-093…096 |
| Preflight sends nothing and never calls configuration "available" | REL-010…014, E2E-097 |

Suites at the Sprint 9 head: 217 unit · 43 contract · 66 privacy · 62 evaluation · 89 Playwright E2E, lint and typecheck clean.

## Approval gates (what a judge can watch)

1. Disclosure Review: the exact prompt, its SHA-256, *will be sent* / *never sent*; nothing leaves before **Approve this exact prompt**.
2. Blind revision: *Newly disclosed* vs *Stays private*, a per-constraint opt-in, then **Approve & Request Revision**; budget 1.
3. Export: built locally, privacy-scanned, drafts need explicit confirmation.

## Known limits (stated, not hidden)

- A deterministic patch with the same approved constraint matched or beat Gemini's revisions (Sprint 8 control P).
- Gemini Nano added no measurable accuracy on these fixtures.
- Provider failures: 10 / 30 initial and 5 / 8 revision requests failed in Sprint 8; 0 / 9 in Sprint 9 (different provider conditions; not our fix).
- Initial proposal validity: 19 / 20 (Sprint 8), 4 / 5 (Sprint 9). Invalid output is rejected, never repaired.
- Small, fictional scenarios written by the team; no statistical claim. The Sprint 8 holdout has since been inspected.
- Not anonymization. No independent usability test yet. The hosted build is not deployed yet (owner approval pending).
