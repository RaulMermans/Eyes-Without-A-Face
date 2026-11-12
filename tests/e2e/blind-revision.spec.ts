import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 7 Blind Integration acceptance. The cloud adapter is the labeled
 * deterministic TEST adapter (no network); these prove the journey, gates and
 * evaluator wiring, not model quality. Real-inference evidence lives in
 * tests/live/blind-revision.spec.ts.
 */
const shots = "test-results/sprint-7-screenshots";

/** Alias-level initial proposal for crm-eu-accounts at the default seed (f_04 is the withheld note). */
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
const CRM_PRIVATE = ["KD-10031", "anna.koch@example.de", "gesperrt", "keine-angabe", "25/03/2026", "Koch Atelier", "kundennummer", "e_post", "kontostatus", "angelegt_am", "unternehmen", "notiz", "PRIVATE_CANARY_PII_DO_NOT_SHARE", "KD-10053", "gekuendigt"];

async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

async function toInitialReality(page: Page, scenario = "crm-eu-accounts"): Promise<void> {
  await page.getByTestId("scenario-picker").locator("summary").click();
  await page.getByTestId(`load-scenario-${scenario}`).click();
  await expect(page.getByTestId("scenario-active")).toBeVisible();
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

test.describe("E2E-070 blind revision journey (simulated adapter)", () => {
  test("prepare → review → approve once → revised mapping → re-evaluate → independent holdout", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { cloudOutput: CRM_INITIAL });
    await toInitialReality(page);
    expect(await cloudCalls(page)).toBe(1);

    const panel = page.getByTestId("blind-revision");
    await expect(page.getByTestId("initial-outcomes")).toHaveAttribute("data-state", "PARTIALLY_VERIFIED");
    await expect(page.getByTestId("initial-outcomes-counts")).toContainText("incorrect");
    await expect(page.getByTestId("policy-id")).toHaveText("crm-eu-v1@1.0.0");
    await expect(page.getByTestId("revision-budget")).toHaveText("1 of 1 remaining");

    // Prepare is local only.
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("revision-phase")).toHaveAttribute("data-phase", "REVISION_REVIEW_REQUIRED");
    expect(await cloudCalls(page)).toBe(1);
    const newInfo = page.getByTestId("revision-new-information");
    await expect(newInfo).toContainText("date-format-mismatch");
    await expect(newInfo).toContainText("undisclosed-category");
    await expect(newInfo).toContainText('Approved fallback: undisclosed categories for status may map to "other"');
    await expect(page.getByTestId("revision-stays-private")).toContainText("Original field names");
    await expect(page.getByTestId("revision-cumulative")).toContainText("no new fields");

    // The exact request carries no private value or source name.
    await page.getByTestId("revision-exact-toggle").click();
    const prompt = await page.getByTestId("revision-prompt").innerText();
    expect(prompt.startsWith("Task: revise a declarative mapping.")).toBe(true);
    for (const value of CRM_PRIVATE) expect(prompt, value).not.toContain(value);
    await expect(page.getByTestId("revision-hash")).toHaveText(/^[a-f0-9]{64}$/);

    // Approval needs the explicit review checkbox.
    const approve = page.getByTestId("approve-request-revision");
    await expect(approve).toBeDisabled();
    await page.getByTestId("revision-reviewed").check();
    await approve.click();
    await expect(page.getByTestId("revised-status")).toHaveAttribute("data-ok", "true");
    expect(await cloudCalls(page)).toBe(2);
    await expect(page.getByTestId("revised-origin")).toHaveText("Simulated test adapter — not Gemini");
    await expect(page.getByTestId("revised-op-createdAt")).toHaveAttribute("data-change", "changed");
    await expect(page.getByTestId("revised-op-status")).toHaveAttribute("data-change", "changed");
    await expect(page.getByTestId("revised-op-id")).toHaveAttribute("data-change", "unchanged");
    await expect(page.getByTestId("revision-budget")).toHaveText("0 of 1 remaining (used)");
    await expect(page.getByTestId("prepare-safe-revision")).toBeDisabled();
    await expect(page.getByTestId("revision-approval-state")).toContainText("cannot authorize another request");

    await page.getByTestId("run-revised-reality-check").click();
    const comparison = page.getByTestId("revision-comparison");
    await expect(comparison).toBeVisible();
    await expect(page.getByTestId("revision-comparison-verdict")).toHaveText("improved, no regressions");
    await expect(page.getByTestId("revision-comparison-incorrect-after")).toHaveText("0");

    await page.getByTestId("run-holdout").click();
    await expect(page.getByTestId("holdout-comparison-verdict")).toHaveText("improved, no regressions");
    const before = Number(await page.getByTestId("holdout-comparison-correctlyHandled-before").innerText());
    const after = Number(await page.getByTestId("holdout-comparison-correctlyHandled-after").innerText());
    expect(after).toBeGreaterThan(before);
    // Quarantine is reported separately and never counted as a transformation.
    await expect(page.getByTestId("holdout-comparison-quarantined-after")).toHaveText("1");
    expect(await cloudCalls(page)).toBe(2);
    expect(providerRequests).toEqual([]);
    await panel.screenshot({ path: path.join(shots, "e2e-070-blind-revision.png") });
  });
});

