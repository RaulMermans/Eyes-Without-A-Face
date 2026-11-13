import type { Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, usingDedicatedProfile } from "./fixtures.ts";
import crmEu from "../../src/examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/firebase-api.ts";

/**
 * Sprint 10 live requalification of the NEW journey with REAL inference:
 * CONNECT (scenario) → Phantom stage: real Gemini Nano, validated suggestions applied
 * → CONNECT: Build Integration (local only, stops at approval) → OBSERVE: approve
 * the exact prompt → real Gemini → Reality Check + semantics → authorize the
 * constraint(s) → ONE approved real revision → OUTCOME → Export → `node run.mjs verify`.
 *
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT10=1 EYES_LIVE_CLOUD=1 EYES_LIVE_ON_DEVICE=1
 * (+ EYES_APPCHECK_DEBUG_TOKEN, + EYES_CHROME_PROFILE).
 * Predeclared budget: 1 run, at most 2 cloud requests. Nothing is retried.
 * Evidence: statuses, codes, counts, timings, alias-level text. No bodies, no tokens.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_SPRINT10 === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_SPRINT10=1.");
test.setTimeout(420_000);

const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-10/experience.json";

type Scenario = { destinationSchema: { properties: Record<string, { enum?: string[] }> }; twinOverrides: Record<string, { discloseCategories?: boolean }>; imported: Array<{ record: Record<string, unknown> }>; revisionFeedback: Array<{ record: Record<string, unknown> }>; development: Array<{ record: Record<string, unknown> }>; holdout: Array<{ record: Record<string, unknown> }> };

/** Same private-term construction as the Sprint 9 qualification (approved vocabulary excluded). */
function privateTerms(scenario: Scenario): string[] {
  const targetNames = Object.keys(scenario.destinationSchema.properties).map((name) => name.toLowerCase());
  const targetValues = new Set(Object.values(scenario.destinationSchema.properties).flatMap((prop) => prop.enum ?? []));
  const disclosed = Object.entries(scenario.twinOverrides).filter(([, o]) => o.discloseCategories).map(([name]) => name);
  const approved = new Set(scenario.imported.flatMap((item) => disclosed.map((field) => item.record[field]).filter((v): v is string => typeof v === "string")));
  const terms = new Set<string>(["PRIVATE_CANARY_PII_DO_NOT_SHARE"]);
  for (const { record } of [...scenario.imported, ...scenario.revisionFeedback, ...scenario.development, ...scenario.holdout]) {
    for (const [key, value] of Object.entries(record)) {
      if (key.length >= 4 && !targetNames.some((name) => name.includes(key.toLowerCase()))) terms.add(key);
      if (typeof value === "string" && value.trim().length >= 4 && !approved.has(value) && !targetValues.has(value)) terms.add(value.trim());
    }
  }
  return [...terms];
}

async function runtimeStatuses(page: Page): Promise<Record<string, string | null>> {
  const rows = page.locator('[data-testid^="runtime-stage-"]');
  const out: Record<string, string | null> = {};
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    out[((await row.getAttribute("data-testid")) ?? "").replace("runtime-stage-", "")] = await row.getAttribute("data-status");
  }
  return out;
}

async function attr(page: Page, testId: string, name: string): Promise<string | null> {
  const locator = page.getByTestId(testId);
  return (await locator.count()) > 0 ? locator.first().getAttribute(name) : null;
}

