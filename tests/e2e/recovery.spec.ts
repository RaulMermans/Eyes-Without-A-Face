import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 14 — guided reliability and recovery (E2E-140…149).
 *
 * The cloud adapter is the labeled deterministic TEST adapter (no network).
 * Sprint 18B: these run on the intent-plan path (ADR 0018). The Sprint 14
 * incident replay (a Mapping Proposal answer) stays covered by the unit tests
 * of the diagnosis; here the plan keeps the status match and the user's
 * translation completes it. These tests prove the explanation, the gates and
 * the recovery path — not model quality.
 */
const shots = "test-results/sprint-14-screenshots";
async function boot(page: Page, harness: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
  }, { label: "test-harness", ...harness });
  await page.goto("/");
}

const cloudCalls = (page: Page) => page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);

async function toDestination(page: Page, destination: "helpdesk" | "billing" | "marketing" = "helpdesk"): Promise<void> {
  await page.getByTestId("demo-json").click();
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await page.getByTestId(`destination-${destination}`).check();
}

/** Sprint 18B: the manual mapping (and the per-field share choice) is behind "Advanced: map fields yourself". */
async function openAdvanced(page: Page): Promise<void> {
  const advanced = page.getByTestId("advanced-manual");
  if ((await advanced.getAttribute("open")) === null) await advanced.locator("summary").click();
}

/** Sprint 18B: the user's one answer on the Helpdesk demo — what each account state means. */
async function answerStatus(page: Page): Promise<void> {
  await expect(page.getByTestId("plan-review")).toBeVisible();
  for (const [label, value] of Object.entries({ active_customer: "active", inactive_customer: "inactive", prospect: "prospect" })) {
    await page.getByTestId(`translate-status-${label}`).selectOption(value);
  }
}

test.describe("E2E-140 the production incident, explained before and after", () => {
  test("before sending: sharing category names is an explicit, optional, advanced choice", async ({ page }) => {
    await boot(page, {});
    await toDestination(page, "helpdesk");
    await openAdvanced(page);
    const need = page.getByTestId("destination-categories");
    await expect(need).toBeVisible();
    // Sprint 18B (ADR 0018 §8): withheld names no longer block the request, so nothing says they must be shared.
    await expect(need).toHaveAttribute("data-blocking", "false");
    await expect(page.getByTestId("share-categories-account_state")).not.toBeChecked();
    await page.screenshot({ path: path.join(shots, "01-destination-needs-categories.png"), fullPage: true });
    // Billing has no fixed-list field: no question.
    await page.getByTestId("destination-billing").check();
    await expect(page.getByTestId("destination-categories")).toHaveCount(0);
    await page.getByTestId("destination-helpdesk").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("guided-category-notice")).toHaveCount(0);
    await expect(page.getByTestId("guided-approve")).toBeEnabled();
    expect(await cloudCalls(page)).toBe(0);
  });

  test("the incident cannot recur: with the names withheld, the status match is kept and only the user's translation completes it", async ({ page }) => {
    // Sprint 14: Gemini answered with an unusable status rule because it saw only placeholders. Sprint 17A blocked
    // that request. Sprint 18B (ADR 0018): the plan states the match and leaves the meaning to the user.
    const providerRequests = attachProviderWatch(page);
    await boot(page, {});
    await toDestination(page, "helpdesk");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).not.toContainText("active_customer");
    await expect(page.getByTestId("approval-kept")).toContainText("Your 3 records");
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("plan-field-status")).toHaveAttribute("data-status", "needs_clarification");
    await expect(page.getByTestId("guided-outcome")).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, "02-plan-asks.png"), fullPage: true });
    await answerStatus(page);
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    expect(await cloudCalls(page)).toBe(1);
    await expect(page.getByTestId("guided-count-transformed")).toHaveText("3");
    await expect(page.getByTestId("guided-origin")).toContainText("Simulated test adapter — not Gemini");
    await page.screenshot({ path: path.join(shots, "03-recovered.png"), fullPage: true });
    expect(providerRequests).toEqual([]);
  });

  test("sharing in the advanced section goes into the reviewed request; un-sharing removes it", async ({ page }) => {
    await boot(page, {});
    await toDestination(page, "helpdesk");
    await openAdvanced(page);
    await page.getByTestId("share-categories-account_state").check();
    await page.getByTestId("guided-build").click();
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).toContainText("inactive_customer");
    // Changing the decision clears the prepared request (it was built for the old twin).
    await page.getByTestId("step-destination").click();
    await openAdvanced(page);
    await page.getByTestId("share-categories-account_state").uncheck();
    await page.getByTestId("guided-build").click();
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).not.toContainText("inactive_customer");
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-142 unusable answers: bounded re-ask with a fresh approval", () => {
  test("asking again needs a new approval, within the plan-request budget; then EYES stops inviting requests", async ({ page }) => {
    await boot(page, { planMode: "malformed" });
    await toDestination(page, "billing");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toHaveAttribute("data-code", "INVALID_STRUCTURED_OUTPUT");
    await expect(page.getByTestId("guided-protected")).toBeVisible();
    await page.getByTestId("guided-fresh-request").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(await cloudCalls(page)).toBe(1);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toBeVisible();
    expect(await cloudCalls(page)).toBe(2);
    await expect(page.getByTestId("guided-fresh-request")).toHaveCount(0);
    await expect(page.getByTestId("guided-request-limit")).toBeVisible();
  });

  test("a failing recovery preparation is shown, never a silent button", async ({ page }) => {
    await boot(page, { planMode: "malformed" });
    await toDestination(page, "billing");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-fresh-request")).toBeVisible();
    // Deterministic fault injection: the browser's hashing fails while the new request is prepared.
    await page.evaluate(() => {
      Object.defineProperty(crypto.subtle, "digest", { value: () => Promise.reject(new Error("injected digest failure")), configurable: true });
    });
    await page.getByTestId("guided-fresh-request").click();
    await expect(page.getByTestId("guided-recovery-error")).toContainText("A new request could not be prepared");
    await expect(page.getByTestId("guided-recovery-error")).toContainText("Your data and destination are kept");
    expect(await cloudCalls(page)).toBe(1);
  });

  test("a provider failure names the actual problem and keeps the work", async ({ page }) => {
    await boot(page, { cloudErrorCode: "PROVIDER_OVERLOADED" });
    await toDestination(page, "billing");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-status-label")).toHaveText("Gemini is overloaded right now");
    await expect(page.getByTestId("guided-protected")).toBeVisible();
    await expect(page.getByTestId("guided-fresh-request")).toBeVisible();
  });
});

