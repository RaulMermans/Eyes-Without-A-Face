import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { attachProviderWatch } from "./helpers.ts";

/**
 * Sprint 13 — the guided flow: Your data → Destination → Result.
 * The cloud adapter is the labeled deterministic TEST adapter (no network).
 * These tests prove the journey, the gates and that what the guided view says
 * matches canonical state — not model quality.
 */
const shots = "test-results/sprint-13-screenshots";

async function boot(page: Page, harness: Record<string, unknown> | null = { deriveProposal: true }): Promise<void> {
  if (harness) {
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", ...harness });
  }
  await page.goto("/");
}

async function cloudCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__EYES_WITHOUT_A_FACE_TEST__?.cloudCalls ?? 0);
}

async function toApproval(page: Page, demo: "csv" | "xlsx" | "json" = "csv"): Promise<void> {
  await page.getByTestId(`demo-${demo}`).click();
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.getByTestId("data-continue").click();
  await expect(page.getByTestId("guided-destination")).toBeVisible();
  await page.getByTestId("guided-build").click();
  await expect(page.getByTestId("approval-card")).toBeVisible();
}

test.describe("E2E-130 guided journey", () => {
  test("three moments: data, destination, result — with one contextual approval", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await expect(page.getByRole("heading", { level: 2, name: "Where is your data?" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Steps" })).toBeVisible();
    await expect(page.getByTestId("step-destination")).toBeDisabled();
    await page.screenshot({ path: path.join(shots, "01-your-data.png"), fullPage: true });

    await page.getByTestId("demo-csv").click();
    await expect(page.getByTestId("source-format")).toContainText("CSV file");
    await expect(page.getByTestId("source-record-count")).toHaveText("3");
    await expect(page.getByTestId("source-field-count")).toHaveText("6");
    await expect(page.getByTestId("source-locality")).toContainText("In this browser only");
    await expect(page.getByTestId("source-preview")).toContainText("CUST-001");
    await page.screenshot({ path: path.join(shots, "02-data-loaded.png"), fullPage: true });

    await page.getByTestId("data-continue").click();
    await expect(page.getByRole("heading", { level: 2, name: "Where should it go?" })).toBeVisible();
    await expect(page.getByTestId("destination-helpdesk")).toBeChecked();
    await expect(page.getByTestId("destination-summary-fields")).toContainText("createdAt");
    await page.screenshot({ path: path.join(shots, "03-destination.png"), fullPage: true });

    await page.getByTestId("guided-build").click();
    // Build stopped at the approval: nothing approved, nothing sent.
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "approval");
    await expect(page.getByTestId("guided-status-label")).toHaveText("Your approval is needed");
    await expect(page.getByTestId("approval-sent")).toContainText("invented example rows");
    await expect(page.getByTestId("approval-kept")).toContainText("Your 3 records");
    expect(await cloudCalls(page)).toBe(0);
    await page.getByTestId("approval-exact").locator("summary").click();
    const prompt = await page.getByTestId("approval-prompt").innerText();
    expect(prompt).not.toContain("PRIVATE_CANARY");
    expect(prompt).not.toContain("email_address");
    expect(prompt).not.toContain("ALICE");
    await page.screenshot({ path: path.join(shots, "04-approval.png"), fullPage: true });

    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    expect(await cloudCalls(page)).toBe(1);
    const state = await page.getByTestId("guided-outcome").getAttribute("data-state");
    expect(["VERIFIED", "VERIFIED_WITH_EXCEPTIONS", "PARTIALLY_VERIFIED"]).toContain(state);
    await expect(page.getByTestId("guided-origin")).toContainText("Simulated test adapter — not Gemini");
    await expect(page.getByTestId("check-structure")).toBeVisible();
    await expect(page.getByTestId("check-meaning")).toBeVisible();
    // The meaning line never claims verification it does not have.
    const meaning = await page.getByTestId("check-meaning").getAttribute("data-ok");
    if (meaning !== "true") await expect(page.getByTestId("check-meaning")).toContainText("not verified");
    await page.screenshot({ path: path.join(shots, "05-result.png"), fullPage: true });

    // Export: the same package and privacy scan as before.
    if (state === "PARTIALLY_VERIFIED") await page.getByTestId("export-draft-confirm").check();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-integration").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^eyes-integration-.*\.zip$/);
    const zip = readFileSync(await download.path());
    expect(zip.includes(Buffer.from("PRIVATE_CANARY"))).toBe(false);
    await expect(page.getByTestId("export-result")).toBeVisible();

    // The full runtime is still one click away and agrees with the guided view.
    await page.getByTestId("result-technical").click();
    await expect(page.getByTestId("observe")).toBeVisible();
    await expect(page.getByTestId("runtime-stage-cloud-inference")).toHaveAttribute("data-status", "completed");
    await expect(page).toHaveURL(/#technical$/);
    await page.getByTestId("view-guided").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    expect(providerRequests).toEqual([]);
  });

  test("transformed data is a separate, explicit download of passing records only", async ({ page }) => {
    // A fixed, correct proposal from the labeled test adapter (aliases of the JSON demo, default seed),
    // for the enum-free Billing destination.
    await boot(page, {
      cloudOutput: {
        operations: [
          { op: "copy", from: "f_05", to: "customerRef" },
          { op: "normalize_email", from: "f_01", to: "billingEmail" },
          { op: "trim", from: "f_02", to: "companyName" },
          { op: "parse_date", from: "f_06", to: "customerSince", params: { inputFormat: "YYYY-MM-DD" } },
        ],
        rationale: "Fixed E2E proposal served by the simulated test adapter.",
      },
    });
    await page.getByTestId("demo-json").click();
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-billing").check();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    await page.getByTestId("guided-preview").locator("summary").click();
    const transformed = Number(await page.getByTestId("guided-count-transformed").innerText());
    expect(transformed).toBe(3);
    await page.screenshot({ path: path.join(shots, "05b-result-verified.png"), fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-transformed-json").click();
    const records = JSON.parse(readFileSync(await (await downloadPromise).path(), "utf8")) as unknown[];
    expect(records).toHaveLength(transformed);
    const csvPromise = page.waitForEvent("download");
    await page.getByTestId("download-transformed-csv").click();
    const csvText = readFileSync(await (await csvPromise).path(), "utf8");
    expect(csvText.split("\r\n")[0]).toBe("customerRef,billingEmail,companyName,customerSince");
  });
});

test.describe("E2E-131 multi-format upload", () => {
  test("CSV and Excel files upload through one control and reach the same engine", async ({ page }) => {
    await boot(page);
    for (const [file, format] of [
      ["src/examples/crm/source-records.csv", "CSV file"],
      ["src/examples/crm/source-records.xlsx", "Excel workbook"],
      ["src/examples/crm/source-records.json", "JSON file"],
    ] as const) {
      await page.getByTestId("source-file-input").setInputFiles(file);
      await expect(page.getByTestId("source-format")).toContainText(format);
      await expect(page.getByTestId("source-record-count")).toHaveText("3");
      await expect(page.getByTestId("data-continue")).toBeEnabled();
      if (format === "Excel workbook") {
        await expect(page.getByTestId("sheet-select")).toHaveValue("Accounts");
        await page.screenshot({ path: path.join(shots, "06-excel-loaded.png"), fullPage: true });
      }
      await page.getByTestId("source-clear").click();
    }
  });

  test("bad files explain themselves and load nothing", async ({ page }) => {
    await boot(page);
    await page.getByTestId("source-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("source-problem")).toContainText("Choose a .json, .csv or .xlsx file.");
    await page.getByTestId("source-file-input").setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from("a,b,c\n1,2,3\n4,5\n") });
    await expect(page.getByTestId("source-problem")).toContainText("row 3 has 2 values, the header has 3");
    await page.getByTestId("source-file-input").setInputFiles({ name: "dup.csv", mimeType: "text/csv", buffer: Buffer.from("email,email\n1,2\n") });
    await expect(page.getByTestId("source-problem")).toContainText("Column names must be unique");
    await expect(page.getByTestId("source-summary")).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, "07-import-problem.png"), fullPage: true });
  });

  test("numeric-looking CSV columns stay text unless the user chooses otherwise", async ({ page }) => {
    await boot(page);
    await page.getByTestId("source-file-input").setInputFiles({
      name: "accounts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("account_id,zip,seats,email\nA-1,00123,12,a@example.com\nA-2,04000,7,b@example.com\n"),
    });
    await expect(page.getByTestId("type-review")).toBeVisible();
    await expect(page.getByTestId("type-choice-seats")).not.toBeChecked();
    await expect(page.getByTestId("type-choice-zip")).toHaveCount(0);
    await page.getByTestId("source-details").locator("summary").click();
    await expect(page.getByTestId("source-note-TEXT_KEPT")).toContainText("zip");
    await page.getByTestId("type-choice-seats").check();
    await expect(page.getByTestId("type-choice-seats")).toBeChecked();
  });
});

