# Sprint 16A — failure report

Served build: `c4a246cee432` on <https://eyes-without-a-face-b7281.web.app> (Chromium 1.65 headless for the matrix; installed Chrome with the dedicated Nano profile for the Nano subset; Linux 7.0). All data fictional or public. **No P0.** No unauthorized disclosure was observed (see the privacy section of the report).

Severity: **P0** stop-ship (privacy, validation bypass) · **P1** fix or disclose before Devpost · **P2** disclose · **P3** note.
Kind: **DEFECT** (the product does something wrong) · **LIMITATION** (the product honestly cannot do it).

## P1 — defects

### S16A-D1 · A pre-selected field match cannot be removed (UI_STATE)

- **Cases:** S16A-R02 (TfL, public), S16A-X17. Domain reproduction: `tests/qa/s16a-repro.test.ts` (`S16A-D1`).
- **Expected:** choosing “Leave empty” (optional) or “Choose…” (required) in *Field matches* removes the mapping for that destination field.
- **Observed (production):**
  - R02: the user cleared `statusText ← name`. The build still wrote `statusText` = the line name in **11/11** records. The headline was “Integration ready” and the package `VERIFIED`.
  - X17: the user cleared `customerId ← contact_email`. The build still copied the email into `customerId` in **10/10** records, also “Integration ready” and `VERIFIED`.
- **Root cause (code):**
  - `guidedMatch` (`src/app/App.tsx:458`) deletes the key when the value is empty.
  - `planFields` (`src/app/guided/field-plan.ts:343`) then treats the target as undecided and re-applies the top-ranked suggestion.
  - There is no state for “the user chose nothing”.
- **Minimal fix:**
  1. Record an explicit empty choice, for example `fieldMatches[target] = ""`.
  2. In `planFields`, treat `""` as `chosen = null, chosenBy = "user"`.
  3. Add a unit regression first: flip `S16A-D1`. Add an E2E test: clear a suggested optional field, build, and check the field is absent.
- **Workaround today:** the technical view's mapping editor.

### S16A-D2 · Pre-selected source fields are often semantically wrong and still build “ready” output (FIELD_DISCOVERY)

- **Cases:** accept-defaults probes S16A-A1-D, C1-D, E1-D, G1-D; also X17 and X12.
- **Evidence:** across 24 scenario variants (162 destination fields), EYES pre-selected:
  - a source for **61** fields, of which **14 were wrong**;
  - nothing for 101 fields.
- **Wrong pre-selections seen:**
  - `ticketId ← show_id`: the event code, repeated across tickets. 38/38 ids wrong, headline “Integration ready”, package `VERIFIED`.
  - `managerId ← employee_id`: every employee is their own manager.
  - `customerId ← legacy_crm_id`.
  - `shippedAt` / `deliveredAt ← last_scan_at`.
  - `attendeeEmail ← buyer_email`.
  - `startDate ← date_of_birth`, a **sensitive** field that would be published to a directory.
- **Probe results:** 3 of 8 click-through probes are correct. The others give 150 wrong-value records out of 233 compared.
- **What is honest today:**
  - The row says “suggested”.
  - “Meaning, field by field” says “Copied from X unchanged … EYES has no way to check what it means”.
  - The before/after preview shows the values.
- **What overclaims:** the headline “Integration ready” and the package status `VERIFIED` are structural. They are presented while the meaning of most fields is unverified.
- **Contributing:** the true id column in X17 was excluded from the candidates because one row held a number. The exclusion is not explained on the data screen.
- **Minimal fix (no new feature):**
  1. Do not pre-select a non-enum destination field unless there is format evidence (email, date) or a unique, code-like match. Identifier and plain-text targets should start undecided, like fixed-list fields already do.
  2. Or keep the pre-selection but require one confirmation click per pre-selected row before “Build on this device”.
  3. In either case, word the headline “Structure verified — confirm field meaning” while any copied field is unconfirmed.

### S16A-D3 · Export privacy scan false positive on ordinary words (EXPORT)

- **Cases:** S16A-F1, F2, F1-D (3 of 46 built journeys). Domain reproduction: `tests/qa/s16a-repro.test.ts` (`S16A-F-EXPORT-FP`), with its control.
- **Observed:** the transformed data is correct (22/22 and 71/71). The reusable `.zip` is refused with `PRIVACY_SCAN_FAILED` (private value in `reports/validation-report.json`).
- **Cause:**
  - `scanPackageFiles` (`src/export/package.ts`) matches every private string of 4 or more characters as a lower-case **substring** of every JSON string.
  - The source holds the word `failed` in an **unmapped** column (`reminder_status`).
  - The package's own validation report contains the word `failed`.
