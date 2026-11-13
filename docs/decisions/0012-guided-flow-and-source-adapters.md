# 0012 — Guided flow (Your data → Destination → Result) and the Source Adapter Layer

Status: Accepted
Date: 2026-11-13

## Context

The Sprint 10/11 experience (CONNECT / OBSERVE / OUTCOME, [ADR 0011](0011-experience-architecture-black-halo.md)) made the hybrid run observable, but it made the run's *machinery* the product. To finish a normal integration, a first-time user had to:

- learn Phantom Twins, runtime stages and inference modes;
- move through five workbench stages;
- click separately to prepare, approve, send, continue, run and export.

Only JSON could be imported.

The engine, the gates and the evidence are correct and must not change.

## Decision

### 1. Two views over one workspace state

| View | Entry | Purpose |
| --- | --- | --- |
| **Guided** (default) | `/` | **1 Your data → 2 Destination → 3 Result.** The approval and the progress are moments inside Result. |
| **Technical** | `/#technical` or "Technical details" | The unchanged Sprint 10/11 experience: CONNECT / OBSERVE / OUTCOME, the 17-stage runtime, the workbench, the Privacy Boundary. |

- Both views read and write the same `WorkspaceState`. Switching view or step changes no workflow state and never approves.
- Existing E2E suites open `/#technical`. Their assertions are unchanged.

### 2. Build, approval and checking in the guided flow

1. **Build integration** runs only local steps (`prepareDisclosureReview`), then stops at the approval card. It never approves, sends or starts Gemini Nano.
2. The approval card is the existing single-use gate, in plain words:
   - what is sent;
   - what stays on the device;
   - why;
   - the exact request on demand (prompt, SHA-256, request id, model).

   The button **"Approve and send"** is one user action. It approves *that* preview (`approveReview`) and sends it once (`spendApproval` → `sendApprovedRequest`). Approval is not pre-authorized, not combined with anything else, and not reused. Any upstream change clears it (`invalidateDownstream`).
3. A valid proposal is then checked **locally and automatically** (`runLocalVerification`, imported records plus reserved test cases). This is deterministic code with no disclosure, so it needs no extra consent.
4. A blind revision keeps its own approval inside `BlindRevisionPanel`, offered only when the result is not verified.
5. On-device interpretation remains a user action ("Optional: improve field understanding with on-device AI"). When Nano is unavailable, the run is labeled deterministic.

The guided flow and the workbench panels share these actions (`src/app/run-actions.ts`). There is exactly one implementation of approve, send, cancel, fresh request and verify.

### 3. Truthful status, derived only

`guidedStatus` (`src/app/guided/guided-status.ts`) is a pure reading of `deriveRuntime`, the export candidates, and the one local operation in flight (preparing or checking). Its states are:

- Your approval is needed
- Generating the mapping
- Checking the result
- Integration ready
- Ready, with exceptions
- Draft — not fully verified
- Failed
- Needs your attention
- Not sent

There are no percentages and no simulated steps. The verdict comes only from `exportEligibility`. The structure line counts the user's records. Reserved test cases have their own line, and meaning that is not verified is shown as not verified.

### 4. Source Adapter Layer

`src/sources/` parses, validates and normalizes every input into **one** `NormalizedSource`. It is then bridged to the engine's existing `ImportedSource` (`toImportedSource`); the new `origin` field is optional. There is no per-format pipeline. See [contracts/source-adapter.md](../contracts/source-adapter.md).

| Adapter | Status |
| --- | --- |
| JSON file | Unchanged behaviour (`parseSourceDataset`) |
| CSV file | Papa Parse 5.7.0, dynamic typing off |
| XLSX file | Archive preflight, then SheetJS CE 0.20.3, lazily loaded; values and cached results only |
| Read-only REST (JSON) | One bounded HTTPS GET after Connect; browser CORS; no proxy |

Text stays text. Numbers and true/false are only *offered* as lossless conversions in a compact review control.

### 5. Destinations

Destinations are fictional example JSON Schemas (helpdesk, billing, marketing) or the user's own: imported, pasted, or drafted from one sample record by a conservative, deterministic rule. Choosing a destination never connects to, or writes to, any system.

### 6. Transformed data

Transformed records can be downloaded as JSON or CSV, but only by an explicit click. The download contains the user's imported records that passed, and never reserved cases. CSV formulas are escaped. These files are separate from the portable ZIP, which is unchanged and never contains records.

## Consequences

- The first screen asks one question ("Where is your data?"). The ordinary path is three screens. It needs about 5 clicks: data, next, build, approve-and-send, download.
- Sprint 10/11 rules about CONNECT/OBSERVE/OUTCOME still hold inside the technical view.
- The Sprint 12 frozen live harness (`tests/live/semantic-benchmark.spec.ts`) now opens `/#technical`. This was recorded as a freeze amendment.
- New dependencies: `papaparse` 5.7.0 (MIT, no dependencies) and `xlsx` 0.20.3 (Apache-2.0, no dependencies, from the SheetJS CDN, because the npm package is stale and has known advisories). The xlsx chunk is about 490 kB and loads only when a workbook is opened.

## Alternatives rejected

- **Auto-approve or auto-send after Build** — forbidden.
- **Hiding the approval behind a "trust me" toggle** — weakens governance.
- **A proxy to reach non-CORS APIs** — an open proxy is a new backend and an SSRF surface.
- **Evaluating Excel formulas** — code execution on untrusted input; cached results are enough.
- **Coercing CSV types automatically** — changes meaningful values (leading zeros, IDs, dates).
- **A general connector framework** — no second connector is in scope; the contract is kept small.
