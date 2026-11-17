# Sprint 18C — independent usability protocol: the AI-first journey (ready to run)

> **Status: NOT PERFORMED.** No independent participant has used the Sprint 18C build. No observations are recorded here or anywhere in the repository. An internal walkthrough or an automated test is not a usability session, so do not cite this file as user evidence.

## What is tested

The Milestone 1 journey: **Connect → Destination → Generate my integration → Verify → Deliver**.

The participant must not need to understand any of these:
- Phantom aliases;
- mapping operations;
- JSON Schema;
- inference modes;
- contract versions.

## Participants

- At least **three** people who have never used EYES. They should do data work (operations, analytics, integration or development) and be recruited outside the team.
- No coaching after the briefing.

## Materials

- **App.** Chrome on the build under test. The footer `build <sha12>` must equal the approved SHA, or use `pnpm dev` for a dry run. Cloud requests in a session count against an owner-approved budget: one plan request per participant, plus at most one recovery request.
- **Data.** [`fixtures/customers.json`](fixtures/customers.json). It has Spanish account states, ambiguous slash dates and several category fields.
- **Destination.** "Helpdesk account", which is built in.
- **Terminal.** Node 22 and `unzip`.

## Briefing (read verbatim)

> "Here is an export from a system you don't know. Turn it into the Helpdesk account format and produce something you could run again next month. Your raw records must not be sent to cloud AI. Think aloud. I will not help."

## Measures

Record times and counts only, in the notes sheet. Never record names, faces, voices or quotes in the repository.

| Measure | How |
| --- | --- |
| Finds the primary action | start → "Generate my integration" clicked (unaided / after searching / not found) |
| Understands the approval | before sending, explains what will leave the device (correct / partly / wrong) |
| Questions answered | count. Note any question the participant could not answer, by question kind |
| Uses "Choose another field" | yes / no / not needed |
| Opens "Advanced: map fields yourself" | yes / no. If yes, note why (screen, not person) |
| Distinguishes proposal from working integration | explains the difference between the field-match table and the verified Result (correct / partly / wrong) |
| Reads the verdict correctly | explains "Structure verified" vs meaning verified (correct / partly / wrong) |
| Time to usable output | start → transformed data downloaded |
| Downloads the intended artifacts | transformed data + .zip (+ bindings) |
| Runs the exported integration | `node run.mjs verify` and `run` exit with the documented code |
| Recovers from a provider failure | only if one happens naturally; never provoke it |
| Confusion / abandoned actions | count. Note the screen, not the person |

## Success criteria (Gate F)

- **Completion:** 3 / 3 complete the task without help.
- **Privacy:** 0 participants believe their raw records were sent to Gemini.
- **Approval:** at least 2 / 3 explain what the approval sends.
- **Verdict:** at least 2 / 3 distinguish a proposal from a verified integration, and "structure" from "meaning".
- **Advanced editor:** at most 1 / 3 needs the advanced manual editor for this dataset.

## Accessibility (same build, separate from the sessions)

- **Keyboard only:** Connect → Deliver, including every plan question and the "Choose another field" group.
- **Screen reader** (NVDA or VoiceOver): every plan question is announced by its title, and the picker by "Source of <field>".
- Do not mark either as passed without a real session.

## After the sessions

1. File every critical problem with a screenshot of the screen, never of the participant.
2. Fix critical problems and add a regression test for each fix.
3. Record aggregate results only in the sprint report, then mark this protocol PERFORMED with the date.
