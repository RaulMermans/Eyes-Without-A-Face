# Agent guide — Eyes Without a Face

## Mission

Build a privacy-aware integration tool: private CRM JSON stays local; on-device inference may interpret structure; only an approved Phantom Twin may go to cloud Gemini; mapping execution and verification stay local and deterministic.

## Architecture constraints

- Application (React) / domain (contracts) / infrastructure (Firebase, files, config) stay separated.
- `src/domain` must not import React, Firebase, or browser-only APIs.
- Mapping execution must not depend on a model provider.
- Do not use Firebase `InferenceMode.PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`. Automatic cloud fallback is forbidden.
- Do not execute model-generated JavaScript.
- Do not persist raw customer datasets.
- Do not add authentication or a backend unless a concrete requirement appears.
- Local development must run without Firebase credentials.
- Missing configuration must never trigger an unauthorized cloud call.

## Tool and data permissions

Allowed without extra authorization: local files in this repository, local tests, local Vite server, Playwright against localhost.

Not allowed without explicit user authorization: creating Firebase/Google Cloud projects, enabling billable APIs, deploying hosting, publishing the repository, force-pushing, or changing external systems.

## Coding conventions

- TypeScript strict mode. No enums (erasable syntax). Use `import type` under `verbatimModuleSyntax`.
- JSON Schema 2020-12 is canonical for contracts; keep TypeScript types aligned.
- Prefer small, tested modules over new packages.
- Do not add decorative controls that look functional but do nothing.
- Do not simulate successful inference.

## Required checks

Before claiming a task complete:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm test:privacy
pnpm build
pnpm test:e2e
```

Do not skip failing tests, stub them empty, or weaken acceptance criteria to go green.

## Privacy rules

- Source contracts are `localOnly: true`.
- Phantom contracts must not embed private canaries or raw private records.
- Export manifests set `includesPrivateSourceFixtures: false`.
- Private-data canary: `PRIVATE_CANARY_PII_DO_NOT_SHARE`.

## Sprint completion

Report PASS / FAIL / SKIPPED / BLOCKED / NOT RUN with evidence. Do not start the next sprint automatically.
