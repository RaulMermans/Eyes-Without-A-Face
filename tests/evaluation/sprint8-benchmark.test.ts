/**
 * EVAL-081 Sprint 8 benchmark replay. The archived live evidence holds only
 * alias-level real model text and browser-displayed counts. Every number in
 * docs/evidence/sprint-8/benchmark-summary.json is regenerated here by the
 * deterministic pipeline; the browser counts must match the replay.
 *
 * Regenerate after archiving new evidence:
 *   EYES_WRITE_BENCHMARK=1 pnpm vitest run tests/evaluation/sprint8-benchmark.test.ts
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBenchmarkReport, type LiveEntry } from "../../src/evaluation/aggregate.ts";
import { EVALUATION_SCENARIOS } from "../../src/evaluation/scenarios.ts";

const evidencePath = "docs/evidence/sprint-8/live-semantic-benchmark.json";
const summaryPath = "docs/evidence/sprint-8/benchmark-summary.json";
const present = fs.existsSync(evidencePath);

describe.skipIf(!present)("EVAL-081 Sprint 8 benchmark replays deterministically", () => {
  it("regenerates the committed summary from the recorded real outputs", async () => {
    const raw = fs.readFileSync(evidencePath);
    const entries = JSON.parse(raw.toString("utf8")) as LiveEntry[];
    const report = await buildBenchmarkReport(entries, EVALUATION_SCENARIOS, createHash("sha256").update(raw).digest("hex"));
    if (process.env.EYES_WRITE_BENCHMARK === "1") fs.writeFileSync(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
    expect(JSON.parse(fs.readFileSync(summaryPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
    // The browser showed exactly what the evaluator computes.
    expect(report.totals.replayMismatches).toBe(0);
    expect(report.totals.bodyLeaks).toBe(0);
    expect(report.totals.cloudRequests).toBeLessThanOrEqual(60);
    for (const record of report.records) {
      if (record.privacy.promptPrivateMatches !== null) expect(record.privacy.promptPrivateMatches, record.runId).toBe(0);
      if (record.privacy.canaryPresent !== null) expect(record.privacy.canaryPresent, record.runId).toBe(false);
    }
  });
});
