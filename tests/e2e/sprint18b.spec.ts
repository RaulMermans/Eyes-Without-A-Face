import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 18B (ADR 0018) — the AI-first guided journey: Connect → Destination →
 * Generate → Verify → Deliver. The planner is the labelled simulated test
 * adapter (never Gemini, no network). Data: the dev split of the 18B
 * evaluation set only (never the holdout).
 */
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/eval-18b/dev/crm-contacts-to-helpdesk-requester.json", "utf8")) as {
  records: Array<Record<string, unknown>>;
  destination: Record<string, unknown>;
};
const RECORDS = Buffer.from(JSON.stringify(FIXTURE.records));
const DESTINATION = JSON.stringify({ title: "Helpdesk requester", ...FIXTURE.destination }, null, 2);

/**
 * A plan as a capable planner would answer this disclosure: field matches for every field it can
 * read, and `needs_clarification` for the lifecycle stage whose category names were withheld.
 * Aliases are the twin's for this fixture at the default seed.
 */
const ready = (target: string, from: string[], transform: string, extra: Record<string, unknown> = {}) => ({
  target, status: "ready", from, transform, confidence: "high", evidence: ["meaning"], missing: [], ...extra,
});
const GOOD_PLAN = {
  fields: [
    ready("external_id", ["f_02"], "copy"),
    ready("name", ["f_19", "f_08"], "concat", { separator: " " }),
    ready("email", ["f_17"], "normalize_email"),
    ready("phone", ["f_20"], "copy"),
    ready("organization", ["f_14"], "trim"),
    ready("created_at", ["f_13"], "parse_date", { inputFormat: "MM/DD/YYYY" }),
    { target: "requester_type", status: "needs_clarification", from: ["f_10"], transform: "map_enum", confidence: "high", evidence: ["meaning"], missing: ["category-labels"] },
    { target: "locale", status: "needs_clarification", from: ["f_11"], transform: "map_enum", confidence: "medium", evidence: ["meaning"], missing: ["category-labels"] },
    ready("address.city", ["f_04"], "copy"),
    ready("address.country", ["f_01"], "copy"),
    { target: "time_zone", status: "no_source", from: [], transform: "none", confidence: "high", evidence: [], missing: ["no-matching-source"] },
  ],
  summary: "Fixed E2E plan served by the simulated test adapter.",
};
const NOTHING_PLAN = {
  fields: (FIXTURE.destination.required as string[]).map((target) => ({ target, status: "no_source", from: [], transform: "none", confidence: "low", evidence: [], missing: ["no-matching-source"] })),
  summary: "Fixed E2E plan: nothing matched.",
};
const LIFECYCLE: Record<string, string> = {
  Subscriber: "prospect",
  Lead: "prospect",
  "Marketing Qualified Lead": "prospect",
  "Sales Qualified Lead": "prospect",
  Customer: "customer",
  Evangelist: "customer",
  "Former Customer": "former_customer",
  "TEST RECORD": "__set_aside__",
};

async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", ...value } as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, harness);
  await page.goto("/");
  await page.getByTestId("source-file-input").setInputFiles({ name: "crm-contacts.json", mimeType: "application/json", buffer: RECORDS });
  await expect(page.getByTestId("source-record-count")).toHaveText(String(FIXTURE.records.length));
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-custom").check();
  await page.getByTestId("destination-text").fill(DESTINATION);
  await page.getByTestId("destination-apply").click();
  await expect(page.getByTestId("destination-summary")).toBeVisible();
}
const cloudCalls = (page: Page) => page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);

async function generate(page: Page): Promise<void> {
  await page.getByTestId("guided-build").click();
  await expect(page.getByTestId("approval-card")).toBeVisible();
  await expect(page.locator("#generate-heading")).toBeVisible();
}

