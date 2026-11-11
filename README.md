# Eyes Without a Face

**Build for systems your AI cannot see.**

A privacy-aware developer tool for the Google #BuildHybridAI 2026 hackathon. It lets a cloud model design a data integration for a private system **without being shown that system's records**, and then proves the result locally.

![Reality Check after a real Gemini proposal](docs/demo/screenshots/reality-check-real-gemini.png)

## The problem

You need to move customer records from a private CRM into a new system. Gemini could write the field mapping in seconds, but the records (names, emails, internal notes) are not allowed to leave your machine. Pasting "just a few rows" into a chat is exactly the leak you are trying to avoid.

## The mechanism: a Phantom Twin

```text
Private JSON ──▶ Phantom Twin ──▶ Disclosure Review ──▶ Gemini (cloud) ──▶ Reality Check
 this browser    this browser      you approve one        proposes a          this browser
                 + Gemini Nano     exact request          declarative         runs it on the real
                   on-device                              mapping             records + hidden cases
```

1. **Source (local).** The JSON is profiled by deterministic code in the browser. Nothing is uploaded.
2. **Phantom Twin (local, on-device AI).** Every field becomes a meaningless alias (`f_01`…) with fictional example values. Gemini Nano, running on-device through Firebase AI Logic (`ONLY_ON_DEVICE`), may suggest field roles from the *synthetic* samples. The alias-to-field bindings never leave the page.
3. **Disclosure Review (you).** The app shows the exact application prompt it would send, with its SHA-256. Approval is bound to that prompt, the destination model and one request id. One approval authorizes one request.
4. **Cloud Mapping (Gemini in the cloud).** Firebase AI Logic (`ONLY_IN_CLOUD`, App Check enforced) sends only the approved payload. Gemini returns a declarative mapping over aliases using an eight-operation allowlist. It cannot execute code.
5. **Reality Check (local, deterministic).** The proposal is validated against the canonical Mapping Contract, aliases are resolved locally, and the engine runs it against the private records **and against reserved hidden cases that were never profiled or disclosed**.

**AI proposes. Deterministic code validates and executes.** There is no automatic fallback between on-device and cloud. If a model is unavailable, the app says so and offers a manual path, labeled as manual.

### What the cloud does and does not see

| Leaves the browser (after your approval) | Never leaves the browser |
| --- | --- |
| Field aliases, generated descriptors, fictional example values, category labels you choose to disclose, a minimal destination description | Source records, original field names, alias bindings, dataset name, reserved hidden cases, failure values |

A Phantom Twin **reduces** disclosure; it does not make data anonymous. Structure, field counts, value formats and any category labels you disclose can still reveal something about the source system. That is why you review the exact request. The app controls the *application payload*; the Firebase SDK still adds App Check tokens, transport metadata and normal HTTP headers.

## What the demo shows

Using a fictional 3-record CRM and a fictional helpdesk destination:

- Gemini Nano classifies the six twin fields on-device: `inferenceSource = ON_DEVICE`, with no cloud request.
- Gemini in the cloud proposes a five-operation mapping: `inferenceSource = IN_CLOUD`. The proposal passes strict contract validation unchanged.
- Locally, all **3 / 3 imported records** transform into valid destination records.
- **0 / 3 reserved hidden cases** are covered: an unseen enum value (`UNMAPPED_ENUM`), a non-string email (`TYPE_MISMATCH`) and a null email (`NULL_VALUE`). The verdict is **FAIL · gaps found in cases the model never saw**. The point of the product is that this discovery happens before production, and without showing the model the data.

Walkthrough script: [docs/demo/README.md](docs/demo/README.md).

## Evidence

Real inference through Firebase AI Logic on Chrome 157 (Linux, AMD Strix Halo) with experimental on-device flags, from the Sprint 5 live suite. Details and caveats are in [docs/sprints/sprint-5.md](docs/sprints/sprint-5.md).

| Check | Result |
| --- | --- |
| On-device Gemini Nano (`ONLY_ON_DEVICE`), guided twin step | `ON_DEVICE`, 6 / 6 fields, schema-valid, 0 cloud requests (3 / 3 runs) |
| Cloud Gemini (`ONLY_IN_CLOUD`, App Check enforced), guided mapping | `IN_CLOUD` in about 2 s, proposal valid unchanged (3 / 3 runs) |
| Private terms in the real `generateContent` request body | 0 |
| On-device reliability, 10 cold + 10 warm browser runs | 19 / 20 first try, 20 / 20 after one user retry, 0 cloud fallbacks |
| Deterministic suites | 134 unit · 22 contract · 33 privacy · 47 Playwright E2E |

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

The app runs **without any Firebase configuration**. You can complete the whole walkthrough with deterministic profiling, the Phantom Twin, the disclosure review and a hand-written mapping contract. On-device and cloud AI stay visibly unavailable, never simulated.

To enable real inference:

1. Copy `.env.example` to `.env.local` and fill in the public Firebase web config ([docs/setup/firebase.md](docs/setup/firebase.md)).
2. **Cloud:** App Check is enforced. On `localhost` use the debug provider and safelist the token ([docs/setup/app-check.md](docs/setup/app-check.md)). The hosted build uses reCAPTCHA Enterprise.
3. **On-device:** Gemini Nano needs desktop Chrome with the Prompt API and a downloaded model. Some hardware needs experimental flags ([docs/setup/browser-compatibility.md](docs/setup/browser-compatibility.md)).

| Command | Purpose |
| --- | --- |
| `pnpm test:all` | Lint, typecheck, unit, contract, privacy, build, deterministic Playwright E2E |
| `pnpm build:release` | Production build for Hosting: forces App Check debug off, stamps the Git SHA, verifies `dist/` |
| `pnpm test:live` | Opt-in real Firebase/Gemini suite ([docs/testing/playwright-live.md](docs/testing/playwright-live.md)); never in CI |

## Status

Release candidate (Sprint 5). Hybrid inference is qualified locally. The hosted deployment and the public release are gated on owner approval ([docs/deployment.md](docs/deployment.md)). Not implemented: export packaging and the correction loop.

## Project

- Architecture: [docs/architecture/system.md](docs/architecture/system.md) · Security model: [docs/security/README.md](docs/security/README.md) · All docs: [docs/README.md](docs/README.md)
- Built during the hackathon period. See [docs/hackathon-history.md](docs/hackathon-history.md).
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Security reports: [SECURITY.md](SECURITY.md)
- License: [Apache-2.0](LICENSE). The emblem artwork is owner-supplied; see [docs/branding/README.md](docs/branding/README.md).
