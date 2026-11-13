# Usability — protocol and internal audit (Sprint 9)

> **Independent usability testing: NOT PERFORMED.** No developer unfamiliar with Eyes Without a Face has used the product yet. Everything below is either a protocol ready to run, or an internal heuristic audit by the team that built it. Do not cite it as user evidence.

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
