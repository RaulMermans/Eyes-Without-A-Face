# Sprint 16A — Real-world production challenge

**Date:** 2026-11-16 · **Branch:** `sprint-16a-real-world-qa` (from `origin/main` @ `7d53fb2`) · **Kind:** evidence-generation and production QA. No product code was changed.

**Readiness decision: `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`**, conditional on the wording below. Three P1 defects (D1–D3) should be fixed before Devpost. Their fixes are small. See [§ Decision](#decision).

## 1. Exact state under test

| Item | Value | How |
| --- | --- | --- |
| `origin/main` | `7d53fb2` (merge of PR #17). Same tree as `0ba5de3` | `git diff` (empty) |
| Served build | `c4a246cee43239a29298e919fe49c83fc0a8e9bb`, `mode: production`, `appCheckDebug: false`, `dirty: false` | `build-info.json`, footer `build c4a246cee432` |
| Code difference served ↔ main | **none** in `src/`, `scripts/`, `public/`, `index.html`, `package.json`; docs only | `git diff --stat c4a246c 0ba5de3 -- src scripts public …` |
| App Check | enforced: the model endpoint answers 401 without a token; no debug token in the page | preflight P-002 |
| Preflight | `pnpm test:production`, **19 / 19 PASS** (Chromium plus the Firefox subset) | [evidence/sprint-16a/preflight/](../evidence/sprint-16a/preflight/) |
| Browsers | Matrix: Playwright Chromium (headless), 1280 × 900. Nano: installed Chrome, headed, dedicated Nano profile. Linux 7.0 x86_64 | `browser.json`, `nano-results.json` |
| Limits in force | 250 records · 64 columns · 16,000 cells · 10,000 characters per cell · 1 MiB JSON/CSV · 2 MiB XLSX · object depth 4 · 12 profile categories / 24 guided labels | `src/sources/limits.ts`, `src/domain/profile` |
| Mapping operations | `copy`, `rename`, `trim`, `normalize_email`, `parse_date` (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, ISO-8601), `map_enum`, `default_if_missing`, `concat`. No arithmetic, joins, arrays, number formatting or locale parsing | `docs/contracts/mapping.md` |

**Release status:** unchanged. `c4a246c` remains `PRODUCTION_ACCEPTED` (Sprint 15). This branch adds only a test harness and documents, so there is nothing to deploy. Its own status is `CODE_READY`. Nothing was deployed, and no Firebase, App Check or credential change was made.

## 2. What was tested and how

```text
generate (seeded, independent) → ground truth → production browser (guided UI only)
  → downloads (transformed JSON/CSV, ZIP, bindings) → independent oracle comparison
  → clean-room runner replay (twice) → ZIP integrity + privacy scan → triage → scorecard
```

| Component | File |
| --- | --- |
| Generator and oracle | `scripts/qa/s16a/{lib,scenarios,generate}.mjs` — imports **nothing** from `src/` |
| Production driver | `tests/qa/sprint-16a.spec.ts` + `playwright.qa-16a.config.ts` (refuses a debug token; localhost only with `EYES_QA_TARGET=local`, labeled) |
| Independent verifier | `scripts/qa/s16a/verify.mjs` (own unzip, SHA-256, a clean `env` with an unusual time zone, no `node_modules`) |
| Triage and scorecard | `scripts/qa/s16a/scorecard.mjs` → `scorecard.json`, `matrix.md` |
| Genuine Nano subset | `tests/qa/sprint-16a-nano.spec.ts` + `playwright.qa-16a-nano.config.ts` |
| Domain reproductions | `tests/qa/s16a-repro.test.ts` + `vitest.qa-16a.config.ts` (D1, D3) |

### How the datasets were generated

- **Independence.** Every record starts as a hidden *canonical entity*: the true status, date, amount and so on. The source record is a *rendering* of it:
  - field names drawn from English, Spanish and German lexicons;
  - labels like `activo` / `gekündigt` / `on hold`;
  - date conventions;
  - email case and padding;
  - nesting.

  The expected destination record is a *projection of the entity*. The oracle never parses the source text and never runs EYES code. EYES' output was never used as truth.
- **Fresh, held-out data.** Master seed `S16A-HOLDOUT-2026-11-16-q7c2`, never used before. The data was generated after reading only contracts and code, and nothing in EYES was tuned. Regenerating reproduces every case exactly, except the canaries, which are crypto-random on purpose. Dataset hash of the exact run: see `dataset-manifest.json`.
- **Ground truth** includes, per record, `TRANSFORMED` with the exact output, `QUARANTINED` (labels the user sets aside) or `UNRESOLVED` (injected bad email, invalid calendar date, missing or null required value).
- **Canaries.** One random canary per variant is placed in an unmapped free-text column, and in a *mapped* value of record 1. The mapped one may legitimately appear in the local transformed download, never anywhere else. The registry is private (`qa-artifacts/`, gitignored).

### Cases (62)

| Group | n | Content |
| --- | --- | --- |
| Scenario variants | 24 | 8 sectors × 3 variants: A CRM→Helpdesk · B E-commerce→OMS · C HR→Directory · D Ledger→Reporting · E Logistics→Tracking · F Healthcare admin→Scheduling · G Ticketing→Attendees · H SaaS support→Issue tracker. Each sector has a JSON (often nested), a CSV and an XLSX variant; languages en / es / de / mixed; 20–200 records; distractor and sensitive columns; injected defects |
| Accept-defaults probes | 8 | The same data as variant 1. The user keeps every field EYES pre-selects and answers only what EYES asks: the click-through developer |
| Boundary / quality / localization / adversarial | 27 | empty, header-only, 1 record, **250 × 64 = 16,000 cells**, 251 records, 65 columns, a 10,001-character cell, >1 MiB, bad quoting, `;` CSV, ragged rows, spaced headers, formula-like text, XLSX formulas/error/hidden sheet, instruction-like and secret-shaped strings, depth 5 and arrays, mixed types, a dirty date, ambiguous `03/02/2026`, duplicates, null/empty, Unicode (CJK, RTL, emoji ZWJ, combining marks), decimal comma / German dates, two-decimal amounts, mixed-language labels, a 72 KB record, absent optional values |
| Public data | 3 | USGS earthquakes CSV (126 × 22, public domain) · TfL tube status over the **live read-only REST connector** (CORS, one GET) · USGS GeoJSON over REST |

The user's answers in each case are the data owner's: which field gives which destination field, translations, date order and type choices. That is the documented guided flow; the developer knows their data. EYES' own pre-selections are recorded **before** any answer, and they are measured separately (§ 5).

### Public data provenance

| Case | Publisher / URL | License | Retrieved | Sensitive-content check |
| --- | --- | --- | --- | --- |
| R01 | USGS Earthquake Hazards Program, `earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2026-11-01&endtime=2026-11-03&minmagnitude=2.5&limit=200&orderby=time-asc` | U.S. Government work, public domain | 2026-11-16 | place names, magnitudes, network codes; no personal data |
| R02 | Transport for London Unified API, `api.tfl.gov.uk/Line/Mode/tube/Status` (no key) | TfL Open Data terms; “Powered by TfL Open Data” | 2026-11-16 (snapshot) plus live during the run | line names, statuses; no personal data |
| R03 | USGS GeoJSON feed (`format=geojson`) | public domain | live during the run | geographic only |

Both hosts send `Access-Control-Allow-Origin: *`. No proxy or redirect was used. The connector made **exactly one GET, after the click** (R02, R03).

## 3. Where things ran

| Path | Where | Real AI? | Evidence |
| --- | --- | --- | --- |
| 62-case matrix | **deployed URL**, guided UI only | **No.** Deterministic “Build on this device”; 0 `generateContent` | `results-production.json` |
| Downloads, verification, runner replay | local Node 22.23, clean env | — | same |
| Gemini Nano subset (A1, H2, C3, X15) | **deployed URL**, installed Chrome | **Yes, real on-device Nano** (every row labeled by the app “Gemini Nano (real on-device)”) | `nano-results.json` |
| Gemini Cloud | — | **NOT RUN.** No approved budget (§ 9) | — |
| Fault paths (provider down, App Check refused, invalid proposals) | not provoked live | existing deterministic E2E (151 pass) | regression |
| Harness development | local preview build (labeled `local`, not counted) | No | gitignored |

## 4. Results

**Status totals (62): PASS 39 · FAIL 10 · PARTIAL 7 · UNSUPPORTED 6 · BLOCKED 0 · NOT RUN 0.** Full table: [evidence/sprint-16a/matrix.md](../evidence/sprint-16a/matrix.md).

| By format | PASS | FAIL | PARTIAL | UNSUPPORTED |
| --- | --- | --- | --- | --- |
| JSON (28) | 16 | 7 | 3 | 2 |
| CSV (22) | 15 | 2 | 2 | 3 |
| XLSX (10) | 8 | 0 | 2 | 0 |
| REST (2) | 0 | 1 | 0 | 1 |

| By sector (variants + probe) | Result |
| --- | --- |
| B E-commerce, D Ledger, H Support | 4/4 PASS each, probes included |
| A CRM, G Ticketing | 3/4 PASS. The probe FAILs: wrong pre-selected identifier (D2) |
| F Healthcare admin | 1/4 PASS. Transformed data correct in all 4; 3 ZIPs blocked by the scan false positive (D3) |
| C HR, E Logistics | 0/4 PASS. All 3 variants PARTIAL: absent optional values flagged (L1). The probe FAILs (D2) |

### 4.1 Correctness: structural and semantic, reported separately

- **The careful user** (36 built journeys, 2,317 records; X17 and R02 are excluded because D1 made a correct answer impossible):
  - **2,079 records exactly equal to ground truth**: every field value, type, date, translation and email normalization.
  - **0 wrong values.**
  - **0 falsely transformed records.**
  - **0 silently dropped records.**
  - **0 invented values.**
  - 238 records (C, E, X27) were flagged only because an optional source value was absent (L1). The business expected them transformed without the field. That is honest, but incomplete.
  - Counts matched the oracle in 29/36. The 7 mismatches are exactly the L1 cases.
- **The click-through user** (8 probes): **3/8 correct**, 150 wrong-value records out of 233 compared.
  - G1-D was headlined “Integration ready” with a `VERIFIED` package while **every** `ticketId` was an event code.
  - Structure was always valid. **Schema validity is not correctness**, and EYES' own “Meaning” section says so per field. The headline does not.
- **Rejections and quarantine.**
  - Every injected bad email, impossible date (`2025-02-30`, `02/30/2025`), null or empty required value and missing required value was flagged, never repaired or filled in.
  - Every set-aside label was quarantined, never counted as transformed (UI counts, ZIP manifest and runner agree).
- **Refusals:** **9/9** malformed or over-limit inputs were refused with a message that names rows, columns or limits, and loaded nothing. These were: empty, header-only, 251 records, 65 columns, 10,001 characters, >1 MiB, an unterminated quote, `;` CSV and a ragged row.
- **Limits:** 250 × 64 = 16,000 cells (X04) passed 250/250. A 72 KB record within the source limits but above the engine's 64 KiB per-record limit (X26) was flagged on its own; the other records were transformed.
- **Semantic ambiguity:**
  - `03/02/2026`-style dates were asked about once, and the answer was applied correctly (X19).
  - Mixed-language labels were never pre-filled (X25, 0 pre-filled in every case).
  - Priority and severity (H) were **never** auto-assigned, because fixed-list fields with several candidates always ask. So they were never swapped.
- **Localization:** Unicode (CJK, Arabic, emoji ZWJ, combining marks) was preserved exactly through XLSX → JSON → runner (X22). Locale numbers and dates are unsupported (L3).

### 4.2 Export portability (43 ZIPs downloaded)

| Check | Result |
| --- | --- |
| `node run.mjs verify` in a clean directory and environment | **43 / 43** |
| Every file's SHA-256 independently recomputed against `manifest.json`; no unlisted file | **43 / 43** |
| Runtime and runner hashes match the manifest | **43 / 43** |
| `run` on the documented input + `bindings.local.json` = the app's transformed output | **43 / 43** |
| Runner output identical over two runs (time zone `Pacific/Chatham`) | **43 / 43** |
| Runner imports | `node:crypto`, `node:fs`, `node:path`, `node:url` only. `npmDependencies: []`. No `node_modules` |
| Status honesty (`VERIFIED` only when every record passed structurally) | 43 / 43 structurally. Semantically, see D2 |
| Statuses | DRAFT 18 · VERIFIED_WITH_EXCEPTIONS 8 · VERIFIED 17 |
| Quarantined records | listed by index in the runner summary, never dropped |
| Export blocked although eligible | **3** (D3, a false positive) |

The runner reads JSON only (stated on screen). For the CSV and XLSX cases, the replay input was converted independently: strings, empty = missing, and the user's type choices applied.

## 5. AI behaviour

| Measure | Result |
| --- | --- |
| EYES pre-selection (24 scenario variants, 162 destination fields) | 47 correct · **14 wrong** · 101 nothing pre-selected. The true field was offered in 162 / 162 and ranked first in 105 / 162 |
| Wrong pre-selections | `customerId ← legacy_crm_id` · `managerId ← employee_id` · `startDate ← date_of_birth` (sensitive) · `shippedAt / deliveredAt ← last_scan_at` · `ticketId ← show_id` · `attendeeEmail ← buyer_email` |
| Gemini Nano: availability | 4 / 4 `AVAILABLE`, real on-device. 35–63 s per source. **0 cloud requests**, so no substitution |
| Nano: role interpretation (41 rows, my reading against the data dictionary) | 31 correct · 8 wrong · 2 ambiguous (phone as identifier). Wrong: email columns called “Identifier” (3), categories called “Identifier” or “Organization” (4), a summary called “Identifier” |
| Nano: deterministic validation | Rejected 12 rows. 6 of them were wrong, but 6 were correct and rejected anyway (conservative). Two wrong roles were not rejected (`e_mail`: Identifier “consistent”; `tier`: Organization “applicable”) |
| Nano: effect on the integration | Applying every applicable suggestion changed **0** guided field-match suggestions (4 / 4). Nano does not improve guided mapping today |
| Nano: adversarial records (X15) | Instruction-like and secret-shaped strings changed nothing: no request, no approval, no status change, normal roles |
| Gemini Cloud | **NOT RUN**: the approval package is in § 9. AI vs local-only for mapping proposals is therefore **unmeasured** in this sprint |
| Provenance accuracy | Every built result is labeled “built on this device from your answers — no AI” (`data-origin="local"`). No simulated output was labeled as Gemini. Nano rows were labeled real on-device |

## 6. Privacy and security

| Check | Result |
| --- | --- |
| `generateContent` requests across 62 journeys + 4 Nano runs | **0** |
| Canary in any request URL or body, console line, page error, `localStorage` / `sessionStorage` | **0** (IndexedDB: no databases) |
| Non-GET or cross-origin requests during the matrix | 2: the user-initiated REST GETs (R02, R03), no body |
| ZIP: canaries / distinctive source field names / binding paths / source values / sensitive columns / adversarial strings / `bindings.local.json` | **0 / 0 / 0 / 0 / 0 / 0 / 0** |
| ZIP: generic word matches (a source key equals a destination field name or package vocabulary: `phone`, `currency`, `title`, `name`, `notes`, `destination`) | 133, reported separately. Each one was decoded and traced before classification; none is a disclosure |
| Category names in the ZIP | only after the explicit per-field opt-in. Without it, the package is blocked (seen in every enum case) |
| Formula-like text | preserved exactly in JSON. **0** unescaped formula cells in the transformed CSV (X13, X15) |
| XLSX | formulas not evaluated (cached values used), hidden sheet flagged, error cell reported (X14 PASS) |
| Prompt-injection text in records | inert (X15 PASS: 10 / 10 correct, 0 requests, ZIP clean) |
| Approval single-use, stale or modified requests, decline sends nothing, no automatic cloud fallback, invalid model output rejected | not re-tested live (no cloud budget). Covered by the unchanged deterministic suites: privacy 91, E2E 151 (E2E-140…153), production P-020 (declining sends nothing, re-run here) |

**Unauthorized disclosures: 0. Stale approvals accepted: 0 (none possible: no request was prepared). No P0.**

## 7. Experience (automated, not human)

- Median time to the first buildable mapping is 0.9 s, and to all downloads 1.4 s. These are machine timings.
- A built journey needed a median of 15 explicit decisions (minimum 5, maximum 28): field confirmations, translations, date order and type choices.
- 0 console errors and 0 page errors.
- Confusing or blocked interactions:
  - D1 (clearing has no effect);
  - D3 (the guidance points at the mapping, where the value is not);
  - D4, L2 (columns disappear without a reason).
- **Usability with real people: NOT PERFORMED**, so no human time-to-value claim can be made.

## 8. Failures

Full detail, reproductions and minimal fixes: [evidence/sprint-16a/failures.md](../evidence/sprint-16a/failures.md).

| Id | Sev | Layer | Kind | Summary | Cases |
| --- | --- | --- | --- | --- | --- |
| D1 | P1 | UI_STATE | defect | Clearing a pre-selected match re-applies it, so the output carries a field the user removed, marked VERIFIED | R02, X17 (+ domain repro) |
| D2 | P1 | FIELD_DISCOVERY | defect | 14 / 61 pre-selections were wrong (including a sensitive DOB). The headline and package say ready / VERIFIED while meaning is unverified | A1-D, C1-D, E1-D, G1-D, X17 |
| D3 | P1 | EXPORT | defect | The scan matches ordinary words (`failed`) from unmapped columns against the package's own report text, so the ZIP is blocked with misleading guidance | F1, F2, F1-D (+ domain repro) |
| D4 | P1 | FIELD_DISCOVERY | defect | Spaced or punctuated headers are silently unusable | X12 |
| L1 | P1 | SEMANTIC_MAPPING | limitation | An absent optional value fails the record | C1–3, E1–3, X27 |
| L2 | P2 | FIELD_DISCOVERY | limitation | One `n/a` disables a date column, without a reason | X18 |
| L3 | P2 | SOURCE_ADAPTER | limitation | Locale numbers/dates and two-decimal text amounts | X23, X24 |
| L4 | P2 | SOURCE_ADAPTER | limitation | One depth-5 branch refuses the whole source | X16 |
| L5 | P2 | FIELD_DISCOVERY | limitation | A single record cannot fill a category field | X03 |
| L6 | P3 | — | documented | Arrays cannot be mapped | R02, R03 |

Unconfirmed observations: none outstanding. Every scan match was traced. Harness bugs and one wrong expectation of mine (R03) are listed in `failures.md`. They were corrected before the production run and are not product defects.

## 9. Gemini Cloud approval package (not executed)

No cloud request was sent. This sprint brief does not authorize one, and none is needed for the decision. To measure AI vs local-only, the owner may approve:

| Item | Proposal |
| --- | --- |
| Budget | **3** requests in total, one per case. No retries. A failure is reported, not repeated |
| Cases | S16A-H2 (priority vs severity, mixed languages, CSV) · S16A-C3 (HR with sensitive distractors, ambiguous dates, XLSX) · S16A-G1 (category collisions `VIP` / `vip` / `Vip`) |
| Route | Deployed URL. Production reCAPTCHA App Check, never a debug token. A human clicks **Approve and send** after reading the exact preview |
| Disclosed | Alias-level twin (`f_NN`), destination schema and, for the one chosen field per case only, its category names after the explicit opt-in. Never records, values or source field names |
| Measured | proposal validity · `convertProposal` result · unsupported ops · invalid aliases · `inferenceSource` · latency · semantic match vs. the oracle · export eligibility · difference from the local build of the same case |
| Stop rule | Any canary or private term in the request body, any request without approval, or App Check refusal: stop and report |

## 10. Generalization findings

1. **The engine, contracts and package generalize well when the user maps the fields.** Across eight unseen sectors, three formats, four languages and adversarial content, there were 0 wrong values, 0 silent drops, 0 invented values and 0 privacy leaks. Exports are portable and reproducible in 43 / 43.
2. **Field discovery does not generalize to unfamiliar naming.** EYES leaves 62 % of destination fields for the user. When it does pre-select, 23 % of picks are wrong, and the pre-selection cannot be removed (D1). The weak link is the step between “valid” and “correct”.
3. **Real-world file conventions** hit undisclosed edges: spaced headers (D4), locale and two-decimal amounts (L3), a single dirty value (L2), absent optional values (L1), and deep JSON (L4). Each one fails safe (blocked or flagged, never wrong), but several fail **silently**.
4. **Gemini Nano** runs genuinely on device and stays inside the privacy boundary. It has no measurable effect on the guided integration today.

## Decision

**`SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`**

**Why not `BLOCKED_BY_CRITICAL_DEFECTS`?**

- There is no P0: zero disclosures, zero unapproved requests, App Check enforced.
- No validation bypass was found.
- When the user answers the questions, every transformed record matches independent ground truth, and every exported package runs identically outside the app.

**Why not `SUBMISSION_READY`?**

- **D1** silently ignores an explicit user decision and yields `VERIFIED` packages with invented or wrong fields.
- **D2** makes the click-through path wrong in 5 of 9 cases (8 probes + X17).
- **D3** blocks a legitimate export with misleading guidance.

All three are reproducible and have small, local fixes. They are **not** fixed on this branch: they need owner review, and a deployment needs approval of the exact SHA.

**What the submission may claim:** “EYES builds integrations whose structure is verified and whose meaning is verified for every field you confirm.” It should not claim to reliably infer which source field is which on unfamiliar data.

**Minimum before Devpost, in this order:**

1. Fix D1: an explicit empty choice in `planFields`, with regression tests. About 20 lines.
2. Fix D3: package vocabulary is not private, with a positive control that real values are still caught.
3. Gate D2: no pre-selection without format or uniqueness evidence, or one confirmation per pre-selected row. And no “Integration ready” headline while copied fields are unconfirmed.
4. Disclose L1, D4, L3 and the “runner reads JSON” point in the README and Devpost text.

Then run the full regression, `build:release`, get approval of the exact SHA, deploy, run `pnpm test:production`, and re-run this matrix (`EYES_QA_CASES` for X17, R02, F1, F2 and the probes).

## Final question

> *Can Eyes Without a Face reliably transform unfamiliar real-world-style data into correct, privacy-preserving, reusable integrations, and what evidence proves that claim?*

**Partly.**

- **Privacy-preserving and reusable: yes, with strong evidence.** On the deployed build:
  - 62 production journeys and 4 real-Nano runs sent 0 model requests;
  - 0 canary appearances anywhere outside the user's own download;
  - 43 / 43 packages are integrity-checked, dependency-free, reproducible, and identical to the in-app output when run outside EYES.
- **Correct: yes, when the user tells EYES which field is which.** 2,079 / 2,079 comparable records are exact against an oracle that never ran EYES code. Every broken record was flagged rather than repaired.
- **Reliable for an unfamiliar developer who accepts EYES' suggestions: no.**
  - 3 / 8 click-through probes are correct.
  - The UI can label wrong output “Integration ready” / VERIFIED.
  - A user's attempt to remove a wrong match is ignored (D1).
  - Common real-world file conventions are unsupported, and some fail silently.

Fixing D1–D3 and narrowing the headline would make the stronger claim defensible.

## Checks run for this sprint

| Suite | Result |
| --- | --- |
| `pnpm lint` | PASS (0 warnings after harness fixes) |
| `pnpm typecheck` (now including `tests/qa`) | PASS |
| `pnpm test:unit` / `contracts` / `privacy` / `evaluation` | 362 / 43 / 91 / 84 PASS (unchanged; frozen benchmarks untouched) |
| `pnpm build`, `pnpm test:e2e` | PASS, 151 / 151 |
| `pnpm test:production` (served `c4a246c`) | 19 / 19 PASS |
| Sprint 16A matrix (production) | 62 journeys executed, statuses above |
| Domain reproductions (`vitest.qa-16a.config.ts`) | 3 / 3. They assert the current defective behaviour (D1, D3) plus a control |

Usability with participants, screen-reader pass, Gemini Cloud: **NOT RUN.** Sprint 16B was not started.
