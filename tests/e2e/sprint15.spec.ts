import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import evidence from "../../docs/evidence/sprint-14/guided-diagnosis.json" with { type: "json" };
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 15 — end-to-end product experience (E2E-150…160).
 *
 * The cloud adapter is the labeled deterministic TEST adapter (no network).
 * These tests prove the target-first questions, the on-device build through
 * the canonical engine, actionable meaning, the outcome-first result and the
 * gates — not model quality.
 */
const shots = "test-results/sprint-15-screenshots";
const WIDE = "tests/fixtures/sprint-15/wide-crm.records.json";
const realHelpdeskAnswer = JSON.parse(evidence.find((item) => item.destination === "helpdesk")!.answer!) as Record<string, unknown>;
const geminiLike = {
  operations: [
    { op: "copy", from: "f_05", to: "id" },
    { op: "normalize_email", from: "f_01", to: "email" },
    { op: "map_enum", from: "f_03", to: "status", params: { map: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" }, unmapped: "fail" } },
    { op: "parse_date", from: "f_06", to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
    { op: "trim", from: "f_02", to: "organization" },
  ],
  rationale: "Fixed E2E proposal served by the simulated test adapter.",
};

async function boot(page: Page, harness: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/");
}

const cloudCalls = (page: Page) => page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);

async function demoToHelpdesk(page: Page, demo: "json" | "csv" | "xlsx" = "json"): Promise<void> {
  await page.getByTestId(`demo-${demo}`).click();
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-helpdesk").check();
}

/** The demo's reserved test cases include records no mapping can fix (an email that is a number): the result is a Draft. */
async function confirmDraftIfAsked(page: Page): Promise<void> {
  const confirm = page.getByTestId("export-draft-confirm");
  if (await confirm.isVisible()) await confirm.check();
}

async function translateCrm(page: Page, prospect: string = "prospect"): Promise<void> {
  await page.getByTestId("translate-open-status").click();
  await page.getByTestId("translate-status-active_customer").selectOption("active");
  await page.getByTestId("translate-status-inactive_customer").selectOption("inactive");
  await page.getByTestId("translate-status-prospect").selectOption(prospect);
}

test.describe("E2E-150 Helpdesk, first run, on this device only", () => {
  test("one relevant question, a local translation, a verified local build — and nothing sent", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { cloudOutput: geminiLike });
    await demoToHelpdesk(page);
    const question = page.getByTestId("question-status");
    await expect(question).toBeVisible();
    await expect(page.getByTestId("question-only-status")).toContainText("account_state");
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "false");
    await page.screenshot({ path: path.join(shots, "01-helpdesk-question.png"), fullPage: true });

    // No guessing: identical-looking names are not translated automatically.
    await page.getByTestId("translate-open-status").click();
    await expect(page.getByTestId("translation-status")).toHaveAttribute("data-complete", "false");
    await expect(page.getByTestId("translate-status-prospect")).toHaveValue("");
    await page.getByTestId("translate-identical-status").click();
    await expect(page.getByTestId("translate-status-prospect")).toHaveValue("prospect");
    await page.getByTestId("translate-status-active_customer").selectOption("active");
    await page.getByTestId("translate-status-inactive_customer").selectOption("inactive");
    await expect(page.getByTestId("translation-status")).toHaveAttribute("data-complete", "true");
    await expect(page.getByTestId("question-ready-status")).toContainText("Nothing about these values is sent");
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "true");
    await page.screenshot({ path: path.join(shots, "02-helpdesk-translated.png"), fullPage: true });

    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByTestId("guided-origin")).toHaveAttribute("data-origin", "local");
    await expect(page.getByTestId("guided-origin")).toContainText("no AI");
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("3");
    await expect(page.getByTestId("meaning-status")).toHaveAttribute("data-tone", "pass");
    await expect(page.getByTestId("meaning-id")).toHaveAttribute("data-tone", "info");
    await expect(page.getByTestId("guided-next")).toBeVisible();
    // The draft is explained as coming from the built-in test cases, not from the user's records.
    await expect(page.getByTestId("guided-reason-test-cases")).toContainText("All of your 3 records were transformed");
    await expect(page.getByTestId("guided-before-after")).toContainText("active_customer");
    await expect(page.getByTestId("guided-approve")).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, "03-local-result.png"), fullPage: true });

    // Transformed data downloads straight away.
    const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-transformed-json").click()]);
    const records = JSON.parse(readFileSync(await json.path(), "utf8")) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ id: "CUST-001", status: "active" });

    // The reusable integration needs the category names inside it: off by default, explicit opt-in.
    await expect(page.getByTestId("package-labels-include")).not.toBeChecked();
    await page.getByTestId("package-labels-include").check();
    await confirmDraftIfAsked(page);
    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-integration").click()]);
    expect(zip.suggestedFilename()).toMatch(/\.zip$/);
    const [bindings] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-bindings-file").click()]);
    expect(bindings.suggestedFilename()).toBe("bindings.local.json");
    const bound = JSON.parse(readFileSync(await bindings.path(), "utf8")) as { aliases: Record<string, string> };
    expect(Object.values(bound.aliases)).toContain("account_state");

    expect(await cloudCalls(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });

  test("without the label opt-in the package is blocked by the privacy scan, with a reason", async ({ page }) => {
    await boot(page);
    await demoToHelpdesk(page);
    await translateCrm(page);
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await confirmDraftIfAsked(page);
    await page.getByTestId("export-integration").click();
    await expect(page.getByTestId("guided-downloads")).toContainText(/privacy|private/i);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-151 a source with 13 category fields", () => {
  test("the Helpdesk question offers three candidates, not thirteen disclosure checkboxes; nothing is shared by default", async ({ page }) => {
    await boot(page);
    await page.getByTestId("source-file-input").setInputFiles(WIDE);
    await expect(page.getByTestId("source-record-count")).toHaveText("8");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-helpdesk").check();
    const question = page.getByTestId("question-status");
    await expect(question.locator('input[type="radio"]')).toHaveCount(3);
    await expect(page.getByTestId("match-status-account_state")).toBeVisible();
    await expect(page.getByTestId("match-other-status")).toBeVisible();
    // No disclosure checkbox before the user chose the field.
    await expect(page.locator('[data-testid^="share-categories-"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, "04-wide-question.png"), fullPage: true });

    await page.getByTestId("match-status-account_state").check();
    // Exactly one disclosure choice: the field the user picked. Off by default.
    await expect(page.locator('[data-testid^="share-categories-"]')).toHaveCount(1);
    await expect(page.getByTestId("share-categories-account_state")).not.toBeChecked();
    await page.getByTestId("translate-open-status").click();
    await page.getByTestId("translate-status-activo").selectOption("active");
    await page.getByTestId("translate-status-inactivo").selectOption("inactive");
    await page.getByTestId("translate-status-pendiente").selectOption("prospect");

    // The dates are ambiguous: the field table asks, once.
    await page.getByTestId("field-matches-disclosure").locator("summary").click();
    await expect(page.getByTestId("field-match-row-createdAt")).toHaveAttribute("data-need", "date-order");
    await page.screenshot({ path: path.join(shots, "05-wide-field-matches.png"), fullPage: true });
    await page.getByTestId("date-order-created_on-dmy").click();
    await expect(page.getByTestId("field-match-row-createdAt")).toHaveAttribute("data-need", "none");
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("8");
    await expect(page.getByTestId("meaning-status")).toHaveAttribute("data-tone", "pass");
    await expect(page.getByTestId("meaning-createdAt")).toHaveAttribute("data-tone", "pass");
    await page.screenshot({ path: path.join(shots, "06-wide-result.png"), fullPage: true });
    expect(await cloudCalls(page)).toBe(0);
  });

  test("correcting a field match rebuilds the local result from the new choice", async ({ page }) => {
    await boot(page);
    await page.getByTestId("source-file-input").setInputFiles(WIDE);
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-marketing").check();
    await page.getByTestId("match-lifecycleStage-lifecycle_stage").check();
    await page.getByTestId("translate-open-lifecycleStage").click();
    await page.getByTestId("translate-lifecycleStage-cliente").selectOption("customer");
    await page.getByTestId("translate-lifecycleStage-antiguo").selectOption("former-customer");
    await page.getByTestId("translate-lifecycleStage-contacto").selectOption("lead");
    await page.getByTestId("field-matches-disclosure").locator("summary").click();
    await page.getByTestId("field-match-organization").selectOption("company");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-before-after")).toContainText("Ficticia 1");
    // Correct the field from Result: the result is rebuilt locally, nothing sent.
    await page.getByTestId("step-destination").click();
    await page.getByTestId("field-matches-disclosure").locator("summary").click();
    await page.getByTestId("field-match-organization").selectOption("region");
    await page.getByTestId("step-result").click();
    await expect(page.getByTestId("guided-before-after")).not.toContainText("Ficticia 1");
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-152 Gemini path: meaning becomes actionable", () => {
  test("an unverified translation is explained, the user's answer is checked by the verifier, and a contradiction is shown", async ({ page }) => {
    await boot(page, { cloudOutput: geminiLike });
    await demoToHelpdesk(page);
    await page.getByTestId("share-categories-account_state").check();
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByTestId("guided-origin")).toContainText("Simulated test adapter — not Gemini");
    const status = page.getByTestId("meaning-status");
    await expect(status).toHaveAttribute("data-tone", "open");
    await expect(status).toContainText("doesn't know what the values of account_state mean");
    await page.screenshot({ path: path.join(shots, "07-gemini-meaning-open.png"), fullPage: true });

    // A different answer than the mapping's translation → a contradiction, never a pass.
    await page.getByTestId("meaning-answer-status").click();
    await page.getByTestId("translate-status-active_customer").selectOption("active");
    await page.getByTestId("translate-status-inactive_customer").selectOption("prospect");
    await page.getByTestId("translate-status-prospect").selectOption("inactive");
    await expect(status).toHaveAttribute("data-tone", "fail");
    await expect(page.getByTestId("check-meaning")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("guided-local-from-mismatch")).toBeVisible();
    await page.screenshot({ path: path.join(shots, "08-gemini-meaning-mismatch.png"), fullPage: true });

    // The matching answer → verified by the canonical verifier; the change is explained.
    await page.getByTestId("translate-status-inactive_customer").selectOption("inactive");
    await page.getByTestId("translate-status-prospect").selectOption("prospect");
    await expect(status).toHaveAttribute("data-tone", "pass");
    await expect(page.getByTestId("guided-meaning-change")).toContainText("Checked again");
    // One confirmed field never verifies the others.
    await expect(page.getByTestId("meaning-organization")).toHaveAttribute("data-tone", "info");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-153 declining and refusals offer the on-device path honestly", () => {
  test("declining sends nothing; the local build is offered when the answers allow it", async ({ page }) => {
    await boot(page, { cloudOutput: geminiLike });
    await demoToHelpdesk(page);
    await page.getByTestId("share-categories-account_state").check();
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-reject").click();
    await expect(page.getByTestId("guided-local-alternative")).toHaveAttribute("data-ready", "false");
    await page.getByTestId("guided-local-questions").click();
    await translateCrm(page);
    await page.getByTestId("step-result").click();
    await expect(page.getByTestId("guided-local-alternative")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("guided-local-fallback").click();
    await expect(page.getByTestId("guided-origin")).toHaveAttribute("data-origin", "local");
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("3");
    expect(await cloudCalls(page)).toBe(0);
  });

  test("a refused Gemini answer offers the local build next to the existing recovery", async ({ page }) => {
    await boot(page, { cloudOutput: realHelpdeskAnswer });
    await demoToHelpdesk(page);
    await translateCrm(page);
    // Gemini is not the obvious action now: the local answers are complete.
    await expect(page.getByTestId("guided-build")).toContainText("Build with Gemini");
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("guided-category-notice")).toHaveAttribute("data-context", "before");
    await expect(page.getByTestId("guided-local-alternative")).toHaveAttribute("data-context", "before");
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-diagnosis")).toHaveAttribute("data-kind", "withheld-categories");
    await expect(page.getByTestId("guided-local-alternative")).toHaveAttribute("data-context", "rejected");
    await page.screenshot({ path: path.join(shots, "09-rejected-with-local.png"), fullPage: true });
    await page.getByTestId("guided-local-fallback").click();
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("3");
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-154 the same answers work for CSV and Excel", () => {
  for (const demo of ["csv", "xlsx"] as const) {
    test(`${demo.toUpperCase()}: equivalent normalization, equivalent local result`, async ({ page }) => {
      await boot(page);
      await demoToHelpdesk(page, demo);
      await translateCrm(page);
      await page.getByTestId("guided-build-local").click();
      await expect(page.getByTestId("guided-count-transformed")).toHaveText("3");
      await expect(page.getByTestId("meaning-status")).toHaveAttribute("data-tone", "pass");
      expect(await cloudCalls(page)).toBe(0);
    });
  }
});

test.describe("E2E-155 set aside, mobile and keyboard", () => {
  test("a value set aside is held for review, never counted as transformed", async ({ page }) => {
    await boot(page);
    await demoToHelpdesk(page);
    await translateCrm(page, "Set aside for review");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("2");
    await expect(page.getByTestId("guided-count-quarantined")).toHaveText("1");
    await expect(page.getByTestId("before-after-3")).toHaveAttribute("data-transformed", "false");
  });

  test("mobile 390 px: questions and result have no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.getByTestId("source-file-input").setInputFiles(WIDE);
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-helpdesk").check();
    await page.getByTestId("match-status-account_state").check();
    await page.getByTestId("translate-open-status").click();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("translate-status-activo").selectOption("active");
    await page.getByTestId("translate-status-inactivo").selectOption("inactive");
    await page.getByTestId("translate-status-pendiente").selectOption("prospect");
    await page.getByTestId("field-matches-disclosure").locator("summary").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("date-order-created_on-dmy").click();
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, "10-mobile-result.png"), fullPage: true });
  });

  test("keyboard: the question, the translation and the local build are reachable and operable", async ({ page }) => {
    await boot(page);
    await demoToHelpdesk(page);
    await page.getByTestId("translate-open-status").focus();
    await page.keyboard.press("Enter");
    const select = page.getByTestId("translate-status-active_customer");
    await select.focus();
    await expect(select).toBeFocused();
    await select.selectOption("active");
    await page.getByTestId("translate-status-inactive_customer").selectOption("inactive");
    await page.getByTestId("translate-status-prospect").selectOption("prospect");
    await page.getByTestId("guided-build-local").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meaning, field by field" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your data → destination" })).toBeVisible();
  });
});
