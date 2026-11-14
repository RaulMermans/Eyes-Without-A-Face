# Claude / coding-agent notes

This repository is **Eyes Without a Face**, a client-only Phantom Twin Engine for the Google #BuildHybridAI 2026 hackathon.

Read, in order:

1. `AGENTS.md` — constraints, privacy, required checks
2. `README.md` — setup and current status
3. `docs/README.md` — documentation index
4. `docs/architecture/system.md` — boundaries and data flow
5. `docs/contracts/README.md` — contract families
6. `docs/contracts/mapping.md` — mapping DSL and interpreter
7. `docs/contracts/mapping-proposal.md` — proposal conversion and alias resolution
8. `docs/sprints/sprint-3.md` — Sprint 3 report
9. `docs/sprints/sprint-5.md` — Sprint 5 release-candidate report and remaining owner approvals
10. `docs/deployment.md` — release build and approval-gated deployment
11. `docs/design/design-system.md` — Spectral Forensics tokens, zones, components
12. `docs/sprints/sprint-6.md` — Sprint 6 report
13. `docs/decisions/0008-blind-revision.md` — blind revision boundary
14. `docs/evaluation/README.md` — evaluation sets, metrics, configurations
15. `docs/sprints/sprint-7.md` — Sprint 7 report and Sprint 8 readiness
16. `docs/decisions/0009-semantic-verification.md` — semantic verification and semantic blind revision
17. `docs/contracts/semantic-verification.md` — Semantic Verification Contract 1.0.0
18. `docs/sprints/sprint-8.md` — Sprint 8 report, benchmark results and Sprint 9 readiness
19. `docs/contracts/export.md` and `docs/decisions/0010-portable-integration-export.md` — portable integration package
20. `docs/sprints/sprint-9.md` — Sprint 9 report, release readiness and submission blockers
21. `docs/decisions/0011-experience-architecture-black-halo.md` — CONNECT / OBSERVE / OUTCOME, derived runtime, Black Halo
22. `docs/sprints/sprint-10.md` — Sprint 10 report
23. `docs/sprints/sprint-11.md` — Sprint 11 report: acceptance status, open owner gates
24. `docs/sprints/sprint-12.md` — Sprint 12 report: live deployment, hosted acceptance, Nano-value experiment, submission readiness
25. `docs/hackathon-requirements.md` and `docs/hackathon-history.md` — Official Rules, compliance, pre-existing work disclosure
26. `docs/decisions/0012-guided-flow-and-source-adapters.md` — guided flow, technical view, Source Adapter Layer
27. `docs/contracts/source-adapter.md` — Source Adapter contract 1.0.0, limits, REST connector safety
28. `docs/sprints/sprint-13.md` — Sprint 13 report: tests, connector evidence, release plan, readiness

29. `docs/decisions/0013-guided-recovery-and-production-acceptance.md` — rejected-proposal diagnosis, category-name readiness, production acceptance standard
30. `docs/sprints/sprint-14.md` — Sprint 14 report: incident root cause, recovery, release status
31. `docs/deployment.md` § Production acceptance standard — **permanent**: release statuses, deployment approval, `pnpm test:production`, evidence

Every sprint ends with an evidence-backed release status (`CODE_READY`, `DEPLOYMENT_PENDING`, `DEPLOYED_UNVERIFIED`, `PRODUCTION_ACCEPTED`, `RELEASE_FAILED`); rules in `AGENTS.md`. Do not duplicate architecture here. Do not start Sprint 15 automatically.
