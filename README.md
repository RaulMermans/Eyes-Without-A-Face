# Eyes Without a Face

Privacy-aware AI integration development tool for the Google #BuildHybridAI 2026 Hackathon.

**Technical concept:** Phantom Twin Engine  
**Tagline:** Build for systems your AI cannot see.

Private reality → On-device interpretation → Approved Phantom Twin → Cloud mapping → Private verification → Portable integration.

## MVP boundaries

Supports one JSON source dataset, one destination JSON Schema, one Phantom Twin, one declarative mapping, one local verification pass, one optional correction cycle, and one portable export.

Does not include CRM connectors, autonomous agents, production databases, authentication, or a custom backend.

## Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (strict) |
| App | React + Vite |
| Styling | Tailwind CSS + shadcn-compatible primitives |
| Contracts | JSON Schema 2020-12 + Ajv |
| App config | Zod |
| Unit tests | Vitest + fast-check |
| Browser tests | Playwright |
| AI (Sprint 1) | Firebase AI Logic (`firebase` 13.2.0) |
| Hosting (prepared) | Firebase Hosting |
| CI | GitHub Actions |
| Package manager | pnpm |

## Local setup

```bash
pnpm install
pnpm dev
```

The app starts without Firebase credentials. Live inference stays unavailable.

Copy `.env.example` to `.env.local` only when you have a Firebase web config. Do not commit `.env.local`. `VITE_*` values are exposed to the browser. App Check debug tokens must never be placed in `VITE_*` variables.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:contracts
pnpm test:privacy
pnpm test:e2e
pnpm test:all
```

`pnpm test:e2e` starts the Vite dev server and drives Chromium against it.

## Implementation status (Sprint 0)

| Capability | Status |
| --- | --- |
| Application shell and five-step workflow | Implemented (navigation only) |
| Versioned Source / Phantom / Mapping / Validation / Export contracts | Implemented |
| Contract validation | Implemented |
| Firebase configuration parsing | Implemented |
| Live on-device inference | Not implemented |
| Live Gemini mapping | Not implemented |
| Mapping interpreter | Not implemented |
| JSON import / export packaging | Not implemented |
| Automatic cloud fallback | Forbidden by design; not implemented |

Canonical contract source of truth: JSON Schema files in `src/domain/contracts/schemas/`. TypeScript types in `src/domain/contracts/types.ts` must match those schemas.

## Documentation

Index: [docs/README.md](docs/README.md)

- `AGENTS.md` — agent operating rules
- `CLAUDE.md` — short pointer into canonical docs
- `CONTRIBUTING.md` — local setup and required checks
- `SECURITY.md` — how to report issues
- `docs/architecture/` — layers and data-flow boundaries
- `docs/contracts/` — five MVP contract families
- `docs/security/` — threat model and disclosure policy
- `docs/testing/` — test strategy
- `docs/sprints/` — Sprint 0 report and Sprint 1 prerequisites
- `docs/hackathon-requirements.md` — verified vs unresolved official rules
