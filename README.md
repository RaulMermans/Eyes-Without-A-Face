# Eyes Without a Face

Privacy-aware AI integration development tool for the Google #BuildHybridAI 2026 Hackathon.

**Technical concept:** Phantom Twin Engine  
**Tagline:** Build for systems your AI cannot see.

Private reality → On-device interpretation → Approved Cloud Disclosure Payload → Cloud mapping → Private verification → Portable integration.

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
| AI | Firebase AI Logic (`firebase` 13.2.0) |
| Hosting (prepared) | Firebase Hosting |
| CI | GitHub Actions |
| Package manager | pnpm |

## Local setup

```bash
pnpm install
pnpm dev
```

The app starts without Firebase credentials. Live inference stays unavailable until `.env.local` is filled and feature flags are enabled.

Copy `.env.example` to `.env.local` only when you have a Firebase web config. Do not commit `.env` or `.env.local`. `VITE_*` values are exposed to the browser. App Check debug tokens must never be placed in `VITE_*` variables.

This repo targets the registered project `eyes-without-a-face-b7281`. Paste the existing reCAPTCHA Enterprise **site key** over the placeholder. Then safelist the local App Check debug token in Firebase Console.

Setup guides: [docs/setup/firebase.md](docs/setup/firebase.md), [docs/setup/app-check.md](docs/setup/app-check.md), [docs/setup/browser-compatibility.md](docs/setup/browser-compatibility.md), [docs/testing/playwright-live.md](docs/testing/playwright-live.md).

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:contracts
pnpm test:privacy
pnpm test:e2e
pnpm test:live
pnpm test:mapping
pnpm test:all
```

`pnpm test:e2e` is deterministic and does not require Firebase.  
`pnpm test:live` is opt-in (`EYES_LIVE_TESTS=1`) and uses installed Chrome. It is **not** part of `pnpm test:all`.  
Real on-device calls also need `EYES_LIVE_ON_DEVICE=1`. Real cloud calls need credentials and `EYES_LIVE_CLOUD=1`.

`pnpm test:mapping` covers the deterministic engine. It is included in the unit, contract, and privacy suites.

## Implementation status (Sprint 2)

| Capability | Status |
| --- | --- |
| Application shell and five-step workflow | Implemented |
| Official emblem, favicon, social-preview foundation | Implemented |
| Versioned Source / Phantom / Mapping / Validation / Export / Cloud Disclosure contracts | Implemented |
| Allowlist projection + single-use disclosure approval + destination binding | Implemented |
| Firebase configuration for `eyes-without-a-face-b7281` | Implemented; live values belong in `.env.local` (Vite prefers it over `.env`) |
| On-device adapter (`ONLY_ON_DEVICE`) | Implemented; live model previously **BLOCKED** (`LanguageModel` `unavailable`) |
| Cloud adapter (`ONLY_IN_CLOUD`) | Implemented; App Check uses the registered public site key; debug token must be safelisted locally |
| Mapping interpreter | Implemented (`executeMapping` / `executeMappingBatch` in `src/domain/mapping`) |
| JSON import | Implemented in the Source step (session memory only) |
| Export packaging | Not implemented |
| Automatic cloud fallback | Forbidden by design; not implemented |

Do not report `HYBRID_QUALIFIED` unless both cloud and on-device provenance are confirmed. Cloud-only success is `CLOUD_QUALIFIED / ON_DEVICE_BLOCKED`.

Canonical contract source of truth: JSON Schema files in `src/domain/contracts/schemas/`. TypeScript types in `src/domain/contracts/types.ts` must match those schemas.

## Documentation

Index: [docs/README.md](docs/README.md)

- `AGENTS.md` — agent operating rules
- `CLAUDE.md` — short pointer into canonical docs
- `CONTRIBUTING.md` — local setup and required checks
- `SECURITY.md` — how to report issues
- `docs/architecture/` — layers and data-flow boundaries
- `docs/contracts/` — contract families
- `docs/security/` — threat model and disclosure policy
- `docs/testing/` — test strategy
- `docs/sprints/` — Sprint 0–2 reports and Sprint 3 readiness
- `docs/hackathon-requirements.md` — verified vs unresolved official rules
