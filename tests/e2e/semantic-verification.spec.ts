import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 8 semantic verification and semantic blind revision (Workstream F).
 * The cloud adapter is the labeled deterministic TEST adapter (no network).
 * The initial support mapping below has the same shape as Sprint 7's real
 * Gemini output (a reversed priority scale), but here it is served by the
 * simulated adapter and labeled as such. These tests prove detection, gates,
 * disclosure review and evaluator wiring, not model quality.
 */
const shots = "test-results/sprint-8-screenshots";

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

const CRM_MMDD = {
  operations: [
    { op: "copy", from: "f_01", to: "id" },
    { op: "normalize_email", from: "f_02", to: "email" },
    { op: "map_enum", from: "f_05", to: "status", params: { map: { aktiv: "active", inaktiv: "inactive", interessent: "prospect" }, unmapped: "default", default: "other" } },
    { op: "parse_date", from: "f_03", to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
    { op: "copy", from: "f_06", to: "organization" },
  ],
  rationale: "Fixed E2E proposal served by the simulated test adapter.",
};

/**
 * Private strings of the support scenario that must never reach a request.
 * (Source names that are substrings of approved destination names, such as
 * "requester" in "requesterEmail", cannot be tested by substring.)
 */
const SUPPORT_PRIVATE = ["ticket_ref", "\"requester\"", "\"prio\"", "\"opened\"", "TCK-2078", "TCK-2077", "li.wei@example.com", "\"p0\"", "Dana.Okafor", "nina.berg@example.com", "PRIVATE_CANARY_PII_DO_NOT_SHARE", "TCK-2201", "pia.lang@example.com"];

async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/#technical");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

async function toReality(page: Page, scenario: string, includeReserved = true): Promise<void> {
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
  if (!includeReserved) await page.getByTestId("include-reserved").uncheck();
  await page.getByTestId("run-mapping").click();
  await expect(page.getByTestId("reality-verdict")).toBeVisible();
}

test.describe("E2E-080 hero: silent error → safe semantic feedback → one blind revision → holdout", () => {
  test("detects the reversed scale, discloses an approved constraint, and measures the result", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await boot(page, { cloudOutput: SUPPORT_REVERSED });
    await toReality(page, "support-tickets");

    // 1. Structurally valid mapping, wrong meaning.
    await expect(page.getByTestId("layer-contract")).toHaveAttribute("data-status", "pass");
    await expect(page.getByTestId("layer-semantic")).toHaveAttribute("data-status", "SEMANTIC_MISMATCH");
    await expect(page.getByTestId("verdict-semantic")).toHaveAttribute("data-status", "SEMANTIC_MISMATCH");
    await expect(page.getByTestId("semantic-silent-error")).toBeVisible();
    const priority = page.getByTestId("semantic-result-priority");
    await expect(priority).toHaveAttribute("data-status", "SEMANTIC_MISMATCH");
    await expect(priority).toHaveAttribute("data-code", "SEMANTIC_ORDER_INVERSION");
    await expect(priority).toContainText("#3");
    await expect(page.getByTestId("semantic-constraint-priority")).toContainText("p1 > p2 > p3 > p4");
    // Unconstrained meaning is unknown, not a pass.
    await expect(page.getByTestId("semantic-structural-only")).toContainText("id");
    await page.screenshot({ path: path.join(shots, "e2e-080-semantic-error.png"), fullPage: true });

    // 2. Nothing is authorized by default; the user opts in to one constraint.
    const authorize = page.getByTestId("authorize-constraint-support-priority-order");
    await expect(authorize).not.toBeChecked();
    await expect(page.getByTestId("authorize-line-support-priority-order")).toContainText("f_01 → priority ranks highest to lowest: p1 > p2 > p3 > p4");
    await authorize.check();
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("revision-phase")).toHaveAttribute("data-phase", "REVISION_REVIEW_REQUIRED");
    expect(await cloudCalls(page)).toBe(1);
    const info = page.getByTestId("revision-new-information");
    await expect(info).toContainText("ordered-category-inversion");
    await expect(info).toContainText("Approved semantic constraint");
    await expect(page.getByTestId("ledger-version")).toHaveText("1.1.0");
    await expect(page.getByTestId("ledger-constraints")).toHaveText("1");
    await expect(page.getByTestId("ledger-new-labels")).toHaveText("0 · 0");

    // 3. The exact request: schema 1.3.0, prompt v3, no private string.
    await page.getByTestId("revision-exact-toggle").click();
    await expect(page.getByTestId("revision-exact")).toContainText("schema 1.3.0");
    const prompt = await page.getByTestId("revision-prompt").innerText();
    expect(prompt).toContain("approvedConstraints");
    expect(prompt).toContain("ordered-category-inversion");
    for (const value of SUPPORT_PRIVATE) expect(prompt, value).not.toContain(value);
    await page.screenshot({ path: path.join(shots, "e2e-080-review.png"), fullPage: true });

    // 4. One approved revision; validated; re-evaluated by the same engine.
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await expect(page.getByTestId("revised-status")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("revised-origin")).toHaveText("Simulated test adapter — not Gemini");
    await expect(page.getByTestId("revised-op-priority")).toHaveAttribute("data-change", "changed");
    expect(await cloudCalls(page)).toBe(2);
    await page.getByTestId("run-revised-reality-check").click();
    await expect(page.getByTestId("revision-comparison-semantic-after")).toHaveText("0");
    await expect(page.getByTestId("revision-decision")).toHaveAttribute("data-verdict", "ACCEPTED");
    // The constraint choice is locked once the request was used.
    await expect(authorize).toBeDisabled();

    // 5. Independent holdout, both versions, with semantic violations counted separately.
    await page.getByTestId("run-holdout").click();
    await expect(page.getByTestId("holdout-comparison")).toBeVisible();
    await expect(page.getByTestId("holdout-comparison-semantic")).toBeVisible();
    const before = Number(await page.getByTestId("holdout-comparison-correctlyHandled-before").innerText());
    const after = Number(await page.getByTestId("holdout-comparison-correctlyHandled-after").innerText());
    expect(after).toBeGreaterThan(before);
    expect(await cloudCalls(page)).toBe(2);
    expect(providerRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: path.join(shots, "e2e-080-holdout.png"), fullPage: true });
  });
});

