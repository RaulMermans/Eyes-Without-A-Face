import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, openOutcome, openStage } from "./helpers.ts";

/**
 * Sprint 10 — CONNECT / OBSERVE / OUTCOME and the Live Intelligence Runtime.
 * The cloud adapter is the labeled deterministic TEST adapter (no network):
 * these tests prove the journey, the gates and that the runtime and outcome
 * agree with canonical state — not model quality.
 */
const shots = "test-results/sprint-10-screenshots";

const CRM_INITIAL = {
  operations: [
    { op: "copy", from: "f_01", to: "id" },
    { op: "normalize_email", from: "f_02", to: "email" },
    { op: "map_enum", from: "f_05", to: "status", params: { map: { aktiv: "active", inaktiv: "inactive", interessent: "prospect" }, unmapped: "fail" } },
    { op: "parse_date", from: "f_03", to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
    { op: "copy", from: "f_06", to: "organization" },
  ],
  rationale: "Fixed E2E proposal served by the simulated test adapter.",
};

async function boot(page: Page, harness: Record<string, unknown> = { deriveProposal: true }): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

function stage(page: Page, id: string) {
  return page.getByTestId(`runtime-stage-${id}`);
}

async function buildFromDemo(page: Page): Promise<void> {
  await page.getByTestId("start-demo").click();
  await page.getByTestId("build-integration").click();
  await expect(page.getByTestId("observe")).toBeVisible();
}

async function approveSendRun(page: Page): Promise<void> {
  await page.getByTestId("runtime-next-action").click();
  await page.getByTestId("approve-disclosure").click();
  await page.getByTestId("continue-to-mapping").click();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("proposal-status")).toContainText("Valid");
  await page.getByTestId("continue-to-reality").click();
  await page.getByTestId("run-mapping").click();
  await expect(page.getByTestId("reality-verdict")).toBeVisible();
}

