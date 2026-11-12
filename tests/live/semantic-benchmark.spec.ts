import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expect, test, usingDedicatedProfile } from "./fixtures.ts";
import crmEu from "../../src/examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import support from "../../src/examples/scenarios/support-tickets.json" with { type: "json" };
import billing from "../../src/examples/scenarios/billing-subscriptions.json" with { type: "json" };
import { BLIND_REVISION_PROMPT_VERSION, SEMANTIC_REVISION_PROMPT_VERSION } from "../../src/inference/prompts.ts";
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/firebase-api.ts";

/**
 * Sprint 8 Semantic Blind Intelligence Benchmark with REAL inference.
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SEMANTIC_BENCHMARK=1 EYES_LIVE_CLOUD=1
 * EYES_LIVE_ON_DEVICE=1 (+ App Check debug token, + EYES_CHROME_PROFILE).
 *
 * Per trial and scenario:
 *   B   real Gemini proposal (no Nano, no revision) → semantic verification → holdout
 *   C/D real Nano private interpretation (validated suggestions applied) → real
 *       Gemini proposal (C) → semantic verification → the user authorizes every
 *       trusted constraint behind a semantic finding → one approved real Gemini
 *       revision (D) → re-evaluation → local acceptance check → holdout
 *
 * Predeclared budget (docs/evidence/sprint-8/freeze-manifest.json): trials 1–5,
 * at most 3 cloud requests per scenario and trial (B: 1, C/D: 2), at most 60 in
 * total. Nothing is retried; a provider failure is recorded as a failure.
 *
 * Evidence holds alias-level proposal text, fixed-vocabulary statuses, counts,
 * hashes and timings for FICTIONAL scenarios only. Nano rationales and request
 * bodies are never stored. It is written OUTSIDE test-results/ (Playwright
 * empties that directory) to EYES_LIVE_EVIDENCE.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_SEMANTIC_BENCHMARK === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SEMANTIC_BENCHMARK=1.");
// One worker keeps the order; "default" mode means one failed run never skips the remaining trials.
test.describe.configure({ mode: "default" });
// Nano (~15 s) + two cloud requests (each up to the app's 45 s timeout) + browser evaluation.
test.setTimeout(420_000);

const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-8/semantic-benchmark.json";
const trials = Number(process.env.EYES_LIVE_TRIALS ?? "1");
const firstTrial = Number(process.env.EYES_LIVE_FIRST_TRIAL ?? "1");
const onlyScenario = process.env.EYES_LIVE_SCENARIO ?? "";

interface ScenarioJson {
  scenarioId: string;
  twinOverrides: Record<string, { discloseCategories?: boolean }>;
  destinationSchema: { properties: Record<string, { enum?: string[] }> };
  imported: Array<{ record: Record<string, unknown> }>;
  revisionFeedback: Array<{ record: Record<string, unknown> }>;
  development: Array<{ record: Record<string, unknown> }>;
  holdout: Array<{ record: Record<string, unknown> }>;
}
const SCENARIOS = ([crmEu, support, billing] as unknown as ScenarioJson[]).filter((item) => !onlyScenario || item.scenarioId === onlyScenario);

/** Private strings that must never appear in a request body (approved vocabulary excluded). */
function privateTerms(scenario: ScenarioJson): string[] {
  const targetNames = Object.keys(scenario.destinationSchema.properties).map((name) => name.toLowerCase());
  const targetValues = new Set(Object.values(scenario.destinationSchema.properties).flatMap((prop) => prop.enum ?? []));
  const disclosedFields = Object.entries(scenario.twinOverrides).filter(([, o]) => o.discloseCategories).map(([name]) => name);
  const imported = scenario.imported.map((item) => item.record);
  const approvedLabels = new Set(imported.flatMap((record) => disclosedFields.map((field) => record[field]).filter((v): v is string => typeof v === "string")));
  const records = [...scenario.imported, ...scenario.revisionFeedback, ...scenario.development, ...scenario.holdout].map((item) => item.record);
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
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const previous = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
  previous.push({
    at: new Date().toISOString(),
    browserLaunch: usingDedicatedProfile ? "dedicated-chrome-profile" : "playwright-default-args",
    model: FIREBASE_AI_LOGIC_API.defaultCloudModel,
    promptVersions: { initial: "mapping-proposal-1.1.0", revision12: BLIND_REVISION_PROMPT_VERSION, revision13: SEMANTIC_REVISION_PROMPT_VERSION },
    ...entry,
  });
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

async function attr(page: Page, testId: string, name: string): Promise<string | null> {
  const locator = page.getByTestId(testId);
  return (await locator.count()) > 0 ? locator.first().getAttribute(name) : null;
}

async function comparison(page: Page, prefix: string): Promise<Record<string, [string | null, string | null]> | null> {
  if ((await page.getByTestId(prefix).count()) === 0) return null;
  const keys = ["transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy", "incorrect", "correctlyHandled", "semantic"];
  const out: Record<string, [string | null, string | null]> = {};
  for (const key of keys) out[key] = [await text(page, `${prefix}-${key}-before`), await text(page, `${prefix}-${key}-after`)];
  return out;
}

async function semanticSnapshot(page: Page): Promise<Record<string, unknown> | null> {
  if ((await page.getByTestId("semantic-verification").count()) === 0) return null;
  const rows = page.locator('[data-testid^="semantic-result-"]');
  const results: Array<Record<string, unknown>> = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    results.push({ key: (await row.getAttribute("data-testid"))?.replace("semantic-result-", ""), status: await row.getAttribute("data-status"), code: await row.getAttribute("data-code") });
  }
  return { overall: await attr(page, "semantic-verification", "data-overall"), coverage: await text(page, "layer-coverage"), results };
}

