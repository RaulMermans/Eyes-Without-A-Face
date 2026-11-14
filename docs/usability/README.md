# Usability — protocol and internal audit (Sprints 9–10)

> **Independent usability testing: NOT PERFORMED (Sprints 9 to 14).** No developer unfamiliar with Eyes Without a Face has used the product yet. Everything below is either a protocol ready to run, or an internal heuristic audit by the team that built it. Do not cite it as user evidence.

## 1. Unassisted task protocol (ready to run, ≥ 3 participants)

**Participants.** Developers who have written at least one data integration and have never seen this repository. No coaching after the briefing.

**Materials.** A Chrome window on the hosted build (or `pnpm dev`), the bundled fictional CRM scenario `crm-eu-accounts` (Scenario picker), its destination schema (pre-loaded), a terminal with Node 22 and `unzip`.

**Briefing (read verbatim).**
> "You must move customer records from a confidential CRM into a helpdesk. The records may not be shown to a cloud model. Use this tool to produce an integration you could run elsewhere. Think aloud. I will not help."

**Tasks.**

1. Load the confidential CRM sample and get a valid mapping.
2. Decide whether the mapping is correct. Explain why.
3. If it is not, improve it without sending the records anywhere.
4. Export the integration and run it in the terminal.
5. Explain in two sentences what Gemini saw and what it did not see.

**Measures.**

| Measure | How |
| --- | --- |
| Task completion | per task: done unaided / done after a hint / not done |
| Time to first valid mapping | start → `proposal-status` "Valid" |
| Time to verified result | start → Reality Check verdict read and explained |
| Incorrect privacy assumptions | count statements such as "Gemini saw my records" or "the export contains my data" |
| Blocked interactions | count moments with no action for > 30 s, or a wrong step |
| Explaining the result | task 2 answer scored 0–2 (wrong / partial / names the date-order finding) |
| Export success | `node run.mjs verify` exit 0 without help |

**Recording.** Screen + audio with consent; notes keep codes and timings only. No participant data enters the repository.

## 2. Internal heuristic audit (team, not users)

Walkthrough of the hero journey on 2026-11-13 against Nielsen's heuristics and the C4 rule "what happened · why it matters · what next".

| # | Finding (before Sprint 9) | Severity | Resolution |
| --- | --- | --- | --- |
| H1 | The journey ended at the Reality Check: no final artifact, no obvious "done" | Critical | **Fixed.** Export Integration panel as the last action, with eligibility, contents, privacy status, limitations and run instructions; a "Next" strip under the verdict links to it |
| H2 | A provider failure showed the raw SDK text, including the Firebase project URL | High | **Fixed.** Guidance card (what / why / next); raw text collapsed as local detail |
| H3 | After a cloud failure the user had to find the Disclosure Review step and rebuild the preview alone | High | **Fixed.** "Prepare a fresh request" builds a new preview and opens the review step; approval is still required |
| H4 | `500 high demand` was labeled `NETWORK` | High | **Fixed** in the classifier (REL-001) |
| H5 | Long waits showed only a spinner | Medium | **Fixed.** Elapsed seconds, the 45 s limit, local/cloud label, Stop waiting; no fake percentage |
| H6 | Nothing told the user, before acting, whether AI was usable in this browser | Medium | **Fixed.** Runtime check on step 1 (CONFIGURED ≠ available) |
| H7 | A revised mapping could be inspected but not used | Medium | **Fixed.** Export lets the user choose the initial or revised mapping; never promoted automatically |
| H8 | Five steps plus a dense revision panel are a lot of reading for a first visit | Medium | **Open.** Progressive disclosure exists (advanced views collapsed); a guided "demo mode" was not built (scope) |
| H9 | The privacy scan blocks a hand-written contract that uses unapproved labels; the fix lives on another step | Low | **Mitigated.** The guidance names both remedies; the cross-step jump remains |
| H10 | Mobile: the Integration Studio becomes a long single column | Low | **Accepted.** No horizontal overflow at 390 px (E2E-092, existing UX tests); usable, not optimized |

