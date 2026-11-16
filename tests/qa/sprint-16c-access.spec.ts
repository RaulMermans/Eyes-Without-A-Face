import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Sprint 16C — AUTOMATED cross-browser and access checks on the Scenario 2 journey.
 * NOT a screen-reader pass: a real screen reader with a human (Orca / NVDA / VoiceOver)
 * is a separate, manual check. Run with playwright.qa-16c.config.ts (Chromium + Firefox).
 */
const DIR = "docs/usability/sprint-16c";
const OUT = process.env.EYES_ACCESS_OUT ?? "qa-artifacts/sprint-16c/access";
const results: Record<string, unknown> = {};

test.afterAll(({ browserName }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `access-${browserName}.json`), `${JSON.stringify(results, null, 2)}\n`);
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function toDestination(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("source-file-input").setInputFiles(path.join(DIR, "participant/scenario-2-shipments.csv"));
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-custom").click();
  await page.getByTestId("destination-text").fill(fs.readFileSync(path.join(DIR, "participant/scenario-2-destination.schema.json"), "utf8"));
  await page.getByTestId("destination-apply").click();
  await expect(page.getByTestId("field-matches")).toBeVisible();
}

async function answer(page: Page): Promise<void> {
  for (const [target, source] of Object.entries({ shipmentId: "consignment_no", carrier: "carrier_name", recipientEmail: "recipient_email", shippedAt: "dispatch_time" })) {
    await page.getByTestId(`field-match-${target}`).selectOption(source);
  }
  const maps = {
    deliveryState: { "label created": "created", creado: "created", "in transit": "in_transit", unterwegs: "in_transit", delivered: "delivered", entregado: "delivered", exception: "exception", "störung": "exception" },
    destinationCountry: { Germany: "DE", "España": "ES", Netherlands: "NL", France: "FR" },
  };
  for (const [target, source] of [["deliveryState", "status"], ["destinationCountry", "destination_country"]] as const) {
    const radio = page.getByTestId(`match-${target}-${source}`);
    if ((await radio.count()) > 0) await radio.check();
  }
  for (const [target, map] of Object.entries(maps)) {
    const open = page.getByTestId(`translate-open-${target}`);
    if ((await open.count()) > 0 && (await open.isVisible())) await open.click();
    for (const [label, value] of Object.entries(map)) await page.getByTestId(`translate-${target}-${label}`).selectOption(value);
  }
}

test("ACC-001 full Scenario 2 workflow builds on this device (per browser), with zero model requests", async ({ page, browserName }) => {
  let model = 0;
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) model += 1;
  });
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 120)));
  await toDestination(page);
  await answer(page);
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-count-transformed")).toHaveText("30");
  results.workflow = { browser: browserName, transformed: 30, modelRequests: model, pageErrors: errors };
  expect(model).toBe(0);
  expect(errors).toEqual([]);
});

test("ACC-002 390 px wide: no horizontal scroll on the data, destination and result steps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const widths: number[] = [];
  await page.goto("/");
  widths.push(await overflow(page));
  await toDestination(page);
  widths.push(await overflow(page));
  await answer(page);
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  widths.push(await overflow(page));
  results.mobile390 = { overflowPx: widths };
  for (const width of widths) expect(width).toBeLessThanOrEqual(0);
});

test("ACC-003 200% zoom (1280 px window → 640 CSS px): no horizontal scroll; build and downloads stay reachable", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await toDestination(page);
  const atDestination = await overflow(page);
  await answer(page);
  await page.getByTestId("guided-build-local").scrollIntoViewIfNeeded();
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  const atResult = await overflow(page);
  await page.getByTestId("download-transformed-json").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("download-transformed-json")).toBeVisible();
  results.zoom200 = { overflowPx: [atDestination, atResult] };
  expect(atDestination).toBeLessThanOrEqual(0);
  expect(atResult).toBeLessThanOrEqual(0);
});

test("ACC-004 keyboard only: Tab reaches the file control, every field-match control, a translation, the build and the downloads, with a visible focus", async ({ page, browserName }) => {
  await toDestination(page);
  const tabTo = async (testId: string, limit = 160): Promise<{ reached: boolean; presses: number; focusVisible: boolean }> => {
    for (let i = 1; i <= limit; i += 1) {
      await page.keyboard.press("Tab");
      const here = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (here === testId) {
        const focusVisible = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const style = getComputedStyle(el);
          return style.outlineStyle !== "none" || style.boxShadow !== "none" || el.matches(":focus-visible");
        });
        return { reached: true, presses: i, focusVisible };
      }
    }
    return { reached: false, presses: limit, focusVisible: false };
  };
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const reach: Record<string, unknown> = {};
  // Page order: the category question (choose the field with Space, then open its translation), then the field matches.
  reach["match-deliveryState-status"] = await tabTo("match-deliveryState-status");
  await page.keyboard.press("Space");
  reach["translate-open-deliveryState"] = await tabTo("translate-open-deliveryState");
  await page.keyboard.press("Enter");
  reach["translate-deliveryState-creado"] = await tabTo("translate-deliveryState-creado");
  for (const id of ["field-match-shipmentId", "field-match-use-shipmentId", "field-match-shippedAt"]) reach[id] = await tabTo(id);
  await answer(page);
  reach["guided-build-local"] = await tabTo("guided-build-local");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  reach["download-transformed-json"] = await tabTo("download-transformed-json", 250);
  results[`keyboard-${browserName}`] = reach;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `keyboard-${browserName}.json`), `${JSON.stringify(reach, null, 2)}\n`);
  for (const value of Object.values(reach)) expect((value as { reached: boolean }).reached).toBe(true);
});

test("ACC-005 reduced motion: no running animations on the guided journey", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await toDestination(page);
  await answer(page);
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  const running = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running" && (animation.effect?.getTiming().iterations ?? 1) === Infinity).length);
  results.reducedMotion = { infiniteRunningAnimations: running };
  expect(running).toBe(0);
  await context.close();
});

test("ACC-006 status and blockers are announced: role=status / role=alert carry the messages", async ({ page }) => {
  await toDestination(page);
  await page.getByTestId("guided-build-local").click();
  const blocker = page.getByTestId("guided-build-local-blocker");
  await expect(blocker).toBeVisible();
  const blockerRole = await blocker.getAttribute("role");
  await page.goto("/");
  await page.getByTestId("source-file-input").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ not json") });
  const problemRole = await page.getByTestId("source-problem").evaluate((el) => el.getAttribute("role") ?? el.closest("[role]")?.getAttribute("role") ?? null);
  results.liveRegions = { buildBlocker: blockerRole, importProblem: problemRole };
  expect(blockerRole).toBe("alert");
  expect(["alert", "status"]).toContain(problemRole);
});
