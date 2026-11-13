# Hero demo — three minutes, real inference only (Sprint 12 final)

| Status | Value |
| --- | --- |
| SCRIPT READY | **Yes** (this page, [captions.srt](captions.srt)) |
| RECORDED | **No.** Needs a person at a normal Chrome window with the Nano profile and a microphone |
| UPLOADED | **No.** YouTube upload (public, ≤ 3:00, English) needs explicit owner approval |
| VERIFIED | **No.** After upload: play it logged out, check length ≤ 3:00, captions on, link works |

**Story.** A confidential CRM cannot be handed to Gemini. Gemini Nano reads it on the device; a Phantom Twin lets Gemini in the cloud design the integration from approved synthetic information. The mapping passes every structural check but reads dates the wrong way. Local verification catches it, the user approves one controlled feedback request, Gemini fixes it without seeing a single record, and the developer exports an integration that runs outside the app.

**Rehearsed on the deployed build.** The exact journey below ran twice on <https://eyes-without-a-face-b7281.web.app> (build `b93e3edbb997`) on 2026-11-13 with real Nano and real Gemini through production App Check, 2 / 2 `ACCEPTED` ([../evidence/sprint-12/hosted-acceptance.json](../evidence/sprint-12/hosted-acceptance.json)). Earlier rehearsals: Sprint 9 (3 / 5 `ACCEPTED`), Sprints 10 and 11 (1 / 1 each). Gemini can still fail or return an invalid first proposal: record until you get a genuine success, never edit a result.

## Environment and preflight

| Item | Setting |
| --- | --- |
| URL | <https://eyes-without-a-face-b7281.web.app> (no `.env`, no debug token: production reCAPTCHA Enterprise) |
| Browser | Desktop Chrome 139+ with the dedicated Nano profile (`~/.cache/eyes-without-a-face/chrome-nano-profile`), model downloaded. **Normal window, not automation** |
| Terminal | Node 22+, `unzip`, an empty directory (`mkdir -p ~/eyes-demo && cd ~/eyes-demo`), font ≥ 18 pt |
| Screen | 1440 × 900 (or 1920 × 1080 at 125 %), browser zoom 100 %, notifications off, bookmarks bar hidden |
| Audio | Voiceover recorded live or afterwards; captions from [captions.srt](captions.srt) |

**Preflight checklist (before each take):**

- [ ] Footer shows `build b93e3edbb997` (or the newly approved SHA). Film it on a 2-second slate.
- [ ] CONNECT → **Runtime check**: Firebase `CONFIGURED`, App Check `CONFIGURED`, cloud `CONFIGURED`, on-device `AVAILABLE`. If on-device is not `AVAILABLE`, do not record the hybrid story.
- [ ] Reload the page (nothing persists). Close other tabs.
- [ ] Terminal is open in an empty folder; the Downloads folder is known.
- [ ] Screen recorder at 30 fps or more, full window, cursor highlight on.

## Storyboard, script and on-screen actions

Times are targets; adjust to the footage.

| Time | Scene | Screen action | Narration | On-screen caption |
| --- | --- | --- | --- | --- |
| 0:00–0:20 | **Problem** (landing) | Hero line *Build integrations for systems your AI cannot see.* Point at "What crosses the boundary" | "Our support team is moving customers from a confidential CRM into a new helpdesk. Gemini could design that integration in seconds — but these customer records are not allowed to leave this machine." | Private customer data can't be pasted into a cloud AI. |
| 0:20–0:45 | **CONNECT** | **Advanced sources → crm-eu-accounts → Load scenario.** Show 6 records stay in the browser and the 5 destination fields | "I connect the private CRM export and the helpdesk's destination schema. Nothing has left the browser." | Source: fictional CRM · destination: helpdesk |
| 0:45–1:10 | **Local intelligence** | **Interpret private fields on-device.** Rows label *Gemini Nano (real on-device)*; apply the applicable suggestion; label turns *this run: hybrid (on-device AI used)*. **Build Integration** | "Gemini Nano runs on this device. It reads the private field names and a few values — locally — and EYES builds a Phantom Twin: aliases and fictional rows instead of real ones." | Gemini Nano · on-device · nothing sent |
| 1:10–1:30 | **Trust boundary** | OBSERVE: *Waiting for your approval of one cloud request.* Gold halo. **Review what crosses the boundary** → *Gemini will receive / will not receive* → **Approve this exact prompt** | "Here is exactly what the cloud may see: aliases, fictional examples, the destination. Not my records, not my field names. I approve this one prompt, bound to its hash." | One request · approved by hash · single use |
| 1:30–1:50 | **Gemini mapping** | **Send approved request.** Stage 07 *real Gemini output · IN_CLOUD*; mapping valid, 5 operations | "Gemini Cloud designs the mapping from the twin alone. Five declarative operations — data, not code." | Real Gemini · IN_CLOUD |
| 1:50–2:10 | **Semantic failure** | **Run Reality Check.** Every record is schema-valid, but stage 11 *failed*: `createdAt` date order. Select it to show the inspector | "Every record passes the schema. But my browser checks meaning: this CRM writes dates day-first. Gemini read them month-first — the 3rd of February would become the 2nd of March." | Schema-valid ≠ correct · caught locally |
| 2:10–2:35 | **Blind revision** | Tick the date constraint → **Prepare Safe Revision** → review *Newly disclosed / Stays private* → **Approve & Request Revision** → **Run Revised Reality Check**: decision `ACCEPTED`, `createdAt` MM/DD → DD/MM, transformed 0 → 7 | "I approve one more request: the finding and the rule, no records. Gemini fixes the mapping blind, and my browser re-checks it: zero to seven correct records, no regressions." | Blind revision · no records sent |
| 2:35–2:50 | **Verification and export** | OUTCOME: *Verified, with managed exceptions.* Read the sentence (1 quarantined, not counted). **Export Integration**. Terminal: `unzip ~/Downloads/eyes-integration-*.zip && cd eyes-integration-*/ && node run.mjs verify` → exit 0 | "What I take away is a verified, inspectable integration that runs with plain Node — outside the app, with every hash checked." | Exported · `node run.mjs verify` ✓ |
| 2:50–3:00 | **Close** | Privacy Boundary band: source → twin → approval → cloud → verified outcome. End card with URL and repo | "Local AI for private understanding. Cloud AI for design. Deterministic checks for the truth. Eyes Without a Face — build integrations for systems your AI cannot see." | eyes-without-a-face-b7281.web.app · github.com/RaulMermans/Eyes-Without-A-Face |

