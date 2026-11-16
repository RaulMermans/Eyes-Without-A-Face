import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 16B — mapping integrity through the real UI (E2E-160…163). Fictional
 * fixtures shaped like the Sprint 16A production cases R02, X17, X12 and F1.
 * Everything here is built on this device: zero model requests.
 */
const FIX = "tests/fixtures/sprint-16b";

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness" } as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  });
  await page.goto("/");
}
const cloudCalls = (page: Page) => page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);

async function load(page: Page, file: string): Promise<void> {
  await page.getByTestId("source-file-input").setInputFiles(path.join(FIX, file));
  await expect(page.getByTestId("source-summary")).toBeVisible();
}

async function customDestination(page: Page, schema: object): Promise<void> {
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-custom").click();
  await page.getByTestId("destination-text").fill(JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, ...schema }, null, 2));
  await page.getByTestId("destination-apply").click();
  await expect(page.getByTestId("field-matches-disclosure")).toBeVisible();
  if (!(await page.getByTestId("field-matches").isVisible())) await page.getByTestId("field-matches-disclosure").locator("summary").click();
}

async function downloadJson(page: Page, testId: string): Promise<unknown> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  return JSON.parse(readFileSync(await download.path(), "utf8")) as unknown;
}

async function downloadZip(page: Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-integration").click()]);
  const dir = mkdtempSync(path.join(tmpdir(), "s16b-zip-"));
  execFileSync("unzip", ["-q", await download.path(), "-d", dir]);
  return path.join(dir, readdirSync(dir)[0]!);
}

const LINES = {
  title: "Line status destination",
  required: ["lineId", "lineName"],
  properties: { lineId: { type: "string", minLength: 1 }, lineName: { type: "string", minLength: 1 }, statusText: { type: "string", minLength: 1 } },
};

