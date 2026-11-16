# Sprint 16B — Mapping integrity, trustworthy verification and production hardening

**Date:** 2026-11-16 · **Branch:** `sprint-16b-mapping-integrity`, from `origin/main` @ `d5f2914` (merge of PR #18, Sprint 16A) · **Kind:** bounded corrective sprint. No new capability, AI workflow, mapping operation, integration or contract change.

**Release status: `DEPLOYMENT_PENDING`.** The release candidate is built from a clean tree and passes `verify:release`. Production still serves `c4a246c` (`PRODUCTION_ACCEPTED`, Sprint 15). Nothing was deployed. The exact release-candidate SHA and artifact identity are recorded in [§ 10](#10-release-candidate-and-approval-package), after the commit that contains this report.

## 1. Starting state (verified)

| Item | Value |
| --- | --- |
| `origin/main` | `d5f2914`. The brief said `7d53fb2`, with Sprint 16A unpushed. In fact Sprint 16A (`2158c72`) was pushed and merged as PR #18 |
| Production | `build-info.json`: `c4a246cee432…`, `mode: production`, `appCheckDebug: false` |
| Baseline tests | 731 pass: 362 unit, 43 contract, 91 privacy, 84 evaluation, 151 E2E |
| Sprint 16A harness | Generator, oracle, browser driver, verifier and the frozen 62-case dataset, with its original canaries, intact in `qa-artifacts/` (gitignored). Reused unchanged, except two harness adaptations (§ 6) |

## 2. Root causes (confirmed)

| Defect | Root cause | How it was confirmed |
| --- | --- | --- |
| **D1** clearing a field was ignored | `guidedMatch` deleted the decision key; `planFields` read a missing key as "undecided" and re-applied the top-ranked suggestion. There was no state for "the user chose no field" | Code trace; `S16B-001` fails on the old code |
| **D2** suggestions became mappings | `planFields` set `chosen = candidates[0]` with `chosenBy: "suggested"` for every non-category field, and `localContract` built a rule from it. Suggestions also needed no specific evidence (any string could be "suggested", for example `Phone` for an email field). The guided headline `VERDICT.VERIFIED` said "Integration ready" whatever the meaning coverage | Code trace; `S16B-002/003` (6 named cases) fail on the old code |
| **D3** ordinary word blocked export | `scanPackageFiles` compares every private value with every JSON key (exact) and string (substring) and the whole README text. F1's unmapped value `failed` equals the report's **schema key** `realityCheck.failed`. *Correction to Sprint 16A, which guessed a string value.* The class is wider than measured: `approved`, `verified`, `review`, `unknown`, `pass` occur in the README and manifest, and `resolved` occurs inside the sentence "…are unresolved…" | Traced on a real report; `S16B-D3-001` fails on the old code |
| **D4** spaced headers vanished | The profiler excludes non-identifier names (`UNSUPPORTED_FIELD_NAME`, a *warning*). The guided data screen showed only *blocking* issues, so exclusions were invisible. Arrays, mixed types and all-null fields vanished the same way (this also explains X17) | Code trace; `S16B-005/007`, E2E-161/162 |

## 3. Changes

**Files changed**

- **App:**
  - `src/app/guided/field-plan.ts`, `FieldQuestions.tsx`, `DestinationStep.tsx`, `DataStep.tsx`, `guided-status.ts`;
  - `src/app/App.tsx`, `workspace-state.ts`, `runtime-model.ts`, `ExportPanel.tsx`, `ConnectView.tsx`, `DestinationPanel.tsx`.
- **Export:** `src/export/package.ts`, `eligibility.ts`.
- **New files:** `src/export/provenance.ts`, `src/app/guided/excluded-fields.ts`, `src/verification/policy-text.ts`.
- **Docs:** `AGENTS.md` § Mapping integrity, `docs/contracts/source-adapter.md` § Field names, README, Devpost draft.
- **Unchanged:**
  - Mapping Contract, Export Contract 1.1.0, export runtime bundle, engine, cloud request path, App Check;
  - frozen benchmarks (`outcomes.ts` was edited by mistake, caught by the freeze test, and reverted);
  - packaged bytes: 42 / 42 files identical before and after on three packages.

**A — D1, explicit deselection.**

- `fieldMatches: Record<string, string | null>`, with three states:
  - no entry = undecided;
  - a path = chosen;
  - `null` = "No field".
- `null` survives replanning, hides the suggestion, omits an optional field and blocks a required one ("required — choose a field").
- "Not decided" returns a row to undecided.

**B — D2, a suggestion is never authority.**

- **No silent rules.** A non-category field gets a rule only from an explicit choice. The ranked candidate becomes `suggested`, offered with a per-row **Use …** button (there is no bulk confirm), and the target's need is `"confirm"`.
- **Category fields are unchanged.** They still require a complete per-value translation of the specific field, which is an explicit decision.
- **Evidence for a suggestion.** A suggestion needs specific evidence (`SourceCandidate.specific`): email share, a date type, unique codes for an id (never an email column), a numeric or boolean type, or a similar name. Ranking itself is unchanged and was *not* tuned on the 16A held-out data.
- **Decisions belong to a destination.** `withDestination` keeps a decision only if that destination field's name, type, format, allowed values and required flag are unchanged.
- **Headline.** "Integration ready" appears only when meaning was verified for every field. Otherwise it says **"Structure verified"**, who chose the matches, and "Meaning was verified for N of M fields". Status ids are unchanged.
- **Export panel.** It says VERIFIED means structure and policy, not business meaning. The Export Contract is unchanged.
- **Field-matches panel.** It opens, and stays open, when a decision is needed.

**C — D3, privacy scan by provenance (`src/export/provenance.ts`).**

- **README.** It is an `owned` tagged template: literal parts are application-owned by language semantics. Codes and counts are `appCode`. Findings and limitations are owned only if their skeleton matches a template.
- **Fixed-schema JSON files** (manifest, report, policy, package.json, expected outputs, mapping and declarations wrappers):
  - Keys and code values are masked only at **exact paths**. The manifest's key paths are derived mechanically from `export.v1.1.schema.json`.
  - Labels, approved fallback/default values, fixture outputs, separators and defaults are never masked.
- **Sentence skeletons** come from the same tables that build the sentences (`ELIGIBILITY_TEXT`, `LIMITATION_TEXT`), so the recognizer cannot drift from the text.
- **What the scan reads.** Private values are searched in the masked `scan` text. Secrets, canaries and source field names are judged on the full text. A file without provenance is scanned exactly as before (fail-closed).

**D — D4, containment.**

- **Data screen.** `excludedFields` lists every field the mapping cannot use, with its reason (name, list, mixed types, empty) and, for names, the rule plus a rename example (`Customer ID` → `customer_id`). It stays local and EYES never renames anything.
- **Destination step.** It notes how many fields are unavailable.
- **Contract docs.** The source-adapter contract documents the rule. Bracketed paths are a post-hackathon contract change.

## 4. Tests

| Suite | Before | After | New / changed |
| --- | --- | --- | --- |
| Unit | 362 | **378** | `S16B-001…007` (16 cases). `sprint15-field-plan` now confirms fields explicitly; its ranking assertions are kept, and "suggested = applied" became "suggested, not applied" |
| Contracts | 43 | **43** | — (EXP-007 runtime freshness passes) |
| Privacy | 91 | **99** | `S16B-D3-001…003` (8 cases), including positive controls. `sprint15-privacy` gives explicit field choices |
| Evaluation | 84 | **84** | frozen, unchanged (freeze test caught and reverted an accidental edit) |
| E2E | 151 | **155** | E2E-160 (R02), 161 (X17), 162 (X12), 163 (F1). Sprint 15 journeys choose fields explicitly; E2E-150 now also asserts "suggestion shown, nothing built" |
| **Total** | **731** | **759** | all pass; lint 0 warnings; typecheck PASS; build PASS |
| QA reproductions (`vitest.qa-16a.config.ts`) | 3 | 4 | flipped to assert the fixed behaviour |

**Failing before, passing after** (run against the old source with `git stash`):

- S16B-001/002/003: 10 of 11 failed before. The 11th is the positive control: a correct, confirmed mapping.
- S16B-D3-001 failed before. Its positive controls passed both before and after, as they must.

**Positive privacy controls (all PASS):**

- **Still blocked:**
  - the same ordinary word placed in a user-derived position (a mapping default `approved`);
  - a dataset-specific canary in a user-derived field;
  - the application canary;
  - an unapproved label used as a mapping key;
  - a README with a private value in an interpolated (user-derived) part.
- **Still fail-closed:** files without provenance.
- **Unchanged and passing:** the existing PRIV-090…095 tests.

## 5. Before / after on the same 62 inputs

- **BEFORE:** Sprint 16A on deployed `c4a246c` (production).
- **AFTER:** the release candidate served **LOCALLY** (`vite preview` of `pnpm build:release` output). **Not production evidence.**
- **Unchanged:** inputs, canaries, oracle and verifier.
- Full table: [evidence/sprint-16b/before-after.md](../evidence/sprint-16b/before-after.md). Metrics: [before-after.json](../evidence/sprint-16b/before-after.json).

| | Before | After |
| --- | --- | --- |
| PASS / FAIL / PARTIAL / UNSUPPORTED (62) | 39 / 10 / 7 / 6 | **43 / 4 / 7 / 8** |
| R02: optional field cleared by the user | `statusText` invented in 11 / 11, "Integration ready", VERIFIED | **PASS**: absent in data and ZIP |
| X17: true id column unusable | email copied into `customerId` in 10 / 10, "Integration ready" | **blocked**; column listed as "mixes kinds of values"; nothing used in its place (UNSUPPORTED) |
| F1 / F2 / F1-D | ZIP refused by the scan | **PASS**: ZIP exported, `verify` OK, 23 / 23 and 72 / 72 records exact |
| X12: spaced headers | silently unusable; `Phone` suggested for id, email and company | **listed** with reason and rename example; no incompatible suggestion (UNSUPPORTED, contained) |
| Click-through probes | 3 / 8 correct; wrong data silent; G1-D "Integration ready" | **4 / 8 correct**; every wrong field entered by an explicit "Use …" click; 0 "Integration ready" (see § 7) |

Before and after are not identical tasks for the probes. *Before*, the user did nothing and EYES applied its picks. *After*, the probe clicks "Use" on every suggestion: the most generous click-through model now that acceptance is explicit.

### Acceptance gates

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 No ignored explicit field decisions | **PASS** | 0 / 246 non-category fields pre-selected; 0 exported rules without an explicit decision in 45 built integrations; R02, X17, E2E-160/161, S16B-001 |
| 2 No misleading verified-meaning claims | **PASS (with a disclosed residual)** | "Integration ready" over wrong data 3 → **0**; all such headlines 17 → 0. Residual: G1-D's package is `VERIFIED` (the structural Export Contract status, unchanged) after the user clicked a wrong suggestion; see § 7 |
| 3 No unauthorized disclosures | **PASS** | 0 `generateContent`; 0 canaries outside the page; 0 ZIP leaks in 45 packages |
| 4 No new invalid mappings accepted | **PASS** | 0 wrong values with confirmed fields; validator and contracts unchanged |
| 5 No regression in previously correct confirmed mappings | **PASS** | 2,079 → 2,174 records exact (F cases now export); no PASS case regressed |
| 6 Previously successful exports remain portable | **PASS** | 42 / 43 still portable. X17's earlier ZIP encoded email-as-id; it is correctly no longer produced, because its confirmation cannot be satisfied. 45 / 45 packages verify, integrity, reproducibility and app ↔ runner agreement |
| 7 D3 false positives resolved, positive controls pass | **PASS** | blocked by scan 3 → 0; controls in § 4 |
| 8 No features or contract changes without review | **PASS** | no new operation, workflow, integration or contract version; Export Contract and runtime bundle unchanged |

## 6. Privacy checks and harness notes

- **Verifier change.** My independent verifier's raw value scan (Sprint 16A) now sees the F-case ZIPs, because they export. It matched `failed` in `run.mjs` (static runner usage text) and in the report key.
  - **Traced:** the value is from the unmapped `estado_aviso` column, and both occurrences are application text.
  - **Change:** the verifier now classifies a value hit as package vocabulary only when the same file of a **control package built from other data** also contains it. This logic is independent of EYES' own provenance code.
  - **Guard:** re-verifying the original Sprint 16A production run with the updated verifier gives identical totals (39 / 6 / 10 / 1 / 6).
- **Harness adaptations to the new UI:**
  - A suggestion is read from the "Use …" button.
  - The click-through probe clicks it.
- **The oracle and expected values were not changed.**

## 7. Remaining limitations and known semantic limits

- **Suggestions are still often wrong.** The ranking is unchanged and was not tuned on held-out data. The four wrong probe picks (`legacy_crm_id`, `employee_id`, `show_id`, `last_scan_at`) mostly win on the generic name token `id`.
  - EYES now never applies them, and it labels them "a suggestion, not proof of meaning".
  - A user who clicks "Use" without checking the preview still gets wrong values.
  - Fixing the ranking needs fresh held-out data.
- **`VERIFIED` package status is structural.**
  - In G1-D, a user-confirmed wrong field yields a `VERIFIED` package and the headline "Structure verified" (with "Meaning was verified for 2 of 6 fields").
  - A contract-level qualifier (for example a meaning-coverage field in the status) would be an **Export Contract change**. It is not implemented, and it needs review: compatibility impact on `run.mjs`, manifest validation and existing packages.
- **Unchanged from Sprint 16A:**
  - L1 absent optional values fail the record;
  - L2 one dirty value disables a date column (still not explained);
  - L3 locale numbers and dates, two-decimal text amounts;
  - L4 depth > 4;
  - L5 single-record categories;
  - L6 arrays.
- **D4 is contained, not fixed.** Arbitrary column names need bracketed paths: a contract change, post-hackathon.
- **Gemini Nano** still does not influence guided field matching (16A finding).
- **Usability with participants and the screen-reader pass:** NOT PERFORMED.

## 8. Gemini

- **No cloud request** was sent this sprint, and none was authorized.
- **No Nano run** this sprint: the fixes are deterministic and proven by deterministic tests.
- **Cloud path unchanged.** Its code path, disclosure gate and approval logic did not change. Cloud readiness (`categoryNeed`) reads the same enum decisions as before.
- **The genuine-model acceptance procedure stays:** `pnpm test:production:real`, with 1 approved cloud request and real Nano, after an approved deployment.

## 9. Not run

| Check | Status | Why / next action |
| --- | --- | --- |
| `pnpm test:production` on the new build | NOT RUN | needs the approved deployment of the exact SHA |
| `pnpm test:production:real` (1 cloud request + Nano) | NOT RUN | after deployment, within the documented budget, by an owner session if App Check refuses automation |
| 62-case matrix against production | NOT RUN | after deployment: `EYES_EXPECTED_SHA=<sha> pnpm exec playwright test -c playwright.qa-16a.config.ts`, then `verify.mjs --run production-16b` and `compare.mjs --after production-16b` |
| Usability sessions, screen reader | NOT PERFORMED | no participants |

## 10. Release candidate and approval package

- **Build.** The candidate is built by `pnpm build:release` from the clean commit that contains this report.
- **Recorded after the build.** Its SHA, `build-info.json`, file count and size, and the LOCAL matrix result on that exact artifact are recorded in [evidence/sprint-16b/release-candidate.md](../evidence/sprint-16b/release-candidate.md).
- **Approval package:**

| Item | Value |
| --- | --- |
| Firebase project | `eyes-without-a-face-b7281` |
| Domain | <https://eyes-without-a-face-b7281.web.app> |
| SHA | the exact SHA in `release-candidate.md` (approval applies to that SHA only) |
| Changed behaviour | explicit field decisions (no silent mapping, "No field"), honest headline, provenance-aware export scan, excluded-column list |
| Configuration changes | **none**: no Firebase, App Check, reCAPTCHA, hosting-rule or key change |
| Risk | users must now confirm each non-category field (one more click per field); wrong suggestions remain possible but are never applied silently |
| Rollback | Firebase Hosting → release history → roll back to `c4a246c` (last `PRODUCTION_ACCEPTED`) |
| After deployment | `pnpm test:production` (P-024 updated for explicit choices) → 62-case matrix → `test:production:real` within budget |

**Do not deploy without the owner's explicit approval of that SHA.**

## 11. Residual submission risks

1. **Wrong suggestions.** A click-through user can still confirm a wrong suggested field. The product now makes that an explicit act, with "a suggestion, not proof of meaning" and a "Structure verified" headline. The Devpost text says so.
2. **Structural `VERIFIED`.** The package status can say `VERIFIED` over semantically wrong but user-confirmed data (§ 7). It is explained in the UI and the manifest notes, not in the status value.
3. **Not production-proven yet.** Everything above was proven locally on the release candidate. Production acceptance is pending deployment approval.
4. **Unchanged limits.** The 16A limitations (L1–L6, D4 containment) remain and are disclosed in the README and Devpost.

The work predating the submission period is still disclosed unchanged ([hackathon-history.md](../hackathon-history.md); Devpost "Development during the submission period").
