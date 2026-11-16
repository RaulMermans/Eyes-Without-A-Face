import { defineConfig } from "@playwright/test";

/**
 * Sprint 16A — genuine Gemini Nano subset against the DEPLOYED build (on-device, no cloud).
 * Uses the dedicated Nano Chrome profile (tests/live/fixtures.ts). Refuses a debug token and localhost.
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) throw new Error("No App Check debug token in Sprint 16A runs.");
const baseURL = process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app";
if (/localhost|127\.0\.0\.1/.test(baseURL)) throw new Error("The Nano subset runs against the deployed URL.");

export default defineConfig({
  testDir: "tests/qa",
  testMatch: /sprint-16a-nano\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 300_000,
  use: { baseURL, headless: false, trace: "off", screenshot: "off", actionTimeout: 20_000 },
  projects: [{ name: "qa-nano-chrome", use: { browserName: "chromium", channel: "chrome", viewport: { width: 1280, height: 900 } } }],
});
