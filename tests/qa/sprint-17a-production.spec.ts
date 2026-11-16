import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Sprint 17A — Meridian-style recovery journey on the DEPLOYED build, with ZERO model requests.
 * Never clicks "Approve and send". Proves: a provably unusable request is not offered; the routes are
 * the chosen field (only its names) or the local build; the local recovery is correct and portable.
 */
const FIXTURE = "tests/fixtures/sprint-17a/meridian-style-120.json";
const OUT = process.env.EYES_S17A_OUT ?? "qa-artifacts/sprint-17a/production";
type Rec = { account_state: string; contact: { email?: string } };
const records = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { records: Rec[] }).records;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const result: Record<string, unknown> = {};

function guard(page: Page) {
  const state = { generateContent: 0, pageErrors: [] as string[] };
  page.on("request", (request) => {
    if (request.url().includes("generateContent")) state.generateContent += 1;
  });
  page.on("pageerror", (error) => state.pageErrors.push(error.message.slice(0, 160)));
  return state;
}

async function toHelpdesk(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("source-file-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("source-record-count")).toHaveText("120");
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-helpdesk").check();
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "meridian-recovery.json"), `${JSON.stringify(result, null, 2)}\n`);
});

test("S17A-PROD-1 a provably unusable request is not offered; the routes are explicit; declining sends nothing", async ({ page }) => {
  const state = guard(page);
  await toHelpdesk(page);
  await page.getByTestId("guided-build").click();
  await expect(page.getByTestId("approval-card")).toBeVisible();
  await expect(page.getByTestId("guided-approve")).toBeDisabled();
  await expect(page.getByTestId("guided-status-label")).toHaveText("Not ready to send");
  await expect(page.getByTestId("approval-blocked")).toHaveAttribute("data-targets", "status");
  await expect(page.getByTestId("approval-blocked")).toContainText("account_state");
  await expect(page.getByTestId("guided-share-categories")).toHaveCount(0);
  await expect(page.getByTestId("guided-category-unchosen")).toContainText("status");
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, "01-blocked.png"), fullPage: true });
  // Route: choose the field, share only its names → a NEW request becomes approvable (NOT sent here).
  const firstHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
  await page.getByTestId("guided-choose-category-source").click();
  await page.getByTestId("match-status-account_state").check();
  await page.getByTestId("share-categories-account_state").check();
  await page.getByTestId("guided-build").click();
  await expect(page.getByTestId("approval-card")).toBeVisible();
  const secondHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
  await expect(page.getByTestId("guided-approve")).toBeEnabled();
  await page.getByTestId("approval-exact").locator("summary").click();
  const prompt = await page.getByTestId("approval-prompt").innerText();
  // Declining sends nothing.
  await page.getByTestId("guided-reject").click();
  await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "rejected");
  result.blocked = {
    approveDisabledWhileBlocked: true,
    newRequestAfterChoosing: secondHash !== firstHash,
    approvableAfterChoosingAndSharing: true,
    onlyChosenFieldNames: prompt.includes("suspendido") && !["retail", "premium", "monthly", "north"].some((other) => prompt.includes(other)),
    noRecordValuesInPrompt: !["person.001@example.com", "MRX-00001", "Fictional Org 001"].some((value) => prompt.includes(value)),
    generateContent: state.generateContent,
    pageErrors: state.pageErrors,
  };
  expect(secondHash).not.toBe(firstHash);
  expect((result.blocked as Record<string, unknown>).onlyChosenFieldNames).toBe(true);
  expect((result.blocked as Record<string, unknown>).noRecordValuesInPrompt).toBe(true);
  expect(state.generateContent).toBe(0);
  expect(state.pageErrors).toEqual([]);
});

test("S17A-PROD-2 valid local recovery: counts equal an independent reading of the data; the ZIP verifies outside the app", async ({ page }) => {
  const state = guard(page);
  await toHelpdesk(page);
  await page.getByTestId("match-status-account_state").check();
  await page.getByTestId("translate-open-status").click();
  for (const [label, value] of Object.entries({ activo: "active", inactivo: "inactive", pendiente: "prospect", reactivado: "active", suspendido: "__set_aside__" })) {
    await page.getByTestId(`translate-status-${label}`).selectOption(value);
  }
  if (!(await page.getByTestId("field-matches").isVisible())) await page.getByTestId("field-matches-disclosure").locator("summary").click();
  for (const [target, source] of Object.entries({ id: "record_id", email: "contact.email", createdAt: "contract.signed_at", organization: "organization" })) {
    await page.getByTestId(`field-match-${target}`).selectOption(source);
  }
  await page.getByTestId("guided-build-local").click();
  await expect(page.getByTestId("guided-outcome")).toBeVisible();
  const bad = records.filter((r) => typeof r.contact.email !== "string" || !EMAIL.test(r.contact.email.trim())).length;
  const aside = records.filter((r) => typeof r.contact.email === "string" && EMAIL.test(r.contact.email.trim()) && r.account_state === "suspendido").length;
  const counts = {
    transformed: await page.getByTestId("guided-count-transformed").innerText(),
    setAside: await page.getByTestId("guided-count-quarantined").innerText(),
    attention: await page.getByTestId("guided-count-attention").innerText(),
  };
  await page.screenshot({ path: path.join(OUT, "02-local-recovery.png"), fullPage: true });
  const confirm = page.getByTestId("export-draft-confirm");
  if (await confirm.isVisible()) await confirm.check();
  const labels = page.getByTestId("package-labels-include");
  if ((await labels.count()) > 0) await labels.check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-integration").click()]);
  const dir = mkdtempSync(path.join(tmpdir(), "s17a-prod-"));
  execFileSync("unzip", ["-q", await download.path(), "-d", dir]);
  const root = path.join(dir, readdirSync(dir)[0]!);
  const verify = spawnSync(process.execPath, ["run.mjs", "verify"], { cwd: root });
  const zipText = execFileSync("find", [root, "-type", "f", "-not", "-path", "*/runtime/*"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  result.local = {
    expected: { transformed: 120 - bad - aside, setAside: aside, attention: bad },
    observed: counts,
    headline: await page.getByTestId("guided-status-label").innerText(),
    origin: await page.getByTestId("guided-origin").getAttribute("data-origin"),
    zipVerifyExit: verify.status,
    zipHasRecordValues: ["person.001@example.com", "MRX-00001", "Fictional Org 001", "Test Person 1"].some((value) => zipText.includes(value)),
    zipHasSourceFieldNames: ["contract.signed_at", "record_id", "account_state"].some((value) => zipText.includes(`"${value}"`)),
    generateContent: state.generateContent,
  };
  expect(counts).toEqual({ transformed: String(120 - bad - aside), setAside: String(aside), attention: String(bad) });
  expect(verify.status).toBe(0);
  expect((result.local as Record<string, unknown>).zipHasRecordValues).toBe(false);
  expect((result.local as Record<string, unknown>).zipHasSourceFieldNames).toBe(false);
  expect(state.generateContent).toBe(0);
});
