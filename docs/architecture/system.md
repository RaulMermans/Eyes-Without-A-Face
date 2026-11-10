# System architecture

Sprint 0 establishes contracts and boundaries. Live inference is not wired.

## Layers

**Application** (`src/app`, `src/components`) — React shell, workflow navigation, status presentation.

**Domain** (`src/domain`) — versioned contracts, Ajv validation, mapping operation specs, executable-code rejection. No React, Firebase, or DOM APIs.

**Infrastructure** (`src/config`, `src/inference`) — environment parsing, Firebase adapter interfaces, future SDK import boundary (`src/inference/firebase-live.ts`).

Supporting modules:

- `src/privacy` — disclosure helpers and private-data canaries
- `src/twin` — cloud-disclosure gate
- `src/verification` — validation report summary
- `src/export` — export manifest builder (always excludes private fixtures)

## Data flow

```text
JSON source (local memory)
        │
        ▼
 Source Contract (localOnly)
        │
        ▼
 On-device interpretation (Sprint 1, ONLY_ON_DEVICE)
        │
        ▼
 Phantom Contract (human approval)
        │  shareable aliases + synthetic examples only
        ▼
 Cloud mapping (Sprint 1, ONLY_IN_CLOUD)
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
| Phantom | Approved synthetic twin for cloud reasoning |
| Mapping | Declarative ops: copy, rename, trim, normalize_email, parse_date, map_enum, default_if_missing, concat |
| Validation | Local pass/fail with safe diagnostics |
| Export | Portable manifest and runtime compatibility |

## Firebase abstraction

`createInferenceServices(config)` returns adapters that report `disabled`, `unconfigured`, or `not-implemented`. `generate()` throws. The application shell does not import `firebase/app` or `firebase/ai`, so boot makes no provider request.

Sprint 1 must call `InferenceMode.ONLY_ON_DEVICE` for schema interpretation and `InferenceMode.ONLY_IN_CLOUD` for mapping. Hybrid “prefer” modes are disallowed because they fall back automatically.

## Local / cloud separation

| Path | Allowed inputs | Network |
| --- | --- | --- |
| Source import | Private JSON | None |
| Phantom construction | Structure / approved descriptors | On-device only |
| Mapping proposal | Approved Phantom Contract | Cloud Gemini via Firebase |
| Verification | Private fixtures + mapping | None |
| Export | Mapping, synthetic fixtures, report | None |
