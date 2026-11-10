# Test strategy

| Suite | Runner | What it proves |
| --- | --- | --- |
| `pnpm test:unit` | Vitest | Config parsing, adapter refusal, SDK symbols, disclosure hashes, structured output |
| `pnpm test:contracts` | Vitest | Ajv validation of contract families, including cloud disclosure |
| `pnpm test:privacy` | Vitest | Private vs shareable split, canaries, gate, no executable transforms |
| `pnpm test:e2e` | Playwright + Vite | Branding, unconfigured Firebase, approval, payload integrity, test adapters |
| `pnpm test:live` | Playwright + installed Chrome | Opt-in capability / real Firebase checks |
| `pnpm lint` / `typecheck` / `build` | oxlint, tsc, Vite | Static quality |

`pnpm test:all` runs lint, typecheck, unit, contracts, privacy, build, and deterministic e2e. It does **not** run `test:live`.

## Mock versus live

Test adapters are injected only in Vite `DEV` via `window.__EYES_WITHOUT_A_FACE_TEST__`. The UI labels those results **Simulated test result**. Live adapters never return mock success.

## Playwright

`playwright.config.ts` launches `pnpm dev` on `127.0.0.1:5173` with bundled Chromium.

`playwright.live.config.ts` uses `channel: "chrome"` on port 5174. Enable with `EYES_LIVE_TESTS=1`. Additional flags:

- `EYES_LIVE_ON_DEVICE=1` — real `ONLY_ON_DEVICE` generate
- `EYES_LIVE_CLOUD=1` — real `ONLY_IN_CLOUD` generate (requires `.env.local`)

Do not place debug tokens or private records in traces.

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
| LIVE-001 | Chrome / Prompt API / model availability |
| LIVE-002 | Real on-device inference |
| LIVE-003 | Real cloud inference |
| LIVE-004 | Unapproved path sends no generateContent |
| LIVE-005 | Console error inspection |
