import { expect, test } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, screenshotDir, openStage } from "./helpers.ts";

const crmSource = path.join(process.cwd(), "src/examples/crm/source-records.json");
const invalidSource = path.join(process.cwd(), "src/examples/crm/invalid-source.txt");

test.describe("E2E-016 JSON import", () => {
  test("imports valid source JSON and inspects it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("source-file-input").setInputFiles(crmSource);
    await expect(page.getByTestId("source-inspect")).toContainText("fictional-crm-accounts");
    await expect(page.getByTestId("source-inspect")).toContainText("3 records");
    await page.getByText("Inspect first record").click();
    await expect(page.getByTestId("source-first-record")).toContainText("CUST-001");
    await page.screenshot({ path: path.join(screenshotDir, "e2e-016-import.png"), fullPage: true });
  });
});

test.describe("E2E-017 invalid source", () => {
  test("malformed input produces a useful error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("source-file-input").setInputFiles(invalidSource);
    await expect(page.getByTestId("source-import-error")).toContainText(/malformed/i);
    await page.screenshot({ path: path.join(screenshotDir, "e2e-017-invalid-source.png"), fullPage: true });
  });
});

test.describe("E2E-018 target schema", () => {
  test("loads and validates the destination JSON Schema", async ({ page }) => {
    await page.goto("/");
    await openStage(page, /Phantom Twin/);
    await page.getByTestId("validate-destination-schema").click();
    await expect(page.getByTestId("destination-schema-ok")).toContainText("valid JSON Schema 2020-12");
    await expect(page.getByTestId("destination-schema-editor")).toContainText("helpdesk-account");
    await page.screenshot({ path: path.join(screenshotDir, "e2e-018-target-schema.png"), fullPage: true });
  });
});

test.describe("E2E-019 mapping execution", () => {
  test("transforms fictional CRM records locally", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("mapping-summary")).toContainText("3 passed");
    await expect(page.getByTestId("mapping-summary")).toContainText("batch ok");
    await expect(page.getByTestId("reality-overall")).toHaveAttribute("data-status", "pass");
    await expect(page.getByTestId("status-hiddenCases")).toHaveText("not_evaluated");
    await page.screenshot({ path: path.join(screenshotDir, "e2e-019-execution.png"), fullPage: true });
  });
});

test.describe("E2E-020 output correctness", () => {
  test("transformed result matches the expected Alice record", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    const output = page.getByTestId("mapping-output-0");
    await expect(output).toContainText('"id": "CUST-001"');
    await expect(output).toContainText('"email": "alice@example.com"');
    await expect(output).toContainText('"status": "active"');
    await expect(output).toContainText('"createdAt": "2026-01-15"');
    await expect(output).toContainText('"organization": "Example Studio"');
    await page.screenshot({ path: path.join(screenshotDir, "e2e-020-output.png"), fullPage: true });
  });
});

test.describe("E2E-021 invalid mapping", () => {
  test("unsupported transformation is rejected", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Cloud Mapping/);
    await page.getByTestId("manual-contract").locator("summary").click();
    await page.getByTestId("load-unsupported-mapping").click();
    await page.getByTestId("validate-mapping-contract").click();
    await expect(page.getByTestId("mapping-contract-error")).toBeVisible();
    await openStage(page, /Reality Check/);
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("mapping-summary")).toContainText("batch failed");
    await expect(page.getByTestId("mapping-record-0")).toContainText("INVALID_MAPPING_CONTRACT");
    await expect(page.getByTestId("status-mappingContract")).toHaveText("fail");
    await expect(page.getByTestId("status-execution")).toHaveText("not_evaluated");
    await expect(page.getByTestId("reality-overall")).toHaveAttribute("data-status", "fail");
    await page.screenshot({ path: path.join(screenshotDir, "e2e-021-invalid-mapping.png"), fullPage: true });
  });
});

test.describe("E2E-022 hidden edge case", () => {
  test("unmapped status produces a real validation failure", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("scenario-picker").locator("summary").click();
    await page.getByTestId("load-edge-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("mapping-record-0")).toContainText("UNMAPPED_ENUM");
    await expect(page.getByTestId("mapping-record-0")).toContainText("vip_customer");
    await expect(page.getByTestId("mapping-summary")).toContainText("batch failed");
    await page.screenshot({ path: path.join(screenshotDir, "e2e-022-unmapped.png"), fullPage: true });
  });
});

test.describe("E2E-023 no network dependency", () => {
  test("local mapping runs with AI provider requests blocked", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.route("**/*", async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (
        host.includes("googleapis.com") ||
        host.includes("firebase") ||
        host.includes("google.com")
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("mapping-output-0")).toContainText("alice@example.com");
    expect(providerRequests).toEqual([]);
    await page.screenshot({ path: path.join(screenshotDir, "e2e-023-offline-mapping.png"), fullPage: true });
  });
});

test.describe("E2E-024 UI integrity", () => {
  test("keeps navigation, layout, and error-free mapping workflow", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    for (const name of ["Source System", "Phantom Twin", "Disclosure Review", "Cloud Mapping", "Reality Check"]) {
      await openStage(page, new RegExp(name));
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await openStage(page, /Source System/);
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("mapping-summary")).toContainText("batch ok");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const compactOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(compactOverflow).toBeLessThanOrEqual(8);
    await page.screenshot({ path: path.join(screenshotDir, "e2e-024-ui.png"), fullPage: true });
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