Keyboard and reduced motion: the export confirmation and button work with Space/Enter (E2E-091); all new animation is the existing indicator, disabled under `prefers-reduced-motion` by the global rule.

## 3. Sprint 10 protocol adaptation (CONNECT / OBSERVE / OUTCOME)

The protocol in §1 still applies. Tasks and measures now follow the three moments. Run it on the Sprint 10 build with the **fictional CRM demo** first, then `crm-eu-accounts` for the revision task.

| # | Task (read verbatim, no hints) | Success criterion | Measure |
| --- | --- | --- | --- |
| T1 | "Start an integration from the fictional CRM into the helpdesk." | Reaches OBSERVE at the approval (CONNECT → Build Integration) | time to first meaningful result: start → `runtime-headline` "Waiting for your approval…" |
| T2 | "Where are the customer records right now? What could the cloud see?" | Names "this browser"; describes aliases and fictional rows; does not say Gemini saw records | wrong privacy assumptions (count) |
| T3 | "Decide whether to let the request go." | Opens the review, reads Will / Will not receive, approves or rejects deliberately | hesitation > 30 s, navigation errors |
| T4 | "Show me what the mapping does with the status field." | Opens the Integration Studio from OBSERVE and selects the operation | unaided / hint / not done |
| T5 | "Is the output correct?" | Separates structure from meaning; names the finding (CRM: hidden-case failures; scenario: date order) | score 0–2 |
| T6 | "If something is wrong, try to fix it without sending records." | Prepares and reviews one blind revision; approves only after reading it | approval without reading (critical) |
| T7 | "What did you end up with?" | Explains the OUTCOME headline, exceptions/quarantine, and draft vs verified | score 0–2 |
| T8 | "Take it with you and run it." | Exports, then `node run.mjs verify` exit 0 in a terminal | export execution success |

**Critical safety misunderstandings** fail the release target for that participant. These include believing Gemini received records, believing Build Integration sent something, believing an export deploys anything, and believing "unknown meaning" means correct.

**Release target (not an observed result):** 3 / 3 participants complete T1–T8 with no critical safety misunderstanding.

**Status:** NOT PERFORMED. No external developer was available to the team during Sprint 10. No interview, observation or quote in this repository comes from a participant.

## 4. Sprint 10 internal heuristic audit and automated checks

The audit with screenshots and measurements is [../design/sprint-10-experience-audit.md](../design/sprint-10-experience-audit.md). Automated usability-related checks:

| Check | Test |
| --- | --- |
| Two clicks from the demo to the first decision; nothing sent before approval | E2E-100 |
| Runtime explains why it is waiting, and where each stage runs | E2E-101, RT-003 |
| On-device unavailability stated honestly | E2E-107, RT-002 |
| Upstream change clears approvals and results visibly | E2E-102, RT-006 |
| Outcome separates structure / meaning / records; quarantine ≠ success | E2E-103 |
| No horizontal overflow, CTA above the fold, mobile build bar | E2E-105 (1440 / 1280 / 768 / 390) |
| Keyboard-only workbench and runtime selection | E2E-058, E2E-101 |
| Reduced motion removes every animation | E2E-106 |
| Screen-reader pass | **UNVERIFIED** (structural checks only) |

Open internal findings (team judgment, not user evidence):

- At 390 px the OBSERVE page is long because all 17 stages are listed.
- Applying a Nano suggestion after Build Integration clears the prepared request (correct by the rules, surprising in flow).
- The revision panel remains text-dense.

## 5. Sprint 11 — session kit, internal findings resolved, results (empty)

**Independent sessions: NOT PERFORMED.** The coding agent that ran Sprint 11 cannot recruit or observe people, and no facilitator ran a session during the sprint. Gate A stays **OPEN**. The kit for a human facilitator is in [sprint-11-session-kit.md](sprint-11-session-kit.md). It covers consent, setup, the verbatim briefing, the 12 tasks with success and critical-failure criteria, a coded observation sheet, severity rules and the release targets.

**Internal findings from Sprint 10, now resolved (team judgment, not user evidence):**

