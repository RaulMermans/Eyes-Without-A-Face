# Sprint 16C — Production acceptance, real-user validation and final reliability gate

**Date:** 2026-11-16 · **Branch:** `sprint-16c-production-acceptance` (from `origin/main` @ `489c6ba`) · **Kind:** release qualification. No feature work, and no product code changed.

**Release status of `489c6ba`: `DEPLOYMENT_PENDING`.** The owner's approval of this exact SHA is required. Production still serves `c4a246c` (`PRODUCTION_ACCEPTED`, Sprint 15).

**Readiness decision at this gate: `INSUFFICIENT_EVIDENCE`** (§ 15).

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

### Deployment approval package (STOP)

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

## 3. Phase B — production deployment and live acceptance: **NOT_RUN**

Blocked at the deployment-approval gate. No deployment, no production checks of `489c6ba` and no 62-case production run. The runbook is ready.

The best available proxy is **LOCAL**, and it is not production evidence. Sprint 16B's LOCAL run on `25c5eeb`, whose app code is identical, gave:

- PASS 43 · FAIL 4 · PARTIAL 7 · UNSUPPORTED 8;
- 0 / 246 fields pre-selected;
- 0 rules without a user decision;
- 0 disclosures;
- 45 / 45 packages verified outside the app;
- 2,174 / 2,174 confirmed-field records exact.

## 4. Phase C — genuine hybrid AI

| Check | Status | Note |
| --- | --- | --- |
| Gemini Nano on `489c6ba` | **NOT_RUN** | needs the deployed build. Last real evidence: Sprint 16A on `c4a246c` (4 / 4 real on-device, 0 cloud requests, 31 / 41 roles plausible). Applying Nano's suggestions changed **no** guided field match. Re-verify after deployment, do not assume |
| Gemini Cloud on `489c6ba` | **NOT_RUN** | needs the deployment **and** a separate budget approval |

### Gemini Cloud approval package (separate decision)

| Item | Proposal |
| --- | --- |
| Budget | **1** real request, the existing release-acceptance path (`S14-REC-3` via `pnpm test:production:real`). No retry. A provider failure is recorded as a failure |
| Data | The procedure's fictional demo source. Optionally, as a second approved request only: the fresh Scenario 2 dataset ([../usability/sprint-16c/participant/](../usability/sprint-16c/participant/)) |
| Sent | Only the previewed, approved alias-level disclosure through production App Check: aliases, descriptors, fictional examples, plus the category names of the one field the procedure opts into. Never records, field names or bindings |
| Checked | approved payload only (0 private terms in the body); `inferenceSource: IN_CLOUD`; `convertProposal` validity; semantic verdict; outcome headline not above its proven level; the export verifies with `node run.mjs verify` in a clean directory |

## 5. Export portability

- **Production:** NOT_RUN.
- **LOCAL proxy (Sprint 16B, identical app code), across the JSON, CSV, XLSX and REST cases** (verified per case in [results-local-rc-25c5eeb45f23.json](../evidence/sprint-16b/results-local-rc-25c5eeb45f23.json)):
  - 45 / 45 packages pass `verify` in a clean environment;
  - every file is re-hashed against its manifest;
  - runner output equals app output and the oracle;
  - reproducible across two runs;
  - 0 dropped or invented values;
  - quarantined records listed;
  - DRAFT packages labeled DRAFT;
  - 0 records, bindings or private values in any ZIP.

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
| The same on production | NOT_RUN (pending deployment). One command: `pnpm exec playwright test -c playwright.qa-16c.config.ts` |

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

1. **The new build is not production-proven.** Everything after A3 waits for approval.
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
| 1 | Starting SHA / release SHA | — | `489c6ba` (main) / `489c6ba` |
| 2 | PR / merge | — | PR #19 merged by the owner; CI green |
| 3 | Production deployment identity | NOT_RUN | serves `c4a246c` |
| 4 | Local regression | LOCAL | 759 / 759 |
| 5 | Production acceptance | NOT_RUN | — |
| 6 | 62-case comparison | LOCAL (16B) / production NOT_RUN | 43 / 4 / 7 / 8 vs. 39 / 10 / 7 / 6 |
| 7 | Gemini Nano | NOT_RUN on the new SHA | — |
| 8 | Gemini Cloud | NOT_RUN (deployment + budget gates) | — |
| 9 | Export portability | LOCAL | 45 / 45 |
| 10 | Independent participants | NOT_RUN | 0 sessions |
| 11 | Manual accessibility | NOT_RUN | automated LOCAL 13 / 13 |
| 12 | Privacy / security | LOCAL + earlier production | no findings |
| 13 | Open defects | — | none new; 16B limits disclosed |
| 14 | Release status | — | **`DEPLOYMENT_PENDING`** |

## 15. Final decision: `INSUFFICIENT_EVIDENCE`

- **Why not `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`?**
  - The build that fixes the Sprint 16A defects is not deployed, and no production or real-model check has run on it.
  - The live build `c4a246c` still has D1–D3: silent wrong mappings shown as “Integration ready”, and blocked exports.
  - There is no human evidence for the Design claim.
- **Why not `BLOCKED_BY_CRITICAL_DEFECTS`?** No P0 or P1 defect is open in the release build. Everything measured so far passes.

**Exact path to `SUBMISSION_READY_WITH_DISCLOSED_LIMITATIONS`:**

1. The owner approves the deployment of `489c6ba` and the 1-request cloud budget.
2. Deploy; `pnpm test:production` passes on that SHA; the 62-case production run matches the LOCAL baseline with 0 privacy or decision regressions; real Nano plus 1 real cloud request pass. The release can then be marked `PRODUCTION_ACCEPTED`.
3. Run at least 3 independent sessions and a manual screen-reader pass. **Strongly recommended for the Design criterion.** Without them, the submission must state that no usability study was performed.
4. Owner submission steps: [submission-readiness.md](../evidence/sprint-16c/submission-readiness.md).

Sprint 17 was not started, nothing was submitted, and no video was uploaded.
