import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures.ts";
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/firebase-api.ts";

/**
 * Sprint 14 (A3/B) — the fix, verified with REAL Gemini through the guided UI.
 *
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_RECOVERY=1 EYES_LIVE_CLOUD=1 (+ EYES_APPCHECK_DEBUG_TOKEN locally;
 * against production use playwright.production-real.config.ts, which forbids a debug token).
 *
 * Predeclared budget: S14-REC-1 = at most 2 approved requests (the incident
 * reproduced, then the user's recovery); S14-REC-2 = 1 request. Nothing is
 * retried. A failure is recorded as a failure.
 *
 * Evidence: statuses, counts, kinds, hashes, timings, alias-level model text.
 * Never request bodies, never tokens, never records.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_GUIDED_RECOVERY === "1" && process.env.EYES_LIVE_CLOUD === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_RECOVERY=1 EYES_LIVE_CLOUD=1.");
test.setTimeout(240_000);

const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-14/guided-recovery.json";
const only = process.env.EYES_RECOVERY_ONLY ?? "";

function append(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const existing = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
  existing.push(entry);
  fs.writeFileSync(evidencePath, `${JSON.stringify(existing, null, 2)}\n`);
}

const PRIVATE_TERMS = ["PRIVATE_CANARY_PII_DO_NOT_SHARE", "email_address", "company_name", "internal_note", "joined_at", "customer_id", "CUST-001", "ALICE"];

function watch(page: import("@playwright/test").Page) {
  const state = { requests: 0, leaks: [] as string[], answers: [] as string[], provenance: [] as string[] };
  page.on("request", (request) => {
    if (!request.url().includes("generateContent")) return;
    state.requests += 1;
    const body = request.postData() ?? "";
    for (const term of PRIVATE_TERMS) if (body.includes(term)) state.leaks.push(term);
  });
  page.on("response", async (response) => {
    if (!response.url().includes("generateContent")) return;
    try {
      const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      state.answers.push(body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "");
    } catch {
      state.answers.push(`<unreadable, HTTP ${response.status()}>`);
    }
  });
  return state;
}

async function start(page: import("@playwright/test").Page, destination: string): Promise<void> {
  if (debugToken) {
    await page.addInitScript((token) => {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, debugToken);
  }
  await page.goto("/");
  await page.getByTestId("demo-json").click();
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await page.getByTestId(`destination-${destination}`).check();
}

async function settle(page: import("@playwright/test").Page): Promise<string | null> {
  await expect(page.getByTestId("guided-status")).not.toHaveAttribute("data-status", /^(approval|generating|checking|preparing)$/, { timeout: 90_000 });
  return page.getByTestId("guided-status").getAttribute("data-status");
}

/** Download the reusable integration and run `node run.mjs verify` in a clean directory with only PATH set. */
async function exportAndVerify(page: import("@playwright/test").Page): Promise<string> {
  if ((await page.getByTestId("export-draft-confirm").count()) > 0) await page.getByTestId("export-draft-confirm").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-integration").click();
  const zip = await (await downloadPromise).path();
  const dir = fs.mkdtempSync(path.join(tmpdir(), "eyes-s14-"));
  execFileSync("unzip", ["-q", zip, "-d", dir]);
  const entries = fs.readdirSync(dir);
  const root = entries.length === 1 && fs.statSync(path.join(dir, entries[0]!)).isDirectory() ? path.join(dir, entries[0]!) : dir;
  try {
    execFileSync("node", ["run.mjs", "verify"], { cwd: root, env: { PATH: process.env.PATH ?? "" }, stdio: "pipe" });
    return "exit 0";
  } catch (error) {
    return `exit ${(error as { status?: number }).status ?? "?"}`;
  }
}