test.describe("E2E-160 D1 (S16A R02): an optional field the user leaves out stays out", () => {
  test("“No field” is honoured in the build, the transformed data and the reusable mapping; nothing is sent", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await load(page, "lines.json");
    await customDestination(page, LINES);
    // Nothing is built from a suggestion.
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "false");
    await page.getByTestId("field-match-lineId").selectOption("id");
    await page.getByTestId("field-match-lineName").selectOption("name");
    // The user explicitly leaves statusText out; no suggestion comes back.
    await page.getByTestId("field-match-statusText").selectOption({ label: "No field — leave it out" });
    await expect(page.getByTestId("field-match-suggestion-statusText")).toHaveCount(0);
    await expect(page.getByTestId("field-match-row-statusText")).toContainText("left out by you");
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("6");
    const records = (await downloadJson(page, "download-transformed-json")) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(6);
    for (const record of records) expect(Object.keys(record).sort()).toEqual(["lineId", "lineName"]);
    const root = await downloadZip(page);
    const mapping = JSON.parse(readFileSync(path.join(root, "mapping/mapping.alias.json"), "utf8")) as { operations: Array<{ to: string }> };
    expect(mapping.operations.map((operation) => operation.to)).toEqual(["lineId", "lineName"]);
    // A replan (a destination round-trip) keeps the decision.
    await page.getByTestId("step-destination").click();
    if (!(await page.getByTestId("field-matches").isVisible())) await page.getByTestId("field-matches-disclosure").locator("summary").click();
    await expect(page.getByTestId("field-match-row-statusText")).toContainText("left out by you");
    expect(await cloudCalls(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-161 D1/D2 (S16A X17): an unusable id column is explained, and nothing is used in its place", () => {
  test("the mixed-type id column is listed with its reason; the email is not pre-selected as the id; the build stays blocked", async ({ page }) => {
    await boot(page);
    await load(page, "mixed-ids.json");
    const excluded = page.getByTestId("source-excluded-fields");
    await expect(excluded).toBeVisible();
    await expect(excluded).toContainText("customer_id");
    await expect(page.getByTestId("excluded-field-0")).toHaveAttribute("data-reason", "mixed");
    await customDestination(page, {
      title: "Helpdesk",
      required: ["customerId", "primaryEmail"],
      properties: { customerId: { type: "string", minLength: 1 }, primaryEmail: { type: "string", format: "email" } },
    });
    await expect(page.getByTestId("destination-excluded-note")).toBeVisible();
    await expect(page.getByTestId("field-match-customerId")).toHaveValue("");
    await expect(page.getByTestId("field-match-suggestion-customerId")).toHaveCount(0);
    await expect(page.getByTestId("field-match-row-customerId")).toHaveAttribute("data-need", "source");
    await page.getByTestId("field-match-use-primaryEmail").click();
    // Choosing "No field" for a required destination field keeps the build blocked, with a reason.
    await page.getByTestId("field-match-customerId").selectOption({ label: "No field (required: blocks the build)" });
    await expect(page.getByTestId("field-match-row-customerId")).toContainText("required — choose a field");
    await expect(page.getByTestId("guided-build-local")).toHaveAttribute("data-ready", "false");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-build-local-blocker")).toContainText("customerId");
    await expect(page.getByTestId("guided-outcome")).toHaveCount(0);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-162 D4 (S16A X12): spaced and punctuated column names never disappear silently", () => {
  test("every unusable column is listed with the naming rule and a rename example, before any mapping", async ({ page }) => {
    await boot(page);
    await load(page, "spaced-headers.csv");
    const excluded = page.getByTestId("source-excluded-fields");
    await expect(excluded).toHaveAttribute("data-count", "4");
    for (const name of ["Customer ID", "Contact Email", "Account Status", "Opened On"]) await expect(excluded).toContainText(name);
    await expect(excluded).toContainText("letters, digits and _");
    await expect(excluded).toContainText("customer_id");
    await expect(page.getByTestId("excluded-field-0")).toHaveAttribute("data-reason", "name");
    await customDestination(page, {
      title: "Helpdesk",
      required: ["customerId", "primaryEmail"],
      properties: { customerId: { type: "string", minLength: 1 }, primaryEmail: { type: "string", format: "email" } },
    });
    await expect(page.getByTestId("destination-excluded-note")).toContainText("4 of your fields");
    // An incompatible field is never offered as the suggestion.
    await expect(page.getByTestId("field-match-suggestion-primaryEmail")).toHaveCount(0);
    await expect(page.getByTestId("field-match-suggestion-customerId")).toHaveCount(0);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-163 D3 (S16A F1): ordinary words in an unmapped column no longer block the reusable integration", () => {
  test("the ZIP downloads, verifies with the reviewed runner and holds none of the unmapped values", async ({ page }) => {
    await boot(page);
    await load(page, "ordinary-words.json");
    await customDestination(page, {
      title: "Ticket",
      required: ["ticketId", "requesterEmail", "openedOn"],
      properties: { ticketId: { type: "string", minLength: 1 }, requesterEmail: { type: "string", format: "email" }, openedOn: { type: "string", format: "date" } },
    });
    await page.getByTestId("field-match-ticketId").selectOption("ticket_ref");
    await page.getByTestId("field-match-requesterEmail").selectOption("requester");
    await page.getByTestId("field-match-openedOn").selectOption("opened_on");
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("7");
    await expect(page.getByTestId("guided-count-attention")).toHaveText("1");
    const confirm = page.getByTestId("export-draft-confirm");
    if (await confirm.isVisible()) await confirm.check();
    const root = await downloadZip(page);
    // Exit code 0 = every file matches its manifest hash, the contract is valid and the fixture replay reproduces.
    const verify = spawnSync(process.execPath, ["run.mjs", "verify"], { cwd: root, encoding: "utf8" });
    expect(verify.status).toBe(0);
    const files = execFileSync("find", [root, "-type", "f", "-not", "-path", "*/runtime/*"], { encoding: "utf8" }).trim().split("\n");
    const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const name of ["reminder_status", "review_state", "not-an-email"]) expect(text).not.toContain(name);
    expect(await cloudCalls(page)).toBe(0);
  });
});
