# Sprint 11 usability session kit (facilitator)

> **Status (Sprint 12, 2026-11-13): NOT PERFORMED.** No participant has used Eyes Without a Face. This kit is ready for a human facilitator. Nothing in this repository is participant evidence. Do not cite the targets below as results.

Everything a facilitator needs to run 3 or more unassisted sessions of about 45 minutes each, on the Sprint 11 build. It extends the protocol in [README.md](README.md) §1 and §3.

## 1. Participants

- **3 or more** developers with basic experience of JSON, APIs, data transformation or integrations.
- **None** may have seen this repository, its demo, its video or its documentation, and none may have talked to the team about how it works.
- Recruit from outside the team. Do not use people who helped build or review the product.

## 2. Consent (read and get a yes before recording)

> "This session tests the software, not you. I will record your screen and voice only if you agree, and only to take notes afterwards. Recordings stay on the facilitator's machine. They are never uploaded to the project repository, and they are deleted within 30 days. Notes use a code such as P1, never your name. You can stop at any time. Do you agree to the screen recording? Do you agree to the audio recording?"

Record the two answers as `screen: yes/no`, `audio: yes/no` on the session sheet. If the answer is no, take notes by hand.

## 3. Setup (before each session)

| Item | Setting |
| --- | --- |
| Build | **Hosted: <https://eyes-without-a-face-b7281.web.app>** (live since Sprint 12, build `b93e3edbb997`; no install, no keys). Note the build SHA from the footer. `pnpm dev` only as a fallback |
| Browser | Fresh Chrome profile. For the hybrid path, use the Nano profile ([../setup/browser-compatibility.md](../setup/browser-compatibility.md)). Note in the sheet whether on-device AI was **available** |
| Data | Fictional only: the bundled **fictional CRM demo** (landing button) and the scenario **crm-eu-accounts** (Connect → Advanced sources). The destination schema loads with each one. Never use real data |
| Terminal | Node 22+, `unzip`, an empty folder such as `~/eyes-session` |
| Screen | 1440×900 or larger. Run one session (or one task) at 390 px in device emulation if time allows |
| Reset | Reload the page between participants. Nothing persists, by design |

## 4. Briefing (read verbatim, then stay silent)

> "You must move customer records from a confidential CRM into a helpdesk. The records may not be shown to a cloud AI model. Use this tool to produce an integration you could run somewhere else. Please think aloud. I can't help you or answer questions about the tool until the end."

If the participant is stuck for **more than 3 minutes**, say only: "What would you try next?" Give a hint only after a further 2 minutes, and log every hint.

## 5. Tasks (A2): read each one verbatim, one at a time

| # | Task prompt | Success criterion (observable) | Critical failure |
| --- | --- | --- | --- |
| T1 | "Look at this page for 30 seconds. What does this tool do?" (landing only) | Mentions integrating private data without showing it to the cloud AI | — |
| T2 | "Start an integration from the fictional CRM to the helpdesk." | Reaches OBSERVE at "Waiting for your approval" | Believes something was already sent |
| T3 | "What has happened on your computer so far? Did any AI run?" | Says the records stayed in the browser; says correctly whether on-device AI ran (the run-kind label in CONNECT) | Says the cloud saw records |
| T4 | "What exactly is the cloud allowed to receive?" | Opens the review; names aliases, fictional rows, destination fields; not records or field names | Says records or real values are sent |
| T5 | "Decide whether to let the request go." | Reads *will / will not receive* before approving or rejecting | Approves without opening the review (log the time spent) |
| T6 | "Show me what the mapping does with the creation date." | Opens the Integration Studio; finds the `createdAt` operation | — |
| T7 | "Is this integration correct?" (use **crm-eu-accounts** from here on) | Separates "schema-valid" from "means the right thing"; names the date-order finding | Says it is correct because every record passed the schema |
| T8 | "What went wrong, and what can you do about it without sending the records?" | Explains the semantic failure; finds *Prepare Safe Revision* | — |
| T9 | "Do that, if you think it is safe." | Reads *newly disclosed / stays private* before approving the revision | Approves without reading, or believes records were sent |
| T10 | "What did you end up with?" | Reads the OUTCOME headline; explains exceptions and quarantine, and draft vs verified | Believes quarantined records were transformed, or that "unknown" means correct |
| T11 | "Take the integration with you." | Exports; says that it is a download, not a deployment | Believes export deployed or connected anything |
| T12 | "Check outside the tool that what you got is intact." | Runs `node run.mjs verify` in the terminal; exit 0 | — |

