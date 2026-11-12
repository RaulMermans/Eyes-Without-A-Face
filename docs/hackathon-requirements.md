# Hackathon requirements

**Verification date:** 2026-11-10 (re-checked during Sprint 2; Official Rules still unpublished)  
**Authoritative listing:** [https://firebasehybridaihackathon.devpost.com/](https://firebasehybridaihackathon.devpost.com/)  
**Official rules URL:** [https://firebasehybridaihackathon.devpost.com/rules](https://firebasehybridaihackathon.devpost.com/rules)

## Verified from the official Devpost pages on 2026-11-10

- Event name: #BuildHybridAI 2026, organized by Google, managed by Devpost.
- Theme: AI apps that run on-device and in the cloud with Firebase AI Logic.
- Registration is open. Submissions are not open yet.
- Public page states submissions open Monday 11 November 2026 and close Monday 30 November 2026 at 2:00 PM PT.
- Prize pool listed: $30,000 in cash.
- Eligibility summary on the listing: above legal age of majority in country of residence; all countries/territories excluding standard exceptions.
- Public judging criteria currently listed: Technological Implementation, Design, Potential Impact, Quality of the Idea.
- Contact listed on the listing: keshya@devpost.com.

## Re-check on 2026-11-11 (Sprint 3)

The rules URL returned **HTTP 403** to automated fetches on the first day of the submission period, so the Official Rules could not be read from this environment. Everything below stays unverified until a human reads the page. Development provenance: Sprint 0–2 commits are dated 2026-11-10 and Sprint 3 work 2026-11-11. Do not present pre-event work as newly developed after the start.

## Re-check on 2026-11-11 (Sprint 4)

Both `https://firebasehybridaihackathon.devpost.com/` and `/rules` returned **HTTP 403** to automated fetches. The Official Rules are still unverified from this environment, so a human must read them before submitting.

The Sprint 4 brief lists these requirements, which still need confirming against the rules:

| Requirement | Repository state |
| --- | --- |
| Real Firebase AI Logic inference at runtime | Verified on-device (LIVE-007, LIVE-013) and in the cloud (LIVE-004, LIVE-009) |
| On-device **and** cloud inference | Both verified: `HYBRID_QUALIFIED` |
| Working demo application | Local dev server. Hosting `live` has never served a release (corrected in Sprint 5); deployment needs owner approval |
| Public GitHub/GitLab repository | Repository is **private**. Publishing needs separate owner confirmation |
| Visible open-source license | `LICENSE` (Apache-2.0) added in Sprint 4 |
| Source code and setup instructions | `README.md`, `docs/setup/` |
| YouTube demo, at most 3 minutes | Storyboard in [demo/README.md](demo/README.md). Not recorded |
| English materials | Yes |
| Explanation of pre-existing code | [hackathon-history.md](hackathon-history.md) |

Firebase on-device documentation (re-read 2026-11-11): Chrome desktop 139+, Firebase AI Logic SDK 12.5.0+, the `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` flag, `initializeDeviceModel()` after a user gesture, and a default in-cloud model of `gemini-3.5-flash-lite`. On-device generation is single-turn, supports structured JSON output, and is capped at 9216 tokens.

## Re-check on 2026-11-11 (Sprint 5)

`/`, `/rules`, `/details/dates` and `/resources` on firebasehybridaihackathon.devpost.com all returned **HTTP 403** to automated fetches. Nothing new was verified. The owner must read the Official Rules in a browser before submitting, and in particular confirm: rules on pre-existing work (Sprints 0–2 are dated 2026-11-10, the day before the period opened), the video host and length, repository visibility, license, hosted-demo expectations, and eligibility.

Repository state against the brief's requirements (Sprint 5):

| Requirement | State |
| --- | --- |
| Hybrid inference through Firebase AI Logic | Verified locally (on-device + cloud). Hosted cloud path pending deployment approval |
| Working project | Local: yes. Hosted: **BLOCKED** on owner approval ([deployment.md](deployment.md)) |
| Public repository | **Private**. Publication needs owner confirmation |
| Visible open-source license | Apache-2.0, detected by GitHub (`licenseInfo: apache-2.0`) |
| Setup instructions | README "Run it" + `docs/setup/` |
| YouTube video ≤ 3:00 | Not recorded. Storyboard ready ([demo/README.md](demo/README.md)) |
| English materials | Yes. Devpost draft in [submission/devpost-draft.md](submission/devpost-draft.md) |
| Disclosure of competition-period work | [hackathon-history.md](hackathon-history.md) |

## Unresolved (do not guess)

The Official Rules page states: **“The Official Rules for the Hackathon are not yet available.”** They are promised before the submission period. Therefore the following remain **unverified**:

- Binding originality / third-party-code constraints
- Exact submission deliverables (video length, repo visibility, license)
- Team size limits
- Country exception list
- Prize breakdown beyond the listing’s grand-prize mention
- Bonus challenges
- Intellectual-property assignment terms

Re-check https://firebasehybridaihackathon.devpost.com/rules on or after 11 November 2026 before submission.

## Third-party code used in this repository (Sprint 0)

Open-source libraries installed via pnpm, including Vite, React, Tailwind CSS, Ajv, Zod, Vitest, Playwright, and the Firebase JavaScript SDK. No copied proprietary application code. Treat this list as incomplete until Official Rules define disclosure format.

## Firebase docs used for SDK planning

- https://firebase.google.com/docs/ai-logic/hybrid/web/get-started (verified 2026-11-10)
- JS SDK latest stable: `firebase@13.2.0` (npm / Firebase release notes, 2026-10-30)
- On-device web inference: SDK ≥ 12.5.0, Chrome desktop ≥ 139, `initializeDeviceModel()`
- Default hybrid in-cloud model (SDK 13+): `gemini-3.5-flash-lite`
