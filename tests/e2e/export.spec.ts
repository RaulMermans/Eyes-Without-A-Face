import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachProviderWatch, openOutcome, openStage } from "./helpers.ts";

/**
 * Sprint 9 Workstream A/C — Export Integration through the real UI.
 * Cloud output comes from the labeled TEST adapter (no network). Each test
 * downloads the ZIP the browser built, extracts it with the system `unzip`
 * into a fresh directory and runs the packaged runner with plain `node`.
 */
const shots = "test-results/sprint-9-screenshots";

const SUPPORT_REVERSED = {
  operations: [
    { op: "copy", from: "f_06", to: "id" },
    { op: "normalize_email", from: "f_04", to: "requesterEmail" },
    { op: "map_enum", from: "f_01", to: "priority", params: { map: { p1: "low", p2: "normal", p3: "high", p4: "urgent" }, unmapped: "default", default: "normal" } },
    { op: "parse_date", from: "f_05", to: "openedAt", params: { inputFormat: "ISO-8601" } },
    { op: "map_enum", from: "f_02", to: "channel", params: { map: { email: "email", phone: "phone", web: "web" }, unmapped: "default", default: "web" } },
  ],
  rationale: "Fixed E2E proposal served by the simulated test adapter.",
};
const SUPPORT_PRIVATE = ["ticket_ref", "\"requester\"", "\"prio\"", "\"opened\"", "TCK-2078", "TCK-2077", "li.wei@example.com", "Dana.Okafor", "nina.berg@example.com", "PRIVATE_CANARY_PII_DO_NOT_SHARE", "TCK-2201", "pia.lang@example.com"];
const CRM_PRIVATE = ["CUST-001", "alice@example.com", "North Bridge", "Cedar & Pine", "customer_id", "email_address", "account_state", "joined_at", "company_name", "internal_note", "PRIVATE_CANARY_PII_DO_NOT_SHARE"];

const dirs: string[] = [];
test.afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/#technical");
}

async function toReality(page: Page, scenario: string): Promise<void> {
  await page.getByTestId("scenario-picker").locator("summary").click();
  await page.getByTestId(`load-scenario-${scenario}`).click();
  await page.getByTestId("continue-to-twin").click();
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  await page.getByTestId("approve-disclosure").click();
  await page.getByTestId("continue-to-mapping").click();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("proposal-status")).toContainText("Valid");
  await page.getByTestId("continue-to-reality").click();
  await page.getByTestId("run-mapping").click();
  await expect(page.getByTestId("reality-verdict")).toBeVisible();
}

/** Click Export, save the download, extract it with `unzip` into a fresh directory. */
async function downloadAndExtract(page: Page): Promise<{ root: string; zip: string }> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-integration").click();
  const download = await downloadPromise;
  const work = mkdtempSync(path.join(tmpdir(), "eyes-e2e-download-"));
  dirs.push(work);
  const zip = path.join(work, download.suggestedFilename());
  await download.saveAs(zip);
  const out = mkdtempSync(path.join(tmpdir(), "eyes-e2e-clean-room-"));
  dirs.push(out);
  execFileSync("unzip", ["-q", zip, "-d", out]);
  const [rootName] = readdirSync(out);
  return { root: path.join(out, rootName as string), zip };
}

function runner(root: string, args: string[]) {
  return spawnSync(process.execPath, ["run.mjs", ...args], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
}

function allText(root: string): string {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));
  return walk(root).map((file) => readFileSync(file, "utf8")).join("\n");
}

