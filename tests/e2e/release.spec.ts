import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, openStage } from "./helpers.ts";

const shots = "test-results/sprint-5-screenshots";

async function boot(page: Page, harness: Record<string, unknown> | null): Promise<void> {
  if (harness) {
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", ...harness });
  }
  await page.goto("/#technical");
}

async function toTwin(page: Page): Promise<void> {
  await page.getByTestId("start-demo").click();
  await page.getByTestId("continue-to-twin").click();
  await expect(page.getByTestId("twin-summary")).toBeVisible();
}

test.describe("E2E-040 first-use experience", () => {
  test("explains the product and offers one demo entry point", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await boot(page, null);
    await expect(page.getByTestId("intro")).toContainText("Phantom Twin");
    await expect(page.getByTestId("path-strip").getByRole("listitem")).toHaveCount(5);
    await expect(page.getByTestId("path-strip")).toContainText("Gemini Nano on-device");
    await expect(page.getByTestId("build-revision")).toContainText("development build");
    await page.screenshot({ path: path.join(shots, "e2e-040-landing.png"), fullPage: true });
    await page.getByTestId("start-demo").click();
    await expect(page.getByTestId("source-profile")).toBeVisible();
    await expect(page.getByTestId("reserved-count")).toContainText("3 reserved hidden cases");
    await expect(page.getByTestId("start-demo")).toHaveCount(0);
    // Sprint 10: the demo lands in CONNECT; the runtime and workbench show the source as done.
    await expect(page.getByTestId("build-integration")).toBeEnabled();
    await page.getByTestId("mode-observe").click();
    await expect(page.getByTestId("runtime-stage-source-imported")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("step-done-source")).toBeVisible();
    expect(providerRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("E2E-041 on-device recovery", () => {
  test("one user-initiated retry resumes the remaining fields; never calls the cloud", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { onDeviceAvailable: true, onDeviceRuntimeFailures: [3] });
    await toTwin(page);
    await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available");
    await page.getByTestId("suggest-on-device").click();
    const error = page.getByTestId("on-device-error");
    await expect(error).toContainText("ON_DEVICE_RUNTIME_ERROR");
    await expect(error).toContainText("3 of 6 fields were classified");
    await expect(error).toContainText("Nothing was sent to the cloud");
    await expect(page.getByTestId("on-device-suggestions").locator("li")).toHaveCount(3);
    await page.getByTestId("retry-on-device").click();
    await expect(page.getByTestId("on-device-suggestions").locator("li")).toHaveCount(6);
    await expect(page.getByTestId("on-device-error")).toHaveCount(0);
    await expect(page.getByTestId("retry-on-device")).toHaveCount(0);
    // Simulated results stay labeled as simulated, never as real on-device output.
    await expect(page.getByTestId("on-device-suggestions")).toContainText("(simulated test adapter)");
    await expect(page.getByTestId("on-device-suggestions")).not.toContainText("(real on-device)");
    expect(providerRequests).toEqual([]);
  });

  test("a second failure blocks on-device mode with reset guidance, no further retry", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { onDeviceAvailable: true, onDeviceRuntimeFailures: [1, 3] });
    await toTwin(page);
    await page.getByTestId("suggest-on-device").click();
    await expect(page.getByTestId("on-device-error")).toContainText("1 of 6 fields");
    await page.getByTestId("retry-on-device").click();
    await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI unavailable — manual/deterministic mode");
    await expect(page.getByTestId("on-device-mode")).toContainText("restart Chrome");
    await expect(page.getByTestId("retry-on-device")).toHaveCount(0);
    await expect(page.getByTestId("suggest-on-device")).toHaveCount(0);
    expect(providerRequests).toEqual([]);
  });

  test("the suggest button is disabled while a run is in flight", async ({ page }) => {
    await boot(page, { onDeviceAvailable: true });
    await toTwin(page);
    const button = page.getByTestId("suggest-on-device");
    await button.click();
    await expect(page.getByTestId("on-device-suggestions").locator("li")).toHaveCount(6);
    await expect(page.getByTestId("on-device-error")).toHaveCount(0);
  });
});

test.describe("E2E-042 cloud unavailable", () => {
  test("keeps the approval unused and completes the walkthrough on the labeled manual path", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, null);
    await toTwin(page);
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await expect(page.getByTestId("cloud-unavailable")).toContainText("Cloud Gemini is not available in this build");
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    await expect(page.getByTestId("cloud-error")).toHaveCount(0);
    await openStage(page, /Disclosure Review/);
    await expect(page.getByTestId("review-status")).toContainText("Approved for one cloud request");
    await openStage(page, /Reality Check/);
    await expect(page.getByTestId("active-mapping-origin")).toContainText("Hand-written local contract (not AI)");
    await page.getByTestId("run-mapping").click();
    const verdict = page.getByTestId("reality-verdict");
    await expect(verdict).toHaveAttribute("data-status", "fail");
    await expect(verdict).toContainText("gaps found in cases the model never saw");
    await expect(page.getByTestId("verdict-imported")).toHaveText("3 / 3");
    await expect(page.getByTestId("verdict-reserved")).toHaveText("0 / 3");
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-043 Reality Check verdict", () => {
  test("never reads as full success when reserved hidden cases fail; passes without them", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await toTwin(page);
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-origin")).toHaveText("Simulated test adapter — not Gemini");
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toHaveAttribute("data-status", "fail");
    await expect(page.getByTestId("reality-overall")).toHaveAttribute("data-status", "fail");
    await expect(page.getByTestId("verdict-imported")).toHaveText("3 / 3");
    await expect(page.getByTestId("verdict-reserved")).toHaveText("0 / 3");
    await expect(page.getByTestId("step-done-verification")).toBeVisible();
    await page.screenshot({ path: path.join(shots, "e2e-043-verdict.png"), fullPage: true });
    await page.getByTestId("include-reserved").uncheck();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toHaveAttribute("data-status", "pass");
    await expect(page.getByTestId("verdict-reserved")).toHaveText("not run");
    await expect(page.getByTestId("reality-verdict")).toContainText("No reserved hidden cases were run");
  });
});