| Sprint 10 finding | Sprint 11 change | Evidence |
| --- | --- | --- |
| OBSERVE at 390 px was 5,638 px long, and the current stage sat at y = 1,067 | A focus card shows the current stage, the last completed stage, the next action and any blocker at y = 266. Phases that do not hold the current stage collapse. Page height 4,958 px, most of it the decision panel itself | E2E-110; [../evidence/sprint-11/](../evidence/sprint-11/) before/after metrics |
| Applying a Nano suggestion after Build Integration cleared the request without saying why | On-device interpretation is offered in CONNECT, before the request exists. A later change shows why the request was cleared and offers **Prepare a new review** (a new approval is still required) | E2E-112, E2E-113; live S11-HERO: 0 invalidations |
| The OUTCOME headline could read "Verified locally." while meaning was partly unknown | `outcomeVerdict` names any partial meaning in the headline | OV-001, E2E-114 |
| After export, the only guidance was one line | Five real runner steps: extract, verify, bindings, run, inspect | E2E-114 |

**Results table (fill in after real sessions; counts and codes only):**

| Participant | Primary journey | Privacy misunderstandings (critical) | Outcome explained | Export verified | CRITICAL / HIGH issues |
| --- | --- | --- | --- | --- | --- |
| P1 | not run | — | — | — | — |
| P2 | not run | — | — | — | — |
| P3 | not run | — | — | — | — |

**Manual screen-reader pass: UNVERIFIED.** No NVDA, JAWS or VoiceOver was available in this environment, and Orca was not exercised. Automated structural checks only: roles, names, `aria-expanded` on phase toggles, `aria-pressed` on stages, the polite live region for the headline, words for every state. A human pass should cover:

1. Can the headline and the focus card be reached and read in order?
2. Is the live region announced when the run stops at an approval?
3. Do the phase toggles announce expanded / collapsed?
4. Is each Privacy Boundary station's state read in words?
5. Can the OUTCOME verdict and the export hand-off be followed without sight?

## 6. Sprint 12 — status

**Independent sessions: NOT PERFORMED.** The coding agent that ran Sprint 12 cannot recruit, schedule or observe people, and no human facilitator ran a session during the sprint. Gate B stays **OPEN**. Nothing in this repository comes from a participant.

What changed for the next facilitator:

- The product is now public at <https://eyes-without-a-face-b7281.web.app>, so sessions need no install, no keys and no localhost setup ([sprint-11-session-kit.md](sprint-11-session-kit.md) §9: remote sessions, timing measures, recruitment note).
- The hosted journey itself was verified on real models (2 / 2 automated runs). That proves the path works, **not** that people can follow it.

Release targets (unchanged, still targets): 3 / 3 participants complete the core tasks without critical assistance, 0 critical privacy misconceptions, correct reading of the final result, successful `node run.mjs verify`.

## 7. Sprint 14 — status and kit addendum

**Independent sessions: NOT PERFORMED.** No participants were available to the agent, and no human facilitator ran a session. Nothing here comes from a participant. Manual screen-reader testing: **NOT PERFORMED**.

The Sprint 11 kit applies to the guided flow, with this scenario and these extra observations:

- **Scenario (verbatim):** "Import this fictional customer dataset, choose the intended helpdesk destination and create a reusable integration without exposing the original records to cloud AI."
- **Measure:**
  - first action within 30 s;
  - task success;
  - time to a valid integration and to export;
  - whether the participant notices and understands the category-name choice ("Share the 3 category names…");
  - recovery success after a refused answer (facilitator: send once without sharing, if the participant does not choose to share);
  - misreading of "Draft" or "Meaning · not verified" as a failure or a success;
  - which download they choose and why;
  - visits to Technical details;
  - every time they need help.
- **Critical failures:**
  - the participant believes their records were sent;
  - they share category names without realising it;
  - they export a Draft believing it is verified;
  - they cannot recover from the refusal without help.

Automated checks (not usability evidence): E2E-140…148 cover the explanations, the recovery path, destination integrity, downloads, the Nano label and the reload warning.
