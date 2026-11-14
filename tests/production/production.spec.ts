import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Production acceptance — deterministic browser checks against the DEPLOYED
 * build (Sprint 14, Workstream E; docs/deployment.md "Production acceptance").
 *
 *   EYES_EXPECTED_SHA=<approved full sha> pnpm test:production
 *
 * - Runs against EYES_PRODUCTION_URL (default: the public Firebase URL), never localhost.
 * - Sends NO Gemini request: every check asserts zero `generateContent` calls.
 *   Real-model acceptance is separate (`pnpm test:production:real`).
 * - Uses fictional demo data only. Evidence holds statuses, counts, codes,
 *   hashes and screenshots of fictional data — never tokens or keys.
 * - Writes browser-results.json and release-manifest.json to
 *   EYES_EVIDENCE_DIR (default docs/evidence/production/<sha12>/).
 */
const baseURL = process.env.EYES_PRODUCTION_URL ?? "https://eyes-without-a-face-b7281.web.app";
const expectedSha = process.env.EYES_EXPECTED_SHA ?? "";
const evidenceDir = process.env.EYES_EVIDENCE_DIR ?? path.join("docs/evidence/production", (expectedSha || "unknown").slice(0, 12));
const shotDir = path.join(evidenceDir, "screenshots");
const resultsPath = path.join(evidenceDir, "browser-results.json");
const restProbe = process.env.EYES_PRODUCTION_REST !== "0";

type Result = { id: string; title: string; project: string; status: string; durationMs: number; kind: "DETERMINISTIC"; details: Record<string, unknown>; error?: string };
const details = new Map<string, Record<string, unknown>>();

function note(testTitle: string, values: Record<string, unknown>): void {
  details.set(testTitle, { ...(details.get(testTitle) ?? {}), ...values });
}

test.afterEach(async ({ page }, info) => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const existing = fs.existsSync(resultsPath) ? (JSON.parse(fs.readFileSync(resultsPath, "utf8")) as Result[]) : [];
  const id = /^(P-\d+)/.exec(info.title)?.[1] ?? info.title;
  const entry: Result = {
    id,
    title: info.title,
    project: info.project.name,
    status: info.status === info.expectedStatus ? "PASS" : info.status === "skipped" ? "SKIPPED" : "FAIL",
    durationMs: info.duration,
    kind: "DETERMINISTIC",
    details: { url: page.url().split("#")[0], ...(details.get(info.title) ?? {}) },
  };
  if (info.error?.message) entry.error = info.error.message.split("\n")[0]!.slice(0, 300);
  fs.writeFileSync(resultsPath, `${JSON.stringify([...existing.filter((item) => !(item.id === id && item.project === entry.project)), entry], null, 2)}\n`);
});

/** Page errors, console errors and Gemini calls for one page. */
function guard(page: Page) {
  const state = { pageErrors: [] as string[], consoleErrors: [] as string[], generateContent: 0 };
  page.on("pageerror", (error) => state.pageErrors.push(error.message.slice(0, 160)));
  page.on("console", (message) => {
    if (message.type() === "error") state.consoleErrors.push(message.text().slice(0, 160));
  });
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) state.generateContent += 1;
  });
  return state;
}

