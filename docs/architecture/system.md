# System architecture

Sprint 2 adds a local deterministic mapping interpreter and a browser import → map → execute workflow. Firebase Hybrid AI remains behind the disclosure gate. Models propose mappings; they do not execute them.

## Layers

**Application** (`src/app`, `src/components`) — React shell, workflow navigation, local mapping workspace, diagnostic workspace.

**Domain** (`src/domain`) — versioned contracts, Ajv validation, mapping interpreter (`executeMapping`), executable-code rejection. No React, Firebase, or DOM APIs.

**Infrastructure** (`src/config`, `src/inference`) — environment parsing, Firebase live adapters (`src/inference/firebase-live.ts` is the only Firebase import).

Supporting modules:

- `src/privacy` — canaries, forbidden-field scan, SHA-256 fingerprints
- `src/twin` — Phantom disclosure checks, allowlist projection, approval gate
- `src/verification` — validation report summary
- `src/export` — export manifest builder (always excludes private fixtures)
- `src/brand` — official emblem

## Data flow

```text
JSON source (local memory)
        │
        ▼
 Source Contract (localOnly)
        │
        ▼
 On-device interpretation (ONLY_ON_DEVICE)
        │
        ▼
 Phantom Contract (internal; may contain sourceFieldId)
        │
        ▼
 CloudDisclosurePayload (allowlist projection)
        │  user approval of SHA-256(bytes)
        ▼
 Cloud mapping (ONLY_IN_CLOUD)
        │  declarative operations, never JS
        ▼
 Mapping Contract
        │
        ▼
 Local verification → Validation Contract
        │
        ▼
 Export Contract (no private source fixtures)
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
| Source import | Private JSON | None |
| Phantom construction | Structure / approved descriptors | On-device only |
| Mapping proposal | Approved CloudDisclosurePayload | Cloud Gemini via Firebase |
| Verification | Private fixtures + mapping | None |
| Export | Mapping, synthetic fixtures, report | None |
