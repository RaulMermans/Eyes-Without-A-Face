# Evidence — what was measured, and how

One page for judges. Every line names its source. **Real** = live Gemini through Firebase AI Logic; **simulated** = the labeled test adapter (proves wiring and gates, never model quality); **deterministic** = local code and tests. Updated Sprint 12 (2026-11-13).

## Production

| Claim | Result | Source |
| --- | --- | --- |
| Public URL serves the approved build | <https://eyes-without-a-face-b7281.web.app> → `build-info.json` `gitSha b93e3edbb997…`, `mode: production`, `appCheckDebug: false`; HTTPS with HSTS, HTTP → HTTPS redirect; main bundle byte-identical to the verified local artifact | [../deployment.md](../deployment.md) Sprint 12 record |
| App Check is enforced | A Firebase AI Logic request with the public API key but no App Check token → `401 "Firebase App Check token is invalid."` (2026-11-13) | [../deployment.md](../deployment.md) |
| No debug token in production | Release build refuses debug mode; local debug token absent from `dist`, from the hosted JS and from all Git history | `pnpm verify:release`; hosted bundle scan |
| Full journey on the public URL with real models | **2 / 2** runs: Nano 6 / 6 `real on-device` in CONNECT, 0 requests before approval, Gemini `IN_CLOUD` valid (2.4–2.5 s), semantic failure detected, revision `ACCEPTED`, OUTCOME *Verified, with managed exceptions.*, export `VERIFIED_WITH_EXCEPTIONS`, `node run.mjs verify` exit 0; production reCAPTCHA Enterprise, **no debug token** | [../evidence/sprint-12/hosted-acceptance.json](../evidence/sprint-12/hosted-acceptance.json), [screenshots](../demo/screenshots/sprint-12-hosted/) |
| Honest degradation | Chromium without Nano (158) and Firefox (159) on the public URL: *Deterministic, not hybrid*, on-device stage `skipped`, 0 cloud requests, 0 page errors | [../evidence/sprint-12/hosted-degradation.json](../evidence/sprint-12/hosted-degradation.json) |

## Real inference and correctness

| Claim | Result | Source |
| --- | --- | --- |
| On-device Gemini Nano runs locally | `inferenceSource = ON_DEVICE` on every Sprint 8, 9 and 12 trial; 0 cloud requests during on-device steps | Sprint 8/9 live suites; Sprint 12 hosted and experiment runs |
| Cloud Gemini runs only after approval | `IN_CLOUD`, one `generateContent` per approval | same |
| Gemini makes schema-valid but wrong mappings | CRM dates read month-first; support priority scale inverted | Sprint 7–8 evidence; Sprint 12 runs |
| The local verifier catches them | Sprint 8: CRM 20 / 20, support 36 / 36 flagged, 0 false alarms. Sprint 12: 3 / 3 wrong holdout dates flagged in each of 6 runs, 0 false alarms | [../sprints/sprint-8.md](../sprints/sprint-8.md) (EVAL-081); [../evidence/sprint-12/nano-value-summary.json](../evidence/sprint-12/nano-value-summary.json) (EVAL-122) |
| A blind revision can fix the meaning | Sprint 8 frozen holdout: support 0 → 6, CRM 1 → 9 of 10. Sprint 9 live: 3 / 5 `ACCEPTED`. Sprint 12 hosted: 2 / 2 `ACCEPTED`, transformed 0 → 7 | Sprint 8 report; [../evaluation/sprint-9-reliability.md](../evaluation/sprint-9-reliability.md); hosted evidence |
| Exported packages run outside the app | Every live export: `node run.mjs verify` exit 0 in a fresh directory, no install (Sprint 9: 4 / 4; Sprints 10, 11: 1 / 1; Sprint 12 hosted: 2 / 2) | live evidence files |

## Does Gemini Nano add value? (Sprint 12 pre-registered experiment)

| Question | Answer | Source |
| --- | --- | --- |
| Does Nano understand what deterministic rules cannot? | **Yes, on this scenario.** Dutch field names `bedrijf` / `contactpersoon` are both generic `text` to the rules; Nano labelled them organization / person-name in 3 / 3 runs. 8 / 8 applied suggestions matched ground truth; 5 wrong suggestions were blocked by validation | [../evaluation/sprint-12-nano-value.md](../evaluation/sprint-12-nano-value.md) |
| Does it improve Gemini's mapping? | **No measurable improvement.** C and D mappings identical in 3 / 3 pairs; holdout delta 0, 0, 0. Nano did not resolve the day-first date order (0 / 3) | same; EVAL-122 replay, 0 mismatches |
| Cost | Median 17.9 s on-device per run | same |
| Verdict | **Neutral** | — |

## Privacy

| Claim | Result | Source |
| --- | --- | --- |
| Request bodies contain no private source values | 0 private values in 61 real request bodies (Sprints 8–11: 51; Sprint 12: 10). In 3 Sprint 12 bodies the scanner matched the word `partner`; traced to a fictional twin example ("Copperfield Partners"), not a source value, and pinned by EVAL-122 | live body scans; [../evaluation/sprint-12-nano-value.md](../evaluation/sprint-12-nano-value.md) |
| Exports contain no private data | Blocking privacy scan on every export; EXP-005, PRIV-090…093 | deterministic tests |
| Approvals are single-use and never reused after a change | E2E-111, E2E-113, REL-001…003 | deterministic tests |

## Deterministic proof

| Claim | Test |
| --- | --- |
| The package runner equals the app's engine | EXP-002 (clean room: system `unzip`, bare `node`) |
| Bindings validated before anything runs | EXP-003 |
| A modified package fails verification | EXP-004 |
| Byte-identical archives; committed runtime fresh | EXP-006, EXP-007 |
| Export status follows verification; quarantine is never success | EXP-010…014, OV-001/002 |
| Provider failures classified; recovery needs a fresh approval; no automatic retry | REL-001…003, E2E-093…096 |
| Displayed runtime, boundary and verdict equal canonical state | RT-009…012, INV-001, E2E-110…115 |

Suites at the Sprint 12 head: see [../sprints/sprint-12.md](../sprints/sprint-12.md).

## Approval gates a judge can watch

1. Disclosure Review: the exact prompt, its SHA-256, *will be sent* / *never sent*; nothing leaves before **Approve this exact prompt**.
2. Blind revision: *Newly disclosed* vs *Stays private*, a per-constraint opt-in, then **Approve & Request Revision**; budget 1.
3. Export: built locally, privacy-scanned; drafts need explicit confirmation.

## Known limits (stated, not hidden)

- **Independent usability: NOT PERFORMED.** No external developer has used EYES; every UX claim is team judgment plus automated checks.
- A deterministic patch with the same approved constraint matched or beat Gemini's revisions (Sprint 8 control P).
- Gemini Nano adds correct understanding but no measured accuracy gain (Sprint 8 and Sprint 12).
- Provider failures: 10 / 30 initial and 5 / 8 revision requests failed in Sprint 8; 0 / 9 in Sprint 9; 0 / 10 in Sprint 12 (provider conditions, not our fix).
- Small fictional scenarios written by the team; no statistical claim.
- Not anonymization. No manual screen-reader pass yet.
