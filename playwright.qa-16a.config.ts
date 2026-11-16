import { defineConfig } from "@playwright/test";

/**
 * Sprint 16A — real-world production challenge (QA harness, not a release gate).
 *
 *   node scripts/qa/s16a/generate.mjs
 *   EYES_EXPECTED_SHA=<served sha> pnpm exec playwright test -c playwright.qa-16a.config.ts
 *   node scripts/qa/s16a/verify.mjs
 *
 * Drives the DEPLOYED guided UI with independently generated fictional data.
 * Sends no Gemini request (every case asserts zero `generateContent`). Never
 * uses an App Check debug token. Harness development against a local preview
 * requires EYES_QA_TARGET=local and is labeled "local" in every result.
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) {
  throw new Error("The Sprint 16A QA run must not use an App Check debug token.");
}
const local = process.env.EYES_QA_TARGET === "local";
const baseURL = local ? (process.env.EYES_QA_LOCAL_URL ?? "http://127.0.0.1:4173") : (process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app");
if (!local && /localhost|127\.0\.0\.1/.test(baseURL)) {
  throw new Error("Production QA runs against the deployed URL. Set EYES_QA_TARGET=local for harness development.");
}

export default defineConfig({
  testDir: "tests/qa",
  testMatch: "**/*.spec.ts",
  testIgnore: /sprint-16a-nano\.spec\.ts|sprint-16c-/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  use: { baseURL, trace: "off", screenshot: "off", viewport: { width: 1280, height: 900 }, acceptDownloads: true, actionTimeout: 15_000 },
  projects: [{ name: local ? "qa-local-chromium" : "qa-production-chromium", use: { browserName: "chromium" } }],
});
