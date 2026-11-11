import type { Page } from "@playwright/test";
import { expect, test, usingDedicatedProfile } from "./fixtures.ts";
import fs from "node:fs";
import path from "node:path";
import { attachProviderWatch, openDiagnostics } from "../e2e/helpers.ts";

const enabled = process.env.EYES_LIVE_TESTS === "1";
const screenshotDir = "test-results/sprint-4-live";
const evidencePath = path.join(screenshotDir, "evidence.json");

test.skip(!enabled, "Live Firebase tests are opt-in. Set EYES_LIVE_TESTS=1.");

/**
 * Optional pre-registered App Check debug token, read from a non-VITE shell
 * variable and injected at runtime. Playwright starts a fresh browser profile
 * each run, so the SDK-generated token would otherwise change every time.
 * The token is never written to evidence, screenshots, or Git.
 */
const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";

test.beforeEach(async ({ page }) => {
  if (debugToken) {
    await page.addInitScript((token) => {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, debugToken);
  }
});

async function gotoDiagnostics(page: Page): Promise<void> {
  await page.goto("/");
  await openDiagnostics(page);
}

async function collectEvidence(
  page: Page,
  extra: Record<string, unknown>,
): Promise<void> {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const payload = {
    at: new Date().toISOString(),
    userAgent,
    browserLaunch: usingDedicatedProfile ? "dedicated-chrome-profile" : "playwright-default-args",
    ...extra,
  };
  const previous = fs.existsSync(evidencePath)
    ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[])
    : [];
  previous.push(payload);
  fs.writeFileSync(evidencePath, JSON.stringify(previous, null, 2));
}

function sanitizeUrls(urls: string[]): string[] {
  return urls.map((url) => {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  });
}

