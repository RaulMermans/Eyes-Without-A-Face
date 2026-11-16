import { defineConfig } from "@playwright/test";

/**
 * Sprint 17A — Meridian-style recovery journey on the deployed build (zero model requests).
 *   pnpm exec playwright test -c playwright.qa-17a.config.ts
 * Refuses an App Check debug token and localhost (unless EYES_QA_TARGET=local).
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) throw new Error("No App Check debug token in Sprint 17A runs.");
const local = process.env.EYES_QA_TARGET === "local";
const baseURL = local ? (process.env.EYES_QA_LOCAL_URL ?? "http://127.0.0.1:4173") : (process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app");
if (!local && /localhost|127\.0\.0\.1/.test(baseURL)) throw new Error("Set EYES_QA_TARGET=local for a local run.");

export default defineConfig({
  testDir: "tests/qa",
  testMatch: /sprint-17a-production\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: { baseURL, trace: "off", screenshot: "off", viewport: { width: 1280, height: 900 }, acceptDownloads: true, actionTimeout: 15_000 },
  projects: [{ name: local ? "local-chromium" : "production-chromium", use: { browserName: "chromium" } }],
});
