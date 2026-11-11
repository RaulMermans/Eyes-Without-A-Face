import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { attachProviderWatch, screenshotDir } from "./helpers.ts";

const sprint3Shots = path.join(screenshotDir, "..", "sprint-3-screenshots");
const PRIVATE_TERMS = [
  "PRIVATE_CANARY_PII_DO_NOT_SHARE",
  "customer_id",
  "email_address",
  "account_state",
  "joined_at",
  "company_name",
  "internal_note",
  "CUST-001",
  "alice@example.com",
  "ALICE@EXAMPLE.COM",
  "Example Studio",
  "North Bridge",
  "fictional-crm-accounts",
  "vip_customer",
];

async function boot(page: Page, harness: Record<string, unknown> | null = { deriveProposal: true }): Promise<void> {
  if (harness) {
    await page.addInitScript((value) => {
      window.__EYES_WITHOUT_A_FACE_TEST__ = value as Window["__EYES_WITHOUT_A_FACE_TEST__"];
    }, { label: "test-harness", ...harness });
  }
  await page.goto("/");
}

async function step(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name }).click();
}

async function loadSampleAndTwin(page: Page, discloseCategories = true): Promise<void> {
  await page.getByTestId("load-crm-sample").click();
  await page.getByTestId("continue-to-twin").click();
  await expect(page.getByTestId("twin-summary")).toBeVisible();
  if (discloseCategories) {
    await page.locator('[data-testid^="disclose-categories-"]').first().check();
  }
}

async function approve(page: Page): Promise<string> {
  await page.getByTestId("continue-to-review").click();
  await page.getByTestId("build-preview").click();
  const prompt = await page.getByTestId("review-prompt").innerText();
  await page.getByTestId("approve-disclosure").click();
  await expect(page.getByTestId("review-status")).toContainText("Approved for one cloud request");
  return prompt;
}

async function proposeAndRun(page: Page): Promise<void> {
  await page.getByTestId("continue-to-mapping").click();
  await page.getByTestId("send-cloud-request").click();
  await expect(page.getByTestId("proposal-status")).toContainText("Valid");
  await page.getByTestId("continue-to-reality").click();
  await page.getByTestId("run-mapping").click();
  await expect(page.getByTestId("mapping-summary")).toBeVisible();
}

async function cloudProposalEvents(page: Page): Promise<number> {
  const text = await page.getByTestId("workflow-telemetry").textContent();
  const events = JSON.parse(text ?? "[]") as Array<{ kind: string }>;
  return events.filter((event) => event.kind === "cloud-proposal").length;
}

test.describe("E2E-025 source profiling", () => {
  test("imports the fictional CRM and shows a local structure profile", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page, null);
    await page.getByTestId("load-crm-sample").click();
    const profile = page.getByTestId("source-profile");
    await expect(profile).toBeVisible();
    await expect(page.getByTestId("profile-field-email_address")).toContainText("string (email)");
    await expect(page.getByTestId("profile-field-account_state")).toContainText("enum");
    await expect(page.getByTestId("profile-field-joined_at")).toContainText("YYYY-MM-DD");
    await expect(page.getByTestId("profile-field-internal_note")).toContainText("optional (2 missing)");
    await expect(page.getByTestId("reserved-count")).toContainText("3 reserved hidden cases");
    await expect(page.getByTestId("profile-issues")).toContainText("OPTIONAL_FIELD");
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-025-profile.png"), fullPage: true });
    expect(providerRequests).toEqual([]);
  });

  test("rejects unsafe JSON with a structured error", async ({ page }) => {
    await boot(page, null);
    await page.getByText("Paste JSON instead").click();
    await page.getByTestId("source-json-editor").fill('[{"__proto__": {"x": 1}}]');
    await page.getByTestId("source-json-editor").blur();
    await expect(page.getByTestId("profile-error")).toContainText("PROTOTYPE_POLLUTION");
  });
});

