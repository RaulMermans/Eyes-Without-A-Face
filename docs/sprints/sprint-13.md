# Sprint 13 — Product simplicity, multi-format data and connected sources

**Date:** 2026-11-13
**Branch:** `sprint-13-product-simplicity`, from `origin/main` @ `acd206c` (merge of PR #13, Sprint 12).
**Goal:** make EYES an integration-building product a first-time user can finish without an explanation, and accept JSON, CSV, Excel and a read-only API. **The engine, the gates and the evidence did not change.**

Decision: [ADR 0012](../decisions/0012-guided-flow-and-source-adapters.md). Contract: [contracts/source-adapter.md](../contracts/source-adapter.md).

## Starting state (verified)

- `origin/main` = `acd206c`; CI on `main` green (run 43488309994).
- `https://eyes-without-a-face-b7281.web.app/build-info.json` serves `b93e3ed` (the Sprint 11 merge, production, `appCheckDebug: false`). Sprint 12 was never deployed.
- Baseline per the Sprint 12 report: 560 passing tests.

## What changed

### A — Guided flow (P0)

| Before | After |
| --- | --- |
| CONNECT → OBSERVE → OUTCOME, a 17-stage runtime and a five-stage workbench on the main path | **1 Your data → 2 Destination → 3 Result**; the approval and the progress are moments inside Result |
| JSON textarea plus a scenario picker | "Where is your data?" Upload a file (drop zone, JSON / CSV / Excel), Connect an API, or fictional demo data in CSV / Excel / JSON |
| Build → OBSERVE → approve → continue → send → continue → run → OUTCOME → export | Build → **Approve and send** (one click, one exact request) → automatic local check → Result → Download integration |
| Runtime headline and 17 stage rows | One status (`guidedStatus`), derived only from `deriveRuntime` and export eligibility |
| Export panel with seven explanatory blocks | "Download integration"; details collapsed (`ExportPanel compact`), same package and privacy scan |

- The Sprint 10/11 experience is untouched and opens from **Technical details** or `/#technical`. Both views share one `WorkspaceState`.
- Approve, reject, send, cancel, fresh request and verify now have one implementation (`src/app/run-actions.ts`), used by both views. `ReviewPanel`, `CloudMappingPanel` and `VerificationPanel` call it.
- Focus moves to each step's heading. Status changes are announced (`role="status"`, `aria-live="polite"`). The busy icon stops under reduced motion. There is no horizontal scroll at 390 px.

### B — Multi-format import (P0)

- **JSON:** unchanged (`parseSourceDataset`).
- **CSV:** Papa Parse 5.7.0, dynamic typing off.
  - Supported: quotes, `""`, multi-line values, BOM, empty cells as missing.
  - Blocking problems name the row and column: malformed rows, duplicate or empty headers, unclosed quotes, non-UTF-8 text, semicolon files.
  - Preserved: leading zeros, 20-digit IDs, `1.50` and ambiguous dates. Numbers and true/false are offered as opt-in conversions.
- **XLSX:**
  - An archive preflight runs before parsing (size, parts, uncompressed total, compression ratio, ZIP64, encryption, legacy `.xls`).
  - SheetJS CE 0.20.3 is loaded lazily.
  - Sheet selection and hidden-sheet warning; date cells become ISO 8601 text.
  - Formulas: cached results are used and reported. Formulas without a cached result and error cells are reported as missing. Macros and external links are ignored and reported.
- **Equivalence:** the fictional CRM as JSON, CSV and XLSX normalizes to **identical records** and produces **identical Phantom Twins** (SRC-EQ-001/002).

### C — Connected source (P1, shipped)

Read-only REST JSON connector:

- one HTTPS GET after **Connect and read**;
- public DNS hosts only; no credentials in the URL;
- redirects refused; browser CORS (no proxy);
- 10 s timeout, 1 MiB cap enforced while streaming, JSON content type, strict parse;
- optional bearer token, kept in memory for the one request.

The UI shows the target host before connecting. The adapter contract is small and documented, along with how Sheets, databases and SaaS sources could be added ([contracts/source-adapter.md](../contracts/source-adapter.md)).

### D — Outcome-first result (P0)

The result screen answers "did EYES create a usable integration?" with:

- the verdict;
- source → destination and the mapping origin;
- **Transformed / Set aside for review / Need attention**, counted over *your* records only;
- Structure, Meaning, and Test cases (the reserved cases Gemini never saw);
- "Why it is not ready".

Then:

- **Download integration** (unchanged Export 1.1.0).
- Preview transformed data, with **explicit** JSON / CSV downloads of passing records only. CSV formulas are escaped. These downloads are never part of the ZIP.
- Review issues (safe summaries), View mapping (plain language).
- One AI revision, behind its own approval.

### E — Privacy and approval

There are fewer clicks, not fewer permissions:

- Build never approves or sends.
- "Approve and send" binds to the previewed hash, once.
- Changing data or destination clears it (E2E-132).
- A revision needs its own approval.
- When cloud is not configured, the button is disabled and the screen says so.
- Gemini Nano is still a user action; without it the run is labeled deterministic.

## Tests & evidence

| Suite | Sprint 12 | Sprint 13 | New |
| --- | --- | --- | --- |
| Unit | 251 | **320** | source adapters (29), REST connector (33), guided flow (7) |
| Contracts | 43 | **43** | — |
| Privacy | 69 | **78** | PRV-SRC / PRV-CON / PRV-OUT (9) |
| Evaluation | 84* | **84** | — |
| E2E | 113 | **129** | E2E-130…134 guided flow (16) |
| **Total** | **560** | **654** | +94 |

\* As measured on this branch's base. Lint and typecheck are clean. `pnpm build` passes; xlsx is a separate lazily loaded chunk of about 490 kB.

**Existing suites.** All 113 Sprint 10/11 E2E tests pass with **unchanged assertions**. Only their entry URL moved to `/#technical` (one line per file; `TECHNICAL_VIEW` in `tests/e2e/helpers.ts`).

**Freeze amendment (reported).** `tests/live/semantic-benchmark.spec.ts` is frozen by the Sprint 12 Nano-value freeze. Its entry URL changed (one line), recorded with `node scripts/freeze-nano-value.mjs --amend …` in [nano-value-freeze.json](../evidence/sprint-12/nano-value-freeze.json). Scenarios, inputs, prompts and assertions are unchanged; EVAL-120 passes.

**Real connector, no mocks** ([evidence/sprint-13/connector-live.json](../evidence/sprint-13/connector-live.json), `tests/live/rest-connector.spec.ts`):

- **LIVE-130:** `https://jsonplaceholder.typicode.com/users` (public, CORS-enabled, fictional records).
  - One `GET`, no body, no `Authorization` header, HTTP 200.
  - 10 records × 8 fields, in 323 ms.
  - The run continued through the same engine to the approval card, whose exact prompt contains none of the API's values or field names. Nothing was approved or sent to Gemini.
- **LIVE-131:** `https://example.com/` (no CORS headers) is refused by the browser and reported as such; nothing loads.

**Mocked in tests (labelled):**

- E2E connector tests use Playwright routes. Because `fulfill()` skips the browser's CORS check, CORS refusal there is modelled as a failed fetch. Real CORS is LIVE-131.
- All guided E2E cloud steps use the labeled simulated test adapter, never presented as Gemini.

**Not run this sprint:** real Gemini / Nano requalification of the guided flow (no hosted or credentialed model run was performed), and `build:release` on the final merge SHA (to run before any deployment approval).

## F — Usability validation

| Item | Status |
| --- | --- |
| Sessions with three unfamiliar developers | **NOT PERFORMED.** No participants were available to the agent. The facilitator kit ([usability/](../usability/)) applies unchanged to the new flow; scenario: "customer data in a spreadsheet → helpdesk structure without sending the records to Gemini". |
| Manual screen-reader test | **NOT PERFORMED.** |
| Automated journey measurement (not usability evidence) | Normal path = **3 screens, 5 clicks**: choose data, Next, Build integration, Approve and send, Download integration (+1 checkbox when the result is a Draft). Decisions: data, destination, approval. 0 technical-inspector visits needed (E2E-130). |
| Automated accessibility checks | Keyboard reach of the file control and the steps, focus on step headings, live status, mobile 390 px with no overflow, reduced motion (E2E-134). |

## Risks

- **Credentials:** the token stays in component memory. It is sent only as a header to the confirmed origin, redirects are refused, and it is cleared after the read. Tests prove it is absent from the workspace, telemetry, disclosure, package and storage. A user can still paste a write-capable token; the UI asks for a read-only one.
- **Browser limits:**
  - Most SaaS and database APIs do not allow browser CORS. EYES says so and does not proxy.
  - DNS rebinding of a public name to a private address cannot be fully prevented in a page.
- **Import safety:** formulas are never evaluated. A workbook that under-states its sizes in the central directory can still make the parser work hard. The worst case is bounded by the 2 MiB input and is limited to the user's own tab. Moving the parser to a Web Worker with a timeout is the follow-up.
- **Supply chain:** two new runtime dependencies, both without dependencies and pinned. SheetJS comes from its official CDN with a lockfile integrity hash; CI needs `cdn.sheetjs.com` reachable.
- **Deployment compatibility:** no Firebase, hosting-header, App Check or configuration change. The app stays client-only and the new code paths need no credentials.
- **UX not yet validated by people:** no human has completed the new flow.

## Rollback

- **Code:** the PR is additive. Revert the merge commit to restore the Sprint 12 UI (the technical view is that UI).
- **Hosting (if a Sprint 13 build is ever deployed):** Firebase Console → Hosting → release history → **Rollback** to the release from `b93e3ed`.
- **Partial rollback:** open `/#technical` for the previous experience.

## Release plan (not executed)

1. Merge the PR after review. CI must pass on the merge commit.
2. On the exact merge SHA: `pnpm install --frozen-lockfile`, full regression, `pnpm build:release`, `pnpm verify:release`.
3. Owner approval of **that exact SHA** for `live` on `eyes-without-a-face-b7281` (AGENTS.md, Sprint 12 rules). Nothing is deployed without it.
4. Hosted acceptance:
   - guided flow with real Gemini (`playwright.hosted.config.ts`, no debug token);
   - LIVE-130 against the hosted origin;
   - degradation checks.
5. Rollback as above.

No deployment, submission, repository-setting or external-account change was made in this sprint.

## Product readiness

| Question | Answer |
| --- | --- |
| Upload JSON, CSV and Excel? | **Yes.** One control; verified by unit, privacy and E2E tests. |
| Connect a real source? | **Yes, read-only and CORS-enabled REST JSON.** Verified against a real public API with no mocks. Databases and SaaS need a future connector service. |
| Choose the destination? | **Yes.** Three fictional examples, or your own schema (import, paste, or draft from a sample). |
| Build with minimal interaction? | **Yes.** 3 screens, 5 clicks on the normal path. |
| Cloud approvals preserved? | **Yes.** Exact, single-use, hash-bound, invalidated by upstream change; the revision approval is separate. |
| Output understandable? | Verdict, counts, three checks and "why not ready" in plain words. **Not yet validated with people.** |
| Download and execute the integration? | **Yes.** Same Export 1.1.0 package and checks as Sprint 12 (E2E-130 downloads it). |
| Release-ready? | **Release candidate.** All deterministic suites pass and the build is clean. A hosted real-model requalification of the guided flow is still required. |
| Unfinished before submission | Owner review and merge; deployment approval of the exact SHA; hosted acceptance of the guided flow; demo video re-recording for the new UI (the Sprint 12 script shows the technical view); human usability sessions if possible; Devpost submission (owner). |
