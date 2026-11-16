import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../live/fixtures.ts";

/**
 * Sprint 16A — genuine Gemini Nano subset on the DEPLOYED build (on-device only, free).
 *
 *   EYES_LIVE_TESTS=1 EYES_LIVE_ON_DEVICE=1 EYES_CHROME_PROFILE="$HOME/.cache/eyes-without-a-face/chrome-nano-profile" \
 *   pnpm exec playwright test -c playwright.qa-16a-nano.config.ts
 *
 * For each case: import the held-out file, run the real on-device interpretation
 * once (user click), record each row (role, validation status, provenance label,
 * duration), apply the suggestions the validator marks applicable (the user's
 * choice), then record EYES' destination suggestions to compare with the
 * deterministic production run. Zero cloud requests are allowed. A missing model
 * is recorded as UNAVAILABLE, never as a pass, and never replaced by the cloud.
 */
const ROOT = process.env.EYES_QA_ROOT ?? "qa-artifacts/sprint-16a";
const OUT = path.join(ROOT, "runs", "nano");
const CASES = (process.env.EYES_QA_NANO_CASES ?? "S16A-A1,S16A-H2,S16A-C3,S16A-X15").split(",");

for (const id of CASES) {
  test(`NANO ${id}`, async ({ page }) => {
    test.skip(process.env.EYES_LIVE_ON_DEVICE !== "1", "Requires EYES_LIVE_ON_DEVICE=1 and the dedicated Nano profile.");
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "cases", id, "case.json"), "utf8")) as { sourceFile: string; destination: unknown; plan: { fieldMatches: Record<string, string> } };
    const dir = path.join(OUT, id);
    fs.mkdirSync(dir, { recursive: true });
    let cloud = 0;
    const hosts = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.url().includes("generateContent")) cloud += 1;
      if (url.origin !== new URL(page.url() || "https://x.invalid").origin) hosts.add(url.host);
    });
    const entry: Record<string, unknown> = { id, at: new Date().toISOString() };
    try {
      await page.goto("/");
      entry.served = await page.getByTestId("build-revision").innerText();
      entry.browser = page.context().browser()?.version() ?? "persistent-context";
      await page.getByTestId("source-file-input").setInputFiles(path.join(ROOT, c.sourceFile));
      await expect(page.getByTestId("source-summary")).toBeVisible({ timeout: 30_000 });
      const available = page.getByTestId("guided-understanding");
      const unavailable = page.getByTestId("guided-on-device-unavailable");
      await expect(available.or(unavailable).first()).toBeVisible({ timeout: 30_000 });
      if (!(await available.isVisible())) {
        entry.availability = "UNAVAILABLE";
        return;
      }
      entry.availability = "AVAILABLE";
      await available.locator("summary").first().click();
      const started = Date.now();
      await page.getByTestId("interpret-private-on-device").click();
      await expect(page.getByTestId("data-continue")).toBeEnabled({ timeout: 240_000 });
      entry.nanoMs = Date.now() - started;
      entry.error = (await page.getByTestId("private-semantics-error").count()) > 0 ? (await page.getByTestId("private-semantics-error").innerText()).slice(0, 200) : null;
      entry.rows = await page.locator('[data-testid^="private-semantics-row-"]').evaluateAll((nodes) =>
        nodes.map((node) => {
          const tokens = [...node.querySelectorAll("span")].map((span) => span.textContent ?? "");
          const text = node.textContent ?? "";
          return { alias: node.getAttribute("data-testid")!.replace("private-semantics-row-", ""), status: node.getAttribute("data-status"), path: tokens[1] ?? null, provenance: /Gemini Nano \(real on-device\)/.test(text) ? "real-on-device" : /Simulated/.test(text) ? "SIMULATED" : "unknown", role: /:\s*([A-Za-z /-]+?)(?: · |$)/.exec(text.replace(/\s+/g, " "))?.[1] ?? null };
        }),
      );
      const apply = page.locator('[data-testid^="apply-semantics-"]');
      entry.applicable = await apply.count();
      for (let i = 0; i < (entry.applicable as number); i += 1) {
        const button = apply.nth(0);
        if (await button.isEnabled()) await button.click();
        else break;
      }
      await page.screenshot({ path: path.join(dir, "nano-rows.png"), fullPage: true });
      await page.getByTestId("data-continue").click();
      await page.getByTestId("destination-custom").click();
      await page.getByTestId("destination-text").fill(JSON.stringify(c.destination, null, 2));
      await page.getByTestId("destination-apply").click();
      const disclosure = page.getByTestId("field-matches-disclosure");
      await expect(disclosure).toBeVisible({ timeout: 15_000 });
      if (!(await page.getByTestId("field-matches").isVisible())) await disclosure.locator("summary").first().click();
      const suggestions: Record<string, string> = {};
      for (const target of Object.keys(c.plan.fieldMatches)) suggestions[target] = await page.getByTestId(`field-match-${target}`).inputValue();
      entry.suggestionsAfterNano = suggestions;
    } finally {
      entry.cloudRequests = cloud;
      entry.crossOriginHosts = [...hosts];
      fs.writeFileSync(path.join(dir, "nano.json"), `${JSON.stringify(entry, null, 2)}\n`);
    }
    expect(cloud, "on-device interpretation must send nothing to the cloud").toBe(0);
  });
}