async function outcome(page: import("@playwright/test").Page, entry: Record<string, unknown>): Promise<void> {
  entry.outcomeState = (await page.getByTestId("guided-outcome").count()) > 0 ? await page.getByTestId("guided-outcome").getAttribute("data-state") : null;
  entry.origin = (await page.getByTestId("guided-origin").count()) > 0 ? await page.getByTestId("guided-origin").innerText() : null;
  if (entry.outcomeState) {
    entry.transformed = await page.getByTestId("guided-count-transformed").innerText();
    entry.attention = await page.getByTestId("guided-count-attention").innerText();
    entry.structure = await page.getByTestId("check-structure").getAttribute("data-ok");
    entry.meaning = await page.getByTestId("check-meaning").getAttribute("data-ok");
    entry.understanding = await page.getByTestId("guided-understanding-summary").getAttribute("data-kind");
  }
}

test("S14-REC-1 helpdesk: the incident, then the user's recovery (≤ 2 requests)", async ({ page }) => {
  test.skip(only !== "" && only !== "1", "filtered");
  const net = watch(page);
  const entry: Record<string, unknown> = { check: "S14-REC-1", destination: "helpdesk", at: new Date().toISOString(), model: FIREBASE_AI_LOGIC_API.defaultCloudModel, baseURL: page.url() };
  try {
    await start(page, "helpdesk");
    entry.baseURL = new URL(page.url()).origin;
    await expect(page.getByTestId("destination-categories")).toHaveAttribute("data-blocking", "true");
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("guided-category-notice")).toBeVisible();
    expect(net.requests).toBe(0);
    // Send WITHOUT sharing, as the production user did.
    await page.getByTestId("guided-approve").click();
    entry.first = { status: await settle(page), requests: net.requests };
    (entry.first as Record<string, unknown>).diagnosis = (await page.getByTestId("guided-diagnosis").count()) > 0 ? await page.getByTestId("guided-diagnosis").getAttribute("data-kind") : null;
    (entry.first as Record<string, unknown>).label = await page.getByTestId("guided-status-label").innerText();
    (entry.first as Record<string, unknown>).retryOffered = (await page.getByTestId("guided-retry-proposal").count()) > 0;
    if ((await page.getByTestId("guided-share-categories").count()) === 0) {
      // Gemini happened to answer usably without the names; record it, spend nothing more.
      await outcome(page, entry.first as Record<string, unknown>);
      return;
    }
    await page.getByTestId("guided-share-categories").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(net.requests).toBe(1);
    await page.getByTestId("guided-approve").click();
    entry.second = { status: await settle(page), requests: net.requests };
    await outcome(page, entry.second as Record<string, unknown>);
    if ((entry.second as Record<string, unknown>).outcomeState) (entry.second as Record<string, unknown>).exportVerify = await exportAndVerify(page);
  } catch (error) {
    entry.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw error;
  } finally {
    entry.requests = net.requests;
    entry.leaks = net.leaks;
    entry.answers = net.answers;
    append(entry);
  }
  expect(net.leaks).toEqual([]);
  expect(net.requests).toBeLessThanOrEqual(2);
});

test("S14-REC-2 marketing: category names shared before the first request (1 request)", async ({ page }) => {
  test.skip(only !== "" && only !== "2", "filtered");
  const net = watch(page);
  const entry: Record<string, unknown> = { check: "S14-REC-2", destination: "marketing", at: new Date().toISOString(), model: FIREBASE_AI_LOGIC_API.defaultCloudModel };
  try {
    await start(page, "marketing");
    entry.baseURL = new URL(page.url()).origin;
    await page.getByTestId("share-categories-account_state").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(net.requests).toBe(0);
    await page.getByTestId("guided-approve").click();
    entry.status = await settle(page);
    await outcome(page, entry);
    if (entry.outcomeState) entry.exportVerify = await exportAndVerify(page);
  } catch (error) {
    entry.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw error;
  } finally {
    entry.requests = net.requests;
    entry.leaks = net.leaks;
    entry.answers = net.answers;
    append(entry);
  }
  expect(net.leaks).toEqual([]);
  expect(net.requests).toBe(1);
});

