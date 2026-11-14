import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.ts";
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/firebase-api.ts";

/**
 * Sprint 14 (A1) — reproduce the guided-flow "Gemini's answer was not a usable
 * mapping" state with REAL Gemini, through the public guided UI on localhost.
 *
 * Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_DIAGNOSIS=1 EYES_LIVE_CLOUD=1 (+ EYES_APPCHECK_DEBUG_TOKEN).
 * Predeclared budget: ONE approved cloud request per example destination
 * (EYES_DIAGNOSIS_DESTINATIONS, default helpdesk,billing,marketing → at most 3).
 * Nothing is retried; a failure is recorded, not re-run.
 *
 * Evidence: the guided status, the alias-level model answer (aliases, the
 * approved destination names and model rationale only — no records), the
 * outbound prompt hash and timings. Never request bodies, never the token.
 * The answers are replayed offline through `acceptProposal` (tests/unit/sprint14-diagnosis.test.ts).
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_GUIDED_DIAGNOSIS === "1" && process.env.EYES_LIVE_CLOUD === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_GUIDED_DIAGNOSIS=1 EYES_LIVE_CLOUD=1.");
test.setTimeout(180_000);

const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "live-evidence/sprint-14/guided-diagnosis.json";
const destinations = (process.env.EYES_DIAGNOSIS_DESTINATIONS ?? "helpdesk,billing,marketing").split(",").filter(Boolean);
const demo = process.env.EYES_DIAGNOSIS_DEMO ?? "json";

function append(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const existing = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
  existing.push(entry);
  fs.writeFileSync(evidencePath, `${JSON.stringify(existing, null, 2)}\n`);
}

for (const destination of destinations) {
  test(`S14-DIAG ${destination}: guided flow, one approved real request`, async ({ page }) => {
    const entry: Record<string, unknown> = { check: "S14-DIAG", destination, demo, at: new Date().toISOString(), model: FIREBASE_AI_LOGIC_API.defaultCloudModel };
    let requests = 0;
    const answers: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("generateContent")) requests += 1;
    });
    page.on("response", async (response) => {
      if (!response.url().includes("generateContent")) return;
      try {
        const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
        const candidate = body.candidates?.[0];
        answers.push(candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "");
        entry.finishReason = candidate?.finishReason ?? null;
        entry.httpStatus = response.status();
      } catch {
        entry.httpStatus = response.status();
      }
    });
    if (debugToken) {
      await page.addInitScript((token) => {
        (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      }, debugToken);
    }
    try {
      await page.goto("/");
      await page.getByTestId(`demo-${demo}`).click();
      await expect(page.getByTestId("source-summary")).toBeVisible();
      await page.getByTestId("data-continue").click();
      await page.getByTestId(`destination-${destination}`).check();
      await page.getByTestId("guided-build").click();
      await expect(page.getByTestId("approval-card")).toBeVisible();
      entry.payloadHash = await page.getByTestId("approval-card").getAttribute("data-payload-hash");
      expect(requests).toBe(0);
      const started = Date.now();
      await page.getByTestId("guided-approve").click();
      await expect(page.getByTestId("guided-status")).not.toHaveAttribute("data-status", /approval|generating|checking|preparing/, { timeout: 90_000 });
      entry.durationMs = Date.now() - started;
      entry.requests = requests;
      entry.guidedStatus = await page.getByTestId("guided-status").getAttribute("data-status");
      entry.guidedLabel = await page.getByTestId("guided-status-label").innerText();
      entry.rejectedPanel = (await page.getByTestId("guided-proposal-rejected").count()) > 0;
      entry.diagnosis = (await page.getByTestId("guided-diagnosis").count()) > 0 ? await page.getByTestId("guided-diagnosis").getAttribute("data-kind") : null;
      entry.outcomeState = (await page.getByTestId("guided-outcome").count()) > 0 ? await page.getByTestId("guided-outcome").getAttribute("data-state") : null;
      entry.origin = (await page.getByTestId("guided-origin").count()) > 0 ? await page.getByTestId("guided-origin").innerText() : null;
      entry.answer = answers[0] ?? null;
      expect(requests).toBe(1);
    } catch (error) {
      entry.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
      entry.requests = requests;
      entry.answer = answers[0] ?? null;
      throw error;
    } finally {
      append(entry);
    }
  });
}
