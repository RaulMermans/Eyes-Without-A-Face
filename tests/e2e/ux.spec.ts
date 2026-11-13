import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, openStage } from "./helpers.ts";

/**
 * Sprint 6 UX acceptance (Spectral Forensics redesign). These prove observable
 * behaviour of the new interface against real application state. They are not
 * claims about user comprehension.
 */
const shots = "test-results/sprint-6-screenshots";
const PRIVATE_VALUES = ["CUST-001", "ALICE@EXAMPLE.COM", "alice@example.com", "Example Studio", "PRIVATE_CANARY_PII_DO_NOT_SHARE"];
const LOCAL_NAMES = ["customer_id", "email_address", "account_state", "joined_at", "company_name", "internal_note"];

async function boot(page: Page, harness: Record<string, unknown> | null = { deriveProposal: true }): Promise<void> {
  if (harness) {
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", ...harness });
  }
  await page.goto("/");
}

async function step(page: Page, name: RegExp): Promise<void> {
  await openStage(page, name);
}

async function toTwin(page: Page): Promise<void> {
  await page.getByTestId("start-demo").click();
  await page.getByTestId("continue-to-twin").click();
  await expect(page.getByTestId("twin-summary")).toBeVisible();
}

async function toApproved(page: Page): Promise<void> {
  await toTwin(page);
  await page.locator('[data-testid^="disclose-categories-"]').first().check();
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  await page.getByTestId("approve-disclosure").click();
  await expect(page.getByTestId("review-status")).toContainText("Approved for one cloud request");
}

async function toProposal(page: Page): Promise<void> {
  await toApproved(page);
  await page.getByTestId("continue-to-mapping").click();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("proposal-status")).toContainText("Valid");
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("E2E-050 landing launches the real demo", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`primary CTA is above the fold and starts the workflow at ${viewport.width}px`, async ({ page }) => {
      const providerRequests = attachProviderWatch(page);
      await page.setViewportSize(viewport);
      await boot(page, null);
      const cta = page.getByTestId("start-demo");
      await expect(cta).toHaveText(/Try the fictional CRM demo/);
      const box = await cta.boundingBox();
      expect(box, "CTA has a box").toBeTruthy();
      expect((box?.y ?? 9999) + (box?.height ?? 0), "CTA fully visible without scrolling").toBeLessThanOrEqual(viewport.height);
      await expect(page.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
      await expect(page.locator("#how-it-works")).toBeAttached();
      await page.screenshot({ path: path.join(shots, `e2e-050-landing-${viewport.width}.png`) });
      await cta.click();
      // Same real workflow: the bundled fixture is profiled locally; no separate demo engine.
      await expect(page.getByTestId("source-profile")).toBeVisible();
      await expect(page.getByTestId("reserved-count")).toContainText("3 reserved hidden cases");
      await expect(page.getByTestId("intro")).toHaveCount(0);
      expect(providerRequests).toEqual([]);
    });
  }
});

test.describe("E2E-051 private records stay in the local context", () => {
  test("private values are masked by default, revealed locally on request, and never appear in twin or disclosure views", async ({ page }) => {
    await boot(page);
    await toTwin(page);
    const privateColumn = page.getByTestId("private-fields");
    const twinColumn = page.getByTestId("twin-fields");
    for (const value of PRIVATE_VALUES) await expect(privateColumn).not.toContainText(value);
    await page.getByTestId("show-local-names").check();
    await expect(privateColumn).toContainText("customer_id");
    await expect(privateColumn).toContainText('"CUST-001"');
    // The phantom side may show the local binding name, but never a private value.
    for (const value of PRIVATE_VALUES) await expect(twinColumn).not.toContainText(value);
    await page.screenshot({ path: path.join(shots, "e2e-051-reveal.png"), fullPage: true });

    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("review-advanced-toggle").click();
    for (const testId of ["disclosure-summary", "review-prompt", "review-payload"]) {
      const text = await page.getByTestId(testId).innerText();
      for (const term of [...PRIVATE_VALUES, ...LOCAL_NAMES]) expect(text, `${testId} leaked ${term}`).not.toContain(term);
    }
  });
});

test.describe("E2E-052 Phantom transformation is inspectable", () => {
  test("every field pairs a private cell with an alias card; withheld state is explicit and truthful", async ({ page }) => {
    await boot(page);
    await toTwin(page);
    const cards = page.locator('[data-testid^="twin-field-f_"]');
    await expect(cards).toHaveCount(6);
    await expect(page.locator('[data-testid^="private-field-f_"]')).toHaveCount(6);
    const first = cards.first();
    await expect(first).toContainText(/f_\d{2}/);
    await expect(first).toContainText("example");
    await expect(first).toContainText("Descriptor Gemini will read");
    await expect(page.getByTestId("twin-withheld")).toContainText("no fields");
    await expect(page.getByTestId("ledger-synthetic")).toContainText("6 aliases · 6 offered for review");

    const share = page.locator('[data-testid^="share-"]').last();
    const alias = ((await share.getAttribute("data-testid")) ?? "").replace("share-", "");
    await share.uncheck();
    await expect(page.getByTestId("twin-withheld")).toContainText(alias);
    await expect(page.getByTestId(`twin-field-${alias}`)).toContainText("withheld · stays local");
    await expect(page.getByTestId("ledger-synthetic")).toContainText("5 offered for review");
    await expect(page.getByTestId("ledger-transmitted")).toHaveText(/Nothing sent/);
  });
});

