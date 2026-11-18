/**
 * Sprint 18D scorer mechanics and zero-request rehearsal (DEV splits only).
 *
 * EVAL-300  arm A sends exactly the Sprint 18C P1 prompt (byte-identical)
 * EVAL-301  every arm builds deterministically, with the right disclosure version, and no privacy finding
 * EVAL-302  a ground-truth plan is a complete correct integration under every policy, nothing falsely verified
 * EVAL-303  a confident wrong match yields incorrect records, never success or false verification
 * EVAL-304  a ranked (v6) plan with alternatives validates; ask-on-alternatives asks and the oracle still completes
 *
 * Reads tests/fixtures/eval-18b/dev, eval-18c/dev and eval-18d/dev (when present). Never a holdout.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScenario18c, prescanPrivacy } from "../../src/evaluation/eval-18c.ts";
import type { Built18b } from "../../src/evaluation/eval-18b.ts";
import { ARMS_18D, buildScenario18d, POLICIES_18D, scorePlan18d, type Eval18dScenario } from "../../src/evaluation/eval-18d.ts";
import type { IntentPlan, IntentPlanEntry } from "../../src/plan/types.ts";

const DEV_ROOTS = ["tests/fixtures/eval-18b/dev", "tests/fixtures/eval-18c/dev", "tests/fixtures/eval-18d/dev"];
const dev: Eval18dScenario[] = DEV_ROOTS.flatMap((dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Eval18dScenario)
    : [],
);

function groundTruthPlan(scenario: Eval18dScenario, built: Built18b, options: { swap?: [string, string]; alternatives?: boolean } = {}): IntentPlan {
  const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
  const usable = built.payload.fields.map((field) => field.alias);
  const fields = Object.entries(scenario.groundTruth).map(([target, g]): IntentPlanEntry => {
    const base = { target, confidence: "high" as const, evidence: ["meaning" as const] };
    const source = options.swap && g.source === options.swap[0] ? options.swap[1] : g.source;
    const from = source ? [alias(source)] : [];
    const alternatives = options.alternatives && from.length === 1 ? { alternatives: usable.filter((item) => item !== from[0]).slice(0, 1) } : options.alternatives ? { alternatives: [] } : {};
    if (g.transform === "none") return { ...base, status: "no_source", from: [], ...(options.alternatives ? { alternatives: [] } : {}), transform: "none", missing: ["no-matching-source"] };
    if (g.transform === "concat") return { ...base, status: "ready", from: g.sources!.map(alias), ...(options.alternatives ? { alternatives: [] } : {}), transform: "concat", separator: g.separator!, missing: [] };
    if (g.transform === "map_enum") return { ...base, status: "needs_clarification", from, ...alternatives, transform: "map_enum", missing: ["category-labels"] };
    if (g.transform === "parse_date") return { ...base, status: "needs_clarification", from, ...alternatives, transform: "parse_date", missing: ["date-order"] };
    return { ...base, status: "ready", from, ...alternatives, transform: g.transform, missing: [] };
  });
  return { fields, summary: "ground truth" };
}

describe("EVAL-300 arm A = Sprint 18C P1", () => {
  it.each(dev.map((s) => [s.scenarioId, s] as const))("%s", async (_id, scenario) => {
    const a = await buildScenario18d(scenario, ARMS_18D.A!);
    const p1 = await buildScenario18c(scenario, "P1");
    expect(a && p1).toBeTruthy();
    expect(a!.prompt).toBe(p1!.prompt);
    expect(a!.payload.schemaVersion).toBe("1.1.0");
  });
});

describe("EVAL-301 every arm builds (zero requests)", () => {
  it.each(dev.map((s) => [s.scenarioId, s] as const))("%s", async (_id, scenario) => {
    for (const arm of Object.values(ARMS_18D)) {
      const first = await buildScenario18d(scenario, arm);
      const second = await buildScenario18d(scenario, arm);
      expect(first, arm.id).toBeTruthy();
      expect(first!.promptSha256).toBe(second!.promptSha256);
      expect(first!.payload.schemaVersion).toBe(arm.semantics || arm.model.thinkingLevel ? "1.4.0" : "1.1.0");
      expect(first!.payload.destination.model).toBe(arm.model.model);
      expect(prescanPrivacy(first!, scenario), arm.id).toBe(0);
      const described = Object.values((scenario.destination as { properties?: Record<string, { description?: unknown }> }).properties ?? {}).some((p) => typeof p.description === "string");
      if (arm.semantics && described) expect(first!.payload.target!.fields.some((field) => field.description), arm.id).toBe(true);
      else expect(first!.payload.target!.fields.some((field) => field.description)).toBe(false);
    }
  });
});

describe("EVAL-302 / 303 scorer", () => {
  const completable = dev.filter((s) => s.completable);
  it.each(completable.map((s) => [s.scenarioId, s] as const))("%s: ground-truth plan succeeds under every policy", async (_id, scenario) => {
    const built = (await buildScenario18d(scenario, ARMS_18D.B!))!;
    const text = JSON.stringify(groundTruthPlan(scenario, built));
    for (const policy of Object.values(POLICIES_18D)) {
      const score = scorePlan18d(scenario, built, text, { arm: ARMS_18D.B!, policy, trial: 1, index: 0 });
      expect(score.usable, policy.id).toBe(true);
      expect(score.e2eSuccess, policy.id).toBe(true);
      expect(score.e2e.falseVerified).toBe(0);
      expect(score.gemini.top1).toBe(score.gemini.n);
      expect(score.invented).toBe(0);
    }
  });

  it.each(completable.map((s) => [s.scenarioId, s] as const))("%s: a confident wrong match never succeeds or verifies falsely", async (_id, scenario) => {
    const built = (await buildScenario18d(scenario, ARMS_18D.B!))!;
    const copies = Object.values(scenario.groundTruth).filter((g) => (g.transform === "copy" || g.transform === "trim") && g.source);
    const used = new Set(Object.values(scenario.groundTruth).flatMap((g) => [g.source, ...(g.sources ?? [])]).filter(Boolean));
    const decoy = built.prepared.profile.fields.find((field) => field.supported && !used.has(field.path) && field.type === "string");
    if (copies.length === 0 || !decoy) return;
    const text = JSON.stringify(groundTruthPlan(scenario, built, { swap: [copies[0]!.source!, decoy.path] }));
    const score = scorePlan18d(scenario, built, text, { arm: ARMS_18D.B!, policy: POLICIES_18D.base!, trial: 1, index: 0 });
    expect(score.e2eSuccess).toBe(false);
    expect(score.e2e.falseVerified).toBe(0);
  });
});

describe("EVAL-304 ranked plans", () => {
  const completable = dev.filter((s) => s.completable);
  it.each(completable.map((s) => [s.scenarioId, s] as const))("%s", async (_id, scenario) => {
    const built = (await buildScenario18d(scenario, ARMS_18D.RB!))!;
    expect(built.prompt.startsWith("Task: plan an integration")).toBe(true);
    const text = JSON.stringify(groundTruthPlan(scenario, built, { alternatives: true }));
    const plain = scorePlan18d(scenario, built, text, { arm: ARMS_18D.RB!, policy: POLICIES_18D.rank!, trial: 1, index: 0 });
    const asking = scorePlan18d(scenario, built, text, { arm: ARMS_18D.RB!, policy: POLICIES_18D.alt!, trial: 1, index: 0 });
    expect(plain.usable).toBe(true);
    expect(plain.e2eSuccess).toBe(true);
    expect(asking.e2eSuccess).toBe(true);
    expect(asking.effort.allAnswers).toBeGreaterThanOrEqual(plain.effort.allAnswers);
    expect(asking.effort.offList).toBe(0);
    // A v5 arm reading the same text refuses `alternatives` (plan 1.0.0 is exact).
    expect(scorePlan18d(scenario, built, text, { arm: ARMS_18D.B!, policy: POLICIES_18D.base!, trial: 1, index: 0 }).wholePlanRejected).toBe(true);
  });
});

/* EVAL-305: the frozen inputs. EVAL-306: holdout rehearsal, counts only (EYES_EVAL_18D_REHEARSE=1, scripts/eval-18d.mjs). */
import { createHash } from "node:crypto";
import { sampleMismatches } from "../../src/evaluation/eval-18c.ts";

