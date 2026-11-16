# Sprint 16C — independent developer usability protocol

> **Status: NOT RUN.** No independent participant has used EYES. Nothing below is an observation. Never cite this file as user evidence. Results go only in [results.md](results.md), and only after real sessions.

## Participants

- **Who:** at least **three developers** who have not worked on EYES and have never used its interface, with some JSON, CSV, API or data-integration experience.
- **Recruiting:** outside the team. Get consent for note-taking only.
- **Never in the repository:** names, faces, voices, recordings or quotes. Record aggregate, sanitized observations only.

## Setup (per session, ~45 min)

| Item | Value |
| --- | --- |
| App | Chrome on <https://eyes-without-a-face-b7281.web.app>. The footer `build <sha12>` must equal the **approved, deployed** SHA; record it. Do not run sessions on an unapproved build |
| Scenario 1 | Guided CRM → Helpdesk: [`docs/usability/fixtures/customers.json`](../../../usability/fixtures/customers.json) (Sprint 15 fictional dataset) and the built-in **Helpdesk account** destination |
| Scenario 2 | Unseen: shipment tracking. Participant pack [`docs/usability/sprint-16c/participant/`](../../../usability/sprint-16c/participant/): the CSV, the destination schema and a one-page requirements note. Answer key (facilitator only): [`facilitator/`](../../../usability/sprint-16c/facilitator/) |
| Terminal | Node 22 and `unzip`, in an empty folder |
| Timer | Facilitator's stopwatch, per measure below |
| Materials check | Agent dry-run on the release artifact: Scenario 2 is solvable; the traps appear (EYES *suggests* `label_id` for `shipmentId` and `last_scan_at` for `shippedAt`, both wrong); the checker accepts a correct result. This is **not** a participant: [pilot.json](pilot.json) |

## Briefing (read verbatim, then stay silent)

> "Here are records from one business system and the data requirements of another. Build a reusable integration that transforms the records into the destination format. The original records must not be sent to cloud AI. Complete the task without my help, and explain what the final result proves."

- Do not explain EYES' architecture.
- Answer only "Please do what you think is right."
- An intervention to unblock is allowed only after 3 minutes stuck. Record it as an intervention.

## Observation checklist (record yes / after intervention / no)

1. Understands what EYES does (first screen, own words).
2. Imports the data.
3. Chooses / applies the destination schema.
4. Interprets the field suggestions ("suggested", "Use …").
5. **Rejects an incorrect suggestion.** Scenario 2: does not accept `label_id` for `shipmentId` nor `last_scan_at` for `shippedAt`.
6. Confirms the intended fields.
7. Translates categories correctly (status, country).
8. Completes the local mapping ("Build on this device").
9. Understands the verification result.
10. Downloads the transformed records.
11. Exports the reusable integration (.zip).
12. Runs the exported package (`node run.mjs verify`, then `run` with the bindings file).
13. Explains what data could leave the device.
14. Explains which parts of the mapping were actually verified.

**Correctness of the output:**

- Scenario 2: `node scripts/qa/s16c/check-usability-output.mjs <their transformed-records.json>`. It prints counts and field names only.
- Scenario 1: compare with the Sprint 15 fixture's documented answers.

## Measures

| Measure | Definition |
| --- | --- |
| Total completion time | briefing end → participant says done |
| Time to first meaningful action | briefing end → first import or destination action |
| Time to usable output | briefing end → transformed data downloaded |
| Incorrect mapping decisions | wrong field chosen or wrong translation kept at build time |
| Unassisted corrections | wrong choices the participant fixed alone |
| Critical misunderstandings | see the trust evaluation below |
| Unexpected UI behaviour | screen + what happened (no person data) |
| Export success | zip downloaded; `verify` exit 0; `run` exit 0 or 3 |
| Abandoned actions | count |
| Facilitator interventions | count + step |

## Trust evaluation (after the task, in this order)

Show each term on screen, or as text where it is not visible, and ask "What does this mean?":

- "Suggested field"
- "Structure verified"
- "Meaning verified"
- "Integration ready"
- `VERIFIED`
- `VERIFIED_WITH_EXCEPTIONS`
- `DRAFT`

Then ask:

1. "Does this result guarantee that the selected fields represent the correct business meaning?"
2. "What has EYES actually verified, and what are you personally responsible for checking?"
3. "Did any of your records leave this computer? How do you know?"

**Critical failure:** the participant believes EYES established semantic correctness automatically when only the structure was validated. This is especially likely for `VERIFIED`. Record each critical failure with the term that caused it.

## Acceptance targets (targets, not results)

| Target | Threshold |
| --- | --- |
| Complete the core task without critical assistance | 3 / 3 |
| Believe records were uploaded without approval | 0 |
| Mistake an unverified semantic mapping for a guaranteed one | 0 |
| Explain the meaning-verification boundary correctly | ≥ 2 / 3 |
| Produce a usable output | 3 / 3 |
| Verify the exported integration (assistance recorded separately) | 3 / 3 |

**If participants systematically misread `VERIFIED`:**

- Record it as a release risk.
- Use the prepared remediation proposal in [../../../qa/sprint-16c-production-acceptance.md](../../../qa/sprint-16c-production-acceptance.md) § Risks.
- Do **not** change the Export Contract during the sprint.
