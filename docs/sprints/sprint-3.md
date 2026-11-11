# Sprint 3 — Phantom Twin generation, controlled cloud mapping, private execution

**Date:** 2026-11-11  
**Branch:** `sprint-3`, stacked on `sprint-2` @ `11ba810` (Sprint 2 was unmerged at the time)  
**Classification:** **`LOCAL_PIPELINE_COMPLETE / CLOUD_BLOCKED`** (on-device also `ON_DEVICE_BLOCKED`)

The complete controlled-disclosure workflow runs end to end in the browser with a clearly labeled deterministic test adapter in place of Gemini. Real Gemini is still blocked by App Check (HTTP 403, debug token not allowlisted). No result in this sprint is presented as real Gemini output.

## What was built

| Workstream | Result |
| --- | --- |
| A Firebase unblock | Config precedence verified (`.env.local` wins; project and app ids match). App Check debug provider active. Real cloud request still `APP_CHECK_REJECTED` 403. Added a fixed-token path for live Playwright (`EYES_APPCHECK_DEBUG_TOKEN`, shell only) because each Playwright run uses a fresh profile. No Firebase admin access in this session, so the token could not be registered. |
| B Local profiling | `profileRecords`: types, email and date formats, categories, optional/null, shapes, padding/case. Structured rejection of invalid, empty, oversized, non-JSON, circular and prototype-key input. |
| C Phantom Twin | `generatePhantomTwin`: fixed-vocabulary roles, seeded `f_NN` aliases, deterministic synthetic examples with collision checks, local `PrivateBindings`, Ajv-valid Phantom and Source contracts. |
| D On-device | Capability is probed on the Phantom step. Chrome 157 Linux: Prompt API `available`, model `unavailable`. UI shows **"On-device AI unavailable — manual/deterministic mode"** and `ON_DEVICE_BLOCKED`. If available, role suggestions run `ONLY_ON_DEVICE` on synthetic samples only, as suggestions. |
| E Controlled disclosure | Reuses projection, exact prompt, SHA-256, single-use ledger and gate. New: cloud-disclosure **1.1.0** with a minimal destination `target` (ADR 0007), a private-value scan in the gate, and invalidation on any upstream change. |
| F Gemini proposal | Mapping-proposal prompt for 1.1.0 (payload declared untrusted). `convertProposal` is the only proposal → Mapping Contract boundary; it rejects and never repairs. |
| G Alias resolution | `resolveAliases` validates bindings, shareability and phantom id, rewrites aliases to local paths, re-validates, then runs the unchanged `executeMappingBatch`. |
| H Reality Check | Imported records plus 3 reserved hidden cases. Reports pass/fail, schema compatibility, failure codes, reproduction hints. Safe summaries by alias; raw engine messages only in collapsed local detail. A disclosure-shaped summary exists but is never sent. |
| I UI | Guided Source → Phantom Twin → Disclosure Review → Cloud Mapping → Reality Check, with one primary action per stage, local/approval/cloud indicators and origin labels (Gemini / simulated test adapter / manual edit). The diagnostic workspace is collapsed under Advanced. |
| J Tests | +47 unit, +5 contract, +11 privacy, +17 Playwright (E2E-025…036), plus LIVE-009. |
| K CI | Workflow adds `sprint-3`. Remote repository is not reachable (see below). |

## Engine changes

Only input hardening: programmatic non-JSON or circular inputs now return `NON_JSON_VALUE` / `CIRCULAR_REFERENCE` instead of throwing. Operation semantics, limits and validation are unchanged. The engine was not modified to accept any AI output.

## Evidence (local, 2026-11-11)

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | PASS |
| `pnpm test:unit` | PASS — 112 (13 files) |
| `pnpm test:contracts` | PASS — 22 |
| `pnpm test:privacy` | PASS — 23 |
| `pnpm test:e2e` | PASS — 41 (24 legacy scenarios + 17 Sprint 3 tests) |
| `pnpm test:all` | PASS |
| `EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live` | 7 PASS, 2 BLOCKED (LIVE-004, LIVE-009: `APP_CHECK_REJECTED` HTTP 403 after ~1.3–1.5 s; no `inferenceSource`; no `generateContent` reached) |
| LIVE-002 | project `eyes-without-a-face-b7281`, app `1:507051460368:web:086c…` |
| LIVE-007 | `ON_DEVICE_BLOCKED` — `MODEL_UNAVAILABLE`, no cloud fallback |

Screenshots: `test-results/sprint-3-screenshots/` and `test-results/sprint-2-live/` (gitignored).

Existing E2E scenarios were preserved. Selectors changed where the flow changed: the step "Verification" is now "Reality Check", the diagnostic workspace is collapsed, the manual contract sits under Advanced, and runs on the CRM sample uncheck the reserved cases where the Sprint 2 assertion expects `batch ok`.

## GitHub / CI diagnosis

- `git ls-remote origin` returns **"Repository not found"**. `gh api repos/RaulMermans/Eyes-Without-A-Face` returns **404**. The repository is absent from the account's repository list (the token has `repo` and `workflow` scopes).
- Consequently: no push, no PR, no Actions run. **CI = BLOCKED** (repository missing or inaccessible), not a code failure.
- The workflow YAML is unchanged apart from the `sprint-3` branch filter. Nothing was recreated or published without owner authorization.

## Hackathon rules

`https://firebasehybridaihackathon.devpost.com/rules` returned **HTTP 403** to automated fetches on 2026-11-11, the first day of the submission period. The rules remain **unverified** here. All code in this repository predates or coincides with the submission start (Sprint 0–2 commits on 2026-11-10; Sprint 3 on 2026-11-11). Do not represent pre-event work as new.

## Remaining owner actions

1. **App Check:** generate a UUID locally and register it under Firebase Console → App Check → `eyes-without-a-face-web` → Manage debug tokens. Then run `EYES_APPCHECK_DEBUG_TOKEN=<uuid> EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 pnpm test:live`. If LIVE-009 shows `source=IN_CLOUD`, the classification becomes `CLOUD_INTEGRATED / ON_DEVICE_BLOCKED`.
2. **GitHub:** restore or recreate `RaulMermans/Eyes-Without-A-Face` (or provide the new remote). Then push `sprint-0` … `sprint-3` and open the Sprint 3 PR against `sprint-2` (stacked) or `main` after Sprint 2 merges.
3. **Rules:** read the Official Rules in a browser and record originality and pre-existing-code terms in `docs/hackathon-requirements.md`.

## Known limitations

- The test adapter's proposer is a deterministic heuristic over descriptors. It proves the plumbing, not model quality.
- Role inference reads local field names (output is fixed vocabulary). Identifier shapes and disclosed labels are structural disclosures.
- The leak scan matches exact normalized strings and substrings; it does not catch paraphrases.
- The UI keeps one twin and one approval per session. State is in memory only.
- No ZIP export and no correction loop (by scope).
