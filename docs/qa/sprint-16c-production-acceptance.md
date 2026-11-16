# Sprint 16C — Production acceptance, real-user validation and final reliability gate

**Date:** 2026-11-16 · **Branch:** `sprint-16c-production-acceptance` (from `origin/main` @ `489c6ba`) · **Kind:** release qualification. No feature work, and no product code changed.

**Release status of `489c6ba`: `PRODUCTION_ACCEPTED`** (2026-11-16, 14:06–14:15 UTC).

- **Deployment:** done with the owner's approval of exactly this SHA.
- **Checks on the public URL, all passed:**
  - 19 / 19 deterministic checks;
  - the 62-case matrix, identical to the local baseline case for case;
  - 45 / 45 exports verified independently;
  - 13 / 13 automated access checks;
  - real Gemini Nano;
  - one approved real Gemini Cloud request, the full budget.
- **Rollback target:** `c4a246c`.

**Readiness decision: `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`** (§ 15). Independent human usability sessions and a manual screen-reader pass are NOT_RUN and must be disclosed.

Evidence labels used throughout:

| Label | Meaning |
| --- | --- |
| **LOCAL** | release artifact served on this machine |
| **PRODUCTION_DETERMINISTIC** | deployed URL, no inference |
| **PRODUCTION_REAL_MODEL** | deployed URL, real Gemini Nano or Cloud |
| **HUMAN_OBSERVED** | an independent person was observed |
| **MOCKED** | a labeled simulated adapter |
| **NOT_RUN** | not performed |

## 1. Starting state (verified, not assumed)

| Item | Value |
| --- | --- |
| Sprint 16B | **Already merged**: PR #19, merged by the owner at 2026-11-16 13:11 UTC; merge commit **`489c6baaf18bf22d146e583752eecc343ed3d986`** (parents `d5f2914`, `b638e16`) |
| Merge content | Tree identical to the reviewed branch head `b638e16` (`git diff` empty). App code identical to the Sprint 16B release candidate `25c5eeb` |
| CI on the merge | GitHub Actions “Quality gates”, run 43873452242: **success** |
| Production | `build-info.json`: `c4a246cee432…`, `mode: production`, `appCheckDebug: false`, HTTP 200 |
| Worktree | clean, apart from an untracked `.cursor/` folder the agent did not create and left alone |

## 2. Phase A — integration and release candidate

**A1 review of Sprint 16B (mechanical):**

- **Files changed:** only `src/app/**` (guided flow, state, status), `src/export/package.ts`, `eligibility.ts`, the new `provenance.ts` and `src/verification/policy-text.ts`.
- **Untouched** (`git diff d5f2914 489c6ba` is empty for each):
  - engine and contracts: `src/domain`, `src/proposal`, contract schemas;
  - cloud path: `src/twin`, `src/inference`;
  - `src/sources`, `src/semantics`, `src/revision`;
  - export runtime and runner: `src/export/runtime`, `src/export/package/run.mjs`;
  - frozen `outcomes.ts`;
  - `package.json`, lockfile, `firebase.json`, `public/`, `vite.config.ts`.
- **Frozen benchmarks:** the evaluation suite's freeze tests pass (84 / 84).
- **The D1–D4 fixes and their regressions** are documented in [sprint-16b-mapping-integrity.md](sprint-16b-mapping-integrity.md); all are present on `main`.

**A2:** not applicable. The branch was already pushed, reviewed and merged by the owner, and CI is green.

