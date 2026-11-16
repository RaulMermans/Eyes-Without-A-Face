import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 17A — hybrid journey recovery on a Meridian-style source (E2E-170…176). Labeled test
 * adapter only (no network). The derived proposal behaves like Gemini did in production: with the
 * account states unreadable to it, it writes no `status` (and no `email`) operation and reads
 * `createdAt` from the only date, `contract.signed_at`.
 */
const FIXTURE = "tests/fixtures/sprint-17a/meridian-style-120.json";
type Rec = { record_id: string; account_state: string; contact: { email?: string }; contract: { signed_at: string } };
const records = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { records: Rec[] }).records;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const shots = "test-results/sprint-17a-screenshots";

async function boot(page: Page, harness: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = { label: "test-harness", ...value } as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, harness);
  await page.goto("/");
  await page.getByTestId("source-file-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("source-record-count")).toHaveText("120");
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-helpdesk").check();
}
/** Choose account_state for status (several category-like fields compete), then opt in to share its names. */
async function shareStatusNames(page: Page): Promise<void> {
  const radio = page.getByTestId("match-status-account_state");
  if ((await radio.count()) > 0) await radio.check();
  await page.getByTestId("share-categories-account_state").check();
}
const cloudCalls = (page: Page) => page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);

async function answerLocally(page: Page): Promise<void> {
  const radio = page.getByTestId("match-status-account_state");
  if ((await radio.count()) > 0) await radio.check();
  const open = page.getByTestId("translate-open-status");
  if ((await open.count()) > 0 && (await open.isVisible())) await open.click();
  for (const [label, value] of Object.entries({ activo: "active", inactivo: "inactive", pendiente: "prospect", reactivado: "active", suspendido: "__set_aside__" })) {
    await page.getByTestId(`translate-status-${label}`).selectOption(value);
  }
  if (!(await page.getByTestId("field-matches").isVisible())) await page.getByTestId("field-matches-disclosure").locator("summary").click();
  for (const [target, source] of Object.entries({ id: "record_id", email: "contact.email", createdAt: "contract.signed_at", organization: "organization" })) {
    await page.getByTestId(`field-match-${target}`).selectOption(source);
  }
}

