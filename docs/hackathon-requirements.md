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