**A3, definitive release from a clean, isolated checkout of `489c6ba`:**

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | OK |
| lint · typecheck · unit · contracts · privacy · evaluation · build · E2E | **759 / 759 PASS** (378 · 43 · 99 · 84 · 155), lint 0 warnings |
| `pnpm build:release` + `pnpm verify:release` | **PASS** (both) |
| `build-info.json` | `{"gitSha":"489c6baaf18bf22d146e583752eecc343ed3d986","dirty":false,"builtAt":"2026-11-16T13:25:14.184Z","mode":"production","appCheckDebug":false}` |
| Artifact | 31 files, 2,653 KiB (`du`: 2,712 KiB); digest (SHA-256 of the sorted per-file SHA-256 list) `247e7057e2184f3f6c1bbd715a18a804bb047b87be828ae2b3711362e22ddad2` |
| Secret scan | No local App Check debug token, no private key, no source map, no `.env` file. Two expected matches: the public Firebase web API key (documented), and the export scanner's own detection regexes, which the live `c4a246c` bundle also contains |
| Config source | Public Firebase web config from the untracked `.env` / `.env.local`, as in every previous release; `build:release` forces App Check debug off |

### Deployment approval package (approved by the owner for exactly this SHA; deployed — see § 3)

| Item | Value |
| --- | --- |
| Firebase project / domain | `eyes-without-a-face-b7281` / <https://eyes-without-a-face-b7281.web.app> |
| **Exact SHA** | **`489c6baaf18bf22d146e583752eecc343ed3d986`**. The `25c5eeb` package does not transfer. App code is identical, but the SHA and the artifact differ |
| Artifact | 31 files, 2,653 KiB, digest `247e7057…` |
| Changed behaviour vs. `c4a246c` | Sprint 16B: no silent field mapping (“Use …” per field, “No field” honoured); headline “Structure verified” unless every field's meaning is verified; export scan by provenance; unusable columns listed |
| Security impact | No change to App Check, disclosure gates, approvals, cloud payloads, privacy-scan coverage of user data, contracts or runtime |
| Expected impact | One extra explicit click per non-category field in the guided local build. Former silent wrong mappings now need a decision. Exports blocked by ordinary words now succeed |
| Rollback | Firebase Console → Hosting → release history → `c4a246c` |
| Command (after approval only) | `npx -y firebase-tools@15.35.0 deploy --only hosting --project eyes-without-a-face-b7281 -m "sprint-16c 489c6baaf18b (owner-approved)"` |
| Acceptance procedure | [../evidence/sprint-16c/production/README.md](../evidence/sprint-16c/production/README.md): identity → `pnpm test:production` → 62-case matrix + comparison → automated access checks → real Nano + 1 approved cloud request |

## 3. Phase B — production deployment and live acceptance