test.describe("E2E-132 approvals stay explicit", () => {
  test("declining sends nothing; reviewing again needs a new approval", async ({ page }) => {
    await boot(page);
    await toApproval(page);
    const firstHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
    await page.getByTestId("guided-reject").click();
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "rejected");
    expect(await cloudCalls(page)).toBe(0);
    await page.getByTestId("guided-prepare-again").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    expect(await page.getByTestId("approval-card").getAttribute("data-payload-hash")).toBe(firstHash);
    expect(await cloudCalls(page)).toBe(0);
  });

  test("changing the destination clears a prepared request; Build asks again", async ({ page }) => {
    await boot(page);
    await toApproval(page);
    const firstHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
    await page.getByTestId("step-destination").click();
    await page.getByTestId("destination-marketing").check();
    await page.getByTestId("step-result").isDisabled();
    await page.getByTestId("guided-build").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    const secondHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
    expect(secondHash).not.toBe(firstHash);
    await expect(page.getByTestId("approval-sent")).toContainText("The 3 destination field names");
    expect(await cloudCalls(page)).toBe(0);
  });

  test("without a cloud configuration the request cannot be sent, and the UI says so", async ({ page }) => {
    await boot(page, null);
    await toApproval(page);
    await expect(page.getByTestId("approval-cloud-unavailable")).toBeVisible();
    await expect(page.getByTestId("guided-approve")).toBeDisabled();
  });

  test("a cloud failure is explained and recovery needs a new approval", async ({ page }) => {
    await boot(page, { deriveProposal: true, cloudErrorCode: "RATE_LIMITED" });
    await toApproval(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-cloud-failure")).toBeVisible();
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "attention");
    await page.getByTestId("guided-fresh-request").click();
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await expect(page.getByTestId("guided-approve")).toContainText("Approve and send");
  });
});

