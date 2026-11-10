# Test strategy

| Suite | Runner | What it proves |
| --- | --- | --- |
| `pnpm test:unit` | Vitest | Config parsing, adapter refusal, SDK symbol presence, operation allow-list |
| `pnpm test:contracts` | Vitest | Ajv validation of five contract families, invalid fixtures |
| `pnpm test:privacy` | Vitest | Private vs shareable split, canaries, no executable transforms, export default |
| `pnpm test:e2e` | Playwright + Vite dev server | Shell, workflow, responsive layout, no provider requests on boot |
| `pnpm lint` / `typecheck` / `build` | oxlint, tsc, Vite | Static quality |

## Mock versus live

Sprint 0 adapters are **explicitly unavailable**. They are not mocks of successful model output. A privacy test named for network disclosure is marked `todo` until a live path exists.

Live Gemini / on-device tests must use a separate CI job that is not required on ordinary pull requests.

## Playwright

`playwright.config.ts` launches `pnpm dev` on `127.0.0.1:5173`. Traces are retained on failure and gitignored. Screenshots from smoke tests land in `test-results/sprint-0-screenshots/` (gitignored).

## Environments

- Local / CI PR: no Firebase credentials, Chromium only.
- Sprint 1 hardware lab: Chrome ≥ 139, Prompt API flag, downloaded on-device model, App Check debug token registered in a private project.

## Initial regression matrix

| ID | Check |
| --- | --- |
| E2E-001 | App boot and identity |
| E2E-002 | Workflow navigation |
| E2E-003 | Desktop and compact viewports |
| E2E-004 | Unconfigured Firebase; no AI provider request |
| C-001 | Valid contracts parse |
| C-002 | Unsupported versions fail |
| P-001 | Private fields not shareable |
| P-002 | Export excludes private fixtures |
