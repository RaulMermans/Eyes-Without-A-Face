import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures.ts";
import { privateTermsInBody } from "../../src/evaluation/ai-value-live.ts";
import { buildScenario } from "../../src/evaluation/eval-18b.ts";

/**
 * Sprint 18A — live AI-value run, G0 vs G1 (docs/evaluation/sprint-18a-ai-value.md).
 *
 * Owner-approved budget: 10 holdout scenarios × 2 configs × 2 trials = 40
 * cloud requests, no revision, no retries. A provider failure is recorded and
 * not repeated.
 *
 *   G0 = the pre-18A app (main @ 82400dd) served from a separate worktree
 *   G1 = this branch (concept-bearing twin)
 * Same UI path, same seed, same model, same approval gate. No product flag.
 *
 * One invocation = one configuration and one trial over the 10 holdout
 * scenarios:
 *   EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 EYES_LIVE_AI_VALUE=1 \
 *   EYES_AI_VALUE_CONFIG=G0|G1 EYES_AI_VALUE_TRIAL=1|2 EYES_AI_VALUE_BASE_URL=http://127.0.0.1:517x \
 *   EYES_APPCHECK_DEBUG_TOKEN="$(cat …)" pnpm test:live tests/live/ai-value.spec.ts
 *
 * Blindness: scenarios are addressed by index only; titles, logs and evidence
 * carry no scenario id, field name, value or request body. Evidence: the
 * alias-level model text, the SHA-256 of the sent prompt text (to prove which
 * twin was sent), statuses, counts and timings. Scored by EVAL-183.
 */
const enabled = process.env.EYES_LIVE_TESTS === "1" && process.env.EYES_LIVE_CLOUD === "1" && process.env.EYES_LIVE_AI_VALUE === "1";
test.skip(!enabled, "Opt-in: EYES_LIVE_TESTS=1 EYES_LIVE_CLOUD=1 EYES_LIVE_AI_VALUE=1.");
test.setTimeout(150_000);

const config = process.env.EYES_AI_VALUE_CONFIG ?? "";
const trial = Number(process.env.EYES_AI_VALUE_TRIAL ?? "0");
const baseURL = process.env.EYES_AI_VALUE_BASE_URL ?? "";
const debugToken = process.env.EYES_APPCHECK_DEBUG_TOKEN ?? "";
// Sets: 18a (G0/G1, Sprint 18A), a5 (P0/P1, Sprint 18A.5 planner; docs/evaluation/sprint-18a5-planner.md)
// and b (P0/P2, Sprint 18B intent plan; docs/evaluation/sprint-18b-intent-plan.md, scored by scripts/eval-18b.mjs).
const set = process.env.EYES_AI_VALUE_SET === "a5" ? "a5" : process.env.EYES_AI_VALUE_SET === "b" ? "b" : "18a";
const evidencePath =
  process.env.EYES_LIVE_EVIDENCE ??
  (set === "a5" ? "docs/evidence/sprint-18a5/planner-live.json" : set === "b" ? "docs/evidence/sprint-18b/intent-plan-live.json" : "docs/evidence/sprint-18a/ai-value-live.json");
// Rehearsals may use the dev split (EYES_AI_VALUE_SPLIT=dev); the real run is always the holdout.
const split = process.env.EYES_AI_VALUE_DRY === "1" && process.env.EYES_AI_VALUE_SPLIT === "dev" ? "dev" : "holdout";
const root =
  set === "b"
    ? `tests/fixtures/eval-18b/${split}`
    : split === "dev"
      ? "tests/fixtures/ai-value-18a/dev"
      : set === "a5"
        ? "tests/fixtures/ai-value-18a5/holdout"
        : "tests/fixtures/ai-value-18a/holdout";
const scenarioCount = split === "holdout" ? 10 : set === "b" ? 4 : 6;
/** Rehearsal: run everything up to an enabled Send button, send nothing, write no evidence. */
const dryRun = process.env.EYES_AI_VALUE_DRY === "1";

interface HoldoutScenario {
  records: Record<string, unknown>[];
  destination: Record<string, unknown>;
}

const files = fs.existsSync(root)
  ? fs
      .readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .sort()
  : [];

function append(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const existing = fs.existsSync(evidencePath) ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")) as unknown[]) : [];
  existing.push(entry);
  fs.writeFileSync(evidencePath, `${JSON.stringify(existing, null, 2)}\n`);
}

