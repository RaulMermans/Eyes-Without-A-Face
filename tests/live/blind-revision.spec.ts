import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expect, test, usingDedicatedProfile } from "./fixtures.ts";
import crmEu from "../../src/examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import support from "../../src/examples/scenarios/support-tickets.json" with { type: "json" };
import billing from "../../src/examples/scenarios/billing-subscriptions.json" with { type: "json" };

/**
 * Sprint 7 preliminary Blind Integration benchmark with REAL inference.
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_BLIND_REVISION=1 (+ App Check debug token,
 * + EYES_CHROME_PROFILE for Gemini Nano). One run per scenario and config:
 *
 *   B  real Gemini IN_CLOUD proposal, no Nano, revision declined → holdout
 *   CD real Nano private interpretation (validated suggestions applied) → real
 *      Gemini proposal (C) → one approved real Gemini revision (D) → holdout
 *
 * Evidence holds only alias-level proposal text, applied overrides for the
 * FICTIONAL scenario fields, counts, hashes and timings. Nano rationales and
 * request bodies are never stored. Nothing is retried automatically.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_BLIND_REVISION === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_BLIND_REVISION=1.");
test.describe.configure({ mode: "serial" });

const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const outDir = "test-results/sprint-7-live";
const evidencePath = path.join(outDir, "blind-revision-evidence.json");

interface ScenarioJson {
  scenarioId: string;
  twinOverrides: Record<string, { discloseCategories?: boolean }>;
  destinationSchema: { properties: Record<string, { enum?: string[] }> };
  imported: Array<{ record: Record<string, unknown> }>;
  revisionFeedback: Array<{ record: Record<string, unknown> }>;
  holdout: Array<{ record: Record<string, unknown> }>;
}
const SCENARIOS = [crmEu, support, billing] as unknown as ScenarioJson[];

/** Private strings that must never appear in a request body (approved vocabulary excluded). */
function privateTerms(scenario: ScenarioJson): string[] {
  const targetNames = Object.keys(scenario.destinationSchema.properties).map((name) => name.toLowerCase());
  const targetValues = new Set(Object.values(scenario.destinationSchema.properties).flatMap((prop) => prop.enum ?? []));
  const disclosedFields = Object.entries(scenario.twinOverrides).filter(([, o]) => o.discloseCategories).map(([name]) => name);
  const records = [...scenario.imported, ...scenario.revisionFeedback, ...scenario.holdout].map((item) => item.record);
  const approvedLabels = new Set(records.flatMap((record) => disclosedFields.map((field) => record[field]).filter((v): v is string => typeof v === "string")));
  const terms = new Set<string>(["PRIVATE_CANARY_PII_DO_NOT_SHARE"]);
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (key.length >= 4 && !targetNames.some((name) => name.includes(key.toLowerCase()))) terms.add(key);
      if (typeof value === "string" && value.trim().length >= 4 && !approvedLabels.has(value) && !targetValues.has(value)) terms.add(value.trim());
    }
  }
  return [...terms];
}

function record(entry: Record<string, unknown>): void {
  fs.mkdirSync(outDir, { recursive: true });
  const previous = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
  previous.push({ at: new Date().toISOString(), browserLaunch: usingDedicatedProfile ? "dedicated-chrome-profile" : "playwright-default-args", ...entry });
  fs.writeFileSync(evidencePath, JSON.stringify(previous, null, 2));
}

function watchBodies(page: Page, terms: string[]) {
  const scan = { generateContent: 0, leaks: [] as string[], otherProviderRequests: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("generateContent")) {
      scan.generateContent += 1;
      const body = (request.postData() ?? "").toLowerCase();
      for (const term of terms) if (body.includes(term.toLowerCase())) scan.leaks.push(term);
    }
  });
  return scan;
}

async function text(page: Page, testId: string): Promise<string | null> {
  const locator = page.getByTestId(testId);
  return (await locator.count()) > 0 ? (await locator.first().innerText()).trim() : null;
}

