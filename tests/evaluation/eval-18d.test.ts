/**
 * Sprint 18D scorer mechanics and zero-request rehearsal (DEV splits only).
 *
 * EVAL-300  arm A sends exactly the Sprint 18C P1 prompt (byte-identical)
 * EVAL-301  every arm builds deterministically, with the right disclosure version, and no privacy finding
 * EVAL-302  a ground-truth plan is a complete correct integration under every policy, nothing falsely verified
 * EVAL-303  a confident wrong match yields incorrect records, never success or false verification
 * EVAL-304  a ranked (v6) plan with alternatives validates; with local evidence asking, the oracle still completes
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
    const asking = scorePlan18d(scenario, built, text, { arm: ARMS_18D.RB!, policy: POLICIES_18D.local!, trial: 1, index: 0 });
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

/* EVAL-307: Stage 1 (dev, live) scoring — EYES_EVAL_18D_STAGE1=1. Dev only: the evidence names no holdout. */
import { summarize18d, type Score18d, type Summary18d } from "../../src/evaluation/eval-18d.ts";

interface StageEntry {
  config: string;
  index: number;
  attempt: number;
  requests: number;
  httpStatus: number[];
  answers: string[];
  promptSha256: string[];
  leakCount: number;
  ms: number;
  usage?: Array<{ prompt: number; output: number }>;
}

const PRICE: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};