test.describe("E2E-026 Phantom generation", () => {
  test("generates aliases, synthetic examples, and a valid twin", async ({ page }) => {
    await boot(page, null);
    await loadSampleAndTwin(page, false);
    await expect(page.getByTestId("twin-id")).toContainText(/phantom-[0-9a-f]{8} · seed 20261111 · 6 aliases · 6 synthetic examples/);
    const fields = page.getByTestId("twin-fields");
    await expect(fields).toContainText("f_01");
    await expect(fields).not.toContainText("customer_id");
    const examples = await page.getByTestId("twin-examples").innerText();
    for (const term of PRIVATE_TERMS) expect(examples).not.toContain(term);
    await expect(page.getByTestId("twin-limitations")).toContainText("Category labels are withheld");
    await page.getByTestId("show-local-names").check();
    await expect(fields).toContainText("customer_id");
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-026-twin.png"), fullPage: true });
  });
});

test.describe("E2E-027 deterministic output", () => {
  test("the same seed and input produce the same twin", async ({ page }) => {
    await boot(page, null);
    await loadSampleAndTwin(page, false);
    const first = (await page.getByTestId("twin-id").innerText()) + (await page.getByTestId("twin-examples").innerText());
    await page.reload();
    await loadSampleAndTwin(page, false);
    const second = (await page.getByTestId("twin-id").innerText()) + (await page.getByTestId("twin-examples").innerText());
    expect(second).toBe(first);
    await page.getByTestId("twin-seed").fill("42");
    await page.getByTestId("apply-seed").click();
    await expect(page.getByTestId("twin-id")).toContainText("seed 42");
    const changed = (await page.getByTestId("twin-id").innerText()) + (await page.getByTestId("twin-examples").innerText());
    expect(changed).not.toBe(first);
    await page.getByTestId("twin-seed").fill("20261111");
    await page.getByTestId("twin-seed").press("Enter");
    await expect(page.getByTestId("twin-id")).toContainText("seed 20261111");
    const restored = (await page.getByTestId("twin-id").innerText()) + (await page.getByTestId("twin-examples").innerText());
    expect(restored).toBe(first);
  });
});

test.describe("E2E-028 privacy", () => {
  test("private canaries and names are absent from the approved cloud payload", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    const bodies: string[] = [];
    page.on("request", (request) => {
      const body = request.postData();
      if (body) bodies.push(body);
    });
    const consoleLines: string[] = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    await boot(page);
    await loadSampleAndTwin(page);
    const prompt = await approve(page);
    for (const term of PRIVATE_TERMS) {
      expect(prompt, `prompt leaked ${term}`).not.toContain(term);
    }
    expect(prompt).toContain("active_customer");
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-028-review.png"), fullPage: true });
    await proposeAndRun(page);
    const telemetry = (await page.getByTestId("workflow-telemetry").textContent()) ?? "";
    const blob = [telemetry, ...bodies, ...consoleLines].join("\n");
    for (const term of PRIVATE_TERMS) {
      expect(blob, `telemetry/network/console leaked ${term}`).not.toContain(term);
    }
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-029 disclosure rejection", () => {
  test("rejecting the prompt results in zero cloud mapping requests", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await loadSampleAndTwin(page);
    await page.getByTestId("continue-to-review").click();
    await page.getByTestId("build-preview").click();
    await page.getByTestId("reject-disclosure").click();
    await expect(page.getByTestId("review-status")).toContainText("Rejected. No cloud request will be made.");
    await step(page, /Cloud Mapping/);
    await expect(page.getByTestId("cloud-needs-approval")).toContainText("rejected");
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    await expect(page.getByTestId("proposal")).toHaveCount(0);
    expect(await cloudProposalEvents(page)).toBe(0);
    expect(providerRequests).toEqual([]);
  });

  test("changing the twin after approval invalidates the approval", async ({ page }) => {
    await boot(page);
    await loadSampleAndTwin(page);
    await approve(page);
    await step(page, /Phantom Twin/);
    await page.locator('[data-testid^="share-"]').last().uncheck();
    await step(page, /Cloud Mapping/);
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
    await step(page, /Disclosure Review/);
    await expect(page.getByTestId("build-preview")).toBeVisible();
  });
});