## 6. Measures (A3), one sheet per participant

Use codes only. Do not write participant names, quotes, emails or employers in the sheet.

```
participant: P#        date: YYYY-MM-DD      build sha: ________   width: 1440 / 390
on-device AI available: yes / no       consent screen: yes/no  audio: yes/no

task | outcome (U=unaided H=hint N=not done) | time (mm:ss) | extra clicks | nav errors | hesitations >30s | notes (codes)
T1   |                                          |              |              |            |                  |
...
T12  |

time to first meaningful result (start → "Waiting for your approval"):  mm:ss
time to verified outcome (start → OUTCOME headline explained):          mm:ss
incorrect privacy assumptions (count + task):
export success (node run.mjs verify exit 0 unaided): yes / no
runtime visualization: helped / neutral / confused (+ 1 short paraphrase, no quote)
confidence in final integration (1–5):
issues (one per line): [CRITICAL|HIGH|MEDIUM|LOW] task · observed behaviour · screen/testid
```

**Severity.**

- **CRITICAL:** a privacy misunderstanding, an approval given unread, export taken for deployment, or the task blocked with no way forward.
- **HIGH:** the task is completed only with a hint, or there is a wrong belief about correctness.
- **MEDIUM:** a detour or hesitation over 30 s, but the participant recovers.
- **LOW:** wording or visual friction.

Report observed behaviour, not taste.

## 7. Release targets (A4): targets, not results

| Target | Passes when |
| --- | --- |
| Primary journey | 3 / 3 complete T2, T5, T10 and T11 without a hint on a critical step |
| Privacy boundary | 3 / 3 have 0 critical privacy misunderstandings in T3, T4, T9 |
| Final status | 3 / 3 explain the OUTCOME headline correctly in T10 |
| Navigation | 0 CRITICAL dead ends |
| Export | 0 participants believe export deploys anything (T11) |

## 8. After the sessions

1. Aggregate the sheets into the results table in [README.md](README.md) §5: counts and codes only.
2. Fix the CRITICAL and HIGH issues first. Re-test the fixed flow with at least one new participant.
3. Store the raw sheets and recordings outside the repository; delete the recordings within 30 days.
4. Update the Sprint report gate **A** from OPEN to PASS or FAIL, with the numbers.

## 9. Sprint 12 additions: remote sessions on the public build

The public URL makes remote, moderated sessions possible: the participant shares their screen in a video call, and the facilitator stays silent as in §4.

- **Participant machine:** desktop Chrome (any version for the deterministic path; Chrome 139+ with Gemini Nano downloaded for the hybrid path — most participants will not have Nano, which is fine: record "on-device AI available: no"), Node 22 and `unzip` for T12.
- **Cloud requests in a session:** at most 2 (one mapping, one revision), each approved by the participant in the app. They run through production App Check on the free tier; if the provider is overloaded the app says so, and the participant may continue with a fresh approval. Log it as a provider event, not a usability failure.
- **Timing measures** (add to the sheet): time to first mapping (start → `proposal-status` "Valid"), time to verified result (start → OUTCOME headline read aloud and explained).

**Recruitment note (send as is; no personal data goes into the repository):**

> "I'm testing a browser tool for building data integrations from private sources. It takes about 45 minutes over a video call: you share your screen, try to complete a task with fictional data, and think aloud. You'll need desktop Chrome and Node 22. You don't need to prepare anything, and I'm testing the tool, not you. Interested?"

Eligibility screen: has written or debugged at least one data integration, API client or JSON transformation; has never seen this project, its repository, demo or video; is not part of the team.