test.describe("E2E-053 disclosure approval stays explicit", () => {
  test("summary first, exact request on demand, and any upstream change clears the approval", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await toTwin(page);
    await page.getByTestId("continue-to-review").click();
    await expect(page.getByTestId("approve-disclosure")).toHaveCount(0);
    await page.getByTestId("build-preview").click();
    await expect(page.getByTestId("disclosure-summary")).toContainText("Gemini will receive");
    await expect(page.getByTestId("disclosure-summary")).toContainText("Gemini will not receive");
    await expect(page.getByTestId("review-categories")).toContainText("None included");
    const toggle = page.getByTestId("review-advanced-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("review-prompt")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("review-prompt")).toBeVisible();
    await expect(page.getByTestId("review-hashes")).toContainText(/prompt sha256 [0-9a-f]{64}/);
    await expect(page.getByTestId("review-advanced")).toContainText("cloud-disclosure 1.1.0");
    await page.getByTestId("approve-disclosure").click();
    await expect(page.getByTestId("ledger-approved")).toContainText("approved for one request");

    await step(page, /Phantom Twin/);
    await page.getByTestId("twin-seed").fill("7");
    await page.getByTestId("apply-seed").click();
    await expect(page.getByTestId("ledger-approved")).toContainText("Not reviewed yet");
    await step(page, /Cloud Mapping/);
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-054 mapping visualization reflects the canonical contract", () => {
  test("one connection per operation with the same op, sources, and destination; inspector shows real params", async ({ page }) => {
    await boot(page);
    await toProposal(page);
    await page.getByText("Edit the proposal locally").click();
    const text = await page.getByTestId("proposal-editor").inputValue();
    const operations = (JSON.parse(text) as { operations: Array<{ op: string; from?: string | string[]; to: string; params?: Record<string, unknown> }> }).operations;
    await expect(page.locator('[data-testid^="mapping-connection-"]')).toHaveCount(operations.length);
    for (const [index, operation] of operations.entries()) {
      const connection = page.getByTestId(`mapping-connection-${index}`);
      await expect(connection).toHaveAttribute("data-state", "validated");
      await expect(connection).toContainText(operation.op);
      await expect(connection).toContainText(operation.to);
      for (const source of [operation.from ?? []].flat()) await expect(connection).toContainText(source);
    }
    const enumIndex = operations.findIndex((operation) => operation.op === "map_enum");
    expect(enumIndex).toBeGreaterThanOrEqual(0);
    await page.getByTestId(`mapping-connection-${enumIndex}`).getByRole("button").click();
    await expect(page.getByTestId(`mapping-connection-${enumIndex}`).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    const inspector = page.getByTestId("mapping-inspector");
    await expect(inspector).toContainText(`Operation #${enumIndex + 1}`);
    const map = (operations[enumIndex]?.params?.map ?? {}) as Record<string, string>;
    for (const [from, to] of Object.entries(map)) {
      await expect(page.getByTestId("inspector-enum-map")).toContainText(from);
      await expect(page.getByTestId("inspector-enum-map")).toContainText(to);
    }
    await expect(inspector).toContainText("not run yet");
    await expect(page.getByTestId("proposal-pipeline")).toContainText("not run yet");
    await page.screenshot({ path: path.join(shots, "e2e-054-studio.png"), fullPage: true });
  });
});

test.describe("E2E-055 origin labeling", () => {
  test("simulated adapter output is never presented as Gemini; local edits become manual", async ({ page }) => {
    await boot(page);
    await toProposal(page);
    await expect(page.getByTestId("proposal-origin")).toHaveText("Simulated test adapter — not Gemini");
    await expect(page.getByTestId("ledger-transmitted")).toContainText("simulated test adapter, no network");
    await expect(page.getByTestId("proposal")).not.toContainText("Real Gemini output");
    await page.getByTestId("inspector-open-editor").click();
    const editor = page.getByTestId("proposal-editor");
    await expect(editor).toBeVisible();
    const text = await editor.inputValue();
    await editor.fill(text.replace('"rationale"', '"rationale_edit": "x", "rationale"'));
    await page.getByTestId("validate-edited-proposal").click();
    await expect(page.getByTestId("proposal-origin")).toHaveText("Manually edited locally — not model output");
  });
});

test.describe("E2E-056 Reality Check separates imported success from hidden failure", () => {
  test("verdict, groups, connection states, and failure-to-operation navigation", async ({ page }) => {
    await boot(page);
    await toProposal(page);
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    const verdict = page.getByTestId("reality-verdict");
    await expect(verdict).toHaveAttribute("data-status", "fail");
    await expect(verdict).not.toContainText("PASS");
    await expect(page.getByTestId("verdict-imported")).toHaveText("3 / 3");
    await expect(page.getByTestId("verdict-reserved")).toHaveText("0 / 3");
    await expect(page.getByRole("region", { name: "Imported records" })).toContainText("3 / 3 pass");
    await expect(page.getByRole("region", { name: "Hidden cases" })).toContainText("0 / 3 pass");
    // Numbering is consistent between Reality Check and the studio (1-based).
    const finding = page.getByTestId("safe-issues-3");
    await expect(finding).toContainText(/operation #\d/);
    const label = (await finding.innerText()).match(/operation #(\d+)/)?.[1];
    await page.getByTestId("inspect-op-3-0").click();
    await expect(page.getByRole("heading", { level: 2, name: "Cloud Mapping" })).toBeVisible();
    await expect(page.getByTestId("mapping-inspector")).toContainText(`Operation #${label}`);
    await expect(page.getByTestId("mapping-inspector")).toContainText("record failed here");
    await expect(page.getByTestId(`mapping-connection-${Number(label) - 1}`)).toHaveAttribute("data-state", "executed-fail");
    await expect(page.getByTestId("proposal-pipeline")).toContainText("findings");
  });
});

test.describe("E2E-057 error states explain what happened", () => {
  test("rejected operations render as rejected with their rule, never as validated", async ({ page }) => {
    await boot(page, {
      cloudOutput: {
        operations: [
          { op: "map_enum", from: "f_01", to: "status", params: { map: "active", unmapped: "fail" } },
          { op: "copy", from: "customer_id", to: "id" },
        ],
        rationale: "x",
      },
    });
    await toApproved(page);
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("Rejected at convert");
    await expect(page.locator('[data-testid^="mapping-connection-"][data-state="validated"]')).toHaveCount(0);
    await expect(page.getByTestId("mapping-connection-1")).toHaveAttribute("data-state", "rejected");
    await expect(page.getByTestId("mapping-connection-1")).toContainText("UNKNOWN_ALIAS");
    await page.getByTestId("mapping-connection-1").getByRole("button").click();
    await expect(page.getByTestId("mapping-inspector")).toContainText("rejected — never executed");
    await expect(page.getByTestId("proposal-pipeline")).toContainText("rejected");
    await expect(page.getByTestId("continue-to-reality")).toHaveCount(0);
  });

  test("unreadable output is reported, not repaired or visualized", async ({ page }) => {
    await boot(page, { rawCloudText: '{"operations": [{"op": "copy",' });
    await toApproved(page);
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-issues")).toContainText("MALFORMED_PROPOSAL");
    await expect(page.getByTestId("studio-unrenderable")).toContainText("It was not repaired");
  });
});

test.describe("E2E-058 keyboard navigation of all five stages", () => {
  test("workflow rail is reachable and operable by keyboard", async ({ page }) => {
    await boot(page);
    // Sprint 10: reach OBSERVE by keyboard, then operate the workbench rail.
    await page.getByTestId("mode-observe").focus();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", { name: "Workflow" });
    const buttons = nav.getByRole("button");
    await expect(buttons).toHaveCount(5);
    for (const [index, name] of ["Source System", "Phantom Twin", "Disclosure Review", "Cloud Mapping", "Reality Check"].entries()) {
      await buttons.nth(index).focus();
      await page.keyboard.press("Enter");
      await expect(buttons.nth(index)).toHaveAttribute("aria-current", "step");
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
    // Focus is visible: the focused control draws an outline.
    await buttons.nth(0).focus();
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
    expect(outline).not.toBe("none");
  });
});

test.describe("E2E-059 narrow viewport journey", () => {
  test("full journey at 390px without horizontal overflow; studio stays inspectable without hover", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await toProposal(page);
    for (const name of [/Source System/, /Phantom Twin/, /Disclosure Review/, /Cloud Mapping/]) {
      await step(page, name);
      expect(await overflow(page), `overflow on ${String(name)}`).toBeLessThanOrEqual(1);
    }
    await page.getByTestId("mapping-connection-1").getByRole("button").click();
    await expect(page.getByTestId("mapping-inspector")).toContainText("Operation #2");
    await page.getByTestId("continue-to-reality").click();
    await page.getByTestId("run-mapping").click();
    await expect(page.getByTestId("reality-verdict")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(shots, "e2e-059-mobile-reality.png"), fullPage: true });
  });

  test("768px tablet journey has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await boot(page);
    await toProposal(page);
    for (const name of [/Source System/, /Phantom Twin/, /Disclosure Review/, /Cloud Mapping/, /Reality Check/]) {
      await step(page, name);
      expect(await overflow(page), `overflow on ${String(name)}`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("E2E-060 reduced motion", () => {
  test("entrance animations are removed when the user prefers reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    await toTwin(page);
    const name = await page.locator('[data-testid^="twin-field-f_"]').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe("none");
  });
});
