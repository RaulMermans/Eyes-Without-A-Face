# Sprint 16C — submission readiness audit (2026-11-16)

Against the Official Rules as recorded in [../../hackathon-requirements.md](../../hackathon-requirements.md) (read 2026-11-13). **Nothing was submitted and no video was uploaded.**

| Requirement | State | Evidence (checked 2026-11-16) |
| --- | --- | --- |
| Public repository | **Met** | `gh repo view`: `visibility: PUBLIC` |
| Open-source licence, detectable | **Met** | `LICENSE` is Apache-2.0 (the appendix is replaced by a copyright line); GitHub's licence API reports `Apache-2.0`; `package.json` says `Apache-2.0` |
| Working hosted application | **Met (old build)** | <https://eyes-without-a-face-b7281.web.app> answers HTTP 200 and serves `c4a246c` (Sprint 15). The Sprint 16B fixes are **not live** until the owner approves `489c6ba` |
| Firebase AI Logic imported and called at runtime | **Met** | `src/inference/firebase-live.ts` (`firebase/ai`, `getGenerativeModel`, `generateContent`); real `IN_CLOUD` (Sprint 15, `c4a246c`) and `ON_DEVICE` results (Sprint 16A, `c4a246c`, 4 / 4 real Nano) |
| Gemini Nano on device (web / Chrome) | **Met, on the old build** | Sprint 16A: real Nano on production, 0 cloud requests. Not re-run on `489c6ba` (pending deployment) |
| Cloud Gemini inference | **Met, on the old build** | Sprint 15: 1 approved real request on `c4a246c` through production App Check. Not re-run on `489c6ba` (needs deployment and a budget approval) |
| App Check | **Met, enforced** | Sprint 16A preflight P-002: the model endpoint refuses a tokenless request (401); no debug token in the page |
| Privacy architecture documented | **Met** | README § “What the cloud does and does not see”; `docs/security/`; the Devpost “Privacy model and limits” |
| Setup instructions | **Met** | README “Run it”, `docs/setup/` |
| Pre-existing work disclosed, with a period summary | **Met, figure updated** | [hackathon-history.md](../../hackathon-history.md); Devpost “Development during the submission period”. Recomputed since `e1d4b03` (hand-written `src/`, excluding the generated runtime): **+25,312 / −1,111 lines**, 37,913 lines now. The +18,946 figure in the history and Devpost files dates from Sprint 12 |
| Current README | **Met** | Sprint 16B status, limits and evidence links |
| Devpost draft | **Draft, owner review** | [../../submission/devpost-draft.md](../../submission/devpost-draft.md): Sprint 16A/16B challenges and limits added in 16B; video URL TODO |
| Demo script and screenshots | **Ready, partly stale** | [../../demo/hero-demo.md](../../demo/hero-demo.md), captions, `docs/demo/screenshots/`. The guided screens now show “Use …” confirmation and “Structure verified”; re-shoot after deployment |
| Video (≤ 3:00, public YouTube, English) | **Not recorded** | Owner action (recording and an approved upload) |
| Accessibility evidence | **Partial** | Automated LOCAL checks pass ([accessibility/](accessibility/)); manual screen reader NOT RUN |
| Usability evidence | **None** | 0 independent sessions ([usability/results.md](usability/results.md)) |
| No exposed secrets | **Met** | `verify-release` on `489c6ba`: no debug token, no source maps, no `.env`. The only key-shaped strings are the public Firebase web API key (documented owner decision) and the export scanner's own detection regexes |
| Public test availability during judging | **Owner action** | Keep the Hosting release, the Firebase project and quota on until judging ends (about 2026-12-16) |
| Commits after the deadline are not evaluated | **Schedule risk** | Deadline 2026-11-30 2:00 PM PT. Deploy, sessions and video must finish before then |

## The four judging claims and what supports them

| Claim | Supported by (measured) | Not claimed |
| --- | --- | --- |
| **Technology:** real on-device and cloud inference, deterministic verification, reusable execution | Real Nano and real Gemini Cloud through App Check (Sprints 12, 15, 16A); 759 deterministic tests; 62-case independent oracle; 45 / 45 exported packages verified outside the app | accuracy statistics, model superiority over deterministic patches |
| **Design:** a developer can complete the core journey | Automated journeys in Chromium and Firefox, mobile, 200% zoom, keyboard | **Human-validated usability: no evidence yet** |
| **Impact:** private records stay local while AI helps | Phantom Twin, single-use approvals, 0 private terms in every real request body measured; 0 disclosures in 62 + 62 cases | security certification, enterprise readiness |
| **Originality:** Phantom Twin + disclosure boundary + local semantic verification + executable export | Architecture docs and ADRs; working end to end | — |

## Owner-only steps before submitting

1. **Approve or decline** deploying `489c6baaf18bf22d146e583752eecc343ed3d986`.
2. **Approve or decline** a budget of 1 real Gemini Cloud request for production acceptance.
3. **Run ≥ 3 independent usability sessions** ([usability/protocol.md](usability/protocol.md)) and one manual screen-reader pass ([accessibility/README.md](accessibility/README.md)).
4. **Update the stale “significantly updated” figure** in `hackathon-history.md` and the Devpost draft (+25,312 / −1,111), and confirm the eligibility items.
5. **Record the ≤ 3-minute video** on the deployed build; approve the public YouTube upload; fill in the URL.
6. **Decide on the public web API key** (documented decision in `hackathon-requirements.md`).
7. **Submit on Devpost** before 2026-11-30 2:00 PM PT. Keep the hosted app and quota available through judging.