test.describe("E2E-090 export → download → run outside the app", () => {
  test("hero journey: wrong meaning → approved revision → export the revised mapping → it runs with plain node", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { cloudOutput: SUPPORT_REVERSED });
    await toReality(page, "support-tickets");

    // Before revision: one candidate, a draft at best (meaning is wrong). Export lives in OUTCOME (Sprint 10).
    await openOutcome(page);
    const panel = page.getByTestId("export-panel");
    await expect(panel).toHaveAttribute("data-decision", "DRAFT_ONLY");
    await expect(page.getByTestId("export-reasons")).toContainText("means something wrong");
    await expect(page.getByTestId("export-integration")).toBeDisabled();

    // One approved blind revision (simulated adapter), re-evaluated locally, in OBSERVE.
    await page.getByTestId("mode-observe").click();
    await page.getByTestId("authorize-constraint-support-priority-order").check();
    await page.getByTestId("prepare-safe-revision").click();
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await page.getByTestId("run-revised-reality-check").click();
    await expect(page.getByTestId("revision-decision")).toHaveAttribute("data-verdict", "ACCEPTED");

    // Two candidates; nothing promoted automatically.
    await openOutcome(page);
    await expect(page.getByTestId("export-candidates")).toBeVisible();
    await expect(page.getByTestId("export-candidate-active")).toBeChecked();
    await page.getByTestId("export-candidate-revised").check();
    await page.getByTestId("export-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, "e2e-090-export-panel.png"), fullPage: false });
    const decision = await panel.getAttribute("data-decision");
    if (decision === "DRAFT_ONLY") await page.getByTestId("export-draft-confirm").check();
    const { root } = await downloadAndExtract(page);
    await expect(page.getByTestId("export-result")).toBeVisible();
    await expect(page.getByTestId("export-privacy-scan")).toContainText("0 findings");

    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.mapping.variant).toBe("revised");
    expect(manifest.mapping.origin).toBe("test-adapter");
    expect(manifest.mapping.inference).toMatchObject({ actualSource: "TEST", simulated: true });
    expect(manifest.mapping.revisionVerdict).toBe("ACCEPTED");
    expect(manifest.includesPrivateSourceFixtures).toBe(false);
    expect(manifest.includesSourceBindings).toBe(false);

    const verify = runner(root, ["verify"]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(verify.stderr).toContain("PASS fixture replay");

    const text = allText(root);
    for (const value of SUPPORT_PRIVATE) expect(text, value).not.toContain(value);
    expect(providerRequests).toEqual([]);
    await page.screenshot({ path: path.join(shots, "e2e-090-exported.png"), fullPage: false });
  });
});

test.describe("E2E-091 no-cloud path: hand-written contract exports as aliases", () => {
  test("degraded mode: the scan blocks unapproved labels; after approving them the package exports, labeled hand-written", async ({ page }) => {
    await page.goto("/#technical");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toBeVisible();

    // Hidden cases fail → draft only; the button stays disabled until confirmed.
    await openOutcome(page);
    await expect(page.getByTestId("export-panel")).toHaveAttribute("data-decision", "DRAFT_ONLY");
    await expect(page.getByTestId("export-state")).toHaveText("Partially verified · draft export only");
    await expect(page.getByTestId("export-integration")).toBeDisabled();
    await expect(page.getByTestId("export-integration")).toHaveText(/Export Draft Integration/);
    await page.getByTestId("export-draft-confirm").check();
    // The hand-written contract maps the real category labels, which were never approved: blocked, nothing downloaded.
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await page.getByTestId("export-integration").click();
    await expect(page.getByTestId("export-failed")).toHaveAttribute("data-code", "PRIVACY_SCAN_FAILED");
    await expect(page.getByTestId("export-failed")).toContainText("mapping/mapping.alias.json (private-value)");
    await expect(page.getByTestId("export-failed")).not.toContainText("active_customer");
    expect(downloads).toBe(0);

    // Remedy: approve those labels for disclosure on the twin step, run again, export with the keyboard.
    await openStage(page, /Phantom Twin/);
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
    await openStage(page, /Reality Check/);
    await page.getByTestId("run-mapping").click();
    await openOutcome(page);
    await page.getByTestId("export-draft-confirm").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("export-integration")).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-integration").focus();
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    const work = mkdtempSync(path.join(tmpdir(), "eyes-e2e-manual-"));
    dirs.push(work);
    const zip = path.join(work, download.suggestedFilename());
    await download.saveAs(zip);
    execFileSync("unzip", ["-q", zip, "-d", work]);
    const root = path.join(work, readdirSync(work).find((name) => !name.endsWith(".zip")) as string);
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.status).toBe("DRAFT");
    expect(manifest.mapping.origin).toBe("hand-written");
    expect(manifest.mapping.inference).toBeNull();
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain("DRAFT — not production-ready");
    expect(runner(root, ["verify"]).status).toBe(0);
    const text = allText(root);
    for (const value of CRM_PRIVATE) expect(text, value).not.toContain(value);
  });

  test("without a Reality Check nothing can be exported", async ({ page }) => {
    await page.goto("/#technical");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await openOutcome(page);
    await expect(page.getByTestId("export-blocked")).toBeVisible();
    await expect(page.getByTestId("export-blocked")).toContainText("Run the Reality Check");
    await expect(page.getByTestId("export-integration")).toBeDisabled();
  });
});

test.describe("E2E-092 export panel on a phone", () => {
  test("no horizontal overflow at 390 px and the action stays reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#technical");
    await page.getByTestId("load-crm-sample").click();
    await openStage(page, /Reality Check/);
    await page.getByTestId("run-mapping").click();
    await openOutcome(page);
    await page.getByTestId("export-panel").scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("export-integration")).toBeVisible();
    await page.screenshot({ path: path.join(shots, "e2e-092-export-mobile.png"), fullPage: false });
  });
});