test.describe("E2E-100 CONNECT → OBSERVE → OUTCOME journey", () => {
  test("two clicks to the approval, no cloud call before it, then verification and export", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await expect(page.getByTestId("build-integration")).toBeDisabled();
    await page.getByTestId("start-demo").click();
    await expect(page.getByTestId("connect")).toBeVisible();
    await expect(page.getByTestId("destination-fields")).toBeVisible();
    await expect(page.getByTestId("destination-preset-default")).toBeChecked();
    await page.getByTestId("build-integration").click();

    // Stopped at the first decision: nothing approved, nothing sent.
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(page.getByTestId("runtime-headline")).toHaveText("Waiting for your approval of one cloud request.");
    await expect(page.getByTestId("ledger-transmitted")).toContainText("Nothing sent");
    await expect(stage(page, "cloud-inference")).toHaveAttribute("data-status", "not-started");
    expect(await cloudCalls(page)).toBe(0);

    await approveSendRun(page);
    expect(await cloudCalls(page)).toBe(1);
    await expect(stage(page, "cloud-inference")).toHaveAttribute("data-status", "completed");
    await expect(stage(page, "cloud-inference")).toContainText("simulated test adapter — not Gemini");
    await expect(stage(page, "reality-check")).toHaveAttribute("data-status", "requires-review");

    await page.getByTestId("open-outcome").click();
    await expect(page.getByTestId("outcome-overview")).toBeVisible();
    await expect(page.getByTestId("export-panel")).toBeVisible();
    await expect(page.getByTestId("export-not-deploy")).toContainText("does not deploy");
    await page.screenshot({ path: path.join(shots, "e2e-100-outcome.png"), fullPage: true });
    expect(providerRequests).toEqual([]);
  });

  test("Build Integration is idempotent: a second build keeps the same pending request", async ({ page }) => {
    await boot(page);
    await buildFromDemo(page);
    const hash = await page.getByTestId("inspector-summary").innerText();
    await page.getByTestId("mode-connect").click();
    await page.getByTestId("build-integration").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await stage(page, "disclosure-prepared").click();
    const again = await page.getByTestId("inspector-summary").innerText();
    await stage(page, "authorization").click();
    expect(await page.getByTestId("inspector-summary").innerText()).toBe(hash);
    expect(again).toMatch(/sha [a-f0-9]{8}…/);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-101 runtime agrees with canonical state", () => {
  test("statuses, inspector, timeline and keyboard selection", async ({ page }) => {
    await boot(page);
    await page.getByTestId("mode-observe").click();
    // Before any source, nothing is completed.
    const statuses = await page.locator('[data-testid^="runtime-stage-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status")));
    expect(statuses).toHaveLength(17);
    expect(statuses.every((status) => status === "not-started")).toBe(true);
    await expect(page.getByTestId("runtime-timeline")).toContainText("Nothing has happened yet");

    await page.getByTestId("mode-connect").click();
    await buildFromDemo(page);
    for (const id of ["source-imported", "source-profiled", "twin", "disclosure-prepared"]) {
      await expect(stage(page, id)).toHaveAttribute("data-status", "completed");
    }
    // Optional on-device step that nobody started: skipped (not run), never completed.
    await expect(stage(page, "on-device")).toHaveAttribute("data-status", "skipped");
    await stage(page, "on-device").focus();
    await page.keyboard.press("Enter");
    await expect(stage(page, "on-device")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("runtime-inspector")).toHaveAttribute("data-stage", "on-device");
    await expect(page.getByTestId("inspector-note")).toContainText("deterministic profile only");

    // Timeline shows real local events of this run only.
    const timeline = page.getByTestId("runtime-timeline");
    await expect(timeline).toContainText("Source profiled");
    await expect(timeline).toContainText("Disclosure prepared");
    await expect(timeline).not.toContainText("Gemini mapping request");

    // Inspector "open" jumps to the workbench stage that owns the controls.
    await stage(page, "authorization").click();
    await page.getByTestId("inspector-open").click();
    await expect(page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name: /Disclosure Review/ })).toHaveAttribute("aria-current", "step");
    await page.getByTestId("approve-disclosure").click();
    await expect(stage(page, "authorization")).toHaveAttribute("data-status", "completed");
    await expect(timeline).toContainText("You approved one request");
  });

  test("a cloud failure is shown as failed with a classified code and no fabricated proposal", async ({ page }) => {
    await boot(page, { cloudErrorCode: "PROVIDER_OVERLOADED" });
    await buildFromDemo(page);
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("cloud-error")).toBeVisible();
    await expect(stage(page, "cloud-inference")).toHaveAttribute("data-status", "failed");
    await expect(stage(page, "cloud-inference")).toContainText("PROVIDER_OVERLOADED");
    await expect(stage(page, "mapping-proposed")).toHaveAttribute("data-status", "blocked");
    await expect(stage(page, "contract-validated")).toHaveAttribute("data-status", "not-started");
    await expect(page.getByTestId("runtime-timeline")).toContainText("Gemini mapping request — did not succeed");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-107 missing Gemini Nano", () => {
  test("a blocked on-device probe is reported as unavailable and the session as not hybrid", async ({ page }) => {
    await boot(page, { deriveProposal: true, onDeviceUnavailable: true });
    await page.getByTestId("load-crm-sample").click();
    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByTestId("twin-summary")).toBeVisible();
    await expect(stage(page, "on-device")).toHaveAttribute("data-status", "skipped");
    await stage(page, "on-device").click();
    await expect(page.getByTestId("inspector-summary")).toContainText("unavailable");
    await expect(page.getByTestId("inspector-note")).toContainText("not hybrid");
    // The deterministic path still completes.
    await expect(stage(page, "twin")).toHaveAttribute("data-status", "completed");
  });
});

test.describe("E2E-102 upstream changes invalidate approvals and results", () => {
  test("changing the destination in CONNECT clears the approval, the proposal and the outcome", async ({ page }) => {
    await boot(page);
    await buildFromDemo(page);
    await approveSendRun(page);
    await expect(stage(page, "reality-check")).not.toHaveAttribute("data-status", "not-started");

    await page.getByTestId("mode-connect").click();
    await page.getByText("Edit schema JSON").click();
    const editor = page.getByTestId("destination-schema-editor");
    await editor.fill((await editor.inputValue()).replace('"title": "', '"title": "Edited '));
    await expect(page.getByTestId("destination-preset-default")).not.toBeChecked();

    await page.getByTestId("mode-observe").click();
    for (const id of ["disclosure-prepared", "authorization", "cloud-inference", "mapping-proposed", "contract-validated", "reality-check", "outcome"]) {
      await expect(stage(page, id), id).toHaveAttribute("data-status", "not-started");
    }
    await expect(page.getByTestId("ledger-approved")).toContainText("Not reviewed yet");
    await openOutcome(page);
    await expect(page.getByTestId("outcome-headline")).toHaveText("No verified evidence yet.");
    await expect(page.getByTestId("outcome-overview")).toHaveCount(0);
  });
});

