# Hero demo — three minutes, real inference only (Sprint 9)

**Story.** A confidential CRM cannot be handed to Gemini. Gemini Nano runs locally, and a Phantom Twin lets Gemini in the cloud design the integration from approved synthetic information. The mapping passes every structural check but reads dates the wrong way. Local verification catches it, the user approves one controlled feedback request, Gemini fixes it without seeing a single record, and the developer exports an integration that runs outside the app.

**Rehearsed live:** this exact journey ran with real Nano and real Gemini on 2026-11-13 (CRM runs 1 and 3: `ACCEPTED`, clean transformations 0 → 8, export verified). See [../evaluation/sprint-9-reliability.md](../evaluation/sprint-9-reliability.md). One of the three CRM attempts produced an invalid first proposal. The provider can also fail. Record until a genuine success, and never edit results.

## Rules for the recording

- Every result on screen comes from the real app state. Gemini output must show `Real Gemini output · IN_CLOUD`; Nano suggestions must say *real on-device*.
- Do not cut out approval steps; you may speed them up (label "2×").
- A failed attempt can be shown honestly or re-recorded, never edited into a success.
- A separate fallback clip (no AI, hand-written contract) may be shown only with the caption "Fallback: no AI, manual contract".

## Environment

| Item | Setting |
| --- | --- |
| Browser | Desktop Chrome 139+ with the dedicated Nano profile (`~/.cache/eyes-without-a-face/chrome-nano-profile`), model already downloaded ([../setup/browser-compatibility.md](../setup/browser-compatibility.md)). Normal window, not automation |
| Build | Hosted: `https://eyes-without-a-face-b7281.web.app` after owner-approved deploy (reCAPTCHA Enterprise). Before that: `pnpm dev` on localhost with `.env.local` and the registered App Check debug token ([../setup/app-check.md](../setup/app-check.md)) |
| Firebase project | `eyes-without-a-face-b7281`, model `gemini-3.5-flash-lite`, App Check enforced |
| Terminal | Node 22+, `unzip`, an empty directory such as `/tmp/demo` |
| Screen | 1440×900, browser zoom 100 %, notifications off |

**Preflight (before recording).** On step 1, open **Runtime check**: Firebase `CONFIGURED`, App Check `CONFIGURED`, cloud `CONFIGURED`, on-device `AVAILABLE`. If on-device is not `AVAILABLE`, do not record the hybrid story.

## Timeline and actions

| Time | Screen action | Narration (suggested) |
| --- | --- | --- |
| 0:00–0:25 | Landing hero. Scroll the "What crosses the boundary" strip | "You need to integrate a confidential CRM with a helpdesk. Gemini could design the mapping in seconds, but these records are not allowed to leave the machine." |
| 0:25–0:55 | Source → **Blind revision scenarios → crm-eu-accounts** → Continue. Twin step: **Interpret private fields on-device** → apply the applicable suggestion. Point at aliases `f_01…` and fictional examples | "Records stay in this tab. Gemini Nano reads them on-device; nothing goes to the cloud. What Gemini Cloud will see is a Phantom Twin: aliases and fictional values." |
| 0:55–1:20 | Disclosure Review: **Build exact outbound prompt** → show "Will be sent / Never sent" → **Approve this exact prompt** → Cloud mapping: **Send approved request**. Show `Real Gemini output · IN_CLOUD` and the Integration Studio | "I approve one exact request, bound to its hash. Gemini proposes a declarative mapping over aliases. It cannot run code." |
| 1:20–1:45 | **Continue to Reality Check → Run Reality Check**. Verdict: *Structurally valid · meaning is wrong*. Semantic panel: `createdAt` date-order conflict, evidence *observed locally* | "Every record passes schema validation. But my browser checks meaning: one hidden case, 25/03/2026, proves the dates are day-first. Gemini read them month-first. Nothing structural would catch this." |
| 1:45–2:20 | Blind revision: tick **Also disclose: f_03 dates are DD/MM/YYYY** → **Prepare Safe Revision** → show *Newly disclosed / Stays private* → tick reviewed → **Approve & Request Revision** → **Run Revised Reality Check** → decision `ACCEPTED` | "I approve one more request: the finding and one constraint, no records, no values. Gemini revises blind. The local check shows 8 records fixed and 0 regressed." |
| 2:20–2:45 | **Export Integration ↓** → select *Gemini mapping (revised)* → **Export Integration**. Terminal: `unzip … && cd eyes-integration-*/ && node run.mjs verify` | "I export it. Outside the app, plain Node verifies every hash and replays the fixtures. No records, no field names, no bindings are inside." |
| 2:45–3:00 | Back to the app: Runtime check now shows cloud `VERIFIED`, on-device `VERIFIED`. End card | "Local intelligence for private understanding, cloud intelligence for integration design, deterministic verification for correctness. Eyes Without a Face." |

The status is `VERIFIED_WITH_EXCEPTIONS`, not `VERIFIED`: the scenario policy quarantines malformed records for manual review. Say so if asked; do not crop it.

## Known provider behavior and what to do

| What you see | Meaning | Action during recording |
| --- | --- | --- |
| *Gemini is overloaded right now* (`PROVIDER_OVERLOADED`) | Provider 500 / high demand | Stop. Wait a minute. Use **Prepare a fresh request** (you approve again) or restart the take |
| *did not answer in time* (`TIMEOUT`, 45 s) | Provider slow | Same. The late answer is discarded |
| *App Check refused this app* | Wrong domain, automation, or unregistered debug token | Fix the environment; never disable App Check |
| Initial proposal *Rejected at convert* | Gemini produced an invalid mapping (e.g. placeholder labels); it was not repaired | Restart the take |
| Revision `HUMAN_REVIEW_REQUIRED` | The revision improved less than required | Honest outcome. Export becomes `DRAFT`; re-record if you need the ACCEPTED story |
| Revision *Blind revision stopped* | Revision request failed; budget spent | The initial mapping stays exportable with its own status; restart the take for the full story |

## Fallback clip (optional, labeled)

No AI: Source → *Load CRM sample* → Reality Check → run → Export panel shows **draft** and the privacy scan **blocks** unapproved labels; approve labels on the twin step → export → `node run.mjs verify`. Caption: "Fallback: no AI, hand-written contract."
