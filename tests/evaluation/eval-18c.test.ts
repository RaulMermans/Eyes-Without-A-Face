/**
 * Sprint 18C frozen scorer (docs/evaluation/sprint-18c-reliability.md).
 *
 * EVAL-200  the Sprint 18C evaluation set and pre-registration match the freeze (when frozen)
 * EVAL-201  prompt reconstruction: P0 (labelCategories false) and P1 (this app's preview)
 * EVAL-202  a perfect plan: complete, every record as expected, nothing falsely verified
 * EVAL-203  a confident wrong category match is counted as incorrect records, never as success
 * EVAL-204  provider failure, then one approved recovery request
 * EVAL-205  the oracle answers a missing required source through "Choose another field"
 * EVAL-206  the pre-registered verdict
 * EVAL-207  the author's expected samples agree with the engine run of the ground truth (dev)
 * EVAL-208  holdout rehearsal, counts only (EYES_EVAL_18C_REHEARSE=1)
 * EVAL-209  live holdout scoring, aggregates + per-index rows (EYES_EVAL_18C_LIVE=1)
 *
 * Mechanics (201–206) run on the readable Sprint 18B dev split. Only 208/209 read
 * the 18C holdout, and only when run by scripts/eval-18c.mjs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Eval18bScenario, Built18b } from "../../src/evaluation/eval-18b.ts";
import {
  buildScenario18c,
  indexRow18c,
  isProviderFailure,
  prescanPrivacy,
  proveReconstruction18c,
  sampleMismatches,
  scorePlan18c,
  scoreScenarioTrial18c,
  summarize18c,
  verdict18c,
  type Eval18cScenario,
  type LiveEntry18c,
  type Summary18c,
} from "../../src/evaluation/eval-18c.ts";
import type { IntentPlan, IntentPlanEntry } from "../../src/plan/types.ts";

const devRoot = "tests/fixtures/eval-18b/dev";
const root = "tests/fixtures/eval-18c";
const freezePath = "docs/evidence/sprint-18c/reliability-freeze.json";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const list = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => path.join(dir, name))
    : [];
const load = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Eval18cScenario;

describe.runIf(fs.existsSync(freezePath))("EVAL-200 the Sprint 18C evaluation set is frozen", () => {
  const freeze = fs.existsSync(freezePath)
    ? (JSON.parse(fs.readFileSync(freezePath, "utf8")) as { preregistration: { path: string; sha256AboveResults: string }; files: Record<string, string>; holdout: { count: number; sha256: string } })
    : null;
  it.each(Object.entries(freeze?.files ?? {}))("%s matches the freeze manifest", (file, hash) => {
    expect(sha(fs.readFileSync(file))).toBe(hash);
  });
  it("the holdout matches its digest (bytes only)", () => {
    const files = list(path.join(root, "holdout"));
    expect(files.length).toBe(freeze!.holdout.count);
    expect(sha(files.map((file) => sha(fs.readFileSync(file))).join("\n"))).toBe(freeze!.holdout.sha256);
  });
  it("the pre-registration text above § Results is unchanged", () => {
    const text = fs.readFileSync(freeze!.preregistration.path, "utf8");
    expect(sha(text.slice(0, text.indexOf("\n## Results")))).toBe(freeze!.preregistration.sha256AboveResults);
  });
});

const dev = list(devRoot).map(load);
const crm = dev.find((item) => item.scenarioId === "crm-contacts-to-helpdesk-requester")!;
const library = dev.find((item) => item.scenarioId === "public-library-patrons-to-notification-service")!;
const ctx = (config: "P0" | "P1" = "P1") => ({ config, trial: 1, index: 0 });

function perfectPlan(scenario: Eval18bScenario, built: Built18b, swap?: [string, string]): IntentPlan {
  const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
  const fields = Object.entries(scenario.groundTruth).map(([target, g]): IntentPlanEntry => {
    const base = { target, confidence: "high" as const, evidence: ["meaning" as const] };
    const source = swap && g.source === swap[0] ? swap[1] : g.source;
    if (g.transform === "none") return { ...base, status: "no_source", from: [], transform: "none", missing: ["no-matching-source"] };
    if (g.transform === "concat") return { ...base, status: "ready", from: g.sources!.map(alias), transform: "concat", separator: g.separator!, missing: [] };
    if (g.transform === "map_enum") return { ...base, status: "needs_clarification", from: [alias(source!)], transform: "map_enum", missing: ["category-labels"] };
    if (g.transform === "parse_date") return { ...base, status: "needs_clarification", from: [alias(source!)], transform: "parse_date", missing: ["date-order"] };
    return { ...base, status: "ready", from: [alias(source!)], transform: g.transform, missing: [] };
  });
  return { fields, summary: "perfect" };
}

describe("EVAL-201 prompt reconstruction (18B dev)", () => {
  it.each(dev.map((s) => [s.scenarioId, s] as const))("%s: P0 and P1 deterministic; P1 equals the preview; no leak", async (_id, scenario) => {
    expect(await proveReconstruction18c(scenario, "P0")).toBe(true);
    expect(await proveReconstruction18c(scenario, "P1")).toBe(true);
    const p0 = (await buildScenario18c(scenario, "P0"))!;
    const p1 = (await buildScenario18c(scenario, "P1"))!;
    // The corrective changes change what Gemini sees about category fields.
    expect(p0.promptSha256).not.toBe(p1.promptSha256);
    expect(prescanPrivacy(p0, scenario)).toBe(0);
    expect(prescanPrivacy(p1, scenario)).toBe(0);
  });
});

describe("EVAL-202 a perfect plan", () => {
  it.each(dev.filter((s) => s.completable).map((s) => [s.scenarioId, s] as const))("%s: complete, every record as expected, 0 falsely verified", async (_id, scenario) => {
    const built = (await buildScenario18c(scenario, "P1"))!;
    const score = scorePlan18c(scenario, built, JSON.stringify(perfectPlan(scenario, built)), ctx());
    expect(score.correct).toBe(score.targets);
    expect(score.e2eSuccess).toBe(true);
    expect(score.e2e.incorrectTransformed).toBe(0);
    expect(score.e2e.falseVerified).toBe(0);
    expect(score.invented).toBe(0);
    expect(score.effort.manualOps).toBe(0);
  });
  it("a non-completable scenario: correctly incomplete, no false complete", async () => {
    const built = (await buildScenario18c(library, "P1"))!;
    const score = scorePlan18c(library, built, JSON.stringify(perfectPlan(library, built)), ctx());
    expect(score.falseComplete).toBe(false);
    expect(score.e2eSuccess).toBe(false);
  });
});

describe("EVAL-203 a confident wrong category match", () => {
  it("lead source used for the requester type: not a success; every transformed record counted as incorrect", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    const score = scorePlan18c(crm, built, JSON.stringify(perfectPlan(crm, built, ["c_LifecycleStage", "c_LeadSource"])), ctx());
    expect(score.categoryCorrect).toBe(score.categoryTargets - 1);
    expect(score.e2eSuccess).toBe(false);
    // The oracle cannot translate a field that is not the true source, so nothing wrong is transformed.
    expect(score.e2e.incorrectTransformed).toBe(0);
    expect(score.e2e.correctTransformed).toBe(0);
  });
});

describe("EVAL-204 provider failure and one approved recovery request", () => {
  it("500 then 200: two requests, one provider failure, the recovered answer is scored", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    const plan = JSON.stringify(perfectPlan(crm, built));
    const base = { config: "P1" as const, trial: 1, index: 0, requests: 1, leakCount: 0, previewSha256: built.promptSha256, promptSha256: [built.promptSha256], ms: 1000 };
    const attempts: LiveEntry18c[] = [
      { ...base, attempt: 1, httpStatus: [500], answers: ["<unreadable, HTTP 500>"] },
      { ...base, attempt: 2, httpStatus: [200], answers: [plan], usage: [{ prompt: 3000, output: 900 }] },
    ];
    const score = await scoreScenarioTrial18c(attempts, crm);
    expect([score.requests, score.providerFailures, score.promptMatches, score.e2eSuccess]).toEqual([2, 1, true, true]);
    const summary = summarize18c([score]);
    expect([summary.requests, summary.http5xx, summary.R1_providerSuccess, summary.tokens.output]).toEqual([2, 1, 0.5, 900]);
    expect(indexRow18c(score).http).toBe("500,200");
  });
  it("a failure with no recovery is an E1 failure, not a mapping error", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    const score = await scoreScenarioTrial18c(
      [{ config: "P1", trial: 1, index: 0, attempt: 1, requests: 1, leakCount: 0, previewSha256: built.promptSha256, promptSha256: [built.promptSha256], httpStatus: [500], answers: [""], ms: 9 }],
      crm,
    );
    expect([score.providerFailures, score.usable, score.wholePlanRejected, score.e2eSuccess, score.correct]).toEqual([1, false, false, false, 0]);
  });
});

describe("EVAL-205 the oracle answers a missing required source", () => {
  it("a plan that wrongly says no_source for the required id: the oracle picks the true field; success", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    const plan = perfectPlan(crm, built);
    plan.fields = plan.fields.map((entry) => (entry.target === "external_id" ? { ...entry, status: "no_source", from: [], transform: "none", missing: ["no-matching-source"] } : entry));
    const score = scorePlan18c(crm, built, JSON.stringify(plan), ctx());
    expect(score.effort.manualOps).toBe(1);
    expect(score.e2eSuccess).toBe(true);
  });
});

describe("EVAL-206 the pre-registered verdict", () => {
  const good: Summary18c = summarize18c([]);
  const p1: Summary18c = {
    ...good,
    scenarioTrials: 32,
    requests: 33,
    providerFailures: 2,
    R1_providerSuccess: 0.939,
    E1_success: 0.75,
    E1_completable: 24,
    M1_correctAll: 0.7,
    M2_correctMappable: 0.8,
    M3_categoryCorrect: 0.7,
    U1_manualOpsMean: 1,
    U2_allAnswersMean: 5,
    baselineManualOpsMean: 10,
    baselineAllAnswersMean: 13,
  };
  const p0: Summary18c = { ...p1, M1_correctAll: 0.72, M2_correctMappable: 0.84 };
  it("passes only when every bold condition holds", () => {
    expect(verdict18c({ p0, p1, sourceDerivedFindings: 0, expectedScenarioTrials: 64, unauthorizedRequests: 0 }).gateC).toBe(true);
    expect(verdict18c({ p0, p1: { ...p1, E1_success: 0.69 }, sourceDerivedFindings: 0, expectedScenarioTrials: 64, unauthorizedRequests: 0 }).E1).toBe(false);
    expect(verdict18c({ p0, p1: { ...p1, S5_falseVerified: 1 }, sourceDerivedFindings: 0, expectedScenarioTrials: 64, unauthorizedRequests: 0 }).gateC).toBe(false);
    expect(verdict18c({ p0, p1: { ...p1, R1_providerSuccess: 0.89 }, sourceDerivedFindings: 0, expectedScenarioTrials: 64, unauthorizedRequests: 0 }).R1).toBe(false);
    expect(verdict18c({ p0: { ...p0, M2_correctMappable: 0.86 }, p1, sourceDerivedFindings: 0, expectedScenarioTrials: 64, unauthorizedRequests: 0 }).M2).toBe(false);
    expect(verdict18c({ p0, p1, sourceDerivedFindings: 0, expectedScenarioTrials: 63, unauthorizedRequests: 0 }).S2).toBe(false);
  });
});

const dev18c = list(path.join(root, "dev")).map(load);
describe.runIf(dev18c.length > 0)("EVAL-207 the author's samples agree with the engine (18C dev)", () => {
  it.each(dev18c.map((s) => [s.scenarioId, s] as const))("%s", (_id, scenario) => {
    expect(sampleMismatches(scenario)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Holdout: run only through scripts/eval-18c.mjs                      */
