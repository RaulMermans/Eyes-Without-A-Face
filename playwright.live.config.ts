import { defineConfig } from "@playwright/test";

const port = 5174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  use: {
    baseURL,
    headless: false,
    // Traces record addInitScript arguments, which would capture an injected
    // App Check debug token. Never trace when a token is present.
    trace: process.env.EYES_APPCHECK_DEBUG_TOKEN ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5174 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "live-chrome",
      use: {
        browserName: "chromium",
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
