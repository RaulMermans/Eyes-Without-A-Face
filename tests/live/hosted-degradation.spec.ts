import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Sprint 12 hosted acceptance, unsupported environments: a browser WITHOUT
 * Gemini Nano loads the deployed build, says honestly that the run is
 * deterministic, still builds the integration locally, and sends nothing.
 * It stops at the approval, so it spends no cloud quota.
 *
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_HOSTED=1, with playwright.hosted.config.ts
 * (projects `hosted-chromium-no-nano`, `hosted-firefox`).
 * Evidence: codes, counts and states only.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_HOSTED === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_HOSTED=1.");

const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-12/hosted-degradation.json";

test("HOSTED-DEG without on-device AI: honest deterministic path, nothing sent", async ({ page, browserName, baseURL }) => {
  const errors: string[] = [];
  let generateContent = 0;
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) generateContent += 1;
  });
  const entry: Record<string, unknown> = { check: "HOSTED-DEG", at: new Date().toISOString(), baseURL, browserName, version: page.context().browser()?.version() ?? null };
  try {
    const info = (await (await page.request.get("/build-info.json")).json()) as { gitSha: string };
    entry.gitSha = info.gitSha;
    await page.goto("/#technical");
    entry.footerHasBuild = (await page.locator("footer").innerText()).includes(info.gitSha.slice(0, 12));
    await page.getByTestId("start-demo").click();
    const card = page.getByTestId("connect-on-device-unavailable");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Deterministic, not hybrid");
    await expect(card).toContainText("Still works");
    entry.unavailableCard = true;
    entry.interpretOffered = await page.getByTestId("interpret-private-on-device").count();
    await page.getByTestId("build-integration").click();
    await expect(page.getByTestId("runtime-stage-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    entry.onDeviceStage = await page.getByTestId("runtime-stage-on-device").getAttribute("data-status");
    entry.gate = await page.getByTestId("privacy-boundary").getAttribute("data-gate");
  } finally {
    entry.generateContent = generateContent;
    entry.pageErrors = errors;
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    const previous = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
    fs.writeFileSync(evidencePath, JSON.stringify([...previous, entry], null, 2));
  }
  expect(entry.onDeviceStage).toBe("skipped");
  expect(entry.interpretOffered).toBe(0);
  expect(generateContent).toBe(0);
  expect(errors).toEqual([]);
});