test.describe("E2E-145 destination state integrity", () => {
  const schemaA = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Alpha destination", type: "object", additionalProperties: false, required: ["alpha_email"], properties: { alpha_email: { type: "string" } } };
  const schemaB = { ...schemaA, title: "Beta destination", required: ["beta_org"], properties: { beta_org: { type: "string" } } };

  test("Build always uses the schema on screen; invalid or empty edits block it with a reason", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await page.getByTestId("demo-json").click();
    await page.getByTestId("data-continue").click();

    // "Your own" with an empty editor must not silently build the previous example.
    await page.getByTestId("destination-custom").check();
    await expect(page.getByTestId("destination-summary")).toHaveCount(0);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("destination-problem")).toContainText("Add your schema first");
    await expect(page.getByTestId("approval-card")).toHaveCount(0);

    // Apply A, then type an invalid edit: the old summary is hidden and Build refuses.
    await page.getByTestId("destination-text").fill(JSON.stringify(schemaA));
    await page.getByTestId("destination-apply").click();
    await expect(page.getByTestId("destination-summary-fields")).toContainText("alpha_email");
    await page.getByTestId("destination-text").fill('{"type": "object", "properties": ');
    await expect(page.getByTestId("destination-unapplied")).toBeVisible();
    await expect(page.getByTestId("destination-summary")).toHaveCount(0);
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("destination-problem")).toContainText("can't be used yet");
    await expect(page.getByTestId("destination-text")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("approval-card")).toHaveCount(0);

    // A valid edit that was never "applied" is what Build uses.
    await page.getByTestId("destination-text").fill(JSON.stringify(schemaB));
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).toContainText("beta_org");
    await expect(page.getByTestId("approval-prompt")).not.toContainText("alpha_email");
    expect(await cloudCalls(page)).toBe(0);
  });
});

test.describe("E2E-146 result clarity", () => {
  test("two clearly different downloads, and how the fields were understood", async ({ page }) => {
    await boot(page, {});
    await toDestination(page, "helpdesk");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await answerStatus(page);
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    // No Firebase in E2E and no simulated Nano: the summary must not claim on-device AI ran.
    const understanding = page.getByTestId("guided-understanding-summary");
    await expect(understanding).toBeVisible();
    expect(["nano-unavailable", "nano-available", "checking"]).toContain(await understanding.getAttribute("data-kind"));
    await expect(understanding).toContainText("deterministic");
    await page.getByTestId("verify-continue").click();
    const downloads = page.getByTestId("guided-downloads");
    await expect(downloads.getByTestId("download-transformed")).toContainText("contains your real data");
    await expect(downloads.getByTestId("export-panel")).toContainText("does not contain your records");
    await expect(page.getByTestId("export-integration")).toContainText("(.zip)");
    await page.screenshot({ path: path.join(shots, "04-result-downloads.png"), fullPage: true });
  });

  test("Nano availability is visible on the data step, and a simulated run is never called Gemini Nano", async ({ page }) => {
    await boot(page, { onDeviceAvailable: true });
    await page.getByTestId("demo-json").click();
    await expect(page.getByTestId("guided-understanding")).toContainText("On-device AI is available");
    await page.getByTestId("guided-understanding").locator("summary").click();
    await page.getByTestId("interpret-private-on-device").click();
    await expect(page.locator('[data-testid^="private-semantics-row-"]').first()).toBeVisible();
    await expect(page.getByTestId("data-continue")).toBeEnabled();
    await page.getByTestId("data-continue").click();
    await page.getByTestId("guided-build").click();
    await page.getByTestId("guided-approve").click();
    await answerStatus(page);
    const understanding = page.getByTestId("guided-understanding-summary");
    await expect(understanding).toHaveAttribute("data-kind", "simulated");
    await expect(understanding).toContainText("not Gemini Nano");
  });
});

test.describe("E2E-148 interruption", () => {
  test("with data loaded, leaving the page asks first; nothing is persisted", async ({ page }) => {
    await boot(page, { deriveProposal: true });
    await expect(page.getByTestId("guided-session-note")).toContainText("Nothing is saved");
    await page.getByTestId("demo-json").click();
    await expect(page.getByTestId("source-summary")).toBeVisible();
    const dialog = new Promise<string>((resolve) => page.once("dialog", (item) => {
      resolve(item.type());
      void item.dismiss();
    }));
    void page.reload().catch(() => undefined);
    expect(await dialog).toBe("beforeunload");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("CUST-001");
  });
});