test.describe("E2E-030 approved mapping", () => {
  test("a labeled deterministic test adapter returns a valid fictional proposal", async ({ page }) => {
    await boot(page);
    await loadSampleAndTwin(page);
    await approve(page);
    await page.getByTestId("continue-to-mapping").click();
    await expect(page.getByTestId("cloud-adapter-label")).toContainText("simulated, not Gemini");
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-origin")).toHaveText("Simulated test adapter — not Gemini");
    await expect(page.getByTestId("proposal-provenance")).toContainText("source=TEST");
    await expect(page.getByTestId("proposal-provenance")).toContainText("simulated=true");
    await expect(page.getByTestId("proposal-status")).toContainText("Valid · 5 operations");
    await expect(page.getByTestId("proposal-operations")).toContainText("map_enum");
    await expect(page.getByTestId("proposal")).not.toContainText("Real Gemini output");
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-030-proposal.png"), fullPage: true });
    // Single-use approval: sending again is not possible.
    await expect(page.getByTestId("send-cloud-request")).toBeDisabled();
  });
});

test.describe("E2E-031 alias resolution", () => {
  test("the proposal resolves to local source fields without sending bindings", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    await boot(page);
    await loadSampleAndTwin(page);
    const prompt = await approve(page);
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
    await expect(page.getByTestId("proposal-status")).toContainText("aliases resolved locally");
    const operations = await page.getByTestId("proposal-operations").innerText();
    expect(operations).toMatch(/"f_\d{2}"/);
    expect(operations).not.toContain("customer_id");
    await page.getByText("Local alias resolution (this browser only)").click();
    const table = page.getByTestId("alias-resolution");
    for (const name of ["customer_id", "email_address", "account_state", "joined_at", "company_name"]) {
      await expect(table).toContainText(name);
      expect(prompt).not.toContain(name);
    }
    await expect(table).not.toContainText("internal_note");
    expect(providerRequests).toEqual([]);
  });
});

test.describe("E2E-032 local execution", () => {
  test("the resolved mapping produces the expected target JSON", async ({ page }) => {
    await boot(page);
    await loadSampleAndTwin(page);
    await approve(page);
    await proposeAndRun(page);
    await expect(page.getByTestId("active-mapping-origin")).toContainText("Simulated test adapter — not Gemini · resolved locally");
    const output = page.getByTestId("mapping-output-0");
    await expect(output).toContainText('"id": "CUST-001"');
    await expect(output).toContainText('"email": "alice@example.com"');
    await expect(output).toContainText('"status": "active"');
    await expect(output).toContainText('"createdAt": "2026-01-15"');
    await expect(output).toContainText('"organization": "Example Studio"');
    await expect(page.getByTestId("mapping-output-1")).toContainText('"organization": "North Bridge Co"');
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-032-reality-check.png"), fullPage: true });
  });
});

test.describe("E2E-033 hidden failure", () => {
  test("an unmapped reserved enum produces an actual failure with a safe summary", async ({ page }) => {
    await boot(page);
    await loadSampleAndTwin(page);
    await approve(page);
    await proposeAndRun(page);
    await expect(page.getByTestId("mapping-summary")).toContainText("3 passed · 3 failed · 6 records · batch failed");
    await expect(page.getByTestId("reserved-summary")).toHaveText("3 of 3 failed");
    const hidden = page.getByTestId("mapping-record-3");
    await expect(hidden).toHaveAttribute("data-set", "reserved");
    const safe = page.getByTestId("safe-issues-3");
    await expect(safe).toContainText("UNMAPPED_ENUM · map_enum");
    await expect(safe).toContainText(/f_\d{2}/);
    await expect(safe).not.toContainText("vip_customer");
    await expect(safe).not.toContainText("account_state");
    await expect(page.getByTestId("local-issues-3")).toContainText("vip_customer");
    await expect(page.getByTestId("failure-codes")).toContainText("UNMAPPED_ENUM");
    expect(await cloudProposalEvents(page)).toBe(1);
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-033-hidden-failure.png"), fullPage: true });
  });
});

