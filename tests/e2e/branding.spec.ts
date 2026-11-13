import { expect, test } from "@playwright/test";
import path from "node:path";
import { screenshotDir } from "./helpers.ts";

test.describe("E2E-005 official branding", () => {
  test("renders the supplied emblem, favicon, and responsive layout", async ({ page }) => {
    const broken: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "image" && !response.ok()) {
        broken.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/#technical");
    const headerLogo = page.getByRole("img", { name: "Eyes Without a Face emblem" }).first();
    await expect(headerLogo).toBeVisible();
    const box = await headerLogo.boundingBox();
    expect(box).toBeTruthy();
    expect(box ? Math.abs(box.width - box.height) : 99).toBeLessThan(2);

    const favicon = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(favicon).toBeTruthy();
    const faviconResponse = await page.request.get(new URL(favicon ?? "", page.url()).href);
    expect(faviconResponse.ok()).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(headerLogo).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-005-branding-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: path.join(screenshotDir, "e2e-005-branding-desktop.png"),
      fullPage: true,
    });
    expect(broken, broken.join("\n")).toEqual([]);
  });
});
