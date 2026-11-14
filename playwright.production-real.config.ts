import { defineConfig } from "@playwright/test";

/**
 * Production acceptance — REAL models on the deployed build (Sprint 14, permanent).
 * See docs/deployment.md, "Production acceptance standard" and its inference budget.
 *
 *   EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_RECOVERY=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
 *   EYES_RECOVERY_ONLY=3 EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
 *   EYES_LIVE_EVIDENCE=docs/evidence/production/<sha12>/inference-results.json pnpm test:production:real
 *
 * One hybrid happy path = real Gemini Nano on the device + ONE approved Gemini
 * request + export run. Production App Check (reCAPTCHA) only: a debug token is refused.
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) {
  throw new Error("Production acceptance must not use an App Check debug token.");
}
const baseURL = process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app";
if (/localhost|127\.0\.0\.1/.test(baseURL)) {
  throw new Error("Production acceptance runs against the deployed URL, never localhost.");
}

export default defineConfig({
  testDir: "tests/live",
  testMatch: /guided-recovery\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 300_000,
  use: { baseURL, headless: false, trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "production-chrome", use: { browserName: "chromium", channel: "chrome", viewport: { width: 1280, height: 800 } } }],
});