test.describe("E2E-071 declining discloses nothing", () => {
  test("decline keeps the initial mapping final and still allows the holdout", async ({ page }) => {
    await boot(page, { cloudOutput: CRM_INITIAL });
    await toInitialReality(page);
    await page.getByTestId("prepare-safe-revision").click();
    await page.getByTestId("decline-revision").click();
    await expect(page.getByTestId("revision-blocked")).toHaveAttribute("data-code", "DECLINED");
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("run-holdout").click();
    await expect(page.getByTestId("holdout-initial")).toBeVisible();
    await expect(page.getByTestId("holdout-comparison")).toHaveCount(0);
  });
});

test.describe("E2E-072 invalid revision output", () => {
  test("malformed revision JSON is rejected, not repaired, not executed, and not retried", async ({ page }) => {
    await boot(page, { cloudOutput: CRM_INITIAL, revisionRawText: "{\"operations\": [ {\"op\": \"eval\"" });
    await toInitialReality(page);
    await page.getByTestId("prepare-safe-revision").click();
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await expect(page.getByTestId("revised-status")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("revised-status")).toContainText("not repaired, not executed");
    await expect(page.getByTestId("revision-phase")).toHaveAttribute("data-phase", "REVISION_REJECTED");
    await expect(page.getByTestId("run-revised-reality-check")).toHaveCount(0);
    await expect(page.getByTestId("prepare-safe-revision")).toBeDisabled();
    expect(await cloudCalls(page)).toBe(2);
  });
});

test.describe("E2E-073 upstream changes invalidate the revision", () => {
  test("changing the twin seed discards the prepared revision and its approval", async ({ page }) => {
    await boot(page, { cloudOutput: CRM_INITIAL });
    await toInitialReality(page);
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("revision-review")).toBeVisible();
    await page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name: /Phantom/ }).click();
    await page.getByTestId("twin-seed").fill("7");
    await page.getByTestId("apply-seed").click();
    await page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name: /Reality/ }).click();
    await expect(page.getByTestId("blind-revision-unavailable")).toBeVisible();
    await expect(page.getByTestId("revision-review")).toHaveCount(0);
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-074 private understanding stays on the device", () => {
  test("validated Nano suggestions need an explicit apply; contradictions are rejected; no cloud call", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, {
      onDeviceAvailable: true,
      onDeviceSemantics: {
        f_03: { fieldAlias: "f_03", semanticRole: "date", valueKind: "date", dateFormat: "DD/MM/YYYY", relationHint: "none", confidence: "medium", reviewRequired: true, rationale: "German field name; simulated." },
        f_06: { fieldAlias: "f_06", semanticRole: "organization", valueKind: "string", dateFormat: "none", relationHint: "none", confidence: "high", reviewRequired: false, rationale: "simulated" },
        f_02: { fieldAlias: "f_02", semanticRole: "date", valueKind: "date", dateFormat: "none", relationHint: "none", confidence: "high", reviewRequired: false, rationale: "simulated contradiction" },
      },
    });
    await page.getByTestId("scenario-picker").locator("summary").click();
    await page.getByTestId("load-scenario-crm-eu-accounts").click();
    await page.getByTestId("continue-to-twin").click();
    await expect(page.getByTestId("descriptor-f_03")).toContainText("MM/DD/YYYY");
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.getByTestId("private-semantics-row-f_03")).toHaveAttribute("data-status", "applicable");
    await expect(page.getByTestId("private-semantics-row-f_02")).toHaveAttribute("data-status", "rejected");
    await expect(page.getByTestId("apply-semantics-f_02")).toHaveCount(0);
    await expect(page.getByTestId("private-semantics-row-f_03")).toContainText("Simulated test adapter");
    // Nothing changes until the user applies it.
    await expect(page.getByTestId("descriptor-f_03")).toContainText("MM/DD/YYYY");
    await page.getByTestId("apply-semantics-f_03").click();
    await expect(page.getByTestId("descriptor-f_03")).toContainText("DD/MM/YYYY");
    await page.getByTestId("apply-semantics-f_06").click();
    await expect(page.getByTestId("descriptor-f_06")).toContainText("Organization");
    // The disclosure carries the reviewed descriptor, never names, samples or the rationale.
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("review-advanced-toggle").click();
    const prompt = await page.getByTestId("review-prompt").innerText();
    expect(prompt).toContain("DD/MM/YYYY");
    for (const value of ["angelegt_am", "German field name", "Lindenhof Studio", "03/02/2026"]) expect(prompt).not.toContain(value);
    expect(await cloudCalls(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-075 responsive blind revision", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ]) {
    test(`no horizontal overflow through the revision journey at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await boot(page, { cloudOutput: CRM_INITIAL });
      await toInitialReality(page);
      await page.getByTestId("prepare-safe-revision").click();
      await page.getByTestId("revision-exact-toggle").click();
      await page.getByTestId("revision-reviewed").check();
      await page.getByTestId("approve-request-revision").click();
      await page.getByTestId("run-revised-reality-check").click();
      await page.getByTestId("run-holdout").click();
      await expect(page.getByTestId("holdout-comparison")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(shots, `e2e-075-revision-${viewport.width}.png`), fullPage: true });
    });
  }
});

test.describe("E2E-076 keyboard and strict default policy", () => {
  test("own data uses the strict policy; the revision controls are keyboard-operable", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await page.getByTestId("start-demo").click();
    await page.getByTestId("continue-to-twin").click();
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("approve-disclosure").click();
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("policy-id")).toHaveText("strict@1.0.0");
    await page.getByTestId("prepare-safe-revision").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("revision-phase")).toHaveAttribute("data-phase", "REVISION_REVIEW_REQUIRED");
    await page.getByTestId("revision-reviewed").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("approve-request-revision")).toBeEnabled();
    await expect(page.getByTestId("holdout")).toHaveCount(0);
  });
});