describe.runIf(process.env.EYES_EVAL_18D_STAGE1 === "1")("EVAL-307 Stage 1 dev scoring", () => {
  it("scores every arm × policy and applies the pre-registered decision rules", async () => {
    const entries = JSON.parse(fs.readFileSync("docs/evidence/sprint-18d/stage1-live.json", "utf8")) as StageEntry[];
    // The last attempt of each (arm, index) decides; every request counts towards R1.
    const final = new Map<string, StageEntry>();
    for (const entry of entries) {
      const key = `${entry.config}:${entry.index}`;
      const previous = final.get(key);
      if (!previous || entry.attempt >= previous.attempt) final.set(key, entry);
    }
    const described = (scenario: Eval18dScenario) => Object.values((scenario.destination as { properties?: Record<string, { description?: unknown }> }).properties ?? {}).some((p) => typeof p.description === "string");
    const out: Record<string, unknown> = {};
    const scoresBy: Record<string, Score18d[]> = {};
    const provider: Record<string, { requests: number; ok: number; http400: number; http5xx: number; ms: number[]; prompt: number; output: number; mismatches: number; leaks: number }> = {};
    for (const arm of Object.values(ARMS_18D)) {
      const p = { requests: 0, ok: 0, http400: 0, http5xx: 0, ms: [] as number[], prompt: 0, output: 0, mismatches: 0, leaks: 0 };
      for (const entry of entries.filter((item) => item.config === arm.id)) {
        p.requests += entry.requests;
        p.leaks += entry.leakCount;
        for (const code of entry.httpStatus) {
          if (code === 200) p.ok += 1;
          if (code === 400) p.http400 += 1;
          if (code >= 500) p.http5xx += 1;
        }
        p.ms.push(entry.ms);
        for (const usage of entry.usage ?? []) {
          p.prompt += usage.prompt;
          p.output += usage.output;
        }
      }
      provider[arm.id] = p;
      for (const policy of Object.values(POLICIES_18D)) scoresBy[`${arm.id}/${policy.id}`] = [];
      for (let index = 0; index < dev.length; index += 1) {
        const scenario = dev[index]!;
        const entry = final.get(`${arm.id}:${index}`);
        if (!entry) continue;
        const built = (await buildScenario18d(scenario, arm))!;
        if (entry.promptSha256[0] && entry.promptSha256[0] !== built.promptSha256) p.mismatches += 1;
        const text = entry.httpStatus.at(-1) === 200 ? (entry.answers.at(-1) ?? "") : "";
        for (const policy of Object.values(POLICIES_18D)) {
          const score = text
            ? scorePlan18d(scenario, built, text, { arm, policy, trial: 1, index })
            : { ...scorePlan18d(scenario, built, "{}", { arm, policy, trial: 1, index }), answered: false };
          scoresBy[`${arm.id}/${policy.id}`]!.push({ ...score, track: described(scenario) ? score.track : score.track });
        }
      }
    }
    const summaries: Record<string, Summary18d & { describedSubset: Summary18d }> = {};
    for (const [key, scores] of Object.entries(scoresBy)) {
      const describedIdx = new Set(dev.map((s, i) => (described(s) ? i : -1)).filter((i) => i >= 0));
      summaries[key] = { ...summarize18d(scores), describedSubset: summarize18d(scores.filter((s) => describedIdx.has(s.index))) };
    }
    const cost = Object.fromEntries(
      Object.values(ARMS_18D).map((arm) => {
        const p = provider[arm.id]!;
        const price = PRICE[arm.model.model]!;
        const usd = (p.prompt * price.input + p.output * price.output) / 1_000_000;
        const sorted = [...p.ms].sort((a, b) => a - b);
        return [arm.id, { usd: Math.round(usd * 10000) / 10000, perRequest: p.requests ? Math.round((usd / p.requests) * 100000) / 100000 : 0, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, promptTokens: p.prompt, outputTokens: p.output }];
      }),
    );

    // Pre-registered decision rules (docs/evaluation/sprint-18d-semantic-intelligence.md, Stage 1).
    const s = (arm: string, policy = "base") => summaries[`${arm}/${policy}`]!;
    const material = (a: Summary18d, b: Summary18d) => b.mappable - a.mappable >= 0.1 || b.e2eSuccess - a.e2eSuccess >= 2;
    const flashBoth = material(s("A"), s("C")) && material(s("B"), s("D"));
    const flashOne = material(s("A"), s("C")) || material(s("B"), s("D"));
    const model = flashBoth ? "gemini-3.8-flash" : "gemini-3.5-flash-lite";
    const ctx = (a: Summary18d, b: Summary18d) => b.correspondence - a.correspondence;
    const ctxPairs = [ctx(s("A").describedSubset, s("B").describedSubset), ctx(s("C").describedSubset, s("D").describedSubset)];
    const semantics = ctxPairs.every((d) => d >= 0) && ctxPairs.some((d) => d >= 0.05) && ctxPairs.every((d) => d > -0.05);
    const flash = model === "gemini-3.8-flash";
    const defaultArm = flash ? (semantics ? "D" : "C") : semantics ? "B" : "A";
    const highArm = flash ? "DH" : "BH";
    const thinkingHigh = semantics && material(s(defaultArm), s(highArm)) && cost[highArm]!.perRequest <= 3 * cost[defaultArm]!.perRequest;
    const baseArm = thinkingHigh ? highArm : defaultArm;
    const rankedArm = flash ? "RD" : "RB";
    const bestE1 = (arm: string) => Math.max(...Object.keys(POLICIES_18D).map((policy) => s(arm, policy).e2eSuccess));
    const rankedOk = semantics && !thinkingHigh && s(rankedArm, "rank").geminiTop3 - s(rankedArm, "rank").geminiTop1 >= 0.1 && bestE1(rankedArm) >= bestE1(baseArm);
    const chosenArm = rankedOk ? rankedArm : baseArm;
    const eligible = Object.keys(POLICIES_18D)
      .map((policy) => ({ policy, summary: s(chosenArm, policy) }))
      .filter(({ summary }) => summary.falseVerified === 0 && summary.falseComplete === 0 && summary.answersPerTrial <= 0.6 * summary.baselineAnswersPerTrial);
    eligible.sort((a, b) => b.summary.e2eSuccess - a.summary.e2eSuccess || a.summary.answersPerTrial - b.summary.answersPerTrial);
    const decision = { flashMaterialInBothPairs: flashBoth, flashMaterialInOnePair: flashOne, model, contextDeltas: ctxPairs, semantics, thinkingHigh, rankedOk, chosenArm, chosenPolicy: eligible[0]?.policy ?? null };

    Object.assign(out, { scoredAt: new Date().toISOString(), devScenarios: dev.length, provider, cost, summaries, decision });
    fs.writeFileSync("docs/evidence/sprint-18d/stage1-summary.json", `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify({ decision, provider, cost }, null, 1));
    for (const leak of Object.values(provider)) expect(leak.leaks).toBe(0);
  }, 300_000);
});