test.describe("E2E-180 DoD: Gemini matches the fields, the user answers only what it can't know", () => {
  test("generate → approve → verify with zero manual field choices → translate → checked locally → deliver", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { planOutput: GOOD_PLAN });
    // The manual mapping is an advanced, collapsed route.
    await expect(page.getByTestId("advanced-manual")).not.toHaveAttribute("open", "");
    await generate(page);
    expect(await cloudCalls(page)).toBe(0);
    await page.getByTestId("guided-approve").click();
    await expect(page.locator("#verify-heading")).toBeVisible();
    expect(await cloudCalls(page)).toBe(1);
    // The planner's matches are shown, labelled honestly (simulated, never Gemini).
    await expect(page.getByTestId("plan-field-external_id")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("plan-field-external_id")).toContainText("c_ContactId");
    await expect(page.getByTestId("plan-field-external_id")).toContainText("Simulated planner (not Gemini)");
    await expect(page.getByTestId("plan-field-email")).toHaveAttribute("data-by", "gemini");
    await expect(page.getByTestId("plan-field-requester_type")).toHaveAttribute("data-status", "needs_clarification");
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "answers-needed");
    await expect(page.getByTestId("guided-outcome")).toHaveCount(0);
    // Answer only the category translation (and the date order if asked).
    const date = page.getByTestId("clarify-confirm-date-order-created_at");
    if ((await date.count()) > 0) await date.getByText("Month/day/year").click();
    for (const [label, value] of Object.entries(LIFECYCLE)) await page.getByTestId(`translate-requester_type-${label}`).selectOption(value);
    // Local verification ran automatically.
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByTestId("plan-field-requester_type")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("plan-field-external_id")).toHaveAttribute("data-by", "gemini");
    const transformed = Number(await page.getByTestId("guided-count-transformed").innerText());
    expect(transformed).toBeGreaterThan(0);
    // No field-mapping control was required.
    await expect(page.getByTestId("advanced-manual")).toHaveCount(0);
    await expect(page.locator('[data-testid^="clarify-pick-"]')).toHaveCount(0);
    // A plan completed with the user's own answers is never offered for revision.
    await expect(page.getByTestId("guided-revision")).toHaveCount(0);

    await page.getByTestId("verify-continue").click();
    await expect(page.locator("#deliver-heading")).toBeVisible();
    const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-transformed-json").click()]);
    expect((JSON.parse(readFileSync(await json.path(), "utf8")) as unknown[]).length).toBe(transformed);
    const confirm = page.getByTestId("export-draft-confirm");
    if (await confirm.isVisible()) await confirm.check();
    const labels = page.getByTestId("package-labels-include");
    if ((await labels.count()) > 0) await labels.check();
    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-integration").click()]);
    expect(zip.suggestedFilename()).toMatch(/^eyes-integration-.*\.zip$/);
    expect(await cloudCalls(page)).toBe(1);
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-181 a plan with no executable field is never an integration", () => {
  test("questions are shown; no integration headline, no result, no deliver step", async ({ page }) => {
    await boot(page, { planOutput: NOTHING_PLAN });
    await generate(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("plan-not-integration")).toBeVisible();
    await expect(page.getByTestId("clarify-missing-required-source-external_id")).toBeVisible();
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "answers-needed");
    await expect(page.getByTestId("guided-status-label")).not.toContainText("ntegration");
    await expect(page.getByTestId("guided-outcome")).toHaveCount(0);
    await expect(page.getByTestId("step-deliver")).toBeDisabled();
  });
});

test.describe("E2E-182 provider error: recovery keeps the source and destination, needs a new approval, within budget", () => {
  test("a failed request offers one new request; the budget then stops further requests", async ({ page }) => {
    await boot(page, { planOutput: GOOD_PLAN, cloudErrorCode: "PROVIDER_OVERLOADED" });
    await generate(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toHaveAttribute("data-code", "PROVIDER_OVERLOADED");
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("guided-fresh-request").click();
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    await expect(page.getByTestId("approval-kept")).toContainText(`Your ${FIXTURE.records.length} records`);
    await expect(page.getByTestId("approval-sent")).toContainText("The 11 destination field names");
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toBeVisible();
    expect(await cloudCalls(page)).toBe(2);
    await expect(page.getByTestId("guided-fresh-request")).toHaveCount(0);
    await expect(page.getByTestId("guided-request-limit")).toBeVisible();
    await page.getByTestId("guided-limit-map").click();
    await expect(page.getByTestId("advanced-manual")).toHaveAttribute("open", "");
  });
});

test.describe("E2E-183 withheld category names do not block sending (ADR 0018 §8; replaces the 17A rule)", () => {
  test("required fixed-list field, names not shared: Approve and send is enabled", async ({ page }) => {
    await boot(page, {});
    await generate(page);
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    await expect(page.getByTestId("approval-blocked")).toHaveCount(0);
    await page.getByTestId("approval-exact").locator("summary").click();
    for (const label of ["Marketing Qualified Lead", "Former Customer"]) await expect(page.getByTestId("approval-prompt")).not.toContainText(label);
  });
});

test.describe("E2E-184 the revision offer follows planRevisionAllowed", () => {
  test("a plan built only by the planner can be revised; the offer disappears once the user's answer completes a field", async ({ page }) => {
    // Without requester_type in the plan's ready set, the plan with only planner operations runs; then the user's answer adds a user-declared op.
    const plan = { ...GOOD_PLAN, fields: GOOD_PLAN.fields.map((field) => (field.target === "requester_type" ? ready("requester_type", ["f_10"], "copy") : field)) };
    await boot(page, { planOutput: plan });
    await generate(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByTestId("guided-revision")).toBeVisible();
    // Choose the locale translation (optional question): now an operation is user-declared.
    const open = page.getByTestId("clarify-translate-categories-locale");
    await expect(open).toBeVisible();
    for (const [label, value] of Object.entries({ English: "en", Deutsch: "de", "Français": "fr", Nederlands: "nl", "Español": "es", "--None--": "__set_aside__" })) {
      await page.getByTestId(`translate-locale-${label}`).selectOption(value);
    }
    await expect(page.getByTestId("plan-field-locale")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("guided-revision")).toHaveCount(0);
  });
});