test.describe("E2E-170 a request preflight proves unusable is never offered for approval", () => {
  test("required status, category names withheld: Approve is disabled, the prerequisite is named, and both routes work", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, { deriveProposal: true });
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await expect(page.getByTestId("guided-approve")).toBeDisabled();
    await expect(page.getByTestId("guided-status-label")).toHaveText("Not ready to send");
    const blocked = page.getByTestId("approval-blocked");
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("status");
    await expect(blocked).toContainText("account_state");
    // "Don't send" stays available; the local route is offered even when local answers are still missing.
    await expect(page.getByTestId("guided-reject")).toBeEnabled();
    await expect(page.getByTestId("guided-local-alternative")).toBeVisible();
    await page.screenshot({ path: path.join(shots, "01-blocked-request.png"), fullPage: true });
    // No field chosen yet: no bulk "share these names" (it would disclose several fields and still not help).
    await expect(page.getByTestId("guided-share-categories")).toHaveCount(0);
    await expect(page.getByTestId("guided-category-unchosen")).toContainText("status");
    // Route: choose the field, opt in to share only its names → a NEW request that can be approved.
    const firstHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
    await page.getByTestId("guided-choose-category-source").click();
    await shareStatusNames(page);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(await page.getByTestId("approval-card").getAttribute("data-payload-hash")).not.toBe(firstHash);
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    await expect(page.getByTestId("approval-blocked")).toHaveCount(0);
    // Only the chosen field's names are in the request.
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).toContainText("suspendido");
    for (const other of ["retail", "premium", "monthly"]) await expect(page.getByTestId("approval-prompt")).not.toContainText(other);
    expect(await cloudCalls(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });

  test("uncertainty Gemini can resolve does not block: names shared, field matches undecided → Approve enabled", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await shareStatusNames(page);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    await expect(page.getByTestId("approval-blocked")).toHaveCount(0);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-171 explicit refusal to disclose labels", () => {
  test("Don't send sends nothing; the local route remains", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-reject").click();
    await expect(page.getByTestId("guided-local-alternative")).toBeVisible();
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-172 correct local translation: a valid local integration and a portable ZIP, all 120 records accounted for", () => {
  test("counts match an independent reading of the fixture; the ZIP verifies outside the app; nothing sent", async ({ page }) => {
    await boot(page);
    await answerLocally(page);
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    const badEmail = records.filter((r) => typeof r.contact.email !== "string" || !EMAIL.test(r.contact.email.trim()));
    const quarantined = records.filter((r) => !badEmail.includes(r) && r.account_state === "suspendido").length;
    await expect(page.getByTestId("guided-count-attention")).toHaveText(String(badEmail.length));
    await expect(page.getByTestId("guided-count-quarantined")).toHaveText(String(quarantined));
    await expect(page.getByTestId("guided-count-transformed")).toHaveText(String(120 - badEmail.length - quarantined));
    // Never claimed complete: some records are set aside or need attention.
    await expect(page.getByTestId("guided-status-label")).not.toHaveText("Integration ready");
    await page.screenshot({ path: path.join(shots, "02-local-result.png"), fullPage: true });
    const confirm = page.getByTestId("export-draft-confirm");
    if (await confirm.isVisible()) await confirm.check();
    const labels = page.getByTestId("package-labels-include");
    if ((await labels.count()) > 0) await labels.check();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-integration").click()]);
    const dir = mkdtempSync(path.join(tmpdir(), "s17a-"));
    execFileSync("unzip", ["-q", await download.path(), "-d", dir]);
    const root = path.join(dir, readdirSync(dir)[0]!);
    expect(spawnSync(process.execPath, ["run.mjs", "verify"], { cwd: root }).status).toBe(0);
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-173 an incomplete mapping is named, explained and recoverable — never completed silently", () => {
  test("missing required fields are listed; no rule is added; the local path keeps the data", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await shareStatusNames(page);
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    const incomplete = page.getByTestId("guided-incomplete");
    await expect(incomplete).toBeVisible();
    await expect(incomplete).toHaveAttribute("data-missing", "email,status");
    await expect(incomplete).toContainText("No record can be valid");
    await expect(page.getByTestId("guided-next")).toContainText("missing");
    await page.screenshot({ path: path.join(shots, "03-incomplete-mapping.png"), fullPage: true });
    // EYES never adds the missing rules itself.
    await page.getByTestId("guided-mapping").locator("summary").click();
    await expect(page.getByTestId("guided-mapping")).not.toContainText("→ status");
    // Recovery without re-importing: answer locally, build here.
    await page.getByTestId("guided-incomplete-local").click();
    await answerLocally(page);
    await page.getByTestId("guided-build-local").click();
    await expect(page.getByTestId("guided-origin")).toHaveAttribute("data-origin", "local");
    await expect(page.getByTestId("guided-incomplete")).toHaveCount(0);
    expect(await cloudCalls(page)).toBe(1);
  });
});

test.describe("E2E-174 provider overload, then recovery without re-importing", () => {
  test("the failure is shown once; a new request needs a new approval; no automatic retry", async ({ page }) => {
    await boot(page, { deriveProposal: true, cloudErrorCode: "PROVIDER_OVERLOADED", cloudFailCalls: [0] });
    await shareStatusNames(page);
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toHaveAttribute("data-code", "PROVIDER_OVERLOADED");
    await page.waitForTimeout(500);
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("guided-fresh-request").click();
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    expect(await cloudCalls(page)).toBe(1);
    await expect(page.getByTestId("approval-kept")).toContainText("Your 120 records");
  });
});

test.describe("E2E-175 a matching date format is not presented as matching meaning", () => {
  test("createdAt read from contract.signed_at says EYES can't tell whether that date means createdAt", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await shareStatusNames(page);
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    const line = page.getByTestId("meaning-createdAt");
    await expect(line).toContainText("contract.signed_at");
    await expect(line).not.toContainText("nothing more to confirm");
    await expect(line).toContainText("can't tell whether");
    await expect(line).toHaveAttribute("data-tone", "info");
    await line.screenshot({ path: path.join(shots, "04-date-meaning.png") });
  });
});