async function comparison(page: Page, prefix: string): Promise<Record<string, [string | null, string | null]> | null> {
  if ((await page.getByTestId(prefix).count()) === 0) return null;
  const keys = ["transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy", "incorrect", "correctlyHandled"];
  const out: Record<string, [string | null, string | null]> = {};
  for (const key of keys) out[key] = [await text(page, `${prefix}-${key}-before`), await text(page, `${prefix}-${key}-after`)];
  return out;
}

async function boot(page: Page): Promise<void> {
  if (debugToken) {
    await page.addInitScript((token) => {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, debugToken);
  }
  await page.goto("/#technical");
}

async function loadScenario(page: Page, id: string): Promise<void> {
  await page.getByTestId("scenario-picker").locator("summary").click();
  await page.getByTestId(`load-scenario-${id}`).click();
  await page.getByTestId("continue-to-twin").click();
}

/** Returns proposal text or throws with the visible cloud error. */
async function approveAndPropose(page: Page): Promise<{ text: string; origin: string | null; provenance: string | null; status: string | null; ms: number }> {
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  await page.getByTestId("approve-disclosure").click();
  await page.getByTestId("continue-to-mapping").click();
  const started = Date.now();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("cloud-error").or(page.getByTestId("proposal"))).toBeVisible({ timeout: 90_000 });
  const error = await text(page, "cloud-error");
  if (error) throw new Error(`Initial cloud request failed (not retried): ${error}`);
  return {
    text: (await page.getByTestId("proposal-editor").count()) > 0 ? await page.getByTestId("proposal-editor").inputValue() : "",
    origin: await text(page, "proposal-origin"),
    provenance: await text(page, "proposal-provenance"),
    status: await text(page, "proposal-status"),
    ms: Date.now() - started,
  };
}

async function runInitialReality(page: Page): Promise<void> {
  await page.getByTestId("continue-to-reality").click();
  await page.getByTestId("run-mapping").click();
  await expect(page.getByTestId("initial-outcomes")).toBeVisible();
}

