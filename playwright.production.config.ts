import { defineConfig } from "@playwright/test";

/**
 * Production acceptance — deterministic browser checks (Sprint 14, permanent).
 * See docs/deployment.md, "Production acceptance standard".
 *
 *   EYES_EXPECTED_SHA=<approved sha> pnpm test:production
 *
 * Runs against the deployed URL only. Sends no Gemini request. Never uses an
 * App Check debug token. Real-model acceptance: `pnpm test:production:real`.
 */
if (process.env.EYES_APPCHECK_DEBUG_TOKEN) {
  throw new Error("Production acceptance must not use an App Check debug token.");
}
const baseURL = process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app";
if (/localhost|127\.0\.0\.1/.test(baseURL)) {
  throw new Error("Production acceptance runs against the deployed URL, never localhost.");
}

export default defineConfig({
  testDir: "tests/production",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: { baseURL, trace: "off", screenshot: "off", viewport: { width: 1280, height: 800 } },
  projects: [
    { name: "production-chromium", use: { browserName: "chromium" } },
    // Degradation check in a browser without on-device AI: the tagged smoke paths must still work.
    { name: "production-firefox", grep: /@cross-browser/, use: { browserName: "firefox" } },
  ],
});
