import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Visual QA capture for the design record. Walks the fictional CRM journey
 * through the real workflow (test adapter labeled as simulated for the cloud
 * step) and saves one full-page JPEG per state and viewport.
 */
const out = process.env.VISUAL_OUT ?? "docs/design/screenshots/after";
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
] as const;

async function shot(page: Page, viewport: string, state: string): Promise<void> {
  // Let entrance transitions settle so captures are stable.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${state}-${viewport}.jpg`), fullPage: true, type: "jpeg", quality: 72 });
}

async function step(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name }).click();
}

for (const viewport of VIEWPORTS) {
  test(`journey at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", deriveProposal: true };
    });
    await page.goto("/");
    await shot(page, viewport.name, "01-landing");

    await page.getByTestId("load-crm-sample").click();
    await expect(page.getByTestId("source-profile")).toBeVisible();
    await shot(page, viewport.name, "02-source");

    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByTestId("twin-summary")).toBeVisible();
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
    await shot(page, viewport.name, "03-twin");

    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await expect(page.getByTestId("approve-disclosure")).toBeVisible();
    await shot(page, viewport.name, "04-review");
    await page.getByTestId("approve-disclosure").click();

    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Valid");
    await shot(page, viewport.name, "05-mapping");

    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toBeVisible();
    await shot(page, viewport.name, "06-reality");

    await step(page, /Cloud Mapping/);
    await shot(page, viewport.name, "07-mapping-after-run");
  });
}