test.describe("LIVE-001 browser compatibility", () => {
  test("identifies Chrome, Prompt API, and model readiness", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Live on-device checks require desktop Chrome.");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await gotoDiagnostics(page);
    await page.getByRole("button", { name: "Check local AI availability" }).click();
    const report = page.getByTestId("capability-report");
    await expect(report).toBeVisible();
    const text = await report.innerText();
    await page.screenshot({
      path: path.join(screenshotDir, "live-001-capability.png"),
      fullPage: true,
    });
    await collectEvidence(page, {
      check: "LIVE-001",
      capability: text,
      pageErrors,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("LIVE-002 Firebase initialization", () => {
  test("shows the registered Firebase project and web app", async ({ page }) => {
    await gotoDiagnostics(page);
    const projectId = (await page.getByTestId("firebase-config-status").innerText()).trim();
    const appId = (await page.getByTestId("firebase-app-id").innerText()).trim();
    await page.screenshot({
      path: path.join(screenshotDir, "live-002-firebase-init.png"),
      fullPage: true,
    });
    await collectEvidence(page, { check: "LIVE-002", projectId, appId });
    if (projectId === "unconfigured") {
      test.info().annotations.push({
        type: "blocked",
        description: "Firebase web config is not loaded in this live session.",
      });
    } else {
      expect(projectId).toBe("eyes-without-a-face-b7281");
      expect(appId).toContain("1:507051460368:web:");
    }
  });
});

test.describe("LIVE-003 App Check", () => {
  test("records App Check readiness before any cloud generate", async ({ page }) => {
    await gotoDiagnostics(page);
    const status = (await page.getByTestId("app-check-status").innerText()).trim();
    await page.screenshot({
      path: path.join(screenshotDir, "live-003-app-check.png"),
      fullPage: true,
    });
    await collectEvidence(page, { check: "LIVE-003", appCheck: status });
    expect(status.length).toBeGreaterThan(0);
  });
});

test.describe("LIVE-004 real Gemini cloud", () => {
  test("executes an approved synthetic mapping request", async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1", "Requires Firebase credentials and EYES_LIVE_CLOUD=1.");
    const started = Date.now();
    await gotoDiagnostics(page);
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    await expect(page.getByTestId("outbound-prompt")).toContainText("Approved disclosure payload:");
    await page.getByRole("button", { name: "Approve payload" }).click();
    await page.getByTestId("run-cloud-inference").click();
    const error = page.getByTestId("diagnostic-error");
    const result = page.getByTestId("cloud-result");
    await expect(error.or(result)).toBeVisible({ timeout: 60_000 });
    const errorText = (await error.count()) > 0 ? await error.innerText() : null;
    const resultText = (await result.count()) > 0 ? await result.innerText() : null;
    await page.screenshot({
      path: path.join(screenshotDir, "live-004-cloud.png"),
      fullPage: true,
    });
    await collectEvidence(page, {
      check: "LIVE-004",
      durationMs: Date.now() - started,
      errorText,
      resultKind: resultText,
    });
    if (errorText) {
      throw new Error(`Live cloud inference did not succeed: ${errorText}`);
    }
    await expect(page.getByTestId("cloud-result-kind")).toHaveText("Real cloud result");
    await expect(page.getByTestId("cloud-result")).toContainText("source=IN_CLOUD");
    await expect(page.getByTestId("cloud-result")).toContainText("simulated=false");
  });
});

test.describe("LIVE-005 rejected disclosure", () => {
  test("does not dispatch cloud inference without approval", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await page.goto("/");
    await expect(page.getByTestId("run-cloud-inference")).toBeDisabled();
    await page.waitForTimeout(500);
    const inferenceUrls = sanitizeUrls(
      providerRequests.filter(
        (url) => url.includes("generateContent") || url.includes(":generateContent"),
      ),
    );
    await collectEvidence(page, { check: "LIVE-005", inferenceUrls });
    expect(inferenceUrls).toEqual([]);
  });
});

test.describe("LIVE-006 payload integrity", () => {
  test("preview fingerprint matches the displayed outbound prompt", async ({ page }) => {
    await gotoDiagnostics(page);
    await page.getByRole("button", { name: "Preview cloud payload" }).click();
    const hash = await page.getByTestId("payload-hash").innerText();
    const prompt = await page.getByTestId("outbound-prompt").innerText();
    await page.screenshot({
      path: path.join(screenshotDir, "live-006-payload.png"),
      fullPage: true,
    });
    await collectEvidence(page, {
      check: "LIVE-006",
      hashPresent: hash.includes("payload") && hash.includes("outbound"),
      promptChars: prompt.length,
    });
    expect(hash).toMatch(/payload [a-f0-9]{64}/);
    expect(hash).toMatch(/outbound [a-f0-9]{64}/);
    expect(prompt).toContain("Approved disclosure payload:");
  });
});

test.describe("LIVE-007 on-device inference", () => {
  test("attempts ONLY_ON_DEVICE and records provenance or the blocker", async ({ page }) => {
    await gotoDiagnostics(page);
    await page.getByRole("button", { name: "Check local AI availability" }).click();
    const capability = await page.getByTestId("capability-report").innerText();
    if (process.env.EYES_LIVE_ON_DEVICE === "1") {
      const providerRequests = attachProviderWatch(page);
      const started = Date.now();
      await page.getByRole("button", { name: "Initialize local model" }).click({ timeout: 120_000 });
      await page.getByRole("button", { name: "Run local inference" }).click();
      await expect(page.getByTestId("on-device-result-kind")).toHaveText("Real on-device result", { timeout: 120_000 });
      await expect(page.getByTestId("on-device-result")).toContainText("source=ON_DEVICE");
      const resultText = await page.getByTestId("on-device-result").innerText();
      const cloudInferenceUrls = sanitizeUrls(providerRequests.filter((url) => url.includes("generateContent")));
      await page.screenshot({ path: path.join(screenshotDir, "live-007-on-device.png"), fullPage: true });
      await collectEvidence(page, {
        check: "LIVE-007",
        status: "PASS",
        capability,
        durationMs: Date.now() - started,
        result: resultText,
        cloudInferenceUrls,
      });
      expect(cloudInferenceUrls).toEqual([]);
      return;
    }
    await page.getByRole("button", { name: "Run local inference" }).click();
    const error = page.getByTestId("diagnostic-error");
    await expect(error).toBeVisible();
    const errorText = await error.innerText();
    await page.screenshot({
      path: path.join(screenshotDir, "live-007-on-device.png"),
      fullPage: true,
    });
    await collectEvidence(page, {
      check: "LIVE-007",
      status: "BLOCKED",
      capability,
      errorText,
    });
    expect(errorText).toMatch(/unavailable|UNSUPPORTED|MODEL_UNAVAILABLE|MISSING_CONFIG|FEATURE/i);
    await expect(page.getByTestId("cloud-result")).toHaveCount(0);
  });
});

test.describe("LIVE-008 UI regression", () => {
  test("captures console errors and responsive diagnostic layout", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await gotoDiagnostics(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Check local AI availability" }).click();
    await page.screenshot({
      path: path.join(screenshotDir, "live-008-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Hybrid AI diagnostic workspace" })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, "live-008-mobile.png"),
      fullPage: true,
    });
    await collectEvidence(page, { check: "LIVE-008", pageErrors });
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});

test.describe("LIVE-009 Sprint 3 Phantom Twin workflow with real Gemini", () => {
  test("approved twin → IN_CLOUD proposal → validation → alias resolution → local Reality Check", async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1", "Requires Firebase credentials and EYES_LIVE_CLOUD=1.");
    const providerRequests = attachProviderWatch(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // LIVE-015: scan every real generateContent body for private terms. Bodies are never stored.
    const privateTerms = ["PRIVATE_CANARY_PII_DO_NOT_SHARE", "customer_id", "email_address", "account_state", "CUST-001", "alice@example.com", "ALICE@EXAMPLE.COM", "vip_customer", "Example Studio"];
    const bodyScan = { requests: 0, leaks: [] as string[] };
    page.on("request", (request) => {
      if (!request.url().includes("generateContent")) return;
      bodyScan.requests += 1;
      const body = request.postData() ?? "";
      for (const term of privateTerms) if (body.includes(term)) bodyScan.leaks.push(term);
    });
    const started = Date.now();
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await page.getByTestId("continue-to-twin").click();
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    const prompt = await page.getByTestId("review-prompt").innerText();
    for (const term of ["PRIVATE_CANARY_PII_DO_NOT_SHARE", "customer_id", "email_address", "CUST-001", "alice@example.com", "vip_customer"]) {
      expect(prompt).not.toContain(term);
    }
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    const error = page.getByTestId("cloud-error");
    const proposal = page.getByTestId("proposal");
    await expect(error.or(proposal)).toBeVisible({ timeout: 90_000 });
    const errorText = (await error.count()) > 0 ? await error.innerText() : null;
    const origin = (await proposal.count()) > 0 ? await page.getByTestId("proposal-origin").innerText() : null;
    const provenance = (await proposal.count()) > 0 ? await page.getByTestId("proposal-provenance").innerText() : null;
    const status = (await proposal.count()) > 0 ? await page.getByTestId("proposal-status").innerText() : null;
    let summary: string | null = null;
    let reserved: string | null = null;
    if (status?.startsWith("Valid")) {
      await page.getByTestId("continue-to-reality").click();
      await page.getByTestId("run-mapping").click();
      summary = await page.getByTestId("mapping-summary").innerText();
      reserved = await page.getByTestId("reserved-summary").innerText();
    }
    await page.screenshot({ path: path.join(screenshotDir, "live-009-phantom-flow.png"), fullPage: true });
    await collectEvidence(page, {
      check: "LIVE-009",
      durationMs: Date.now() - started,
      errorText,
      origin,
      provenance,
      proposalStatus: status,
      realityCheck: summary,
      reserved,
      providerHosts: [...new Set(sanitizeUrls(providerRequests).map((url) => new URL(url).hostname))],
      generateContentRequests: bodyScan.requests,
      privateTermsInRequestBodies: bodyScan.leaks,
      overall: status?.startsWith("Valid") ? await page.getByTestId("reality-overall").innerText() : null,
      pageErrors,
    });
    if (errorText) {
      throw new Error(`Live cloud proposal did not succeed: ${errorText}`);
    }
    expect(origin).toBe("Real Gemini output · IN_CLOUD");
    expect(provenance).toContain("source=IN_CLOUD");
    expect(provenance).toContain("simulated=false");
    expect(status).toMatch(/^(Valid|Rejected)/);
    expect(bodyScan.requests).toBeGreaterThan(0);
    expect(bodyScan.leaks).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    if (status?.startsWith("Valid")) {
      // LIVE-016: reserved hidden cases must surface a real local failure.
      expect(reserved).toMatch(/[1-9]\d* of \d+ failed/);
    }
  });
});

test.describe("LIVE-013 on-device in the guided Phantom Twin step", () => {
  test("real ONLY_ON_DEVICE role suggestions on synthetic samples, no cloud request", async ({ page }) => {
    test.skip(process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires an eligible Chrome profile and EYES_LIVE_ON_DEVICE=1.");
    const providerRequests = attachProviderWatch(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const started = Date.now();
    await page.goto("/");
    await page.getByTestId("load-crm-sample").click();
    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available", { timeout: 30_000 });
    await page.getByTestId("suggest-on-device").click();
    const suggestions = page.getByTestId("on-device-suggestions");
    await expect(suggestions).toBeVisible({ timeout: 180_000 });
    const text = await suggestions.innerText();
    const cloudInferenceUrls = sanitizeUrls(providerRequests.filter((url) => url.includes("generateContent")));
    await page.screenshot({ path: path.join(screenshotDir, "live-013-guided-on-device.png"), fullPage: true });
    await collectEvidence(page, {
      check: "LIVE-013",
      durationMs: Date.now() - started,
      suggestions: text,
      cloudInferenceUrls,
      pageErrors,
    });
    expect(text).toContain("(real on-device)");
    expect(text).not.toContain("simulated");
    expect(cloudInferenceUrls).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
});