test("S14-REC-3 hybrid happy path: real Gemini Nano on this device, then one approved real Gemini request (1 request)", async ({ page }) => {
  test.skip(only !== "" && only !== "3", "filtered");
  test.skip(process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_ON_DEVICE=1 and the dedicated Nano profile.");
  const net = watch(page);
  const entry: Record<string, unknown> = { check: "S14-REC-3", destination: "helpdesk", at: new Date().toISOString(), model: FIREBASE_AI_LOGIC_API.defaultCloudModel };
  try {
    if (debugToken) {
      await page.addInitScript((token) => {
        (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      }, debugToken);
    }
    await page.goto("/");
    entry.baseURL = new URL(page.url()).origin;
    await page.getByTestId("demo-json").click();
    await expect(page.getByTestId("source-summary")).toBeVisible();
    // Nano availability must be visible without opening anything.
    await expect(page.getByTestId("guided-understanding")).toContainText("On-device AI is available", { timeout: 30_000 });
    await page.getByTestId("guided-understanding").locator("summary").click();
    const started = Date.now();
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.locator('[data-testid^="private-semantics-row-"]').first()).toBeVisible({ timeout: 120_000 });
    // Next is held while on-device analysis runs (Sprint 14); wait for it to finish.
    await expect(page.getByTestId("data-continue")).toBeEnabled({ timeout: 180_000 });
    entry.nanoMs = Date.now() - started;
    entry.nanoRows = await page.locator('[data-testid^="private-semantics-row-"]').count();
    entry.requestsAfterNano = net.requests;
    expect(net.requests).toBe(0);
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-helpdesk").check();
    await page.getByTestId("share-categories-account_state").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(net.requests).toBe(0);
    await page.getByTestId("guided-approve").click();
    entry.status = await settle(page);
    await outcome(page, entry);
    if (entry.outcomeState) entry.exportVerify = await exportAndVerify(page);
  } catch (error) {
    entry.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw error;
  } finally {
    entry.requests = net.requests;
    entry.leaks = net.leaks;
    entry.answers = net.answers;
    append(entry);
  }
  expect(net.leaks).toEqual([]);
  expect(net.requests).toBe(1);
  expect(entry.understanding).toBe("nano-used");
});

test("S14-NANO guided on-device qualification: real Gemini Nano, Next held until done, runtime completed (0 cloud requests)", async ({ page }) => {
  test.skip(only !== "nano", "Run with EYES_RECOVERY_ONLY=nano.");
  test.skip(process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_ON_DEVICE=1 and the dedicated Nano profile.");
  const net = watch(page);
  const entry: Record<string, unknown> = { check: "S14-NANO", at: new Date().toISOString() };
  try {
    await page.goto("/");
    entry.baseURL = new URL(page.url()).origin;
    await page.getByTestId("demo-json").click();
    await expect(page.getByTestId("guided-understanding")).toContainText("On-device AI is available", { timeout: 30_000 });
    await page.getByTestId("guided-understanding").locator("summary").click();
    const started = Date.now();
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.getByTestId("data-continue")).toBeDisabled({ timeout: 10_000 });
    entry.nextHeldWhileRunning = (await page.getByTestId("data-continue-wait").count()) > 0;
    await expect(page.getByTestId("data-continue")).toBeEnabled({ timeout: 180_000 });
    entry.nanoMs = Date.now() - started;
    entry.nanoRows = await page.locator('[data-testid^="private-semantics-row-"]').count();
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-billing").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await page.getByTestId("result-technical").click();
    await page.getByTestId("mode-observe").click();
    entry.runtimeOnDevice = await page.getByTestId("runtime-stage-on-device").getAttribute("data-status");
    entry.runtimeSummary = (await page.getByTestId("runtime-stage-on-device").innerText()).split("\n").slice(0, 3).join(" | ");
  } finally {
    entry.requests = net.requests;
    append(entry);
  }
  expect(net.requests).toBe(0);
  expect(entry.runtimeOnDevice).toBe("completed");
});
