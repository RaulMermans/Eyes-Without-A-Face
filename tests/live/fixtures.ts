import { test as base, chromium, type BrowserContext } from "@playwright/test";

/**
 * Optional dedicated Chrome profile for on-device qualification.
 *
 * Playwright's default Chromium arguments include `--disable-component-update`
 * and `--disable-features=...OptimizationHints...`. With those, Chrome never
 * registers the Optimization Guide on-device model component and
 * `LanguageModel.availability()` reports `unavailable` even on eligible
 * hardware (Sprint 4 finding, Chrome 157 Linux).
 *
 * When `EYES_CHROME_PROFILE` is set (shell only, never `VITE_*`), the live suite
 * launches installed Chrome with a persistent, dedicated user-data directory and
 * none of Playwright's default arguments, so the downloaded Gemini Nano model is
 * reused across runs. Point it at a directory used only for testing, never at a
 * personal Chrome profile.
 */
const profileDir = process.env.EYES_CHROME_PROFILE ?? "";

export const ON_DEVICE_FEATURES = [
  "OptimizationGuideOnDeviceModel:BypassPerfRequirement/true",
  "PromptAPIForGeminiNano",
  "PromptAPIForGeminiNanoMultimodalInput",
].join(",");

export const usingDedicatedProfile = profileDir.length > 0;

export const test = base.extend<object, object>({
  context: async ({ context, baseURL }, provide) => {
    if (!usingDedicatedProfile) {
      await provide(context);
      return;
    }
    const dedicated: BrowserContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      baseURL,
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: true,
      args: [
        `--user-data-dir=${profileDir}`,
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        `--enable-features=${ON_DEVICE_FEATURES}`,
        "about:blank",
      ],
    });
    try {
      await provide(dedicated);
    } finally {
      await dedicated.close();
    }
  },
  page: async ({ context }, provide) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await provide(page);
  },
});

export { expect } from "@playwright/test";