/* ------------------------------------------------------------------ */

const holdout = () => list(path.join(root, "holdout")).map(load);

describe.runIf(process.env.EYES_EVAL_18C_REHEARSE === "1")("EVAL-208 holdout rehearsal (counts only)", () => {
  it("every holdout scenario builds for P0 and P1, reconstructs, has 0 leaks and 0 sample mismatches", async () => {
    const rows: string[] = [];
    let failures = 0;
    for (const [index, scenario] of holdout().entries()) {
      const r0 = await proveReconstruction18c(scenario, "P0");
      const r1 = await proveReconstruction18c(scenario, "P1");
      const b0 = await buildScenario18c(scenario, "P0");
      const b1 = await buildScenario18c(scenario, "P1");
      const leaks = (b0 ? prescanPrivacy(b0, scenario) : -1) + (b1 ? prescanPrivacy(b1, scenario) : -1);
      const mismatches = sampleMismatches(scenario);
      if (!r0 || !r1 || leaks !== 0 || mismatches !== 0) failures += 1;
      rows.push(`#${index + 1} completable=${scenario.completable} P0=${r0 ? "ok" : "FAIL"} P1=${r1 ? "ok" : "FAIL"} leaks=${leaks} sampleMismatches=${mismatches}`);
    }
    console.log(rows.join("\n"));
    expect(failures).toBe(0);
  });
});