async function shot(page: Page, name: string, project: string): Promise<void> {
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${project}-${name}.png`) });
}

async function loadDemo(page: Page, demo: "json" | "csv" | "xlsx"): Promise<void> {
  await page.goto(baseURL);
  await page.getByTestId(`demo-${demo}`).click();
  await expect(page.getByTestId("source-summary")).toBeVisible({ timeout: 20_000 });
}

test.describe("deployment identity", () => {
  test("P-001 served build is the approved SHA, production mode, no debug", async ({ page, request, browserName }, info) => {
    expect(expectedSha, "Set EYES_EXPECTED_SHA to the approved full commit SHA.").toMatch(/^[0-9a-f]{40}$/);
    const response = await request.get(`${baseURL}/build-info.json`, { headers: { "cache-control": "no-cache" } });
    expect(response.status()).toBe(200);
    const buildInfo = (await response.json()) as { gitSha: string; dirty: boolean; mode: string; appCheckDebug: boolean; builtAt: string };
    const html = await (await request.get(baseURL, { headers: { "cache-control": "no-cache" } })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]!);
    const assetStatus: Record<string, number> = {};
    for (const asset of assets) assetStatus[asset] = (await request.get(`${baseURL}${asset}`)).status();
    const state = guard(page);
    await page.goto(baseURL);
    const footer = await page.getByTestId("build-revision").innerText();
    const manifest = {
      testedUrl: baseURL,
      expectedSha,
      servedSha: buildInfo.gitSha,
      buildInfo,
      footer,
      assets: assetStatus,
      testedAt: new Date().toISOString(),
      browser: `${browserName} ${page.context().browser()?.version() ?? ""}`.trim(),
      runner: "pnpm test:production (playwright.production.config.ts)",
    };
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    note(info.title, { servedSha: buildInfo.gitSha, assets: Object.keys(assetStatus).length });
    expect(buildInfo.gitSha).toBe(expectedSha);
    expect(buildInfo.dirty).toBe(false);
    expect(buildInfo.mode).toBe("production");
    expect(buildInfo.appCheckDebug).toBe(false);
    expect(footer).toContain(expectedSha.slice(0, 12));
    expect(assets.length).toBeGreaterThan(0);
    expect(Object.values(assetStatus).every((status) => status === 200)).toBe(true);
    expect(state.pageErrors).toEqual([]);
  });

  test("P-002 App Check: no debug token in the page; the model endpoint refuses a request without App Check", async ({ page, request }, info) => {
    const state = guard(page);
    await page.goto(baseURL);
    const debugGlobal = await page.evaluate(() => (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown }).FIREBASE_APPCHECK_DEBUG_TOKEN ?? null);
    expect(debugGlobal).toBeNull();
    // The public web API key is read from the served bundle at run time and never written anywhere.
    const html = await (await request.get(baseURL)).text();
    const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeTruthy();
    const bundle = await (await request.get(`${baseURL}${script}`)).text();
    const key = /AIza[0-9A-Za-z_-]{35}/.exec(bundle)?.[0];
    const project = /eyes-without-a-face-[a-z0-9]+/.exec(bundle)?.[0];
    expect(key && project).toBeTruthy();
    // A request with no data and no App Check token: it must be refused before any inference.
    const probe = await request.post(`https://firebasevertexai.googleapis.com/v1beta/projects/${project}/models/gemini-3.5-flash-lite:generateContent`, {
      headers: { "content-type": "application/json", "x-goog-api-key": key! },
      data: { contents: [{ role: "user", parts: [{ text: "ping" }] }] },
    });
    const body = (await probe.text()).slice(0, 400);
    note(info.title, { probeStatus: probe.status(), appCheckRefusal: /App Check/i.test(body) });
    expect(probe.status()).toBe(401);
    expect(body).toMatch(/App Check/i);
    expect(state.generateContent).toBe(0);
  });
});

