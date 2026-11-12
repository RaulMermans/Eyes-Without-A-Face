import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/**
 * Visual QA capture (Sprint 6). Not part of `pnpm test:e2e`: it walks the
 * fictional CRM journey at four viewports and writes JPEG screenshots to
 * $VISUAL_OUT (default docs/design/screenshots/after). Same unconfigured
 * Firebase environment as the e2e suite; the cloud step uses the labeled
 * deterministic test adapter, never live Gemini.
 */
export default defineConfig({
  ...base,
  testDir: "tests/visual",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