test("S10-HERO crm-eu-accounts through CONNECT / OBSERVE / OUTCOME with real inference", async ({ page }) => {
  test.skip(process.env.EYES_LIVE_CLOUD !== "1" || process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_CLOUD=1 and EYES_LIVE_ON_DEVICE=1.");
  const terms = privateTerms(crmEu as unknown as Scenario);
  const scan = { generateContent: 0, leaks: [] as string[] };
  page.on("request", (request) => {
    if (!request.url().includes("generateContent")) return;
    scan.generateContent += 1;
    const body = (request.postData() ?? "").toLowerCase();
    for (const term of terms) if (body.includes(term.toLowerCase())) scan.leaks.push(term);
  });
  const entry: Record<string, unknown> = { check: "S10-HERO", at: new Date().toISOString(), model: FIREBASE_AI_LOGIC_API.defaultCloudModel, browserLaunch: usingDedicatedProfile ? "dedicated-chrome-profile" : "playwright-default-args" };
  try {
    if (debugToken) {
      await page.addInitScript((token) => {
        (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      }, debugToken);
    }
    await page.goto("/#technical");
    await page.getByTestId("scenario-picker").locator("summary").click();
    await page.getByTestId("load-scenario-crm-eu-accounts").click();

    // Real on-device interpretation from the Phantom stage (user-started).
    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByTestId("on-device-mode-label")).toContainText("On-device AI available", { timeout: 30_000 });
    const nanoStarted = Date.now();
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.locator('[data-testid^="private-semantics-row-"]').first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("private-semantics-progress")).toHaveCount(0, { timeout: 180_000 });
    entry.nanoMs = Date.now() - nanoStarted;
    const rows = page.locator('[data-testid^="private-semantics-row-"]');
    const applied: string[] = [];
    let real = 0;
    for (let i = 0; i < (await rows.count()); i += 1) {
      const row = rows.nth(i);
      if ((await row.innerText()).includes("Gemini Nano (real on-device)")) real += 1;
      const alias = ((await row.getAttribute("data-testid")) ?? "").replace("private-semantics-row-", "");
      if ((await row.getAttribute("data-status")) === "applicable") {
        await page.getByTestId(`apply-semantics-${alias}`).click();
        applied.push(alias);
      }
    }
    entry.nano = { rows: await rows.count(), realOnDevice: real, applied };
    expect(scan.generateContent, "no cloud request during on-device interpretation").toBe(0);
    entry.runtimeAfterNano = (await runtimeStatuses(page))["on-device"];

    // CONNECT → Build Integration: local only, stops at the approval.
    await page.getByTestId("mode-connect").click();
    await page.getByTestId("build-integration").click();
    await expect(page.getByTestId("runtime-stage-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    entry.runtimeAtApproval = await runtimeStatuses(page);
    expect(scan.generateContent, "Build Integration sends nothing").toBe(0);

    // OBSERVE → approve → one real Gemini request.
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    const started = Date.now();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("cloud-error").or(page.getByTestId("proposal"))).toBeVisible({ timeout: 90_000 });
    entry.initial = { ms: Date.now() - started, failureCode: await attr(page, "cloud-error", "data-code"), status: (await page.getByTestId("proposal-status").count()) ? await page.getByTestId("proposal-status").innerText() : null };
    entry.cloudStage = { status: await attr(page, "runtime-stage-cloud-inference", "data-status"), text: await page.getByTestId("runtime-stage-cloud-inference").innerText() };
    if (!String((entry.initial as { status: string | null }).status ?? "").startsWith("Valid")) return;

    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("initial-outcomes")).toBeVisible();
    entry.runtimeAfterReality = await runtimeStatuses(page);

    const boxes = page.locator('[data-testid^="authorize-constraint-"]');
    for (let i = 0; i < (await boxes.count()); i += 1) if (await boxes.nth(i).isEnabled()) await boxes.nth(i).check();
    await page.getByTestId("prepare-safe-revision").click();
    if ((await attr(page, "revision-phase", "data-phase")) === "REVISION_REVIEW_REQUIRED") {
      entry.revisionGate = await attr(page, "runtime-stage-revision-authorization", "data-status");
      await page.getByTestId("revision-reviewed").check();
      await page.getByTestId("approve-request-revision").click();
      await expect(page.getByTestId("revised-mapping").or(page.getByTestId("revision-blocked"))).toBeVisible({ timeout: 90_000 });
      if ((await page.getByTestId("run-revised-reality-check").count()) > 0) await page.getByTestId("run-revised-reality-check").click();
    }
    entry.runtimeFinal = await runtimeStatuses(page);

    // OUTCOME → export the revised mapping when one exists.
    await page.getByTestId("mode-outcome").click();
    entry.outcome = {
      headlineState: await attr(page, "outcome-headline", "data-state"),
      verdict: await attr(page, "outcome-decision", "data-verdict"),
      requests: await page.getByTestId("privacy-requests").innerText(),
      models: await page.getByTestId("privacy-models").innerText(),
    };
    if ((await page.getByTestId("export-candidate-revised").count()) > 0) await page.getByTestId("export-candidate-revised").check();
    const decision = await attr(page, "export-panel", "data-decision");
    if (decision === "BLOCKED") return;
    if (decision === "DRAFT_ONLY") await page.getByTestId("export-draft-confirm").check();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-integration").click();
    const file = await download;
    const work = fs.mkdtempSync(path.join(tmpdir(), "eyes-live-s10-"));
    try {
      const zip = path.join(work, file.suggestedFilename());
      await file.saveAs(zip);
      execFileSync("unzip", ["-q", zip, "-d", work]);
      const root = path.join(work, fs.readdirSync(work).find((name) => !name.endsWith(".zip")) as string);
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, any>;
      const verify = spawnSync(process.execPath, ["run.mjs", "verify"], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
      entry.export = { status: manifest.status, variant: manifest.mapping.variant, origin: manifest.mapping.origin, inference: manifest.mapping.inference, revisionVerdict: manifest.mapping.revisionVerdict, verifyExit: verify.status };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  } finally {
    entry.cloudRequests = scan.generateContent;
    entry.privateTermsInRequestBodies = [...new Set(scan.leaks)];
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    const previous = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
    fs.writeFileSync(evidencePath, JSON.stringify([...previous, entry], null, 2));
  }
  expect(scan.leaks).toEqual([]);
  expect(scan.generateContent).toBeLessThanOrEqual(2);
});
