import { defineConfig } from "@playwright/test";

/**
 * Hosted acceptance (Sprint 12): runs the opt-in live specs against a DEPLOYED
 * build instead of the local dev server. No web server, and no App Check debug
 * token: production attestation goes through reCAPTCHA Enterprise on an allowed
 * domain. Never set EYES_APPCHECK_DEBUG_TOKEN with this config.
 *
 *   EYES_HOSTED_URL=https://eyes-without-a-face-b7281.web.app \
 *   EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT11=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1 \
 *   EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
 *   EYES_LIVE_EVIDENCE=live-evidence/sprint-12/hosted.json \
 *   pnpm exec playwright test -c playwright.hosted.config.ts tests/live/sprint11-experience.spec.ts
 */
const baseURL = process.env.EYES_HOSTED_URL ?? "https://eyes-without-a-face-b7281.web.app";
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) {
  throw new Error("Hosted acceptance must not use an App Check debug token.");
}

export default defineConfig({
  testDir: "tests/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 420_000,
  use: {
    baseURL,
    headless: false,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Real Chrome with the dedicated Nano profile (EYES_CHROME_PROFILE): the hybrid journey.
      name: "hosted-chrome",
      testIgnore: /hosted-degradation/,
      use: { browserName: "chromium", channel: "chrome", viewport: { width: 1280, height: 800 } },
    },
    {
      // Playwright's bundled Chromium: its default flags disable the Nano component.
      name: "hosted-chromium-no-nano",
      testMatch: /hosted-degradation/,
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "hosted-firefox",
      testMatch: /hosted-degradation/,
      // Headed Firefox crashes at launch (SIGSEGV) on the Sprint 12 machine; headless runs.
      use: { browserName: "firefox", headless: true, viewport: { width: 1280, height: 800 } },
    },
  ],
});
