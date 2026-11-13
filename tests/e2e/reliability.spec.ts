import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 9 Workstream B — provider failures produce safe, understandable,
 * recoverable states. The cloud adapter is the labeled TEST adapter; failures
 * are injected (including the verbatim Sprint 8 provider message, which runs
 * through the real classifier). No network request is made.
 */
const shots = "test-results/sprint-9-screenshots";
const SPRINT8_HIGH_DEMAND =
  "AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/demo/models/gemini-3.5-flash-lite:generateContent: [500 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again";

async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", deriveProposal: true, ...harness });
  await page.goto("/");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

async function toMapping(page: Page): Promise<string> {
  await page.getByTestId("load-crm-sample").click();
  await page.getByTestId("continue-to-twin").click();
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  const requestId = (await page.getByTestId("review-request-id").textContent()) ?? "";
  await page.getByTestId("approve-disclosure").click();
  await page.getByTestId("continue-to-mapping").click();
  return requestId;
}

test.describe("E2E-093 provider overload → explicit fresh request with fresh approval", () => {
  test("classifies the real Sprint 8 message, hides raw text, and recovers without reusing the approval", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { cloudRawError: SPRINT8_HIGH_DEMAND, cloudFailCalls: [0] });
    const firstRequest = await toMapping(page);
    await page.getByTestId("send-cloud-request").click();

    const error = page.getByTestId("cloud-error");
    await expect(error).toHaveAttribute("data-code", "PROVIDER_OVERLOADED");
    await expect(error).toContainText("Gemini is overloaded right now");
    await expect(error.locator('[data-guidance="why"]')).toContainText("provider's side");
    // Raw provider text is not shown by default (collapsed local detail only).
    await expect(page.getByTestId("cloud-error-detail")).toBeHidden();
    for (const part of ["what", "why", "next"]) await expect(error.locator(`[data-guidance="${part}"]`)).not.toContainText("firebasevertexai");
    // The consumed approval cannot send again.
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    expect(await cloudCalls(page)).toBe(1);
    await page.screenshot({ path: path.join(shots, "e2e-093-overloaded.png"), fullPage: false });

    // Recovery: a NEW preview with a NEW request id, pending approval. Nothing is sent by preparing it.
    await page.getByTestId("prepare-fresh-request").click();
    await expect(page.locator("#step-heading")).toHaveText("Disclosure Review");
    const secondRequest = (await page.getByTestId("review-request-id").textContent()) ?? "";
    expect(secondRequest.length).toBeGreaterThan(8);
    expect(secondRequest).not.toBe(firstRequest);
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Valid");
    await expect(page.getByTestId("proposal-origin")).toHaveText("Simulated test adapter — not Gemini");
    expect(await cloudCalls(page)).toBe(2);
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-094 every provider condition explains itself", () => {
  for (const [harness, code, text] of [
    [{ cloudErrorCode: "TIMEOUT" }, "TIMEOUT", "did not answer in time"],
    [{ cloudRawError: "AI: Error fetching from https://x: [429 ] Resource has been exhausted (e.g. check quota)." }, "RATE_LIMITED", "rate or quota limit"],
    [{ cloudErrorCode: "APP_CHECK_REJECTED" }, "APP_CHECK_REJECTED", "approved domain"],
    [{ cloudErrorCode: "MODEL_UNAVAILABLE" }, "MODEL_UNAVAILABLE", "No other model is substituted"],
    [{ malformedCloudOutput: { operations: [{ op: "eval_js", from: "f_01", to: "id" }], rationale: "x" } }, "INVALID_STRUCTURED_OUTPUT", "It was not repaired"],
  ] as const) {
    test(`${code}`, async ({ page }) => {
      await boot(page, harness);
      await toMapping(page);
      await page.getByTestId("send-cloud-request").click();
      const error = page.getByTestId("cloud-error");
      await expect(error).toHaveAttribute("data-code", code);
      await expect(error).toContainText(text);
      await expect(error.locator('[data-guidance="next"]')).not.toBeEmpty();
      await expect(page.getByTestId("use-manual-contract")).toBeVisible();
      await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
      expect(await cloudCalls(page)).toBe(1);
    });
  }

  test("the manual fallback is one click away and labeled manual", async ({ page }) => {
    await boot(page, { cloudErrorCode: "APP_CHECK_REJECTED" });
    await toMapping(page);
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("prepare-fresh-request")).toHaveCount(0);
    await page.getByTestId("use-manual-contract").click();
    await expect(page.getByTestId("manual-contract")).toHaveAttribute("open", "");
    await expect(page.getByTestId("manual-contract")).toContainText("not AI");
  });
});