const FREEZE = "docs/evidence/sprint-18d/semantic-freeze.json";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

describe("EVAL-305 the Sprint 18D set and pre-registration match the freeze", () => {
  const manifest = JSON.parse(fs.readFileSync(FREEZE, "utf8")) as { files: Record<string, string>; holdout: { count: number; sha256: string }; preregistration: { path: string; sha256AboveResults: string } };
  it("listed files", () => {
    for (const [file, digest] of Object.entries(manifest.files)) expect(sha(fs.readFileSync(file)), file).toBe(digest);
  });
  it("sealed holdout digest (files are hashed, never parsed here)", () => {
    const root = "tests/fixtures/eval-18d";
    const files = [
      ...fs.readdirSync(`${root}/holdout`).filter((name) => name.endsWith(".json")).sort().map((name) => `${root}/holdout/${name}`),
      `${root}/author/specs_holdout_wedge.py`,
      `${root}/author/specs_holdout_general.py`,
    ];
    expect(files.length).toBe(manifest.holdout.count);
    expect(sha(files.map((file) => sha(fs.readFileSync(file))).join("\n"))).toBe(manifest.holdout.sha256);
  });
  it("pre-registration above Results", () => {
    const text = fs.readFileSync(manifest.preregistration.path, "utf8");
    const cut = text.indexOf("\n## Results");
    expect(sha(cut >= 0 ? text.slice(0, cut) : text)).toBe(manifest.preregistration.sha256AboveResults);
  });
});

describe.runIf(process.env.EYES_EVAL_18D_REHEARSE === "1")("EVAL-306 holdout rehearsal (zero requests, counts only)", () => {
  it("every arm builds every holdout scenario, no privacy finding, author samples agree", async () => {
    const dir = "tests/fixtures/eval-18d/holdout";
    const scenarios = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8")) as Eval18dScenario);
    const counts: Record<string, { built: number; leaks: number; v14: number; described: number }> = {};
    let mismatches = 0;
    for (const scenario of scenarios) mismatches += sampleMismatches(scenario);
    for (const arm of Object.values(ARMS_18D)) {
      const row = { built: 0, leaks: 0, v14: 0, described: 0 };
      for (const scenario of scenarios) {
        const built = await buildScenario18d(scenario, arm);
        if (!built) continue;
        row.built += 1;
        row.leaks += prescanPrivacy(built, scenario);
        if (built.payload.schemaVersion === "1.4.0") row.v14 += 1;
        if (built.payload.target!.fields.some((field) => field.description)) row.described += 1;
      }
      counts[arm.id] = row;
    }
    console.log(JSON.stringify({ scenarios: scenarios.length, sampleMismatches: mismatches, arms: counts }));
    expect(scenarios.length).toBe(20);
    expect(mismatches).toBe(0);
    for (const row of Object.values(counts)) {
      expect(row.built).toBe(20);
      expect(row.leaks).toBe(0);
    }
  });
});