describe.runIf(process.env.EYES_EVAL_18C_LIVE === "1")("EVAL-209 live holdout scoring", () => {
  it("scores the recorded evidence and writes the summary", async () => {
    const evidence = process.env.EYES_EVAL_18C_EVIDENCE ?? "docs/evidence/sprint-18c/reliability-live.json";
    const entries = JSON.parse(fs.readFileSync(evidence, "utf8")) as LiveEntry18c[];
    const scenarios = holdout();
    const groups = new Map<string, LiveEntry18c[]>();
    for (const entry of entries) groups.set(`${entry.config}|${entry.trial}|${entry.index}`, [...(groups.get(`${entry.config}|${entry.trial}|${entry.index}`) ?? []), entry]);
    const scores = [];
    let unauthorized = 0;
    for (const attempts of groups.values()) {
      const sorted = [...attempts].sort((a, b) => a.attempt - b.attempt);
      // At most one request per attempt; a second attempt only after a provider failure of the first.
      if (sorted.some((item) => item.requests > 1) || sorted.length > 2 || (sorted.length === 2 && !isProviderFailure(sorted[0]!))) unauthorized += 1;
      scores.push(await scoreScenarioTrial18c(sorted, scenarios[sorted[0]!.index]!));
    }
    const p0 = summarize18c(scores.filter((score) => score.config === "P0"));
    const p1 = summarize18c(scores.filter((score) => score.config === "P1"));
    const sourceDerivedFindings = scores.reduce((total, score) => total + score.leakCount, 0);
    const verdict = verdict18c({ p0, p1, sourceDerivedFindings, expectedScenarioTrials: scenarios.length * 4, unauthorizedRequests: unauthorized });
    const out = process.env.EYES_EVAL_18C_SUMMARY ?? "docs/evidence/sprint-18c/reliability-live-summary.json";
    fs.writeFileSync(out, `${JSON.stringify({ p0, p1, verdict, unauthorized, rows: scores.map(indexRow18c) }, null, 2)}\n`);
    console.log(JSON.stringify({ verdict, p0, p1 }, null, 2));
    expect(scores.length).toBeGreaterThan(0);
  });
});