**Owner approval:** deploy only the verified artifact of `489c6baaf18bf22d146e583752eecc343ed3d986`, plus at most 1 real Gemini Cloud request. `main` had meanwhile moved to `9f47dec` (PR #20, docs and QA only); as instructed, it was **not** substituted.

| Step | Label | Result |
| --- | --- | --- |
| Pre-deploy integrity | — | Clean checkout still at `489c6ba`; `dist/` unchanged: 31 files, digest `247e7057…`; `verify:release` PASS; `firebase.json` as committed |
| Deploy | — | `firebase-tools@15.35.0 deploy --only hosting`, release complete at 14:06:49 UTC. No configuration, App Check, billing or policy change |
| Served identity | PRODUCTION_DETERMINISTIC | `build-info.json` = `489c6ba…`, `mode: production`, `appCheckDebug: false`; **31 / 31 served files byte-identical** to the artifact; HTTP 200 |
| `pnpm test:production` | PRODUCTION_DETERMINISTIC | **19 / 19 PASS** (Chromium plus the Firefox subset). Covers identity, App Check enforced (tokenless request refused), JSON / CSV / XLSX imports, one read-only REST GET, invalid file, approval gate (declining sends nothing), category warning, invalid destination, local build with explicit field choices (P-024), navigation, 390 px, keyboard. 0 model requests |
| 62-case matrix (Sprint 16A inputs and canaries, oracle unchanged) | PRODUCTION_DETERMINISTIC | PASS 43 · FAIL 4 · PARTIAL 7 · UNSUPPORTED 8. **0 per-case discrepancies** against the local release candidate (status, counts, per-record correctness, headline, export status, verification) |

### 62-case comparison

**Sprint 16A production (`c4a246c`) → production now (`489c6ba`):**

| Measure | `c4a246c` | `489c6ba` |
| --- | --- | --- |
| PASS / FAIL / PARTIAL / UNSUPPORTED | 39 / 10 / 7 / 6 | 43 / 4 / 7 / 8 |
| Fields pre-selected before the user acts | silently applied | 0 / 246 |
| Exported rules without an explicit decision | present | 0 (45 integrations) |
| “Integration ready” over wrong data | 3 | 0 |
| “Integration ready” headlines in total | 17 | 0 |
| Exports blocked by the scan false positive | 3 | 0 |
| Model requests | 0 | 0 |
| Canary or ZIP leaks | 0 | 0 |
| Confirmed-field records exact (wrong) | 2,079 (0) | 2,174 (0) |
| PASS cases that regressed | — | none |

**Notes on the FAIL and limitation counts:**

- **The 4 FAIL** are the click-through probes that click “Use …” on every suggestion; 4 suggestions are wrong.
- **The 129 wrong JSON values** all come from those explicitly confirmed wrong suggestions. Wrong values with correctly chosen fields: 0.
- **UNSUPPORTED** results are honest stops with a reason. They are not counted as successful integrations.

Evidence: [results-production-489c6ba.json](../evidence/sprint-16c/production/results-production-489c6ba.json), [before-after.md](../evidence/sprint-16c/production/before-after.md), [production/489c6baaf18b/](../evidence/production/489c6baaf18b/acceptance-results.json).

## 4. Phase C — genuine hybrid AI (PRODUCTION_REAL_MODEL)

| Check | Result |
| --- | --- |
| **Gemini Nano**, Sprint 16A subset (A1 nested JSON, H2 mixed-language CSV, C3 XLSX with sensitive columns, X15 prompt-injection strings) | **4 / 4 PASS.** Installed Chrome with the dedicated Nano profile. 41 rows, all labeled “Gemini Nano (real on-device)”; 17–29 s per source; **0 cloud requests**. Validator: 20 consistent, 7 applicable, 14 rejected. 38 / 41 roles identical to Sprint 16A; 3 changed between runs (model non-determinism), 2 of which the validator rejected |
| Nano's effect on guided mapping | **None, by design.** After applying the applicable suggestions, **0 / 27** destination fields were selected. Nano is advisory: it never chooses a field, and it did not improve field matching (as in Sprint 16A) |
| First Nano attempt | Harness race: the spec did not wait for the app's “Next is held while Nano runs” state, so it recorded 0 rows while Nano was still running. Fixed in the spec; product unchanged; 0 cloud requests |
| **Hybrid path** `S14-REC-3` (`pnpm test:production:real`) | **PASS, 1 / 1 request used.** Real Nano 6 / 6 fields in 15.2 s with 0 requests during Nano. One request through the app's approval card to `gemini-3.5-flash-lite`: provenance **REAL GEMINI OUTPUT · IN_CLOUD**; **0 private terms** in the request body. Local verification: 3 transformed, structure passed; outcome **`PARTIALLY_VERIFIED` (Draft)** because the demo's reserved hidden cases fail; meaning “unknown”, not promoted. Exported package: `node run.mjs verify` exit 0 in a clean directory |
| App Check during the cloud request | No App Check exchange was observed in this session: the dedicated profile reused a still-valid token. The request was authenticated: P-002 shows the endpoint refuses tokenless requests on this deployment, and this one returned a real answer |
| Retries / extra requests | none |

### Gemini Cloud budget (approved by the owner: 1 request; used: 1)

| Item | Proposal |
| --- | --- |
| Budget | **1** real request, the existing release-acceptance path (`S14-REC-3` via `pnpm test:production:real`). No retry. A provider failure is recorded as a failure |
| Data | The procedure's fictional demo source. Optionally, as a second approved request only: the fresh Scenario 2 dataset ([../usability/sprint-16c/participant/](../usability/sprint-16c/participant/)) |
| Sent | Only the previewed, approved alias-level disclosure through production App Check: aliases, descriptors, fictional examples, plus the category names of the one field the procedure opts into. Never records, field names or bindings |
| Checked | approved payload only (0 private terms in the body); `inferenceSource: IN_CLOUD`; `convertProposal` validity; semantic verdict; outcome headline not above its proven level; the export verifies with `node run.mjs verify` in a clean directory |

## 5. Export portability (PRODUCTION_DETERMINISTIC)

The independent verifier checked every reusable integration downloaded from production:

- unzip into a fresh directory;
- re-hash every file against `manifest.json`;
- run `node run.mjs verify` with a clean environment and no `node_modules`;
- run `node run.mjs run` with the downloaded `bindings.local.json`, twice;
- compare record by record with the app's download and with the oracle.

| Format | Packages | `verify` OK | runner = app | Reproducible | Records exact / compared | Wrong values |
| --- | --- | --- | --- | --- | --- | --- |
| JSON | 22 | 22 | 22 | 22 | 682 / 839 | 129* |
| CSV | 12 | 12 | 12 | 12 | 675 / 740 | 0 |
| XLSX | 10 | 10 | 10 | 10 | 957 / 1,102 | 0 |
| REST | 1 | 1 | 1 | 1 | 11 / 11 | 0 |

\* Only the four JSON click-through probes that explicitly confirmed wrong suggestions. The other non-exact records were correctly flagged or quarantined (optional-field limit, injected bad data), never altered or dropped.

**Package findings:**

- Statuses: DRAFT 20, VERIFIED_WITH_EXCEPTIONS 9, VERIFIED 16.
- Quarantined records are listed by index.
- 0 records, bindings, canaries or private values in any ZIP. Six package-vocabulary matches were traced and are reported separately.

## 6. Phase D — independent developer usability: **NOT_RUN (0 participants)**

No independent participant was available to the agent, and participants must never be simulated.

**Prepared:**

- The session protocol with the verbatim briefing, the 14-step checklist, the measures, the trust questions and the critical-failure rule: [../evidence/sprint-16c/usability/protocol.md](../evidence/sprint-16c/usability/protocol.md).
- An empty results sheet: [results.md](../evidence/sprint-16c/usability/results.md).
- **Scenario 1:** the Sprint 15 fictional CRM.
- **Scenario 2:** a **fresh** logistics dataset: new seed `S16C-USABILITY-2026-11-16-logistics-r8`, 30 fictional shipments, mixed-language states. It is **not** a Sprint 16A case. Generated by [`scripts/qa/s16c/usability-dataset.mjs`](../../scripts/qa/s16c/usability-dataset.mjs), with a participant pack, a facilitator answer key and an independent checker.

**Materials dry-run (agent, not a participant):**

- On the `489c6ba` artifact, LOCAL: Scenario 2 is solvable, and correct answers give 30 / 30 records exact, with 0 model requests.
- **EYES visibly suggests the wrong fields** `label_id` → `shipmentId` and `last_scan_at` → `shippedAt`. Checklist item 5, “reject an incorrect suggestion”, is therefore actually exercised. See [pilot.json](../evidence/sprint-16c/usability/pilot.json).

## 7. Phase E — accessibility and cross-browser

| Check | Status |
| --- | --- |
| Manual screen reader (Orca / NVDA / VoiceOver, with a person) | **NOT_RUN**. 12-step protocol ready ([../evidence/sprint-16c/accessibility/README.md](../evidence/sprint-16c/accessibility/README.md)) |
| Scenario 2 workflow in Chromium and Firefox; 390 px; 200% zoom; keyboard only (Tab + Space/Enter through the category radio, translation, field matches, “Use …”, build, download, visible focus); reduced motion; `role="alert"` blockers | **LOCAL, automated: 13 / 13 PASS** on the `489c6ba` artifact ([automated-local.json](../evidence/sprint-16c/accessibility/automated-local.json)) |
| The same on production | **PRODUCTION_DETERMINISTIC: 13 / 13 PASS**, Chromium + Firefox ([automated-production.json](../evidence/sprint-16c/accessibility/automated-production.json)); the Scenario 2 dry-run also passes on production ([pilot-production.json](../evidence/sprint-16c/usability/pilot-production.json)) |

**Harness bugs (not product defects):**

- The first access run failed because my helper skipped the category-field step.
- The keyboard check initially tabbed past a control that only appears after a choice.
- Both were fixed in the test, and the product was unchanged.

## 8. Phase F — failure analysis

**No new P0 / P1 was found.**

- No release-blocking defect appeared in the release build, the regression or the LOCAL checks, and no product code changed.
- The P1 behaviours carried from Sprint 16B are disclosed limitations, not regressions:
  - wrong suggestions are possible, but never applied silently;
  - `VERIFIED` is a structural status.
- Ranking was not tuned. A ranking improvement needs a fresh held-out set and a separate, reviewed change.

## 9. Privacy and security findings

- No change to any privacy or security boundary in Sprint 16C. App Check enforcement was last verified on production on 2026-11-16 (P-002, Sprint 16A preflight).
- 0 model requests in all LOCAL runs this sprint.
- Secret scan clean (§ 2).
- Usability material holds no canaries and no real data.

## 10. Risks and the `VERIFIED` remediation proposal (not implemented)

1. **Superseded: the new build is now production-accepted** (§ 3, § 4). Residual: the real cloud path was exercised once, on the demo data (no statistical claim).
2. **No human evidence.**
   - The Design claim (“a developer can complete it”) rests on automated journeys only.
   - The most likely misunderstanding, “`VERIFIED` = correct meaning”, is untested with people.
3. **Wrong suggestions** (Sprint 16B):
   - A click-through user can confirm `label_id` as `shipmentId`. Scenario 2 is built to observe exactly this.
   - The result then says “Structure verified”, and `VERIFIED` remains the package status.
4. **Minimal remediation if sessions show systematic misreading of `VERIFIED`** (for review; it changes the Export Contract and must not be done in this sprint):
   - **Short term, UI only, no contract change:** render the guided status as “VERIFIED (structure)” and show “Meaning verified for N of M fields” next to every `VERIFIED` badge and in the ZIP's README header line.
   - **Contract option:** Export Contract 1.2.0 adds `verification.meaningComplete: boolean`, and the runner prints it. This needs compatibility review of `run.mjs`, manifest validation and existing packages.
5. **Deadline:** 2026-11-30 2:00 PM PT. Commits after it are not evaluated.
6. **Stale figure:** the “significantly updated” count in the history and Devpost files is from Sprint 12. It is recomputed in [submission-readiness.md](../evidence/sprint-16c/submission-readiness.md)): +25,312 / −1,111.