test.describe("E2E-095 honest pending state and Stop waiting", () => {
  test("shows elapsed time without a fake percentage; a stopped request's late answer is discarded", async ({ page }) => {
    await boot(page, { cloudDelayMs: 2500 });
    await toMapping(page);
    await page.getByTestId("send-cloud-request").click();
    const pending = page.getByTestId("cloud-pending");
    await expect(pending).toContainText("Cloud · Gemini via Firebase AI Logic");
    await expect(pending).toContainText("gives up at 45 s");
    await expect(pending).not.toContainText("%");
    await page.getByTestId("cloud-pending-stop").click();
    await expect(page.getByTestId("cloud-error")).toHaveAttribute("data-code", "CANCELLED");
    await expect(page.getByTestId("cloud-error")).toContainText("its answer will be discarded");
    // Wait past the simulated answer: it must not appear as a proposal.
    await page.waitForTimeout(3000);
    await expect(page.getByTestId("proposal")).toHaveCount(0);
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-096 a failed revision keeps the initial mapping and its export", () => {
  test("revision TIMEOUT: classified, budget spent, initial mapping still exportable with its own status", async ({ page }) => {
    await boot(page, { cloudErrorCode: "TIMEOUT", cloudFailCalls: [1] });
    await toMapping(page);
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Valid");
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await page.getByTestId("prepare-safe-revision").click();
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    const blocked = page.getByTestId("revision-blocked");
    await expect(blocked).toHaveAttribute("data-failure", "TIMEOUT");
    await expect(page.getByTestId("revision-failure")).toContainText("budget for this mapping is spent");
    await expect(page.getByTestId("revision-failure")).toContainText("export it with its own status");
    await expect(page.getByTestId("revision-budget")).toHaveText("0 of 1 remaining (used)");
    await expect(page.getByTestId("prepare-safe-revision")).toBeDisabled();
    expect(await cloudCalls(page)).toBe(2);
    // The initial mapping is still a candidate; no revised candidate exists.
    await expect(page.getByTestId("export-panel")).toBeVisible();
    await expect(page.getByTestId("export-candidates")).toHaveCount(0);
    await expect(page.getByTestId("export-state")).not.toHaveText(/Blocked/);
    await page.screenshot({ path: path.join(shots, "e2e-096-revision-timeout.png"), fullPage: false });
  });
});

test.describe("E2E-097 runtime preflight", () => {
  test("reports unconfigured AI honestly and sends no request", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.goto("/");
    const preflight = page.getByTestId("runtime-preflight");
    await preflight.locator("summary").click();
    await expect(page.getByTestId("preflight-firebase")).toHaveAttribute("data-status", "UNAVAILABLE");
    await expect(page.getByTestId("preflight-cloud")).toHaveAttribute("data-status", "UNAVAILABLE");
    await expect(page.getByTestId("preflight-on-device")).toHaveAttribute("data-status", "UNAVAILABLE");
    await expect(preflight).toContainText("never tested automatically");
    await expect(page.getByTestId("preflight-app-check")).toHaveAttribute("data-status", "UNAVAILABLE");
    expect(providerRequests).toEqual([]);
  });
});
