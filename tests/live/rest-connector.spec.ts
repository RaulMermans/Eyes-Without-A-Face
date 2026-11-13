import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Sprint 13 — real, unmocked read-only REST connector evidence (C2).
 *
 * Reads a public, CORS-enabled HTTPS API that serves fictional records
 * (JSONPlaceholder), then builds up to the approval. It never approves and
 * never calls Gemini. A second case proves a real CORS refusal is reported,
 * not bypassed. Evidence records host, status, counts and timings only.
 *
 *   pnpm exec playwright test -c playwright.live.config.ts tests/live/rest-connector.spec.ts
 */
const PUBLIC_API = "https://jsonplaceholder.typicode.com/users";
const NO_CORS = "https://example.com/";
const evidenceDir = "docs/evidence/sprint-13";

test("LIVE-130 a real public API is read once, read-only, and flows into the same engine", async ({ page }) => {
  const requests: Array<{ method: string; url: string; hasBody: boolean; auth: boolean }> = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://jsonplaceholder.typicode.com")) {
      requests.push({ method: request.method(), url: request.url(), hasBody: request.postData() !== null, auth: "authorization" in request.headers() });
    }
  });
  const responses: number[] = [];
  page.on("response", (response) => {
    if (response.url().startsWith("https://jsonplaceholder.typicode.com")) responses.push(response.status());
  });
  await page.goto("/");
  await page.getByTestId("data-tab-api").click();
  await page.getByTestId("api-url").fill(PUBLIC_API);
  await expect(page.getByTestId("api-target")).toContainText("jsonplaceholder.typicode.com");
  expect(requests).toHaveLength(0);
  const started = Date.now();
  await page.getByTestId("api-connect-button").click();
  await expect(page.getByTestId("source-summary")).toBeVisible({ timeout: 20_000 });
  const elapsedMs = Date.now() - started;
  const records = Number(await page.getByTestId("source-record-count").innerText());
  const fields = Number(await page.getByTestId("source-field-count").innerText());
  await expect(page.getByTestId("source-format")).toContainText("Connected API");
  await expect(page.getByTestId("source-locality")).toContainText("Read from jsonplaceholder.typicode.com");
  expect(records).toBeGreaterThan(0);
  expect(requests.length).toBeGreaterThanOrEqual(1);
  for (const request of requests) {
    expect(request.method === "GET" || request.method === "OPTIONS").toBe(true);
    expect(request.hasBody).toBe(false);
  }
  await page.screenshot({ path: path.join("test-results/sprint-13-screenshots", "live-connector.png"), fullPage: true });

  // Same engine: profile → twin → disclosure, stopping at the approval.
  await page.getByTestId("data-continue").click();
  await page.getByTestId("destination-custom").check();
  await page.getByTestId("destination-sample").locator("summary").click();
  await page.getByTestId("destination-sample-text").fill('{"contactId": "U-1", "email": "a@example.com", "company": "Example"}');
  await page.getByTestId("destination-draft").click();
  await page.getByTestId("guided-build").click();
  await expect(page.getByTestId("approval-card")).toBeVisible();
  await page.getByTestId("approval-exact").locator("summary").click();
  const prompt = await page.getByTestId("approval-prompt").innerText();
  // Real values and real field names from the API are not in the request.
  expect(prompt).not.toContain("Sincere@april.biz");
  expect(prompt).not.toContain("Leanne Graham");
  expect(prompt).not.toContain('"username"');

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    path.join(evidenceDir, "connector-live.json"),
    `${JSON.stringify(
      {
        test: "LIVE-130",
        at: new Date().toISOString(),
        host: "jsonplaceholder.typicode.com",
        mocked: false,
        methods: [...new Set(requests.map((request) => request.method))],
        anyRequestBody: requests.some((request) => request.hasBody),
        anyAuthorizationHeader: requests.some((request) => request.auth),
        responseStatuses: responses,
        records,
        fields,
        elapsedMs,
        stoppedAt: "approval (nothing approved, nothing sent to Gemini)",
        promptContainsSourceValues: false,
      },
      null,
      2,
    )}\n`,
  );
});

test("LIVE-131 a real CORS refusal is reported and not bypassed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("data-tab-api").click();
  await page.getByTestId("api-url").fill(NO_CORS);
  await page.getByTestId("api-connect-button").click();
  await expect(page.getByTestId("source-problem")).toContainText("CORS", { timeout: 20_000 });
  await expect(page.getByTestId("source-summary")).toHaveCount(0);
});