test.describe("S18A-LIVE G0/G1 holdout run", () => {
  test.beforeAll(() => {
    expect(set === "a5" ? ["P0", "P1"] : set === "b" ? ["P0", "P2"] : ["G0", "G1"]).toContain(config);
    expect([1, 2]).toContain(trial);
    expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(files.length).toBe(scenarioCount);
  });

  for (let index = 0; index < scenarioCount; index += 1) {
    test(`holdout #${String(index + 1).padStart(2, "0")}`, async ({ page }) => {
      const scenario = JSON.parse(fs.readFileSync(path.join(root, files[index]!), "utf8")) as HoldoutScenario;
      const entry: Record<string, unknown> = { config, trial, index, at: new Date().toISOString() };
      const net = { requests: 0, leakCount: 0, promptSha256: [] as string[], answers: [] as string[], httpStatus: [] as number[] };
      page.on("request", (request) => {
        if (!request.url().includes("generateContent")) return;
        net.requests += 1;
        const body = request.postData() ?? "";
        // Sprint 18A.5 trace: destination vocabulary is blanked as exact quoted strings before matching.
        net.leakCount += privateTermsInBody(body, scenario).length;
        try {
          const parsed = JSON.parse(body) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
          const text = (parsed.contents ?? []).flatMap((content) => content.parts ?? []).map((part) => part.text ?? "").join("");
          net.promptSha256.push(createHash("sha256").update(text).digest("hex"));
        } catch {
          net.promptSha256.push("<unparseable body>");
        }
      });
      page.on("response", async (response) => {
        if (!response.url().includes("generateContent")) return;
        net.httpStatus.push(response.status());
        try {
          const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          net.answers.push(body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "");
        } catch {
          net.answers.push(`<unreadable, HTTP ${response.status()}>`);
        }
      });
      const started = Date.now();
      let step = "start";
      try {
        if (debugToken) {
          await page.addInitScript((token) => {
            (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = token;
          }, debugToken);
        }
        step = "goto";
        await page.goto(`${baseURL}/#technical`);
        const dir = fs.mkdtempSync(path.join(tmpdir(), "eyes-s18a-"));
        const file = path.join(dir, "records.json");
        fs.writeFileSync(file, JSON.stringify(scenario.records));
        step = "source";
        await page.getByTestId("source-file-input").setInputFiles(file);
        fs.rmSync(dir, { recursive: true, force: true });
        step = "destination";
        await page.getByText("Edit schema JSON").click();
        await page.getByTestId("destination-schema-editor").fill(JSON.stringify(scenario.destination, null, 2));
        await page.getByTestId("validate-destination-schema").click();
        await expect(page.getByTestId("destination-schema-ok")).toBeVisible();
        step = "build";
        await page.getByTestId("build-integration").click();
        await expect(page.getByTestId("observe")).toBeVisible();
        expect(net.requests).toBe(0);
        step = "approve";
        await page.getByTestId("runtime-next-action").click();
        const preview = (await page.getByTestId("review-prompt").textContent()) ?? "";
        entry.previewSha256 = createHash("sha256").update(preview).digest("hex");
        await page.getByTestId("approve-disclosure").click();
        await page.getByTestId("continue-to-mapping").click();
        expect(net.requests).toBe(0);
        if (dryRun) {
          await expect(page.getByTestId("send-cloud-request")).toBeEnabled();
          entry.dry = "ready-to-send";
          // Set b, dev split only: prove the preview equals the scorer's reconstruction (S2) before any live run.
          if (set === "b" && split === "dev") entry.dry += ` reconstruction=${(await buildScenario(scenario, config as "P0" | "P2"))?.promptSha256 === entry.previewSha256 ? "match" : "MISMATCH"}`;
          return;
        }
        step = "send";
        await page.getByTestId("send-cloud-request").click();
        await expect(page.getByTestId("proposal-status").or(page.getByTestId("cloud-error"))).toBeVisible({ timeout: 120_000 });
        entry.proposalStatus = (await page.getByTestId("proposal-status").count()) > 0 ? (await page.getByTestId("proposal-status").innerText()).split("\n")[0] : null;
        entry.cloudError = (await page.getByTestId("cloud-error").count()) > 0;
        entry.origin = (await page.getByTestId("proposal-origin").count()) > 0 ? await page.getByTestId("proposal-origin").innerText() : null;
        entry.provenance = (await page.getByTestId("proposal-provenance").count()) > 0 ? await page.getByTestId("proposal-provenance").innerText() : null;
      } catch (error) {
        entry.harnessError = `${step}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      } finally {
        entry.ms = Date.now() - started;
        entry.requests = net.requests;
        entry.leakCount = net.leakCount;
        entry.promptSha256 = net.promptSha256;
        entry.httpStatus = net.httpStatus;
        entry.answers = net.answers;
        if (dryRun) console.log(`dry ${config} #${index + 1} preview=${String(entry.previewSha256 ?? "").slice(0, 16)}: ${entry.dry ?? `harness error (${String(entry.harnessError ?? "").slice(0, 80)})`}, requests=${net.requests}`);
        else append(entry);
      }
      // Budget and privacy: at most one request per scenario, never a private term.
      expect(net.requests).toBeLessThanOrEqual(1);
      expect(net.leakCount).toBe(0);
    });
  }
});