test.describe("E2E-103 outcome derives from the evaluator", () => {
  test("hero scenario: before/after, quarantine not counted as success, recommendation never auto-applied", async ({ page }) => {
    await boot(page, { cloudOutput: CRM_INITIAL });
    await page.getByTestId("scenario-picker").locator("summary").click();
    await page.getByTestId("load-scenario-crm-eu-accounts").click();
    await page.getByTestId("build-integration").click();
    await approveSendRun(page);

    // Initial outcome: meaning is wrong → partially verified.
    await openOutcome(page);
    await expect(page.getByTestId("outcome-headline")).toHaveAttribute("data-state", "PARTIALLY_VERIFIED");
    await expect(page.getByTestId("outcome-meaning")).not.toContainText("Meaning verified");
    await expect(page.getByTestId("outcome-before-after")).toHaveCount(0);

    // One approved revision, observed as a second boundary crossing.
    await page.getByTestId("mode-observe").click();
    await page.getByTestId("prepare-safe-revision").click();
    await expect(stage(page, "revision-authorization")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(stage(page, "revision-inference")).toHaveAttribute("data-status", "not-started");
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await page.getByTestId("run-revised-reality-check").click();
    await expect(stage(page, "revision-inference")).toHaveAttribute("data-status", "completed");
    await expect(stage(page, "revision-evaluated")).toHaveAttribute("data-status", "completed");
    expect(await cloudCalls(page)).toBe(2);

    await openOutcome(page);
    await expect(page.getByTestId("outcome-before-after")).toBeVisible();
    await expect(page.getByTestId("outcome-decision")).toHaveAttribute("data-verdict", "ACCEPTED");
    await expect(page.getByTestId("outcome-changes")).toContainText("createdAt");
    // Initial and revised stay distinguishable, and export still defaults to the initial mapping.
    await expect(page.getByTestId("outcome-initial")).toContainText("partially verified");
    await expect(page.getByTestId("outcome-revised")).toContainText("verified with exceptions");
    await expect(page.getByTestId("export-candidate-active")).toBeChecked();
    // Quarantined records are counted separately, never as transformed.
    const revised = page.getByTestId("outcome-revised");
    const transformed = Number(await revised.getByTestId("outcome-count-transformed").getAttribute("data-value"));
    const quarantined = Number(await revised.getByTestId("outcome-count-quarantined").getAttribute("data-value"));
    expect(quarantined).toBeGreaterThan(0);
    expect(transformed + quarantined).toBeLessThanOrEqual(9);
    // Privacy outcome reflects the two approved, sent requests.
    await expect(page.getByTestId("privacy-requests")).toContainText("2 authorized by you · 2 sent");
    await expect(page.getByTestId("privacy-models")).toContainText("Simulated test adapter — not Gemini");
    await page.screenshot({ path: path.join(shots, "e2e-103-outcome-revised.png"), fullPage: true });
  });
});

test.describe("E2E-104 advanced controls stay reachable", () => {
  test("step-by-step path, workbench stages and engineering diagnostics", async ({ page }) => {
    await boot(page);
    await page.getByTestId("load-crm-sample").click();
    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByRole("heading", { level: 2, name: "Phantom Twin", exact: true })).toBeVisible();
    await expect(page.getByTestId("twin-summary")).toBeVisible();
    await openStage(page, /Cloud Mapping/);
    await expect(page.getByTestId("manual-contract")).toBeVisible();
    await expect(page.getByTestId("diagnostic-details")).toBeVisible();
    await expect(page.getByTestId("workflow-telemetry")).toBeAttached();
  });
});

test.describe("E2E-105 responsive Black Halo shell", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`no horizontal overflow in any mode at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await boot(page);
      const cta = await page.getByTestId("start-demo").boundingBox();
      expect(cta).not.toBeNull();
      expect(cta!.y + cta!.height).toBeLessThanOrEqual(viewport.height);
      await page.getByTestId("start-demo").click();
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      if (viewport.width < 1024) {
        await expect(page.getByTestId("build-integration-mobile")).toBeVisible();
        await page.getByTestId("build-integration-mobile").click();
      } else {
        await page.getByTestId("build-integration").click();
      }
      await expect(page.getByTestId("runtime-lanes")).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByTestId("runtime-next-action").click();
      await expect(page.getByTestId("approve-disclosure")).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
      await openOutcome(page);
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("E2E-106 reduced motion", () => {
  test("no element animates when the user prefers reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, { deriveProposal: true, cloudDelayMs: 1500 });
    await buildFromDemo(page);
    await page.getByTestId("runtime-next-action").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    // While Gemini (simulated) is pending, the running node exists but does not animate.
    await expect(stage(page, "cloud-inference")).toHaveAttribute("data-status", "running");
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("*")].filter((node) => {
        const style = getComputedStyle(node);
        const pseudo = getComputedStyle(node, "::after");
        return (style.animationName !== "none" && style.animationName !== "") || (pseudo.animationName !== "none" && pseudo.animationName !== "");
      }).length,
    );
    expect(animated).toBe(0);
  });
});
