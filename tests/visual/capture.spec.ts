import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Visual QA capture for the design record (Sprint 10: CONNECT / OBSERVE /
 * OUTCOME). Walks the fictional CRM journey through the real workflow — the
 * cloud step is the labeled deterministic test adapter, never live Gemini —
 * and saves one full-page JPEG per state and viewport to $VISUAL_OUT.
 */
const out = process.env.VISUAL_OUT ?? "docs/design/screenshots/sprint-10-after";
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
] as const;

/** Alias-level initial proposal for crm-eu-accounts (same fixture as E2E-070). */
const CRM_INITIAL = {
  operations: [
    { op: "copy", from: "f_01", to: "id" },
    { op: "normalize_email", from: "f_02", to: "email" },
    { op: "map_enum", from: "f_05", to: "status", params: { map: { aktiv: "active", inaktiv: "inactive", interessent: "prospect" }, unmapped: "fail" } },
    { op: "parse_date", from: "f_03", to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
    { op: "copy", from: "f_06", to: "organization" },
  ],
  rationale: "Fixed visual-capture proposal served by the simulated test adapter.",
};

async function shot(page: Page, viewport: string, state: string, fullPage = true): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${state}-${viewport}.jpg`), fullPage, type: "jpeg", quality: 72 });
}

for (const viewport of VIEWPORTS) {
  test(`journey at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", deriveProposal: true };
    });
    await page.goto("/");
    await shot(page, viewport.name, "01-landing");
    await shot(page, viewport.name, "01-landing-fold", false);

    await page.getByTestId("start-demo").click();
    await expect(page.getByTestId("source-profile")).toBeVisible();
    await shot(page, viewport.name, "02-connect");

    await page.getByTestId("build-integration").click();
    await expect(page.getByTestId("runtime-stage-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await shot(page, viewport.name, "03-observe-awaiting-approval");

    await page.getByTestId("runtime-next-action").click();
    await expect(page.getByTestId("approve-disclosure")).toBeVisible();
    await shot(page, viewport.name, "04-review");
    await page.getByTestId("approve-disclosure").click();

    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Valid");
    await shot(page, viewport.name, "05-observe-mapping");

    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toBeVisible();
    await shot(page, viewport.name, "06-observe-reality");

    await page.getByTestId("open-outcome").click();
    await expect(page.getByTestId("outcome-overview")).toBeVisible();
    await shot(page, viewport.name, "07-outcome");
  });
}

for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
  test(`hero scenario with revision at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", cloudOutput: CRM_INITIAL });
    await page.goto("/");
    await page.getByTestId("scenario-picker").locator("summary").click();
    await page.getByTestId("load-scenario-crm-eu-accounts").click();
    await page.getByTestId("build-integration").click();
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("runtime-stage-revision-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await shot(page, viewport.name, "08-observe-revision-approval");
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await page.getByTestId("run-revised-reality-check").click();
    await expect(page.getByTestId("revision-comparison")).toBeVisible();
    await shot(page, viewport.name, "09-observe-revised");
    await page.getByTestId("mode-outcome").click();
    await expect(page.getByTestId("outcome-before-after")).toBeVisible();
    await shot(page, viewport.name, "10-outcome-revised");
  });
}