## 11–14. Summary table

| # | Item | Label | Result |
| --- | --- | --- | --- |
| 1 | Starting SHA / release SHA | — | `489c6ba` (main at the start) / `489c6ba` (deployed). `main` is now `9f47dec` (PR #20, docs and QA only; not deployed) |
| 2 | PR / merge | — | PR #19 (16B) and PR #20 (16C prep) merged by the owner; CI green |
| 3 | Production deployment identity | PRODUCTION_DETERMINISTIC | `489c6ba` served; 31 / 31 files = artifact |
| 4 | Local regression | LOCAL | 759 / 759 |
| 5 | Production acceptance | PRODUCTION_DETERMINISTIC | 19 / 19 |
| 6 | 62-case comparison | PRODUCTION_DETERMINISTIC | 43 / 4 / 7 / 8, equal to LOCAL; 16A production 39 / 10 / 7 / 6 |
| 7 | Gemini Nano | PRODUCTION_REAL_MODEL | 4 / 4 subset + hybrid path; advisory only |
| 8 | Gemini Cloud | PRODUCTION_REAL_MODEL | 1 / 1 approved request, `IN_CLOUD`, verified locally, Draft (not promoted) |
| 9 | Export portability | PRODUCTION_DETERMINISTIC | 45 / 45 |
| 10 | Independent participants | NOT_RUN | 0 sessions |
| 11 | Manual accessibility | NOT_RUN | automated 13 / 13 on production |
| 12 | Privacy / security | PRODUCTION_DETERMINISTIC + PRODUCTION_REAL_MODEL | no findings: 0 unapproved model requests, 0 leaks, App Check enforced |
| 13 | Open defects | — | none new; 16B limits disclosed |
| 14 | Release status | — | **`PRODUCTION_ACCEPTED`** (`489c6ba`) |

## 15. Final decision: `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`

**Why it is submittable:**

- The release that fixes every Sprint 16A defect is live and passed every required production check on its exact SHA.
- Real Nano and real Gemini Cloud work through production App Check.
- Privacy held in every measurement.
- Every exported integration runs independently and matches the app and the oracle.

**What must be disclosed:**

- No independent usability sessions.
- No manual screen-reader pass.
- Suggestions can be wrong. Accepting every one gave wrong values in 4 of 8 click-through probes, always as an explicit act, never shown as “Integration ready”.
- `VERIFIED` is a structural package status.
- The 16A limitations remain (optional fields, locale numbers and dates, column names, depth, arrays).

**What would move it to `SUBMISSION_READY`:**

- At least 3 independent sessions that meet the targets in the protocol, in particular 0 participants reading `VERIFIED` or “Structure verified” as guaranteed meaning.
- One manual screen-reader pass without blockers.

**Next actions for human usability sessions:** see § 16.

## 16. Next actions — independent usability sessions (owner)

1. **Recruit** three developers who have never used EYES and have JSON / CSV / API experience. Get consent for note-taking only: no recordings in the repository.
2. **Prepare** each machine: Chrome; Node 22 and `unzip` in an empty folder.
   - Materials: [`docs/usability/fixtures/customers.json`](../usability/fixtures/customers.json) (Scenario 1) and the [`participant/`](../usability/sprint-16c/participant/) pack (Scenario 2).
   - Do **not** share the `facilitator/` folder.
3. **Check** that the footer shows `build 489c6baaf18b` on <https://eyes-without-a-face-b7281.web.app>.
4. **Run** the session exactly as in [protocol.md](../evidence/sprint-16c/usability/protocol.md):
   - read the verbatim briefing;
   - stay silent; intervene only after 3 minutes stuck, and record it;
   - time the measures;
   - mark the 14 checklist items.
5. **Check correctness** with `node scripts/qa/s16c/check-usability-output.mjs <their transformed-records.json>` (Scenario 2). It prints counts and field names only.
6. **Ask the trust questions** after the task, especially “Does this result guarantee the correct business meaning?”, for “Structure verified” and `VERIFIED`.
7. **Record aggregate, sanitized results** in [results.md](../evidence/sprint-16c/usability/results.md).
8. **If a critical misunderstanding of `VERIFIED` appears:** record it as a release risk and consider the UI-only remediation in § 10. Any contract change needs its own review.
9. **Screen-reader pass:** one person, Orca / NVDA / VoiceOver, the 12 steps in [accessibility/README.md](../evidence/sprint-16c/accessibility/README.md).
10. **Then** update the decision, before the deadline: 2026-11-30, 2:00 PM PT.

Sprint 17 was not started, nothing was submitted to Devpost, and no video was uploaded.