test.describe("E2E-081 codes only: no constraint disclosed, meaning stays wrong", () => {
  test("without an approved constraint the reviser cannot fix the scale and the decision says so", async ({ page }) => {
    await boot(page, { cloudOutput: SUPPORT_REVERSED });
    await toReality(page, "support-tickets");
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("ledger-constraints")).toHaveText("0");
    await expect(page.getByTestId("ledger-semantic-findings")).not.toHaveText("0");
    await page.getByTestId("revision-exact-toggle").click();
    const prompt = await page.getByTestId("revision-prompt").innerText();
    expect(prompt).toContain('"approvedConstraints":[]');
    expect(prompt).not.toContain("p1 > p2");
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("approve-request-revision").click();
    await page.getByTestId("run-revised-reality-check").click();
    await expect(page.getByTestId("revision-decision")).not.toHaveAttribute("data-verdict", "ACCEPTED");
    expect(Number(await page.getByTestId("revision-comparison-semantic-after").innerText())).toBeGreaterThan(0);
  });
});

test.describe("E2E-082 changing the semantic disclosure invalidates the prepared request", () => {
  test("toggling a constraint after Prepare discards the request and its pending approval", async ({ page }) => {
    await boot(page, { cloudOutput: SUPPORT_REVERSED });
    await toReality(page, "support-tickets");
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("revision-review")).toBeVisible();
    await page.getByTestId("revision-reviewed").check();
    await page.getByTestId("authorize-constraint-support-priority-order").check();
    await expect(page.getByTestId("revision-review")).toHaveCount(0);
    await expect(page.getByTestId("approve-request-revision")).toHaveCount(0);
    await page.getByTestId("prepare-safe-revision").click();
    await expect(page.getByTestId("revision-reviewed")).not.toBeChecked();
    await expect(page.getByTestId("ledger-constraints")).toHaveText("1");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-083 ambiguous evidence requires confirmation", () => {
  test("without the reserved cases the date order is ambiguous; the user's confirmation makes it trusted", async ({ page }) => {
    await boot(page, { cloudOutput: CRM_MMDD });
    await toReality(page, "crm-eu-accounts", false);
    const date = page.getByTestId("semantic-result-createdAt");
    await expect(date).toHaveAttribute("data-status", "SEMANTIC_AMBIGUOUS");
    await expect(page.getByTestId("layer-semantic")).not.toHaveAttribute("data-status", "SEMANTIC_PASS");
    await page.getByTestId("confirm-date-day-first").click();
    await expect(date).toHaveAttribute("data-status", "SEMANTIC_MISMATCH");
    await expect(date).toContainText("Your declaration · trusted");
    // Local detail shows private values on this device only.
    await page.getByTestId("semantic-local-createdAt").locator("summary").click();
    await expect(page.getByTestId("semantic-local-createdAt")).toContainText("trusted reading");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-084 responsive semantic verification", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ]) {
    test(`no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await boot(page, { cloudOutput: SUPPORT_REVERSED });
      await toReality(page, "support-tickets");
      await page.getByTestId("authorize-constraint-support-priority-order").check();
      await page.getByTestId("prepare-safe-revision").click();
      await page.getByTestId("revision-reviewed").check();
      await page.getByTestId("approve-request-revision").click();
      await page.getByTestId("run-revised-reality-check").click();
      await page.getByTestId("run-holdout").click();
      await expect(page.getByTestId("holdout-comparison")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(shots, `e2e-084-semantic-${viewport.width}.png`), fullPage: true });
    });
  }
});