test.describe("E2E-133 connect a read-only API", () => {
  test("validates the address before any request and reads only after Connect", async ({ page }) => {
    let apiRequests = 0;
    await page.route("https://api.example.com/**", async (route) => {
      apiRequests += 1;
      expect(route.request().method()).toBe("GET");
      expect(route.request().postData()).toBeNull();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        body: JSON.stringify({ data: [{ id: "C-1", email: "ada@example.com" }, { id: "C-2", email: "bo@example.com" }] }),
      });
    });
    await boot(page);
    await page.getByTestId("data-tab-api").click();
    await page.getByTestId("api-url").fill("http://api.example.com/customers");
    await expect(page.getByTestId("api-target")).toContainText("Only HTTPS");
    await expect(page.getByTestId("api-connect-button")).toBeDisabled();
    await page.getByTestId("api-url").fill("https://localhost/customers");
    await expect(page.getByTestId("api-target")).toContainText("not allowed");
    await page.getByTestId("api-url").fill("https://api.example.com/customers?api_key=x");
    await expect(page.getByTestId("api-target")).toContainText("token field");
    await page.getByTestId("api-url").fill("https://api.example.com/customers");
    await expect(page.getByTestId("api-target")).toContainText("api.example.com");
    expect(apiRequests).toBe(0);
    await page.screenshot({ path: path.join(shots, "08-connect-api.png"), fullPage: true });
    await page.getByTestId("api-connect-button").click();
    await expect(page.getByTestId("source-format")).toContainText("Connected API");
    await expect(page.getByTestId("source-record-count")).toHaveText("2");
    await expect(page.getByTestId("source-locality")).toContainText("Read from api.example.com");
    expect(apiRequests).toBe(1);
  });

  test("a token is sent only as a header and never kept, exported or disclosed", async ({ page }) => {
    let auth: string | undefined;
    await page.route("https://api.example.com/**", async (route) => {
      auth = route.request().headers().authorization;
      await route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization" }, body: JSON.stringify([{ id: "C-1", email: "ada@example.com" }]) });
    });
    await boot(page);
    await page.getByTestId("data-tab-api").click();
    await page.getByTestId("api-url").fill("https://api.example.com/c");
    await page.getByTestId("api-token").fill("tok_E2E_SECRET_42");
    await page.getByTestId("api-connect-button").click();
    await expect(page.getByTestId("source-summary")).toBeVisible();
    expect(auth).toBe("Bearer tok_E2E_SECRET_42");
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(storage).not.toContain("tok_E2E_SECRET_42");
    await expect(page.locator("body")).not.toContainText("tok_E2E_SECRET_42");
    await page.getByTestId("data-continue").click();
    await page.getByTestId("destination-custom").check();
    await page.getByTestId("destination-sample").locator("summary").click();
    await page.getByTestId("destination-sample-text").fill('{"ref": "X", "contact": "a@example.com"}');
    await page.getByTestId("destination-draft").click();
    await expect(page.getByTestId("destination-summary-fields")).toContainText("contact");
    await page.getByTestId("guided-build").click();
    await page.getByTestId("approval-exact").locator("summary").click();
    await expect(page.getByTestId("approval-prompt")).not.toContainText("tok_E2E_SECRET_42");
    const telemetry = await page.evaluate(() => document.documentElement.outerHTML);
    expect(telemetry).not.toContain("tok_E2E_SECRET_42");
  });

  test("network and CORS refusals are reported, never bypassed", async ({ page }) => {
    // Playwright's fulfill() skips the browser's CORS check, so a blocked request is modelled as a failed fetch,
    // which is exactly what the browser reports for a CORS refusal. Real CORS enforcement: tests/live/rest-connector.spec.ts.
    await page.route("https://api.example.com/**", (route) => route.abort("failed"));
    await boot(page);
    await page.getByTestId("data-tab-api").click();
    await page.getByTestId("api-url").fill("https://api.example.com/c");
    await page.getByTestId("api-connect-button").click();
    await expect(page.getByTestId("source-problem")).toContainText("CORS");
    await expect(page.getByTestId("source-problem")).toContainText("does not use a proxy");
  });

  test("an empty API response is explained", async ({ page }) => {
    await page.route("https://api.example.com/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: "[]" }));
    await boot(page);
    await page.getByTestId("data-tab-api").click();
    await page.getByTestId("api-url").fill("https://api.example.com/c");
    await page.getByTestId("api-connect-button").click();
    await expect(page.getByTestId("source-problem")).toContainText("The response contains no records.");
  });
});

test.describe("E2E-134 accessibility and mobile", () => {
  test("keyboard: the file control, the tabs and the step headings are reachable", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Tab"); // skip link
    let reached = false;
    for (let index = 0; index < 20 && !reached; index += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "source-file-input");
    }
    expect(reached).toBe(true);
    await page.getByTestId("demo-csv").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("source-summary")).toBeVisible();
    await page.getByTestId("data-continue").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#destination-step-heading")).toBeFocused();
    await expect(page.getByTestId("guided-status")).toHaveCount(0);
  });

  test("mobile: no horizontal scroll on any step and the main action is reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(shots, "m01-your-data.png"), fullPage: true });
    await toApproval(page);
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(shots, "m02-approval.png"), fullPage: true });
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-outcome")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(shots, "m03-result.png"), fullPage: true });
  });

  test("reduced motion: the busy indicator does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, { deriveProposal: true, cloudDelayMs: 1500 });
    await toApproval(page);
    await page.getByTestId("guided-approve").click();
    await expect(page.getByTestId("guided-status")).toHaveAttribute("data-status", "generating");
    const animation = await page.locator(".status-pulse").evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe("none");
    await expect(page.getByTestId("guided-outcome")).toBeVisible({ timeout: 10_000 });
  });
});
