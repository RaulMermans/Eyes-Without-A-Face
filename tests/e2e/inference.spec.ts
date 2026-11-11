import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, screenshotDir } from "./helpers.ts";

async function gotoWithHarness(
  page: Page,
  harness: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/");
}

test.describe("E2E-006 unconfigured Firebase", () => {
  test("shows unavailable AI states and no false success", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.goto("/");
    await expect(page.getByTestId("on-device-status")).toContainText("Unavailable");
    await expect(page.getByTestId("cloud-status")).toContainText("Unavailable");
    await expect(page.getByTestId("on-device-result")).toHaveCount(0);
    await expect(page.getByTestId("cloud-result")).toHaveCount(0);
    await page.getByRole("button", { name: "Run local inference" }).click();
    await expect(page.getByTestId("diagnostic-error")).toBeVisible();
    await expect(page.getByTestId("diagnostic-error")).not.toContainText("Real on-device result");
    expect(providerRequests).toEqual([]);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-006-unconfigured.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-007 cloud approval required", () => {
  test("does not run cloud inference without approval", async ({ page }) => {
    await gotoWithHarness(page, {});
    await expect(page.getByTestId("approval-status")).toContainText("Approval required");
    await expect(page.getByTestId("run-cloud-inference")).toBeDisabled();
    await expect(page.getByTestId("cloud-result")).toHaveCount(0);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-007-approval-required.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-008 payload integrity", () => {
  test("invalidates authorization after the payload changes", async ({ page }) => {
    await gotoWithHarness(page, {});
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    await page.getByRole("button", { name: "Approve payload" }).click();
    await expect(page.getByTestId("approval-status")).toContainText("Approved for request");
    const editor = page.getByTestId("cloud-payload-editor");
    const current = await editor.inputValue();
    await editor.fill(current.replace("work email address", "work email address changed"));
    await expect(page.getByTestId("approval-status")).toContainText("Approval required");
    await expect(page.getByTestId("run-cloud-inference")).toBeDisabled();
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-008-payload-integrity.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-009 local model unavailable", () => {
  test("fails closed without cloud fallback", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await gotoWithHarness(page, { onDeviceUnavailable: true });
    await page.getByRole("button", { name: "Run local inference" }).click();
    await expect(page.getByTestId("diagnostic-error")).toContainText(/unavailable|MODEL_UNAVAILABLE/i);
    await expect(page.getByTestId("cloud-result")).toHaveCount(0);
    expect(providerRequests).toEqual([]);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-009-local-unavailable.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-010 malformed AI response", () => {
  test("rejects invalid structured output from the test adapter", async ({ page }) => {
    await gotoWithHarness(page, {
      malformedCloudOutput: { nope: true },
    });
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    await page.getByRole("button", { name: "Approve payload" }).click();
    await page.getByTestId("run-cloud-inference").click();
    await expect(page.getByTestId("diagnostic-error")).toContainText(/INVALID_STRUCTURED_OUTPUT|schema/i);
    await expect(page.getByTestId("cloud-result")).toHaveCount(0);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-010-malformed.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-011 successful controlled flow", () => {
  test("preview, approve, and display a labeled test-adapter result", async ({ page }) => {
    await gotoWithHarness(page, {});
    await expect(page.getByTestId("test-adapter-banner")).toBeVisible();
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    await page.getByRole("button", { name: "Approve payload" }).click();
    await page.getByTestId("run-cloud-inference").click();
    await expect(page.getByTestId("cloud-result-kind")).toHaveText("Simulated test result");
    await expect(page.getByTestId("cloud-result")).toContainText("simulated=true");
    await expect(page.getByTestId("cloud-result")).not.toContainText("Real cloud result");
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-011-controlled-flow.png"),
      fullPage: true,
    });
  });
});
