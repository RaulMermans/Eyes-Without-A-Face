import type { Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, usingDedicatedProfile } from "./fixtures.ts";
import crmEu from "../../src/examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import support from "../../src/examples/scenarios/support-tickets.json" with { type: "json" };
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/firebase-api.ts";
import { INITIAL_RESPONSE_SCHEMA_ID } from "../../src/inference/response-schemas.ts";

/**
 * Sprint 9 live qualification: the hero journey end to end with REAL inference.
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT9=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1
 * (+ App Check debug token, + EYES_CHROME_PROFILE).
 *
 * Per run: real Nano interpretation (validated suggestions applied) → real Gemini
 * initial proposal (per-operation response schema) → Reality Check + semantic
 * verification → the user authorizes the trusted constraint(s) behind a semantic
 * finding → ONE approved real Gemini revision → re-evaluation and local decision →
 * Export Integration → the downloaded ZIP is extracted outside the repo and
 * `node run.mjs verify` must pass.
 *
 * Predeclared budget (before any Sprint 9 live request): at most 5 runs
 * (EYES_LIVE_RUNS, capped), at most 2 cloud requests per run, 10 in total.
 * Nothing is retried; a provider failure is recorded as a failure.
 * Evidence: alias-level text, fixed-vocabulary statuses, codes, counts, timings.
 * No request bodies, no Nano rationales, no tokens.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_SPRINT9 === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT9=1.");
test.describe.configure({ mode: "default" });
test.setTimeout(420_000);

const MAX_RUNS = 5;
const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-9/qualification.json";
const plan = (process.env.EYES_LIVE_PLAN ?? "crm-eu-accounts,crm-eu-accounts,crm-eu-accounts,support-tickets,support-tickets").split(",").slice(0, MAX_RUNS);

interface ScenarioJson {
  scenarioId: string;
  twinOverrides: Record<string, { discloseCategories?: boolean }>;
  destinationSchema: { properties: Record<string, { enum?: string[] }> };
  imported: Array<{ record: Record<string, unknown> }>;
  revisionFeedback: Array<{ record: Record<string, unknown> }>;
  development: Array<{ record: Record<string, unknown> }>;
  holdout: Array<{ record: Record<string, unknown> }>;
}
const SCENARIOS = new Map(([crmEu, support] as unknown as ScenarioJson[]).map((item) => [item.scenarioId, item]));

/** Private strings of a scenario (approved vocabulary excluded). Used for request bodies AND the exported package. */
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
    initialResponseSchema: INITIAL_RESPONSE_SCHEMA_ID,
    ...entry,
  });
  fs.writeFileSync(evidencePath, JSON.stringify(previous, null, 2));
}

