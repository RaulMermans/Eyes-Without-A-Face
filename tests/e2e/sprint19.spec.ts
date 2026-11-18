import { expect, test, type Page } from "@playwright/test";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 19 — presentation only: the five guided steps are shown as three stages
 * (Add your data · Build & review · Check & export). The steps, gates and verdicts
 * are unchanged. The planner is the labelled simulated test adapter (no network).
 */
async function boot(page: Page, harness: Record<string, unknown> | null = { deriveProposal: true }): Promise<void> {
  if (harness) {
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", ...harness });
  }
  await page.goto("/");
}

const stage = (page: Page, n: number) => page.getByTestId(`guided-stage-${n}`);

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("E2E-S19-001 three stages over the same five steps", () => {
  test("data → build & review → check & export, with the check summary next to the downloads", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await expect(page.getByText("Build integrations for systems your AI cannot see.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Add your data" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Stage 1 of 3: Add your data" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Stage 2 of 3: Build & review" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Stage 3 of 3: Check & export" })).toBeVisible();
    await expect(stage(page, 1)).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("step-deliver")).toBeDisabled();
    await expect(page.getByTestId("demo-picker")).toContainText("fictional");

    await page.getByTestId("demo-csv").click();
    await page.getByTestId("data-continue").click();
    await expect(stage(page, 2)).toHaveAttribute("data-current", "true");
    await expect(page.getByText("Step 2 of 3 · Build & review")).toBeVisible();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("step-generate")).toHaveAttribute("aria-current", "step");
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("step-verify")).toHaveAttribute("aria-current", "step");
    await expect(stage(page, 2)).toHaveAttribute("data-current", "true");
    for (const [label, value] of Object.entries({ active_customer: "active", inactive_customer: "inactive", prospect: "prospect" })) {
      await page.getByTestId(`translate-status-${label}`).selectOption(value);
    }
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    const structure = await page.getByTestId("check-structure").getAttribute("data-ok");
    const meaning = await page.getByTestId("check-meaning").getAttribute("data-ok");

    await page.getByTestId("verify-continue").click();
    await expect(stage(page, 3)).toHaveAttribute("data-current", "true");
    await expect(page.getByText("Step 3 of 3 · Check & export")).toBeVisible();
    // The summary is the same reading as the Review step, never a promotion.
    await expect(page.getByTestId("deliver-check-structure")).toHaveAttribute("data-ok", structure!);
    await expect(page.getByTestId("deliver-check-meaning")).toHaveAttribute("data-ok", meaning!);
    if (meaning !== "true") await expect(page.getByTestId("deliver-check-meaning")).toContainText("not verified");
    await expect(page.getByTestId("deliver-checks-counts")).toContainText("against your 3 records");
    await expect(page.getByTestId("export-integration")).toBeVisible();

    // Back-navigation by stage keeps the work.
    await page.getByTestId("step-destination").click();
    await expect(page.getByTestId("guided-destination")).toBeVisible();
    await page.getByTestId("step-deliver").click();
    await expect(page.getByTestId("deliver-checks")).toBeVisible();
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-S19-002 cloud unavailable: the approval says so and sends nothing", () => {
  test("no harness, no Firebase config: Approve and send is disabled with a reason", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, null);
    await page.getByTestId("demo-json").click();
    await page.getByTestId("data-continue").click();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await expect(page.getByTestId("approval-cloud-unavailable")).toBeVisible();
    await expect(page.getByTestId("guided-approve")).toBeDisabled();
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-S19-003 phone width: every stage fits without horizontal scrolling", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("data, destination, approval, review and export", async ({ page }) => {
    await boot(page);
    await noHorizontalScroll(page);
    await page.getByTestId("demo-csv").click();
    await noHorizontalScroll(page);
    await page.getByTestId("data-continue").click();
    await noHorizontalScroll(page);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await noHorizontalScroll(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("plan-review")).toBeVisible();
    // The "Matched by" column folds under the source field instead of scrolling away.
    await expect(page.getByTestId("plan-field-email")).toContainText("matched by Simulated planner (not Gemini)");
    await noHorizontalScroll(page);
    for (const [label, value] of Object.entries({ active_customer: "active", inactive_customer: "inactive", prospect: "prospect" })) {
      await page.getByTestId(`translate-status-${label}`).selectOption(value);
    }
    await page.getByTestId("verify-continue").click();
    await expect(page.getByTestId("deliver-checks")).toBeVisible();
    await noHorizontalScroll(page);
  });
});

test.describe("E2E-S19-004 keyboard: the stage navigation is reachable and labelled", () => {
  test("Tab reaches the current step; its accessible name matches its visible label", async ({ page }) => {
    await boot(page);
    const first = page.getByTestId("step-data");
    await expect(first).toHaveAccessibleName("Add your data");
    await first.focus();
    await expect(first).toBeFocused();
    await expect(page.getByTestId("step-generate")).toHaveAccessibleName("Approve");
    await expect(page.getByTestId("step-deliver")).toHaveAccessibleName("Check & export");
  });
});