test.describe("E2E-034 invalid AI proposal", () => {
  async function runWith(page: Page, harness: Record<string, unknown>): Promise<void> {
    await boot(page, harness);
    await loadSampleAndTwin(page);
    await approve(page);
    await page.getByTestId("continue-to-mapping").click();
    await page.getByTestId("send-cloud-request").click();
  }

  test("unsupported operations are refused", async ({ page }) => {
    await runWith(page, { cloudOutput: { operations: [{ op: "eval_js", from: "f_01", to: "id" }], rationale: "x" } });
    await expect(page.getByTestId("cloud-error")).toContainText("INVALID_STRUCTURED_OUTPUT");
    await expect(page.getByTestId("proposal")).toHaveCount(0);
  });

  test("executable content is refused", async ({ page }) => {
    await runWith(page, { cloudOutput: { operations: [{ op: "copy", from: "f_01", to: "id", params: { code: "function () { return 1 }" } }], rationale: "x" } });
    await expect(page.getByTestId("cloud-error")).toContainText(/INVALID_STRUCTURED_OUTPUT|executable/i);
    await expect(page.getByTestId("proposal")).toHaveCount(0);
  });

  test("malformed params and unknown aliases are rejected at the conversion boundary", async ({ page }) => {
    await runWith(page, {
      cloudOutput: {
        operations: [
          { op: "map_enum", from: "f_01", to: "status", params: { map: "active", unmapped: "fail" } },
          { op: "copy", from: "customer_id", to: "id" },
        ],
        rationale: "x",
      },
    });
    await expect(page.getByTestId("proposal-status")).toContainText("Rejected at convert");
    await expect(page.getByTestId("proposal-issues")).toContainText("INVALID_PARAMS");
    await expect(page.getByTestId("proposal-issues")).toContainText("UNKNOWN_ALIAS");
    await expect(page.getByTestId("continue-to-reality")).toHaveCount(0);
  });

  test("malformed JSON is not repaired and local edits are re-validated and labeled", async ({ page }) => {
    await runWith(page, { rawCloudText: '{"operations": [{"op": "copy",' });
    await expect(page.getByTestId("proposal-issues")).toContainText("MALFORMED_PROPOSAL");
    await page.getByText("Edit the proposal locally").click();
    await page.getByTestId("proposal-editor").fill('{"operations":[{"op":"copy","from":"f_01","to":"id","params":{"expr":"x"}}],"rationale":"edit"}');
    await page.getByTestId("validate-edited-proposal").click();
    await expect(page.getByTestId("proposal-origin")).toHaveText("Manually edited locally — not model output");
    await expect(page.getByTestId("proposal-issues")).toContainText("EXECUTABLE_CONTENT");
  });
});

test.describe("E2E-035 offline execution", () => {
  test("twin generation, local mapping, and validation work with AI providers blocked", async ({ page }) => {
    const providerRequests = attachProviderWatch(page);
    const blocked: string[] = [];
    await page.route("**/*", async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host.includes("googleapis.com") || host.includes("firebase") || host.includes("google.com") || host.includes("gstatic.com")) {
        blocked.push(host);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await boot(page);
    await loadSampleAndTwin(page);
    await approve(page);
    await proposeAndRun(page);
    await expect(page.getByTestId("mapping-output-0")).toContainText("alice@example.com");
    await expect(page.getByTestId("safe-issues-3")).toContainText("UNMAPPED_ENUM");
    expect(providerRequests).toEqual([]);
    expect(blocked).toEqual([]);
  });
});

test.describe("E2E-036 UX regression", () => {
  test("keyboard navigation, responsive layout, and no browser errors across the journey", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await boot(page);
    await page.getByTestId("load-crm-sample").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("source-profile")).toBeVisible();
    await page.getByTestId("continue-to-twin").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Phantom Twin" })).toBeVisible();
    await page.locator('[data-testid^="disclose-categories-"]').first().focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-testid^="disclose-categories-"]').first()).toBeChecked();
    await page.getByTestId("continue-to-review").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("build-preview").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("approve-disclosure").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-status")).toContainText("Approved");

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of [/Source System/, /Phantom Twin/, /Disclosure Review/, /Cloud Mapping/, /Reality Check/]) {
        await step(page, name);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `horizontal overflow at ${width}px on ${String(name)}`).toBeLessThanOrEqual(8);
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await step(page, /Disclosure Review/);
    await page.screenshot({ path: path.join(sprint3Shots, "e2e-036-mobile-review.png"), fullPage: true });
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