Say the numbers you see on screen. If your take shows different counts, change the narration, not the footage.

If Nano is unavailable, CONNECT says *Deterministic, not hybrid*. Do not record the hybrid story in that state.

`VERIFIED_WITH_EXCEPTIONS` is the honest status: the policy quarantines a record with an unusable email for manual review. Keep that sentence on screen.

## Evidence integrity (non-negotiable)

1. Record **one continuous take** of the whole journey. Never splice two runs into one apparent run.
2. Allowed edits: cut idle waiting (show a short "time skipped" caption), speed up approvals and model waits (label "2×"), add captions and voiceover.
3. Not allowed: re-ordering events, cutting out an approval, replacing a failed result, overlaying numbers that are not on screen, or showing simulated output as AI.
4. A failed take (provider error, invalid proposal, `HUMAN_REVIEW_REQUIRED`) is kept and re-recorded; it may be shown honestly.
5. List every cut and speed change in the YouTube description.
6. Upload only after explicit owner approval.

## Known provider behavior during recording

| What you see | Meaning | Action |
| --- | --- | --- |
| *Gemini is overloaded right now* (`PROVIDER_OVERLOADED`) | Provider 500 / high demand | Stop. Wait a minute. **Prepare a fresh request** (you approve again) or restart the take |
| *did not answer in time* (`TIMEOUT`, 45 s) | Provider slow | Same; the late answer is discarded |
| *App Check refused this app* | Wrong domain, automation, or low reCAPTCHA score | Use a normal Chrome window on the `web.app` URL; never disable App Check |
| Initial proposal *Rejected at convert* | Gemini produced an invalid mapping; it was not repaired | Restart the take |
| Revision `HUMAN_REVIEW_REQUIRED` | The revision improved less than required | Honest outcome; export becomes `DRAFT`. Re-record for the `ACCEPTED` story |

## Supporting material

- Real hosted-run screenshots (2026-11-13, build `b93e3edbb997`): [screenshots/sprint-12-hosted/](screenshots/sprint-12-hosted/)
  - `01` CONNECT with Nano on-device · `02` OBSERVE awaiting approval · `04` real Gemini mapping · `05` Reality Check stage · `06` blind revision before/after · `07` OUTCOME verdict · `08` export hand-off
  - Captured by the automated hosted acceptance run (viewport only). They show genuine state.
- Technical proof: [../submission/evidence.md](../submission/evidence.md) · business narrative: [../submission/business-impact.md](../submission/business-impact.md)

## YouTube description (draft, fill in after recording)

```text
Eyes Without a Face — a privacy-aware hybrid AI integration studio for #BuildHybridAI 2026. Gemini Nano (on-device) and Gemini (cloud) through Firebase AI Logic design a CRM-to-helpdesk integration without the cloud seeing the private records; local checks catch a silent date error; one approved blind revision fixes it; the result exports as a runnable package. Recorded on the public build https://eyes-without-a-face-b7281.web.app, one continuous take. Edits: [list cuts and speed-ups with timestamps]. All data is fictional. Code: https://github.com/RaulMermans/Eyes-Without-A-Face
```
