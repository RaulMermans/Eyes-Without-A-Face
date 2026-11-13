# Hackathon requirements

**Official Rules read in full on 2026-11-13** (Sprint 12) from <https://firebasehybridaihackathon.devpost.com/rules>; also the overview, schedule and resources pages. Earlier sprints got HTTP 403; this sprint the pages returned HTTP 200. Quotes below are from the rules; the owner should still re-read them in a browser before submitting, because Devpost can update them.

## Key facts

| Item | Rule (2026-11-13) |
| --- | --- |
| Submission period | 2026-11-11 1:30 PM PT → **2026-11-30 2:00 PM PT** (= 23:00 CET) |
| Judging | 2026-12-09/10 → 12-16; winners around 12-21 |
| Eligibility | Age of majority; excluded: Brazil, Quebec, Crimea, Russia, Italy, Syria, Sudan, Belarus, Cuba, Iran, North Korea, OFAC-designated; no Contest Entity employees or family; no government-agency employees; Internet access on 2026-11-11 |
| What to build | A Gen AI app using **Firebase AI Logic**, with supported Firebase products (App Check, Remote Config, Firestore, Authentication) |
| Platform | At least one. **Web (Chrome): Gemini Nano 4 via Firebase AI Logic** (web app or Chrome extension). Multi-platform is preferred for the Grand Prize; a single-platform app can win |
| App Check | Required by Firebase AI Logic; "debug tokens are accepted in submissions" |
| Existing projects | Must have been "significantly updated after the start of the Submission Period"; must disclose pre-existing code; must "provide a summary of what you built during the submission period" |
| Repository | GitHub/GitLab URL; all source, assets and instructions to run it; value proposition; Firebase AI Logic **imported and actually called** at runtime |
| License | Public repo with an open-source license file, detectable in the About section (Apache preferred) |
| Video | Shows the project functioning; **≤ 3 minutes** (only the first 3 are evaluated); **public on YouTube**; English or English subtitles |
| Text description | How Firebase AI Logic is used, features and functionality, value proposition |
| Testing access | Strongly encouraged: a URL to the working project ("a hosted project is highly encouraged"); free and unrestricted for judges until judging ends |
| Forbidden in repo / form | "production API keys, live Google Cloud project secrets, confidential commercial data, or personally identifiable information" |
| After the deadline | No changes to the submission; **commits pushed after the period ends will not be evaluated** |
| Judging criteria (equal weight, 1–5) | Technological Implementation (incl. effective use of Firebase AI Logic hybrid inference), Design (complete coherent product), Potential Impact (credible, specific real problem for a real audience), Quality of the Idea (creative, non-obvious use; understanding of the problem) |
| Prizes | Grand $10k, runner-ups $7k / $4k, Best Web/Chrome $3k (also iOS, Android) |

## Compliance status (Sprint 12, 2026-11-13)

| Requirement | State | Evidence |
| --- | --- | --- |
| Firebase AI Logic imported and called at runtime | **Met** | `src/inference/firebase-live.ts` (`firebase/ai`, `getGenerativeModel`, `generateContent`); real `IN_CLOUD` and `ON_DEVICE` results on the hosted build |
| Web (Chrome) + Gemini Nano via Firebase AI Logic | **Met** | Hosted runs: Nano 6 / 6 `real on-device` ([evidence/sprint-12/hosted-acceptance.json](evidence/sprint-12/hosted-acceptance.json)) |
| App Check | **Met, enforced** | Tokenless request → 401 (2026-11-13); hosted runs used production reCAPTCHA Enterprise, no debug token |
| Working hosted project | **Met** | <https://eyes-without-a-face-b7281.web.app>, build `b93e3edbb997` ([deployment.md](deployment.md)) |
| Public repo + detectable license | **Met** | GitHub reports `visibility: PUBLIC`, `licenseInfo: apache-2.0` (2026-11-13) |
| Setup instructions + value proposition in repo | **Met** | `README.md`, `docs/setup/` |
| No production API keys in the repository | **Mitigated, owner decision open** | Literal web API key and site key removed from `docs/setup/firebase.md` in Sprint 12. The web API key is a public browser identifier protected by App Check, but it remains in Git history (since `45971db`) and in every deployed bundle by design. Options: accept (common practice for Firebase web keys), restrict it in Cloud Console, or rotate it. Rewriting history needs a force push and separate approval |
| No PII / confidential data | **Met** | All fixtures are fictional; privacy suites and release verification |
| Pre-existing work disclosed + period summary | **Ready** | [hackathon-history.md](hackathon-history.md) (corrected in Sprint 12: Sprints 0–4 predate the period) |
| "Significantly updated" during the period | **Owner judgment, evidence ready** | +18,946 / −1,006 hand-written source lines since the last pre-period commit; blind revision, semantic verification, export, redesign, deployment all in-period |
| Demo video ≤ 3:00 on YouTube, English | **Not recorded** | Script and captions ready ([demo/hero-demo.md](demo/hero-demo.md)) |
| Devpost submission | **Not submitted** | Draft: [submission/devpost-draft.md](submission/devpost-draft.md) |
| Project available to judges until judging ends | **Owner action** | Keep the Hosting release and the Firebase project on, and stay within the free-tier quota through 2026-12-16 |

## Judging-relevant design note

The challenge text describes hybrid inference as "runs prompts on-device when a local model is available and falls back to the cloud when it isn't". EYES deliberately uses `ONLY_ON_DEVICE` for steps that read private data and `ONLY_IN_CLOUD` for approved synthetic data, and never falls back automatically, because a silent fallback would move a private-data step to the cloud ([ADR 0002](decisions/0002-no-automatic-cloud-fallback.md)). This uses the same Firebase AI Logic hybrid SDK, but routes by data sensitivity rather than by availability. The submission text must explain this choice, because a judge reading the challenge literally may expect `PREFER_ON_DEVICE`.

## History of this page

Sprints 2–5 could not read the rules (HTTP 403 to automated fetches); see Git history of this file for those notes.
