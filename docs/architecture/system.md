# System architecture

Sprint 3 connects the Sprint 2 engine to locally generated Phantom Twins and gated Gemini mapping proposals. The guided flow is Source → Phantom Twin → Disclosure Review → Cloud Mapping → Reality Check. AI proposes; deterministic software validates and executes; private data remains local. This is a bounded workflow, not a multi-agent system.

## Layers

**Application** (`src/app`, `src/components`) — React shell, workflow navigation, local mapping workspace, diagnostic workspace.

**Domain** (`src/domain`) — versioned contracts, Ajv validation, mapping interpreter (`executeMapping`), executable-code rejection. No React, Firebase, or DOM APIs.

**Infrastructure** (`src/config`, `src/inference`) — environment parsing, Firebase live adapters (`src/inference/firebase-live.ts` is the only Firebase import).

Supporting modules:

- `src/domain/profile` — deterministic local source profiling (`profileRecords`)
- `src/domain/json/inspect.ts` — non-JSON, circular, and prototype-key inspection
- `src/phantom` — role vocabulary, seeded synthetic generator, Phantom Twin generation, `PrivateBindings`
- `src/proposal` — proposal → alias-level Mapping Contract (`convertProposal`) and local alias resolution (`resolveAliases`)
- `src/workflow/pipeline.ts` — pure orchestration shared by the UI and tests
- `src/verification/reality-check.ts` — local execution report with tiered diagnostics
- `src/observability/workflow-log.ts` — in-memory, allowlisted workflow telemetry
- `src/privacy` — canaries, forbidden-field scan, SHA-256 fingerprints, private-value index and leak scan
- `src/twin` — Phantom disclosure checks, allowlist projection, approval gate
- `src/verification` — validation report summary
- `src/export` — export manifest builder (always excludes private fixtures)
- `src/brand` — official emblem

## Data flow

```text
JSON source (local memory)            reserved hidden cases (local, never profiled)
        │                                          │
        ▼                                          │
 profileRecords → SourceProfile (local)            │
        │   optional ONLY_ON_DEVICE role suggestions on synthetic samples
        ▼                                          │
 generatePhantomTwin ──► PrivateBindings (local, unserializable)
        │   Phantom Contract (aliases f_NN, synthetic examples)
        │   Source Contract (localOnly)            │
        ▼                                          │
 describeTargetSchema (destination → minimal target)
        ▼                                          │
 CloudDisclosurePayload 1.1.0 (allowlist projection + target)
        │   exact prompt preview, SHA-256, private-value scan
        │   explicit Approve / Reject (single-use, request-bound)
        ▼                                          │
 submitApprovedCloudInference → Gemini (ONLY_IN_CLOUD)
        │   structured proposal over aliases       │
        ▼                                          │
 convertProposal → alias-level Mapping Contract    │
        ▼                                          │
 resolveAliases (local) → executable Mapping Contract
        ▼                                          ▼
 executeMappingBatch + destination JSON Schema  ◄──┘
        ▼
 Reality Check (local detail / safe summary / disclosure-shaped summary)
        ▼
 Export Contract (not implemented; no private source fixtures)
```

## Contract families

Canonical schemas live in `src/domain/contracts/schemas/`.

| Family | Purpose |
| --- | --- |
| Source | Field inventory and sensitivity of the imported JSON |
| Phantom | Internal synthetic twin (may keep source field ids) |
| Cloud disclosure | Allowlisted outbound payload for Gemini |
| Mapping | Declarative ops: copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat |
| Validation | Local pass/fail with safe diagnostics |
| Export | Portable manifest and runtime compatibility |

## Firebase abstraction

`createInferenceServices(config)` returns on-device and cloud adapters. The application does not import `firebase/app` at boot. The live chunk loads only when a configured adapter runs.

On-device uses `InferenceMode.ONLY_ON_DEVICE`. Cloud uses `InferenceMode.ONLY_IN_CLOUD`. Hybrid “prefer” modes are disallowed because they fall back automatically.

Cloud `generateAuthorized` requires an `AuthorizedCloudRequest` reserved by `submitApprovedCloudInference`. Free-form prompts are not accepted. Provenance must come from `response.inferenceSource`.

## Local / cloud separation

| Path | Allowed inputs | Network |
| --- | --- | --- |
| Source import + profiling | Private JSON | None |
| Phantom construction | Local profile + user decisions | None (optional on-device suggestions on synthetic samples) |
| Disclosure review | Projected payload | None |
| Mapping proposal | Approved CloudDisclosurePayload 1.1.0 | Cloud Gemini via Firebase |
| Conversion, alias resolution, Reality Check | Proposal + local bindings + private records | None |
| Export | Mapping, synthetic fixtures, report | None |

## Sprint 5 changes (no new boundaries)

- **On-device failure handling.** `classifyUnknownError` maps Chrome `kError*` failures to `ON_DEVICE_RUNTIME_ERROR`. The live adapter drops its cached `GenerativeModel` after a recoverable failure. `retry-policy.ts` allows exactly one *user-initiated* on-device retry (`ON_DEVICE_USER_RETRY_LIMIT = 1`), which resumes unclassified fields. Cloud retries remain at zero.
- **Release build.** `scripts/build-release.mjs` and `scripts/verify-release.mjs` sit outside the app. They force App Check debug off, stamp `VITE_BUILD_SHA` (exposed as `AppConfig.buildSha`) and verify `dist/` before any Hosting deploy.
- **UI.** The workflow shows only implemented steps (five). The Reality Check verdict separates imported-record transformation from hidden-case coverage, while `report.overall` stays strict. When the cloud adapter is unavailable, the send action is disabled so an approval is never spent on a request that cannot be dispatched. The gate and adapter still refuse independently.