- **Misleading guidance:** the message tells the user to “remove the private value from the mapping”. The value is not in the mapping, so the user has no way out.
- **Minimal fix (must not weaken the scan):**
  1. Skip the package's own fixed vocabulary only: field keys and status words that every package contains.
  2. Or check only the user-derived strings in the report against private values.
  3. Keep the canary, field-name and secret checks unchanged.
  4. Add a regression from this reproduction, plus a positive control that a real private value is still caught.

### S16A-D4 · Column names with spaces or punctuation are silently unusable (FIELD_DISCOVERY)

- **Case:** S16A-X12. These headers come straight from a typical CRM/Excel export: `Customer ID`, `Contact Email`, `Account Status`, `Opened On`, `Company Name`, `Phone`.
- **Observed:**
  - Only `Phone` is usable.
  - It is pre-selected for `customerId`, for `primaryEmail` (“as a lower-case email ✓”) and for `companyName`.
  - The status and date questions say “None of your fields …”.
  - The data screen reports nothing.
- **Cause:** the profiler accepts only identifier-like field names (`UNSUPPORTED_FIELD_NAME`), and the guided flow does not surface that.
- **Minimal fix:**
  1. Short term: show the excluded columns and the reason on the data screen (“rename columns to letters, digits and _”).
  2. Disclose the limitation in the Source Adapter contract.
  3. A real fix (bracketed paths) is a contract change for a later sprint.

## P1 — limitation

### S16A-L1 · An absent optional source value fails the record (SEMANTIC_MAPPING)

- **Cases:** S16A-C1–C3 (managerId), E1–E3 (deliveredAt), X27 (phone). **238** records were flagged.
- **Business expectation:** transform the record and omit the optional field.
- **Observed:** the record is “needs attention” (`MISSING_SOURCE_FIELD`).
- **What was not violated:** no wrong value, no silent drop, and the runner agrees with the app.
- **Disclose:** “Optional fields must be present in every source record, or left out of the mapping.” A real fix needs a DSL change.

## P2 — limitations (disclose)

| Id | Case | Observed | Note |
| --- | --- | --- | --- |
| S16A-L2 | X18 | One `n/a` in a date column removes the column from the `createdOn` candidates | The data screen says nothing. Expected: 14 transformed, 1 flagged. |
| S16A-L3 | X23, X24 | `1234,50` / `15.03.2026` and two-decimal text like `1234.50` cannot become numbers or dates | No type choice is offered: “lossless” rules out `1.50 → 1.5`. Accounting exports always look like this. |
| S16A-L4 | X16 | One branch deeper than 4 levels refuses the whole source | The message is clear. Excluding just that branch would be enough. |
| S16A-L5 | X03 | A single-record source cannot fill a fixed-list field | `distinctLabels` needs at least 2 distinct values. |

## P3 — documented behaviour, recorded

- **S16A-L6** (R02, R03): values inside arrays (`lineStatuses[]`, GeoJSON `features[]`) cannot be mapped. A single JSON object loads as one record, as documented.
- **Runner input:** the portable runner reads JSON only. For CSV/XLSX sources, the user must convert the rows themselves, including any type choice made in the app. This is said on screen. Our replay used independently converted JSON and matched in 43/43.
- **Nano:** applying its suggestions changed **no** guided field-match suggestion (4/4 cases). Nano currently improves twin roles only.

## Harness defects found and fixed during the sprint (not product defects)

- **Duplicate-id generator ordering:** crashed. Fixed before any production run.
- **Invalid-date injection:** `31/02/2025` in a month-first column would have disabled detection. Fixed: the injection is now rendered per convention.
- **ZIP scanner:**
  - It initially counted source names that equal destination field names or package vocabulary (`phone`, `currency`, `title`, `destination`) as leaks. They were traced, and are now reported separately as generic matches (133). Distinctive names stay blocking.
  - No match was hidden. Every match was decoded before reclassification (traced in the report).
- **Harness behaviour:**
  - The harness first kept a wrong default when the truth was not offered. It now clears it like a careful user. That is how D1 was found.
  - A disabled Continue button is now recorded as `PROFILE_BLOCKED` instead of a timeout (X16).
- **Wrong expectation of mine:** R03 was expected to be refused, but a single JSON object is documented as one record. The expectation was corrected before the production run.
