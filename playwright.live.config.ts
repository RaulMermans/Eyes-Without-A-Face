import { defineConfig } from "@playwright/test";

const port = 5174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/live",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  use: {
    baseURL,
    headless: false,
    trace: "retain-on-failure",
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
