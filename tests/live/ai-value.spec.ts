import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures.ts";

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
const evidencePath = process.env.EYES_LIVE_EVIDENCE ?? "docs/evidence/sprint-18a/ai-value-live.json";
// Rehearsals may use the dev split (EYES_AI_VALUE_SPLIT=dev); the real run is always the holdout.
const split = process.env.EYES_AI_VALUE_DRY === "1" && process.env.EYES_AI_VALUE_SPLIT === "dev" ? "dev" : "holdout";
const root = `tests/fixtures/ai-value-18a/${split}`;
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

/** Terms that must never appear in a request body: coded source keys and longer private values. */
function privateTerms(scenario: HoldoutScenario): string[] {
  const destinationWords = new Set<string>();
  const visitSchema = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
        destinationWords.add(key.toLowerCase());
        visitSchema(child);
      }
    }
    if (Array.isArray(record.enum)) for (const value of record.enum) if (typeof value === "string") destinationWords.add(value.toLowerCase());
  };
  visitSchema(scenario.destination);
  const terms = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (key && (/[_0-9]/.test(key) || /[a-z][A-Z]/.test(key)) && !destinationWords.has(key.toLowerCase())) terms.add(key);
    if (typeof value === "string" && value.trim().length >= 6 && !destinationWords.has(value.trim().toLowerCase())) terms.add(value.trim());
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k);
  };
  for (const record of scenario.records) visit(record);
  return [...terms];
}

test.describe("S18A-LIVE G0/G1 holdout run", () => {
  test.beforeAll(() => {
    expect(["G0", "G1"]).toContain(config);
    expect([1, 2]).toContain(trial);
    expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(files.length).toBe(split === "dev" ? 6 : 10);
  });

  for (let index = 0; index < (split === "dev" ? 6 : 10); index += 1) {
    test(`holdout #${String(index + 1).padStart(2, "0")}`, async ({ page }) => {
      const scenario = JSON.parse(fs.readFileSync(path.join(root, files[index]!), "utf8")) as HoldoutScenario;
      const terms = privateTerms(scenario);
      const entry: Record<string, unknown> = { config, trial, index, at: new Date().toISOString() };
      const net = { requests: 0, leakCount: 0, promptSha256: [] as string[], answers: [] as string[], httpStatus: [] as number[] };
      page.on("request", (request) => {
        if (!request.url().includes("generateContent")) return;
        net.requests += 1;
        const body = request.postData() ?? "";
        net.leakCount += terms.filter((term) => body.includes(term)).length;
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