async function boot(page: Page): Promise<void> {
  if (debugToken) {
    await page.addInitScript((token) => {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, debugToken);
  }
  await page.goto("/");
}

async function loadScenario(page: Page, id: string): Promise<void> {
  await page.getByTestId("scenario-picker").locator("summary").click();
  await page.getByTestId(`load-scenario-${id}`).click();
  await page.getByTestId("continue-to-twin").click();
}

async function approveAndPropose(page: Page) {
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  await page.getByTestId("approve-disclosure").click();
  await page.getByTestId("continue-to-mapping").click();
  const started = Date.now();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("cloud-error").or(page.getByTestId("proposal"))).toBeVisible({ timeout: 90_000 });
  const error = await text(page, "cloud-error");
  return {
    error,
    text: error ? "" : (await page.getByTestId("proposal-editor").count()) > 0 ? await page.getByTestId("proposal-editor").inputValue() : "",
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

for (let trial = firstTrial; trial < firstTrial + trials; trial += 1) {
  for (const scenario of SCENARIOS) {
    test(`trial ${trial} B ${scenario.scenarioId}: real Gemini proposal + semantic verification`, async ({ page }) => {
      test.skip(process.env.EYES_LIVE_CLOUD !== "1", "Requires EYES_LIVE_CLOUD=1.");
      const scan = watchBodies(page, privateTerms(scenario));
      await boot(page);
      await loadScenario(page, scenario.scenarioId);
      const initial = await approveAndPropose(page);
      const entry: Record<string, unknown> = { check: "S8-B", trial, scenarioId: scenario.scenarioId, config: "B-cloud", initial };
      try {
        if (initial.status?.startsWith("Valid")) {
          await runInitialReality(page);
          entry.initialState = await attr(page, "initial-outcomes", "data-state");
          entry.initialCounts = await text(page, "initial-outcomes-counts");
          entry.semantic = await semanticSnapshot(page);
          await page.getByTestId("prepare-safe-revision").click();
          if ((await page.getByTestId("decline-revision").count()) > 0) await page.getByTestId("decline-revision").click();
          await page.getByTestId("run-holdout").click();
          entry.holdoutState = await attr(page, "holdout-initial", "data-state");
          entry.holdoutCounts = await text(page, "holdout-initial-counts");
        }
      } finally {
        entry.requests = scan;
        record(entry);
      }
      expect(scan.leaks).toEqual([]);
      expect(scan.generateContent).toBeLessThanOrEqual(1);
    });

    test(`trial ${trial} C+D ${scenario.scenarioId}: real Nano, real Gemini, one semantic blind revision`, async ({ page }) => {
      test.skip(process.env.EYES_LIVE_CLOUD !== "1" || process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_CLOUD=1 and EYES_LIVE_ON_DEVICE=1.");
      const scan = watchBodies(page, privateTerms(scenario));
      await boot(page);
      await loadScenario(page, scenario.scenarioId);
      const entry: Record<string, unknown> = { check: "S8-CD", trial, scenarioId: scenario.scenarioId, config: "C/D" };
      try {
        await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available", { timeout: 30_000 });
        const nanoStarted = Date.now();
        await page.getByTestId("interpret-private-on-device").click();
        await expect(page.locator('[data-testid^="private-semantics-row-"]').first()).toBeVisible({ timeout: 120_000 });
        await expect(page.getByTestId("private-semantics-progress")).toHaveCount(0, { timeout: 180_000 });
        entry.nanoMs = Date.now() - nanoStarted;
        entry.nanoError = await text(page, "private-semantics-error");
        expect(scan.generateContent, "no cloud request during on-device interpretation").toBe(0);
        const rows = page.locator('[data-testid^="private-semantics-row-"]');
        const nano: Array<Record<string, unknown>> = [];
        for (let i = 0; i < (await rows.count()); i += 1) {
          const row = rows.nth(i);
          const alias = ((await row.getAttribute("data-testid")) ?? "").replace("private-semantics-row-", "");
          const tokens = await row.locator(".font-mono").allInnerTexts();
          nano.push({
            alias,
            localPath: tokens[1] ?? null,
            status: await row.getAttribute("data-status"),
            check: await text(page, `private-semantics-check-${alias}`),
            real: (await row.innerText()).includes("Gemini Nano (real on-device)"),
          });
        }
        entry.nano = nano;
        const applied: string[] = [];
        for (const item of nano) {
          if (item.status === "applicable") {
            await page.getByTestId(`apply-semantics-${String(item.alias)}`).click();
            applied.push(String(item.alias));
          }
        }
        entry.applied = applied;

        const initial = await approveAndPropose(page);
        entry.initial = initial;
        if (initial.status?.startsWith("Valid")) {
          await runInitialReality(page);
          entry.initialState = await attr(page, "initial-outcomes", "data-state");
          entry.initialCounts = await text(page, "initial-outcomes-counts");
          entry.semantic = await semanticSnapshot(page);
          // The user authorizes every trusted constraint behind a semantic finding (recorded as a human intervention).
          const boxes = page.locator('[data-testid^="authorize-constraint-"]');
          const authorized: string[] = [];
          for (let i = 0; i < (await boxes.count()); i += 1) {
            const box = boxes.nth(i);
            if (await box.isEnabled()) {
              await box.check();
              authorized.push(((await box.getAttribute("data-testid")) ?? "").replace("authorize-constraint-", ""));
            }
          }
          entry.authorizedConstraints = authorized;
          await page.getByTestId("prepare-safe-revision").click();
          entry.preparePhase = await attr(page, "revision-phase", "data-phase");
          entry.newInformation = await text(page, "revision-new-information");
          entry.ledger = {
            version: await text(page, "ledger-version"),
            findings: await text(page, "ledger-findings"),
            semanticFindings: await text(page, "ledger-semantic-findings"),
            constraints: await text(page, "ledger-constraints"),
            newLabels: await text(page, "ledger-new-labels"),
          };
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
              ok: await attr(page, "revised-status", "data-ok"),
              status: await text(page, "revised-status"),
            };
            // Read only what exists: a blocked revision (e.g. provider TIMEOUT) renders no revised mapping.
            entry.revisedText =
              (await page.getByTestId("revised-proposal-json").count()) > 0
                ? await page.getByTestId("revised-proposal-json").textContent()
                : (await page.getByTestId("revised-mapping").locator("pre").count()) > 0
                  ? await page.getByTestId("revised-mapping").locator("pre").first().textContent()
                  : null;
            if ((await page.getByTestId("run-revised-reality-check").count()) > 0) {
              await page.getByTestId("run-revised-reality-check").click();
              entry.revisionComparison = {
                verdict: await text(page, "revision-comparison-verdict"),
                cases: await text(page, "revision-comparison-cases"),
                metrics: await comparison(page, "revision-comparison"),
              };
              entry.decision = {
                verdict: await attr(page, "revision-decision", "data-verdict"),
                rows: await text(page, "revision-decision-rows"),
                operationRegressions: await text(page, "revision-decision-operation-regressions"),
                clean: await text(page, "revision-decision-clean"),
                semantic: await text(page, "revision-decision-semantic"),
              };
            }
          }
          if ((await page.getByTestId("run-holdout").count()) > 0) {
            await page.getByTestId("run-holdout").click();
            entry.holdoutInitial = await text(page, "holdout-initial-counts");
            entry.holdoutComparison = {
              verdict: await text(page, "holdout-comparison-verdict"),
              cases: await text(page, "holdout-comparison-cases"),
              metrics: await comparison(page, "holdout-comparison"),
            };
          }
          entry.budget = await text(page, "revision-budget");
        }
      } finally {
        entry.requests = scan;
        record(entry);
      }
      expect(scan.leaks).toEqual([]);
      expect(scan.generateContent).toBeLessThanOrEqual(2);
    });
  }
}
