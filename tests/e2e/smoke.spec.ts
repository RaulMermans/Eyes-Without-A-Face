import { expect, test } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, screenshotDir } from "./helpers.ts";

test.describe("E2E-001 application boot", () => {
  test("renders identity without uncaught errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Eyes Without a Face" })).toBeVisible();
    await expect(page.getByText("Build for systems your AI cannot see.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workflow" })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-001-boot.png"),
      fullPage: true,
    });
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("E2E-002 workflow navigation", () => {
  test("moves between shell sections", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Source System/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Source System" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import source JSON" })).toBeVisible();
    await page.getByRole("button", { name: /Reality Check/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Reality Check" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Local mapping execution" })).toBeVisible();
    await page.getByRole("button", { name: /Export/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Export" })).toBeVisible();
    await expect(page.getByText("Export is not implemented yet")).toBeVisible();
    await page.getByRole("button", { name: /Phantom Twin/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Phantom Twin" })).toBeVisible();
    await expect(page.getByTestId("twin-empty")).toBeVisible();
    await page.getByRole("button", { name: /Disclosure Review/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Disclosure Review" })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-002-workflow.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-003 responsive UI", () => {
  test("desktop and compact viewports remain usable", async ({ page }) => {
    await page.goto("/");
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desktopOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-003-desktop.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export/ })).toBeVisible();
    const compactOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(compactOverflow).toBeLessThanOrEqual(8);
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-003-mobile.png"),
      fullPage: true,
    });
  });
});

test.describe("E2E-004 configuration safety", () => {
  test("loads without Firebase credentials and does not call AI providers", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.goto("/");
    await expect(page.getByTestId("on-device-status")).toContainText("Unavailable");
    await expect(page.getByTestId("cloud-status")).toContainText("Unavailable");
    await expect(page.getByTestId("live-inference")).toHaveText("none");
    await expect(page.getByTestId("on-device-status")).toContainText(
      /feature flag off|Firebase config missing/i,
    );
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-004-unconfigured.png"),
      fullPage: true,
    });
    expect(providerRequests, providerRequests.join("\n")).toEqual([]);
  });
});
