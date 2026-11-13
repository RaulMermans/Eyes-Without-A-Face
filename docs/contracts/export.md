# Export Contract

**Kind:** `export`  
**Schema versions:** `1.0.0` (manifest only, Sprint 0), `1.1.0` (portable integration package, Sprint 9)  
**Schemas:** `src/domain/contracts/schemas/export.v1.schema.json`, `export.v1.1.schema.json`  
**Decision:** [ADR 0010](../decisions/0010-portable-integration-export.md)

## 1.1.0 — portable integration package

A ZIP the user downloads from **Export Integration**, the last action of the Reality Check step. It runs outside the app with Node.js 22+ and nothing else.

```text
eyes-integration-<mapping>-<sha8>/
  README.md                          verify / run / bind instructions, verification table, limitations
  manifest.json                      Export Contract 1.1.0 (SHA-256 of every other file)
  package.json                       type: module, engines node >=22, no dependencies
  run.mjs                            reviewed runner: verify · fixtures · bindings-template · run
  runtime/eyes-mapping-runtime.mjs   the app's own engine, bundled (hash-pinned)
  runtime/THIRD_PARTY_NOTICES.md     ajv, ajv-formats, fast-deep-equal, fast-uri, json-schema-traverse
  mapping/mapping.alias.json         Mapping Contract 1.0.0 over Phantom aliases
  schemas/destination.schema.json
  fixtures/synthetic-records.json    the reviewed twin examples, keyed by alias
  fixtures/expected-outputs.json     engine results on the fixtures at export time
  reports/validation-report.json     statuses, counts, outcome classes, codes — no values
  policy/acceptance-policy.json      local acceptance / quarantine policy
  policy/semantic-declarations.json  alias-level semantic constraints (approved vocabulary only)
  bindings/bindings.template.json    every alias the mapping reads, bound to ""
```

### Manifest fields (summary)

| Field | Meaning |
| --- | --- |
| `status` | `VERIFIED`, `VERIFIED_WITH_EXCEPTIONS` or `DRAFT`. `DRAFT` requires `draftConfirmed: true` and `verification.state: PARTIALLY_VERIFIED` (schema `if/then`) |
| `runtime` | engine, `runtimeName`/`runtimeVersion`, `runtimeSha256`, `runnerSha256`, `node: ">=22"`, `npmDependencies: []` |
| `mapping` | `variant` (initial / revised), `origin` (gemini-cloud, test-adapter, manual-edit, hand-written), `contractSha256` (SHA-256 of canonical JSON), `inference` provenance or `null`, `revisionVerdict`, `approvedDisclosureSha256` |
| `verification` | `state`, imported records, hidden cases run / available, outcome counts, quarantine rate, `semanticOverall`, policy id/version, `reasons` |
| `includesPrivateSourceFixtures` / `includesSourceBindings` | both `const false` |
| `privacyScan` | method, files scanned, `findings: 0` (a non-zero scan never produces a package) |
| `files[]` | path, SHA-256, bytes for every file except the manifest |

### Eligibility (`src/export/eligibility.ts`)

Deterministic and ground-truth blind: the Reality Check report, rows re-classified **without** `expected` under the local acceptance policy, the local semantic verifier and, for a revised mapping, the local acceptance decision.

| State | Export |
| --- | --- |
| `VERIFIED` — every record transformed, no rule, no quarantine | yes, `VERIFIED` |
| `VERIFIED_WITH_EXCEPTIONS` — approved rules or quarantine within the policy limit | yes, with the quarantine disclosed |
| `PARTIALLY_VERIFIED` — unresolved / policy-rejected records, quarantine over the limit, a semantic mismatch, hidden cases that exist but were not run, or a revision whose local decision is not `ACCEPTED` | only as `DRAFT`, after an explicit confirmation |
| `REVISION_FAILED`, `BLOCKED` | no |

Imported records passing alone is never `VERIFIED` when hidden cases fail or were skipped. Quarantine is never counted as a transformation; the runner lists quarantined records instead of dropping them.

### Privacy

- Never packed: records or outputs computed from them, source field names, alias bindings, prompts, Gemini rationale, Nano output, engine messages, tokens, Firebase config, credentials.
- The alias contract must read aliases only (`f_NN`); a hand-written contract is rewritten to aliases through the private bindings, and blocked if a reference has no alias.
- Before any download, `scanPackageFiles` checks every data-bearing file for private record values (normalized, 4+ characters), local field names and secret patterns (API keys, private keys, App Check debug tokens, the canary). Labels the user approved for disclosure and destination-schema strings are the only sanctioned overlaps. Any finding blocks the export and names the file and kind, never the value.
- ZIP paths are validated (`[A-Za-z0-9._-]` segments, no `..`, no absolute paths, ≤ 200 chars), entries are stored with a fixed timestamp and mode 0644. The same state yields byte-identical archives.

### Portable execution and local binding

```bash
node run.mjs verify                     # integrity (all hashes), canonical contract, fixture replay
node run.mjs fixtures --out ../f.json   # run on the fictional fixtures
node run.mjs bindings-template --out ../bindings.local.json
node run.mjs run --input ../records.json --bindings ../bindings.local.json --out ../results.json
```

Bindings file: `{ "bindingsVersion": "1.0.0", "mappingId": "...", "aliases": { "f_01": "path.to.field" } }`. Before anything runs, the runner requires every alias the mapping reads to be bound to a distinct valid path (`UNBOUND_ALIAS`, `UNKNOWN_ALIAS`, `DUPLICATE_SOURCE_PATH`, `INVALID_SOURCE_PATH`, `MAPPING_MISMATCH`, `BINDINGS_VERSION`). `bindMapping` mirrors `resolveAliases`; a contract test proves identical operations. **The bindings file names your source fields: it stays in the environment that owns the data and is never exported.** There is no optional binding export.

Exit codes: 0 ok · 1 verification failed · 2 usage or input error · 3 some records need review (unresolved, policy-rejected, quarantined or quarantine over the limit).

### Runtime

`src/export/runtime/runtime.ts` is pure and imports only the app's engine (`executeMappingBatch`, `validateContract`, `classifyRow`). `scripts/build-runtime.mjs` bundles it with Vite into `src/export/runtime/generated/eyes-mapping-runtime.mjs` (committed, reviewable; EXP-007 fails if it is stale). The app hashes the exact bytes it packs; `run.mjs` refuses a runtime whose hash differs from the manifest.

## 1.0.0 — manifest only

`buildExportManifest` (`src/export/build-export-manifest.ts`) still produces 1.0.0 manifests, which stay valid. They always set `includesPrivateSourceFixtures: false`.
