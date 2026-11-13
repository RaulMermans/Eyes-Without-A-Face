import { chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expect, test, ON_DEVICE_FEATURES } from "./fixtures.ts";
import { attachProviderWatch } from "../e2e/helpers.ts";

/**
 * Sprint 5 on-device reliability study (opt-in, never in CI).
 *
 * Each attempt launches a fresh Chrome process on the dedicated profile (cold),
 * runs the guided Phantom Twin on-device step, then reloads the page in the same
 * process and runs it again (warm). It records outcome, latency, the Firebase
 * error code, and how many cloud inference requests were observed (must be 0).
 *
 *   EYES_LIVE_TESTS=1 EYES_LIVE_RELIABILITY=1 EYES_RELIABILITY_ATTEMPTS=10 \
 *   EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
 *   pnpm test:live tests/live/nano-reliability.spec.ts
 *
 * Optional EYES_RELIABILITY_CHROME_LOG_DIR captures Chrome's own log per launch
 * (outside the repository) to classify model-service failures.
 */
const enabled =
  process.env.EYES_LIVE_TESTS === "1" &&
  process.env.EYES_LIVE_RELIABILITY === "1" &&
  (process.env.EYES_CHROME_PROFILE ?? "").length > 0;
const attempts = Number.parseInt(process.env.EYES_RELIABILITY_ATTEMPTS ?? "10", 10);
const profileDir = process.env.EYES_CHROME_PROFILE ?? "";
const chromeLogDir = process.env.EYES_RELIABILITY_CHROME_LOG_DIR ?? "";
const outDir = "test-results/sprint-5-reliability";

test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_RELIABILITY=1 EYES_CHROME_PROFILE=…");
test.setTimeout(Math.max(1, attempts) * 240_000);

interface RunRecord {
  attempt: number;
  phase: "cold" | "warm";
  outcome: "success" | "failure";
  durationMs: number;
  errorText: string | null;
  recovered: boolean | null;
  fieldsClassified: number;
  cloudInferenceRequests: number;
  pageErrors: number;
}

async function launch(attempt: number, baseURL: string): Promise<BrowserContext> {
  const logArgs = chromeLogDir
    ? [
        "--enable-logging",
        "--v=0",
        "--vmodule=*on_device_model*=1,*optimization_guide*=1,*ai_language_model*=1",
        `--log-file=${path.join(chromeLogDir, `chrome-attempt-${String(attempt).padStart(2, "0")}.log`)}`,
      ]
    : [];
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    baseURL,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: true,
    args: [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      `--enable-features=${ON_DEVICE_FEATURES}`,
      ...logArgs,
      "about:blank",
    ],
  });
}

async function guidedOnDeviceRun(page: Page, attempt: number, phase: "cold" | "warm"): Promise<RunRecord> {
  const providerRequests = attachProviderWatch(page);
  let pageErrors = 0;
  page.on("pageerror", () => {
    pageErrors += 1;
  });
  const started = Date.now();
  await page.goto("/#technical");
  await page.getByTestId("load-crm-sample").click();
  await page.getByTestId("continue-to-twin").click();
  await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available", { timeout: 30_000 });
  await page.getByTestId("suggest-on-device").click();
  const suggestions = page.getByTestId("on-device-suggestions");
  const failure = page.getByTestId("on-device-error");
  const progress = page.getByTestId("on-device-progress");
  // Suggestions render incrementally; a run is finished only when the
  // progress indicator is gone.
  const settle = async () => {
    await expect(suggestions.or(failure)).toBeVisible({ timeout: 150_000 });
    await expect(progress).toHaveCount(0, { timeout: 150_000 });
  };
  await settle();

  let recovered: boolean | null = null;
  let errorText: string | null = null;
  if ((await failure.count()) > 0) {
    errorText = (await failure.innerText()).slice(0, 300);
    const retry = page.getByTestId("retry-on-device");
    if ((await retry.count()) > 0) {
      await retry.click();
      await settle();
      recovered = (await failure.count()) === 0;
    } else {
      recovered = false;
    }
  }
  const text = (await suggestions.count()) > 0 ? await suggestions.innerText() : "";
  const fieldsClassified = (text.match(/\(real on-device\)/g) ?? []).length;
  const cloudInferenceRequests = providerRequests.filter((url) => url.includes("generateContent")).length;
  return {
    attempt,
    phase,
    outcome: fieldsClassified === 6 && !errorText ? "success" : "failure",
    durationMs: Date.now() - started,
    errorText,
    recovered,
    fieldsClassified,
    cloudInferenceRequests,
    pageErrors,
  };
}

test("on-device startup and inference reliability (cold + warm)", async ({ baseURL }) => {
  fs.mkdirSync(outDir, { recursive: true });
  if (chromeLogDir) fs.mkdirSync(chromeLogDir, { recursive: true });
  const records: RunRecord[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const context = await launch(attempt, baseURL ?? "http://127.0.0.1:5174");
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      for (const phase of ["cold", "warm"] as const) {
        try {
          records.push(await guidedOnDeviceRun(page, attempt, phase));
        } catch (error) {
          records.push({
            attempt,
            phase,
            outcome: "failure",
            durationMs: -1,
            errorText: `HARNESS: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
            recovered: null,
            fieldsClassified: 0,
            cloudInferenceRequests: 0,
            pageErrors: 0,
          });
        }
        fs.writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(records, null, 2));
      }
    } finally {
      await context.close();
    }
  }
  const ok = records.filter((item) => item.outcome === "success" || item.recovered === true);
  console.log(
    `reliability: ${ok.length}/${records.length} usable (first-try ${records.filter((r) => r.outcome === "success").length}), ` +
      `cloud generateContent=${records.reduce((sum, r) => sum + r.cloudInferenceRequests, 0)}`,
  );
  expect(records.every((item) => item.cloudInferenceRequests === 0)).toBe(true);
});