function watchBodies(page: Page, terms: string[]) {
  const scan = { generateContent: 0, leaks: [] as string[] };
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) {
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

plan.forEach((scenarioId, index) => {
  const run = index + 1;
  test(`run ${run} ${scenarioId}: real Nano → real Gemini → one real revision → export → plain node`, async ({ page }) => {
    test.skip(process.env.EYES_LIVE_CLOUD !== "1" || process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_CLOUD=1 and EYES_LIVE_ON_DEVICE=1.");
    const scenario = SCENARIOS.get(scenarioId);
    if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
    const terms = privateTerms(scenario);
    const scan = watchBodies(page, terms);
    const entry: Record<string, unknown> = { check: "S9-HERO", run, scenarioId };
    try {
      if (debugToken) {
        await page.addInitScript((token) => {
          (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
        }, debugToken);
      }
      await page.goto("/");
      await page.getByTestId("runtime-preflight").locator("summary").click();
      entry.preflight = Object.fromEntries(
        await Promise.all(["browser", "on-device", "firebase", "app-check", "cloud"].map(async (id) => [id, await attr(page, `preflight-${id}`, "data-status")] as const)),
      );
      await page.getByTestId("scenario-picker").locator("summary").click();
      await page.getByTestId(`load-scenario-${scenarioId}`).click();
      await page.getByTestId("continue-to-twin").click();

      // 1. Real on-device interpretation. No cloud request may happen here.
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
        nano.push({ alias, status: await row.getAttribute("data-status"), real: (await row.innerText()).includes("Gemini Nano (real on-device)") });
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

      // 2. Exact-prompt approval and one real Gemini request.
      await page.getByTestId("continue-to-review").click();
      await page.getByTestId("build-preview").click();
      await page.getByTestId("approve-disclosure").click();
      await page.getByTestId("continue-to-mapping").click();
      const started = Date.now();
      await page.getByTestId("send-cloud-request").click();
      await expect(page.getByTestId("cloud-error").or(page.getByTestId("proposal"))).toBeVisible({ timeout: 90_000 });
      entry.initial = {
        failureCode: await attr(page, "cloud-error", "data-code"),
        text: (await page.getByTestId("proposal-editor").count()) > 0 ? await page.getByTestId("proposal-editor").inputValue() : null,
        origin: await text(page, "proposal-origin"),
        provenance: await text(page, "proposal-provenance"),
        status: await text(page, "proposal-status"),
        ms: Date.now() - started,
      };
      const initialStatus = await text(page, "proposal-status");
      if (!initialStatus?.startsWith("Valid")) return;

      // 3. Local Reality Check + semantic verification.
      await page.getByTestId("continue-to-reality").click();
      await page.getByTestId("run-mapping").click();
      await expect(page.getByTestId("initial-outcomes")).toBeVisible();
      entry.initialState = await attr(page, "initial-outcomes", "data-state");
      entry.initialCounts = await text(page, "initial-outcomes-counts");
      entry.semanticBefore = await attr(page, "semantic-verification", "data-overall");
      entry.exportBefore = { state: await attr(page, "export-panel", "data-state"), decision: await attr(page, "export-panel", "data-decision") };

      // 4. The user authorizes the trusted constraint(s) behind a semantic finding; one approved revision.
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
      if (entry.preparePhase === "REVISION_REVIEW_REQUIRED") {
        const before = scan.generateContent;
        await page.getByTestId("revision-reviewed").check();
        const revisionStarted = Date.now();
        await page.getByTestId("approve-request-revision").click();
        await expect(page.getByTestId("revised-mapping").or(page.getByTestId("revision-blocked"))).toBeVisible({ timeout: 90_000 });
        entry.revision = {
          ms: Date.now() - revisionStarted,
          requests: scan.generateContent - before,
          blockedCode: await attr(page, "revision-blocked", "data-code"),
          failureCode: await attr(page, "revision-blocked", "data-failure"),
          origin: await text(page, "revised-origin"),
          provenance: await text(page, "revised-provenance"),
          ok: await attr(page, "revised-status", "data-ok"),
        };
        if ((await page.getByTestId("run-revised-reality-check").count()) > 0) {
          await page.getByTestId("run-revised-reality-check").click();
          entry.decision = {
            verdict: await attr(page, "revision-decision", "data-verdict"),
            rows: await text(page, "revision-decision-rows"),
            clean: await text(page, "revision-decision-clean"),
            semantic: await text(page, "revision-decision-semantic"),
          };
        }
      }

      // 5. Export: the revised mapping when one exists, else the initial one, with its own status.
      if ((await page.getByTestId("export-candidate-revised").count()) > 0) await page.getByTestId("export-candidate-revised").check();
      const decision = await attr(page, "export-panel", "data-decision");
      entry.exportCandidate = { state: await attr(page, "export-panel", "data-state"), decision };
      if (decision === "BLOCKED") return;
      if (decision === "DRAFT_ONLY") await page.getByTestId("export-draft-confirm").check();
      const download = page.waitForEvent("download");
      await page.getByTestId("export-integration").click();
      const file = await download;
      const work = fs.mkdtempSync(path.join(tmpdir(), "eyes-live-export-"));
      try {
        const zip = path.join(work, file.suggestedFilename());
        await file.saveAs(zip);
        execFileSync("unzip", ["-q", zip, "-d", work]);
        const root = path.join(work, fs.readdirSync(work).find((name) => !name.endsWith(".zip")) as string);
        const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, any>;
        const verify = spawnSync(process.execPath, ["run.mjs", "verify"], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
        const all = fs.readdirSync(root, { recursive: true }).map(String).filter((rel) => fs.statSync(path.join(root, rel)).isFile()).map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("\n").toLowerCase();
        entry.export = {
          status: manifest.status,
          variant: manifest.mapping.variant,
          origin: manifest.mapping.origin,
          inference: manifest.mapping.inference,
          revisionVerdict: manifest.mapping.revisionVerdict,
          contractSha256: manifest.mapping.contractSha256,
          verifyExit: verify.status,
          verifyPassLines: verify.stderr.split("\n").filter((line) => line.startsWith("PASS")).length,
          packageLeaks: terms.filter((term) => all.includes(term.toLowerCase())),
        };
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    } finally {
      entry.requests = scan;
      record(entry);
    }
    expect(scan.leaks).toEqual([]);
    expect(scan.generateContent).toBeLessThanOrEqual(2);
    const exported = entry.export as { verifyExit: number; packageLeaks: string[] } | undefined;
    if (exported) {
      expect(exported.verifyExit).toBe(0);
      expect(exported.packageLeaks).toEqual([]);
    }
  });
});