test.describe("guided imports (fictional data, local only)", () => {
  for (const demo of ["json", "csv", "xlsx"] as const) {
    test(`P-01${demo === "json" ? 0 : demo === "csv" ? 1 : 2} ${demo.toUpperCase()} demo imports and normalizes to 3 records × 6 fields @cross-browser`, async ({ page }, info) => {
      const state = guard(page);
      await loadDemo(page, demo);
      await expect(page.getByTestId("source-record-count")).toHaveText("3");
      await expect(page.getByTestId("source-field-count")).toHaveText("6");
      await expect(page.getByTestId("source-locality")).toContainText("In this browser only");
      await shot(page, `import-${demo}`, info.project.name);
      note(info.title, { pageErrors: state.pageErrors.length, generateContent: state.generateContent });
      expect(state.pageErrors).toEqual([]);
      expect(state.generateContent).toBe(0);
    });
  }

  test("P-013 read-only REST connector reads a public CORS API once, as a snapshot", async ({ page }, info) => {
    test.skip(!restProbe, "EYES_PRODUCTION_REST=0");
    const state = guard(page);
    let gets = 0;
    page.on("request", (item) => {
      if (item.url().startsWith("https://jsonplaceholder.typicode.com/")) gets += 1;
    });
    await page.goto(baseURL);
    await page.getByTestId("data-tab-api").click();
    await page.getByTestId("api-url").fill("https://jsonplaceholder.typicode.com/users");
    expect(gets).toBe(0);
    await page.getByTestId("api-connect-button").click();
    await expect(page.getByTestId("source-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("source-record-count")).toHaveText("10");
    note(info.title, { gets, locality: await page.getByTestId("source-locality").innerText() });
    expect(gets).toBe(1);
    expect(state.generateContent).toBe(0);
  });

  test("P-014 an invalid file explains itself and loads nothing", async ({ page }) => {
    const state = guard(page);
    await page.goto(baseURL);
    await page.getByTestId("source-file-input").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ not json") });
    await expect(page.getByTestId("source-problem")).toBeVisible();
    await expect(page.getByTestId("source-summary")).toHaveCount(0);
    expect(state.generateContent).toBe(0);
  });
});

test.describe("guided journey up to the approval gate (no request is sent)", () => {
  test("P-020 Build stops at the exact request; declining sends nothing @cross-browser", async ({ page }, info) => {
    const state = guard(page);
    await loadDemo(page, "json");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-billing").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await page.getByTestId("approval-exact").locator("summary").click();
    const prompt = await page.getByTestId("approval-prompt").innerText();
    expect(prompt).not.toContain("PRIVATE_CANARY");
    expect(prompt).not.toContain("email_address");
    await shot(page, "approval", info.project.name);
    await page.getByTestId("guided-reject").click();
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "rejected");
    note(info.title, { generateContent: state.generateContent, payloadHash: await page.getByTestId("approval-card").count() });
    expect(state.generateContent).toBe(0);
    expect(state.pageErrors).toEqual([]);
  });

  test("P-021 a destination that needs category names says so before anything is sent", async ({ page }) => {
    const state = guard(page);
    await loadDemo(page, "json");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-helpdesk").check();
    await expect(page.getByTestId("destination-categories")).toHaveAttribute("data-blocking", "true");
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("guided-category-notice")).toBeVisible();
    expect(state.generateContent).toBe(0);
  });

  test("P-022 an invalid destination blocks Build with a reason", async ({ page }) => {
    const state = guard(page);
    await loadDemo(page, "json");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-custom").check();
    await page.getByTestId("destination-text").fill('{"type": "object", "properties": ');
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("destination-problem")).toBeVisible();
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    expect(state.generateContent).toBe(0);
  });

  test("P-023 guided ↔ technical navigation keeps the work", async ({ page }) => {
    await loadDemo(page, "json");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    const hash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
    await page.getByTestId("result-technical").click();
    await expect(page).toHaveURL(/#technical$/);
    await page.getByTestId("view-guided").click();
    await expect(page.getByTestId("approval-card")).toHaveAttribute("data-payload-hash", hash!);
  });
});

test.describe("layout and access", () => {
  test("P-030 mobile 390 px: no horizontal scroll on any step", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadDemo(page, "json");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("data-continue").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await shot(page, "mobile-approval", "mobile");
  });

  test("P-031 keyboard reaches the file control", async ({ page }) => {
    await page.goto(baseURL);
    let reached = false;
    for (let index = 0; index < 25 && !reached; index += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "source-file-input");
    }
    expect(reached).toBe(true);
  });
});
