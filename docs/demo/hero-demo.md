# Hero demo — three minutes, real inference only (Sprint 11: CONNECT / OBSERVE / OUTCOME)

**Story.** A confidential CRM cannot be handed to Gemini. Gemini Nano runs locally, and a Phantom Twin lets Gemini in the cloud design the integration from approved synthetic information. The mapping passes every structural check but reads dates the wrong way. Local verification catches it, the user approves one controlled feedback request, Gemini fixes it without seeing a single record, and the developer exports an integration that runs outside the app.

**Rehearsed live:**

- **Sprint 11 sequence (below).** Ran once with real Nano and real Gemini on 2026-11-13 ([../evidence/sprint-11/live-experience.json](../evidence/sprint-11/live-experience.json)). Result: Nano 6 / 6 in CONNECT, 0 invalidated approvals, revision `ACCEPTED`, OUTCOME `VERIFIED_WITH_EXCEPTIONS`, `node run.mjs verify` exit 0, 2 cloud requests, 0 private terms in request bodies.

- **Sprint 10 UI.** The journey below ran once with real Nano and real Gemini on 2026-11-13 ([../evidence/sprint-10/live-experience.json](../evidence/sprint-10/live-experience.json)). Result: `ACCEPTED`, OUTCOME `VERIFIED_WITH_EXCEPTIONS`, `node run.mjs verify` exit 0, 2 cloud requests, 0 private terms in request bodies.
- **Sprint 9 UI.** The same flow ran as CRM runs 1 and 3, both `ACCEPTED` ([../evaluation/sprint-9-reliability.md](../evaluation/sprint-9-reliability.md)).

One of three Sprint 9 CRM attempts produced an invalid first proposal, and the provider can also fail. Record until you get a genuine success, and never edit results.

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

**Preflight (before recording).** In CONNECT, open **Runtime check**: Firebase `CONFIGURED`, App Check `CONFIGURED`, cloud `CONFIGURED`, on-device `AVAILABLE`. If on-device is not `AVAILABLE`, do not record the hybrid story.

## Timeline and actions

| Time | Mode | Screen action | Narration (suggested) |
| --- | --- | --- | --- |
| 0:00–0:20 | Landing | Hero: *Build integrations for systems your AI cannot see.* Point at "What crosses the boundary" | "You need to integrate a confidential CRM with a helpdesk. Gemini could design the mapping in seconds, but these records are not allowed to leave the machine." |
| 0:20–0:35 | **CONNECT** | **Advanced sources → crm-eu-accounts → Load**. Show the source (records stay local) and the destination fields | "I connect the private source and the destination I need. Nothing has left this browser." |
| 0:35–0:55 | CONNECT · *Understand locally* | **Interpret private fields on-device** → apply the applicable suggestion. The label turns to *this run: hybrid (on-device AI used)* | "Gemini Nano reads field names and a few samples on this device, before anything is prepared for the cloud." |
| 0:55–1:05 | CONNECT → **OBSERVE** | **Build Integration**. The focus card reads *Now · Your authorization · Awaiting approval*; the Privacy Boundary gate is the gold double ring | "EYES builds a Phantom Twin and prepares exactly what the cloud may receive, then it stops and waits for me." |
| 1:05–1:25 | OBSERVE | **Review what crosses the boundary** → show *Gemini will receive / will not receive* → **Approve this exact prompt** (the gate opens: solid ring) → **Send approved request**. Stage 07 reads `real Gemini output · IN_CLOUD`; the boundary's cloud station turns *done* | "I approve one exact request, bound to its hash. That is the only thing that crosses." |
| 1:25–1:45 | OBSERVE | **Run Reality Check**. Stage 10 *requires review*, stage 11 *failed*: `createdAt` date order. Select stage 11 in the runtime to show the inspector | "Every record passes schema validation, but my browser checks meaning. The dates are day-first; Gemini read them month-first." |
| 1:45–2:20 | OBSERVE | Tick the date constraint → **Prepare Safe Revision**. The runtime shows a second gold checkpoint. Review → **Approve & Request Revision** → **Run Revised Reality Check**. Stages 13–15 complete; decision `ACCEPTED` | "One more approved request: the finding and one constraint, with no records and no values. Gemini revises blind; my browser re-checks it." |
| 2:20–2:45 | **OUTCOME** | Verdict *Verified, with managed exceptions.* and the sentence under it (quarantine, partial meaning coverage) Show Before / After (read the real numbers; the Sprint 9 rehearsals showed clean transformations 0 → 8) and the privacy outcome (2 authorized · 2 sent). Select the revised mapping → **Export Integration**. Terminal: `unzip … && cd eyes-integration-*/ && node run.mjs verify` | "Here is what I built, what is still uncertain, and what crossed the boundary. I export it, and plain Node verifies every hash and replays the fixtures." |
| 2:45–3:00 | OBSERVE | Show the Privacy Boundary band (source → twin → approval → cloud → verified outcome) and the full runtime: every stage placed where it ran. End card | "Local intelligence for private understanding, cloud intelligence for design, deterministic verification for correctness. Eyes Without a Face." |

If Nano is unavailable, CONNECT says so (*Deterministic, not hybrid*) and you can show the shorter path: CONNECT → **Build Integration** → OBSERVE. The runtime then shows stage 03 as *skipped · optional · not run*, so do not claim the run was hybrid.

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

## Filming sequence and disclosure (Sprint 11)

1. Preflight as above. Record the build SHA from the footer and the Runtime check states on a slate frame.
2. Record one continuous take of the whole journey. Never splice two runs into one apparent run.
3. In the edit you may: cut idle waiting (mark the cut with a short "time skipped" caption), speed up approvals and model waits (label "2×"), and add captions.
4. You may not: re-order events, cut an approval out, replace a failed result, or overlay numbers that are not on screen.
5. If the take fails (provider error, invalid proposal, `HUMAN_REVIEW_REQUIRED`), keep the file and re-record. Optionally show the failure honestly.
6. Upload to YouTube only after explicit owner authorization. List the cuts and speed changes in the video description.
