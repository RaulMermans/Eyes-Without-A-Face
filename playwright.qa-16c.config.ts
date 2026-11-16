import { defineConfig } from "@playwright/test";

/**
 * Sprint 16C — automated cross-browser / access checks and the Scenario 2 dry-run.
 *   LOCAL:      EYES_QA_TARGET=local pnpm exec playwright test -c playwright.qa-16c.config.ts
 *   PRODUCTION: pnpm exec playwright test -c playwright.qa-16c.config.ts   (deployed URL)
 * No model request is made; no App Check debug token is accepted.
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) throw new Error("No App Check debug token in Sprint 16C runs.");
const local = process.env.EYES_QA_TARGET === "local";
const baseURL = local ? (process.env.EYES_QA_LOCAL_URL ?? "http://127.0.0.1:4173") : (process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app");
if (!local && /localhost|127\.0\.0\.1/.test(baseURL)) throw new Error("Set EYES_QA_TARGET=local for a local run.");

export default defineConfig({
  testDir: "tests/qa",
  testMatch: /sprint-16c-(access|pilot)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: { baseURL, trace: "off", screenshot: "off", viewport: { width: 1280, height: 900 }, acceptDownloads: true, actionTimeout: 15_000 },
  projects: [
    { name: local ? "local-chromium" : "production-chromium", use: { browserName: "chromium" } },
    { name: local ? "local-firefox" : "production-firefox", testMatch: /sprint-16c-access\.spec\.ts/, use: { browserName: "firefox" } },
  ],
});