for (const scenario of SCENARIOS) {
  test(`B ${scenario.scenarioId}: real Gemini proposal, no Nano, no revision`, async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1", "Requires EYES_LIVE_CLOUD=1.");
    const scan = watchBodies(page, privateTerms(scenario));
    await boot(page);
    await loadScenario(page, scenario.scenarioId);
    const initial = await approveAndPropose(page);
    const entry: Record<string, unknown> = { check: "BENCH-B", scenarioId: scenario.scenarioId, config: "B-cloud", initial };
    if (initial.status?.startsWith("Valid")) {
      await runInitialReality(page);
      entry.initialState = await page.getByTestId("initial-outcomes").getAttribute("data-state");
      entry.initialCounts = await text(page, "initial-outcomes-counts");
      await page.getByTestId("prepare-safe-revision").click();
      if ((await page.getByTestId("decline-revision").count()) > 0) await page.getByTestId("decline-revision").click();
      await page.getByTestId("run-holdout").click();
      entry.holdoutState = await page.getByTestId("holdout-initial").getAttribute("data-state");
      entry.holdoutCounts = await text(page, "holdout-initial-counts");
    }
    entry.requests = scan;
    record(entry);
    expect(initial.origin).toBe("Real Gemini output · IN_CLOUD");
    expect(scan.generateContent).toBe(1);
    expect(scan.leaks).toEqual([]);
  });

  test(`C+D ${scenario.scenarioId}: real Nano private understanding, real Gemini proposal and one blind revision`, async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1" || process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_CLOUD=1 and EYES_LIVE_ON_DEVICE=1.");
    const scan = watchBodies(page, privateTerms(scenario));
    await boot(page);
    await loadScenario(page, scenario.scenarioId);
    await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available", { timeout: 30_000 });

    // C: real on-device interpretation of the private fields. No cloud request may occur.
    const nanoStarted = Date.now();
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.locator('[data-testid^="private-semantics-row-"]').first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("private-semantics-progress")).toHaveCount(0, { timeout: 180_000 });
    const nanoMs = Date.now() - nanoStarted;
    const nanoError = await text(page, "private-semantics-error");
    expect(scan.generateContent, "no cloud request during on-device interpretation").toBe(0);
    const rows = page.locator('[data-testid^="private-semantics-row-"]');
    const nano: Array<Record<string, unknown>> = [];
    for (let i = 0; i < (await rows.count()); i += 1) {
      const row = rows.nth(i);
      const testId = (await row.getAttribute("data-testid")) ?? "";
      const alias = testId.replace("private-semantics-row-", "");
      const tokens = await row.locator(".font-mono").allInnerTexts();
      nano.push({
        alias,
        localPath: tokens[1] ?? null,
        status: await row.getAttribute("data-status"),
        // Fixed-vocabulary check line only; the model rationale is never stored.
        check: await text(page, `private-semantics-check-${alias}`),
        real: (await row.innerText()).includes("Gemini Nano (real on-device)"),
      });
    }
    const applied: string[] = [];
    for (const item of nano) {
      if (item.status === "applicable") {
        await page.getByTestId(`apply-semantics-${String(item.alias)}`).click();
        applied.push(String(item.alias));
      }
    }

    const initial = await approveAndPropose(page);
    const entry: Record<string, unknown> = { check: "BENCH-CD", scenarioId: scenario.scenarioId, config: "C/D", nanoMs, nanoError, nano, applied, initial };
    try {
      if (initial.status?.startsWith("Valid")) {
        await runInitialReality(page);
        entry.initialState = await page.getByTestId("initial-outcomes").getAttribute("data-state");
        entry.initialCounts = await text(page, "initial-outcomes-counts");
        await page.getByTestId("prepare-safe-revision").click();
        entry.preparePhase = await page.getByTestId("revision-phase").getAttribute("data-phase");
        entry.newInformation = await text(page, "revision-new-information");
        if (entry.preparePhase === "REVISION_REVIEW_REQUIRED") {
          await page.getByTestId("revision-exact-toggle").click();
          entry.revisionHash = await text(page, "revision-hash");
          const requestsBefore = scan.generateContent;
          await page.getByTestId("revision-reviewed").check();
          const started = Date.now();
          await page.getByTestId("approve-request-revision").click();
          await expect(page.getByTestId("revised-mapping").or(page.getByTestId("revision-blocked"))).toBeVisible({ timeout: 90_000 });
          entry.revisionMs = Date.now() - started;
          entry.revisionRequests = scan.generateContent - requestsBefore;
          entry.revisionBlocked = await text(page, "revision-blocked");
          entry.revised = {
            origin: await text(page, "revised-origin"),
            provenance: await text(page, "revised-provenance"),
            ok: await page.getByTestId("revised-status").getAttribute("data-ok").catch(() => null),
            status: await text(page, "revised-status"),
            operations: await text(page, "revised-operations"),
          };
          if ((await page.getByTestId("run-revised-reality-check").count()) > 0) {
            await page.getByTestId("run-revised-reality-check").click();
            entry.revisionComparison = { verdict: await text(page, "revision-comparison-verdict"), cases: await text(page, "revision-comparison-cases"), metrics: await comparison(page, "revision-comparison") };
          }
          // Alias-level revised contract for offline replay.
          entry.revisedText =
            (await page.getByTestId("revised-proposal-json").count()) > 0
              ? await page.getByTestId("revised-proposal-json").textContent()
              : await page.getByTestId("revised-mapping").locator("pre").first().textContent().catch(() => null);
        }
        if ((await page.getByTestId("run-holdout").count()) > 0) {
          await page.getByTestId("run-holdout").click();
          entry.holdoutInitial = await text(page, "holdout-initial-counts");
          entry.holdoutComparison = { verdict: await text(page, "holdout-comparison-verdict"), cases: await text(page, "holdout-comparison-cases"), metrics: await comparison(page, "holdout-comparison") };
        }
        entry.budget = await text(page, "revision-budget");
      }
      await page.screenshot({ path: path.join(outDir, `bench-cd-${scenario.scenarioId}.png`), fullPage: true });
    } finally {
      entry.requests = scan;
      record(entry);
    }
    expect(initial.origin).toBe("Real Gemini output · IN_CLOUD");
    expect(nano.every((item) => item.real), "Nano results are real on-device").toBe(true);
    expect(scan.leaks).toEqual([]);
    expect(scan.generateContent).toBeLessThanOrEqual(2);
  });
}
