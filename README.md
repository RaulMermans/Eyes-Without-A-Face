# Eyes Without a Face

Privacy-aware AI integration development tool for the Google #BuildHybridAI 2026 Hackathon.

**Technical concept:** Phantom Twin Engine  
**Tagline:** Build for systems your AI cannot see.

Private Source → Local Profiling → Phantom Twin → Disclosure Review → Gemini Cloud → Mapping Contract → Private Execution → Verification.

**AI proposes. Deterministic software validates and executes. Private data remains local.**

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
Real on-device calls also need `EYES_LIVE_ON_DEVICE=1`. Real cloud calls need credentials and `EYES_LIVE_CLOUD=1`. A pre-registered App Check debug token can be injected with the shell-only `EYES_APPCHECK_DEBUG_TOKEN`; never put it in `VITE_*`.

`pnpm test:mapping` covers the deterministic engine. It is included in the unit, contract, and privacy suites.

## Implementation status (Sprint 4)

Current classification: **`LOCAL_PIPELINE_COMPLETE / CLOUD_BLOCKED`**, with **real on-device inference verified**. See [docs/sprints/sprint-4.md](docs/sprints/sprint-4.md).

| Capability | Status |
| --- | --- |
| Guided flow: Source → Phantom Twin → Disclosure Review → Cloud Mapping → Reality Check | Implemented |
| Phantom Twin, cloud disclosure 1.1.0, exact-prompt approval, alias resolution | Implemented |
| Reality Check: five independent stage statuses plus an overall verdict | Implemented (fixed in Sprint 4) |
| On-device adapter (`ONLY_ON_DEVICE`, Gemini Nano through Firebase AI Logic) | **Verified live**: `inferenceSource = ON_DEVICE`, schema-valid, no cloud request (LIVE-007, LIVE-013; Chrome 157 Linux) |
| Cloud adapter (`ONLY_IN_CLOUD`, Gemini Developer API) | Implemented. Live request **BLOCKED** by App Check 403 until the owner registers the prepared debug token ([docs/setup/app-check.md](docs/setup/app-check.md)) |
| Firebase CLI / MCP | Configured (`.firebaserc`, `.mcp.json`). Authenticated access **BLOCKED** until `firebase login` ([docs/setup/firebase-cli-mcp.md](docs/setup/firebase-cli-mcp.md)) |
| Hosting | Configured, not deployed ([docs/deployment.md](docs/deployment.md)) |
| Export packaging, correction loop | Not implemented |
| Automatic cloud fallback | Forbidden by design |

Classifications:
- `HYBRID_QUALIFIED`: real on-device and real cloud inference both verified.
- `CLOUD_QUALIFIED / ON_DEVICE_BLOCKED`: cloud only.
- `LOCAL_PIPELINE_COMPLETE / CLOUD_BLOCKED`: cloud is not yet verified.

### On-device quick start

Playwright's default Chrome flags block the Gemini Nano component. Live on-device tests use a dedicated Chrome profile. See [docs/setup/browser-compatibility.md](docs/setup/browser-compatibility.md).

```bash
EYES_LIVE_TESTS=1 EYES_LIVE_ON_DEVICE=1 \
EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" pnpm test:live
```

Demo storyboard: [docs/demo/README.md](docs/demo/README.md).

## License

[Apache-2.0](LICENSE).

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
- `docs/sprints/` — Sprint 0–4 reports
- `docs/demo/` — 90-second demo storyboard and narration
- `docs/deployment.md` — Hosting status
- `docs/hackathon-history.md` — development timeline for the submission
- `docs/hackathon-requirements.md` — verified vs unresolved official rules
