# Sprint 15 — independent usability protocol (ready to run)

> **Status: NOT PERFORMED.** No independent participant has used the Sprint 15 build. No observations are recorded here or anywhere in the repository. Do not cite this file as user evidence.

## Participants

At least **three developers** who have never used EYES. Recruit them outside the team. No coaching after the briefing.

## Materials

- **App.** Chrome on the hosted build, footer `build <sha12>` = the approved SHA, or `pnpm dev` for a dry run.
- **Data.** [`fixtures/customers.json`](fixtures/customers.json): 8 fictional customers, 17 fields, 13 category fields, Spanish account states, ambiguous slash dates.
- **Destination.** "Helpdesk account" (built in).
- **Terminal.** Node 22 and `unzip`.

## Briefing (read verbatim)

> "Your customer records must be transformed into the supplied Helpdesk format. The original data must not be sent to cloud AI. Produce a usable output and a reusable integration. Think aloud. I will not help."

## Measures

Record times and counts in the notes sheet. Do not record names, faces, voices or quotes in the repository.

| Measure | How |
| --- | --- |
| Time to understand the first screen | start → first purposeful action |
| Time to import data | start → `source-summary` visible |
| Time to choose a destination | import → Helpdesk selected |
| Clarification decisions | number of answers given (field choice, each translation, date order) |
| Time to first valid mapping | start → Result with Structure passed |
| Time to usable output | start → transformed data downloaded |
| Corrects an ambiguous field | picks `account_state` for status, and day/month for `created_on` (yes / after hint / no) |
| Privacy approvals understood | participant explains what would leave the device (correct / partly / wrong) |
| Verification status understood | participant explains Draft vs verified, and "meaning" (correct / partly / wrong) |
| Downloads the intended artifacts | transformed data + .zip (+ bindings) |
| Runs the exported integration | `node run.mjs verify` and `run` exit 0 |
| Confusion / abandoned actions | count; note the screen, not the person |

## Success criteria

- 3 / 3 complete the task unaided.
- 0 participants believe their records were sent to Gemini.
- At least 2 / 3 explain the meaning check correctly.

## After the sessions

1. File every critical problem as an issue, with a screenshot of the screen, never of the participant.
2. Fix critical problems before submission, and add a regression test per fix.
3. Record aggregate results only in the sprint report, then mark this protocol PERFORMED with the date.
