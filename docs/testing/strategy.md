# Test strategy

| Suite | Runner | What it proves |
| --- | --- | --- |
| `pnpm test:unit` | Vitest | Config parsing, adapter refusal, SDK symbols, disclosure hashes, structured output, mapping engine, source profiling, Phantom generation, proposal conversion, alias resolution, Reality Check |
| `pnpm test:contracts` | Vitest | Ajv validation of contract families, including cloud disclosure 1.0.0 and 1.1.0, plus engine input hardening |
| `pnpm test:privacy` | Vitest | Private vs shareable split, canaries, gate, exact-prompt approval invalidation, replay and concurrency, private-value scan, telemetry sanitization |
| `pnpm test:e2e` | Playwright + Vite | Branding, unconfigured Firebase, approval, payload integrity, test adapters, the full Phantom Twin journey |
| `pnpm test:live` | Playwright + installed Chrome | Opt-in capability / real Firebase checks |
| `pnpm lint` / `typecheck` / `build` | oxlint, tsc, Vite | Static quality |

`pnpm test:all` runs lint, typecheck, unit, contracts, privacy, build, and deterministic e2e. It does **not** run `test:live`.

## Mock versus live

Test adapters are injected only in Vite `DEV` via `window.__EYES_WITHOUT_A_FACE_TEST__`. The UI labels those results **Simulated test result** or **Simulated test adapter — not Gemini**. Live adapters never return mock success.

Sprint 3 harness options:

- `deriveProposal: true` — a deterministic test proposer reads only the approved payload (`src/inference/test-proposer.ts`).
- `cloudOutput` — a fixed proposal object.
- `rawCloudText` — raw response text, used to prove malformed JSON is not repaired.

Property-based tests (fast-check) cover the following:

- profiling never throws on arbitrary JSON;
- conversion never accepts arbitrary JSON;
- synthetic examples never reproduce private strings across random datasets and seeds.

## Playwright

`playwright.config.ts` launches `pnpm dev` on `127.0.0.1:5173` with bundled Chromium.

`playwright.live.config.ts` uses `channel: "chrome"` on port 5174. Enable with `EYES_LIVE_TESTS=1`. Additional flags:

- `EYES_LIVE_ON_DEVICE=1` — real `ONLY_ON_DEVICE` generate
- `EYES_LIVE_CLOUD=1` — real `ONLY_IN_CLOUD` generate (requires `.env.local`)

See [playwright-live.md](playwright-live.md). Do not place debug tokens or private records in traces.

## Regression matrix

| ID | Check |
| --- | --- |
| E2E-001 | App boot and identity |
| E2E-002 | Workflow navigation |
| E2E-003 | Desktop and compact viewports |
| E2E-004 / E2E-006 | Unconfigured Firebase; no AI provider request |
| E2E-005 | Official branding and favicon |
| E2E-007 | Cloud approval required |
| E2E-008 | Payload change invalidates approval |
| E2E-009 | Local model unavailable; no cloud fallback |
| E2E-010 | Malformed structured output rejected |
| E2E-011 | Controlled test-adapter success labeled simulated |
| E2E-012 | Duplicate cloud submission requires a new approval |
| E2E-013 | Timeout is not treated as success |
| E2E-014 | Unknown / unverified provenance is rejected |
| E2E-015 | App Check unconfigured without credentials |
| E2E-016 | JSON import |
| E2E-017 | Invalid source JSON |
| E2E-018 | Destination JSON Schema |
| E2E-019 | Mapping execution |
| E2E-020 | Output correctness |
| E2E-021 | Invalid mapping rejected |
| E2E-022 | Unmapped enum edge case |
| E2E-023 | Mapping with AI network blocked |
| E2E-024 | UI integrity |
| E2E-025 | Source profiling (local profile, structured unsafe-input error) |
| E2E-026 | Phantom generation (aliases, synthetic examples, limitations) |
| E2E-027 | Same seed and input give the same twin; a seed change alters it; restoring the seed restores it |
| E2E-028 | Canaries and private names absent from the approved prompt, network bodies, console, telemetry |
| E2E-029 | Rejection gives zero cloud requests; twin change invalidates approval |
| E2E-030 | Labeled deterministic test adapter returns a valid proposal; approval is single-use |
| E2E-031 | Alias resolution to local fields; bindings absent from the prompt |
| E2E-032 | Resolved mapping produces the expected target JSON |
| E2E-033 | Reserved unmapped enum fails with a safe summary; value only in local detail |
| E2E-034 | Unsupported ops, executable content, malformed params, unknown aliases, malformed JSON, manual edits |
| E2E-035 | Full journey with AI provider hosts blocked |
| E2E-036 | Keyboard, responsive (1280/390 on every step), no page or console errors |
| LIVE-001 | Chrome / Prompt API / model availability |
| LIVE-002 | Firebase project / web app initialization |
| LIVE-003 | App Check status |
| LIVE-004 | Real cloud inference |
| LIVE-005 | Unapproved path sends no generateContent |
| LIVE-006 | Outbound prompt fingerprint |
| LIVE-007 | Real on-device inference or recorded blocker |
| LIVE-008 | Console errors and responsive layout |
| LIVE-009 | Sprint 3 Phantom Twin journey with real Gemini (`IN_CLOUD` proposal → validation → resolution → Reality Check) |
