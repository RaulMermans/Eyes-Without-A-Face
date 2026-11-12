# Development history

For the submission's explanation of work done before and during the submission period (11–30 November 2026). Dates come from Git commit metadata. The Official Rules on pre-existing code are **unverified** (see [hackathon-requirements.md](hackathon-requirements.md)), so check this account against them before submitting.

| Date | Sprint | Work |
| --- | --- | --- |
| 2026-11-10 (before the submission period) | 0 | Repository foundation: canonical JSON Schema contracts, test harness, docs |
| 2026-11-10 (before) | 1, 1.1 | Firebase AI Logic adapters (`ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`), disclosure gate, provenance validation, single-use approval |
| 2026-11-10 (before) | 2 | Deterministic eight-operation mapping engine |
| 2026-11-11 (period opens) | 3 | Phantom Twin generation, cloud disclosure 1.1.0, proposal conversion, alias resolution, Reality Check, guided UI |
| 2026-11-11 | 4 | Firebase CLI/MCP setup. Root cause of the on-device blocker and **first real Gemini Nano inference** through Firebase AI Logic. App Check token preparation. Reality Check stage-status fix. Adversarial privacy tests. Fix for a live-test trace leak. License, demo and release docs |
| 2026-11-11 | 4 (follow-up) | Real Gemini cloud inference through Firebase AI Logic (`IN_CLOUD`), cloud response-schema fix: `HYBRID_QUALIFIED` |
| 2026-11-11 | 5 | Release candidate: on-device crash investigation (Chrome model-service SIGILL) and a bounded user-initiated retry; a release build that cannot ship App Check debug mode; Hosting/App Check audit; first-use UX, verdict card, cloud-unavailable path; full-history security audit; CI workflow fix; demo storyboard; Devpost draft |
| 2026-11-12 | 6 | Spectral Forensics redesign: landing, Phantom transformation, Integration Studio |
| 2026-11-12 | 7 | Blind Integration: private on-device understanding, Blind Revision Feedback 1.0.0, one approved blind revision, outcome classes, three evaluation scenarios, real-model runs |
| 2026-11-12 | 8 | Semantic verification (trusted local constraints), Feedback 1.1.0 / disclosure 1.3.0, deterministic revision decision, frozen fresh holdout, replayable real-model benchmark (A/B/C/D + deterministic patch control), Nano ablation |

Sprints 0–2 predate the submission period. Present them as pre-existing work and describe Sprint 3 onward as competition-period work, as far as the Official Rules allow.

## Third-party code

Open-source dependencies installed through pnpm. The production dependency tree is all permissive: Apache-2.0, MIT, BSD-3-Clause, ISC and 0BSD (`pnpm licenses list --prod`). No copied proprietary code. The emblem's provenance is documented in [branding/README.md](branding/README.md).
