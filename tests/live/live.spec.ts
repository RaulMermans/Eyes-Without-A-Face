import { expect, test } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch } from "../e2e/helpers.ts";

const enabled = process.env.EYES_LIVE_TESTS === "1";
const screenshotDir = "test-results/sprint-1-live";

test.skip(!enabled, "Live Firebase tests are opt-in. Set EYES_LIVE_TESTS=1.");

test.describe("LIVE-001 Chrome capability", () => {
  test("records Chrome, Prompt API, and model availability", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Live on-device checks require desktop Chrome.");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Check local AI availability" }).click();
    const report = page.getByTestId("capability-report");
    await expect(report).toBeVisible();
    const text = await report.innerText();
    await page.screenshot({
      path: path.join(screenshotDir, "live-001-capability.png"),
      fullPage: true,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("LIVE-002 on-device inference", () => {
  test("runs ONLY_ON_DEVICE and records provenance", async ({ page }) => {
    test.skip(process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires downloaded Gemini Nano and EYES_LIVE_ON_DEVICE=1.");
    await page.goto("/");
    await page.getByRole("button", { name: "Initialize local model" }).click({ timeout: 120_000 });
    await page.getByRole("button", { name: "Run local inference" }).click();
    await expect(page.getByTestId("on-device-result-kind")).toHaveText("Real on-device result");
    await expect(page.getByTestId("on-device-result")).toContainText("source=ON_DEVICE");
    await expect(page.getByTestId("on-device-result")).toContainText("simulated=false");
  });
});

test.describe("LIVE-003 cloud inference", () => {
  test("sends an approved synthetic payload to ONLY_IN_CLOUD", async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1", "Requires Firebase credentials and EYES_LIVE_CLOUD=1.");
    await page.goto("/");
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    await page.getByRole("button", { name: "Approve payload" }).click();
    await page.getByTestId("run-cloud-inference").click();
    await expect(page.getByTestId("cloud-result-kind")).toHaveText("Real cloud result");
    await expect(page.getByTestId("cloud-result")).toContainText("source=IN_CLOUD");
    await expect(page.getByTestId("cloud-result")).toContainText("simulated=false");
  });
});

test.describe("LIVE-004 network and disclosure", () => {
  test("rejected requests do not send cloud inference", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.goto("/");
    await expect(page.getByTestId("run-cloud-inference")).toBeDisabled();
    await page.waitForTimeout(500);
    expect(
      providerRequests.filter((url) => url.includes("generateContent") || url.includes("/models/")),
    ).toEqual([]);
  });
});

test.describe("LIVE-005 browser error inspection", () => {
  test("captures console exceptions during a diagnostic visit", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Check local AI availability" }).click();
    await page.screenshot({
      path: path.join(screenshotDir, "live-005-errors.png"),
      fullPage: true,
    });
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
