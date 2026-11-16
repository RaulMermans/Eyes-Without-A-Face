/**
 * Sprint 18A AI-value experiment (docs/evaluation/sprint-18a-ai-value.md).
 *
 * EVAL-180  the evaluation set and the pre-registration match the freeze
 * EVAL-181  dev split: T0 (pre-18A twin) vs T1 (concept-bearing twin), O1–O5
 * EVAL-182  holdout: aggregates only, and only when EYES_AI_VALUE_HOLDOUT=1
 *           (node scripts/eval-ai-value.mjs). Per-scenario holdout detail is
 *           never computed, printed or written.
 *
 * EYES_AI_VALUE_DETAIL=1 prints dev per-field misses (tuning aid, dev only).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scoreScenario, summarize, type AiValueScenario } from "../../src/evaluation/ai-value.ts";

const root = "tests/fixtures/ai-value-18a";
const freezePath = "docs/evidence/sprint-18a/ai-value-freeze.json";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const list = (dir: string) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(root, dir, name));
const load = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as AiValueScenario;

const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8")) as {
  preregistration: { path: string; sha256AboveResults: string };
  files: Record<string, string>;
  holdout: { count: number; sha256: string };
};

describe("EVAL-180 the AI-value evaluation set is frozen", () => {
  it.each(Object.entries(freeze.files))("%s matches the freeze manifest", (file, hash) => {
    expect(sha(fs.readFileSync(file))).toBe(hash);
  });
  it("the holdout matches its digest (no holdout name or content is read here)", () => {
    const files = list("holdout");
    expect(files.length).toBe(freeze.holdout.count);
    expect(sha(files.map((file) => sha(fs.readFileSync(file))).join("\n"))).toBe(freeze.holdout.sha256);
  });
  it("the pre-registration text above § Results is unchanged", () => {
    const text = fs.readFileSync(freeze.preregistration.path, "utf8");
    expect(sha(text.slice(0, text.indexOf("\n## Results")))).toBe(freeze.preregistration.sha256AboveResults);
  });
});

describe("EVAL-181 dev split: T0 vs T1", () => {
  const scenarios = list("dev").map(load);
  const detail = process.env.EYES_AI_VALUE_DETAIL === "1";
  const t0 = scenarios.map((scenario) => scoreScenario(scenario, false));
  const t1 = scenarios.map((scenario) => scoreScenario(scenario, true, detail));

  it("every dev scenario builds a twin and a disclosure in both configurations", () => {
    expect([...t0, ...t1].filter((item) => !item.ok).map((item) => `${item.scenarioId}:${item.failure}`)).toEqual([]);
  });

  it("T1 meets the pre-registered offline thresholds on dev (O1 ≥ T0+20pp, O2 ≥ T0+30pp, O3 ≥ 0.85, O5 = 0)", () => {
    const a = summarize(t0);
    const b = summarize(t1);
    if (detail) {
      console.log(JSON.stringify({ T0: a, T1: b }, null, 2));
      for (const item of t1) {
        console.log(item.scenarioId, { wrong: item.wrong, missed: item.missed });
      }
    }
    expect(b.O5_privacyFindings).toBe(0);
    expect(a.O5_privacyFindings).toBe(0);
    expect(b.O1_distinguishability).toBeGreaterThanOrEqual(a.O1_distinguishability + 0.2);
    expect(b.O2_confusableSeparation).toBeGreaterThanOrEqual(a.O2_confusableSeparation + 0.3);
    expect(b.O3_conceptPrecision ?? 0).toBeGreaterThanOrEqual(0.85);
  });

  it("T0 reproduces the pre-18A twin: no field states a meaning", () => {
    expect(t0.every((item) => item.conceptsStated === 0)).toBe(true);
  });
});

describe.runIf(process.env.EYES_AI_VALUE_HOLDOUT === "1")("EVAL-182 holdout: aggregates only", () => {
  it("writes the offline holdout summary", () => {
    const scenarios = list("holdout").map(load);
    const summary = {
      experiment: "sprint-18a-ai-value",
      split: "holdout",
      holdoutDigest: freeze.holdout.sha256,
      implementation: Object.fromEntries(
        ["src/phantom/concepts.ts", "src/phantom/generate.ts", "src/phantom/roles.ts", "src/evaluation/ai-value.ts"].map((file) => [file, sha(fs.readFileSync(file))]),
      ),
      T0: summarize(scenarios.map((scenario) => scoreScenario(scenario, false))),
      T1: summarize(scenarios.map((scenario) => scoreScenario(scenario, true))),
    };
    fs.writeFileSync("docs/evidence/sprint-18a/ai-value-offline-holdout.json", `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  });
});

/**
 * EVAL-183 live run (G0 vs G1). The offline reconstruction must reproduce the
 * exact previewed prompt: pinned here on dev (hashes recorded by the zero-
 * request rehearsal of tests/live/ai-value.spec.ts). Scoring of the holdout run
 * writes aggregates when EYES_WRITE_AI_VALUE_LIVE=1, otherwise replays them.
 */
describe("EVAL-183 live AI-value run", () => {
  it("the offline reconstruction reproduces the prompts the two apps previewed (dev, rehearsal)", async () => {
    const { reconstruct, promptSha256 } = await import("../../src/evaluation/ai-value-live.ts");
    const first = load(list("dev")[0]!);
    expect((await promptSha256((await reconstruct(first, false))!)).slice(0, 16)).toBe("41949fad70703962");
    expect((await promptSha256((await reconstruct(first, true))!)).slice(0, 16)).toBe("9a53440131d7a4dd");
  });
});

const livePath = "docs/evidence/sprint-18a/ai-value-live.json";
const liveSummaryPath = "docs/evidence/sprint-18a/ai-value-live-summary.json";

describe.runIf(fs.existsSync(livePath))("EVAL-184 live holdout scoring (G0 vs G1)", () => {
  it("scores the recorded run against the pre-registered live thresholds", async () => {
    const { scoreEntry, summarizeLive, pairedByScenario } = await import("../../src/evaluation/ai-value-live.ts");
    const raw = fs.readFileSync(livePath);
    const entries = JSON.parse(raw.toString("utf8")) as import("../../src/evaluation/ai-value-live.ts").LiveEntry[];
    const scenarios = list("holdout").map(load);
    const scores = [];
    for (const entry of entries) scores.push(await scoreEntry(entry, scenarios[entry.index]!));
    const g0 = summarizeLive(scores.filter((score) => score.config === "G0"));
    const g1 = summarizeLive(scores.filter((score) => score.config === "G1"));
    const paired = pairedByScenario(scores);
    const comparable = paired.filter((row) => row.g0 !== null && row.g1 !== null);
    const notWorse = comparable.filter((row) => (row.g1 as number) >= (row.g0 as number)).length;
    const verdict = {
      L1: g1.L1_correctCorrespondences >= g0.L1_correctCorrespondences + 0.1,
      notWorseScenarios: `${notWorse}/${comparable.length}`,
      notWorse: notWorse >= 7,
      L2: g1.L2_validProposals >= g0.L2_validProposals,
      L3: g1.L3_hallucinatedReferences <= g0.L3_hallucinatedReferences,
      privacy: g0.leaks + g1.leaks === 0,
      promptsProven: g0.promptMismatches + g1.promptMismatches === 0,
    };
    const summary = {
      experiment: "sprint-18a-ai-value",
      split: "holdout",
      evidenceSha256: createHash("sha256").update(raw).digest("hex"),
      G0: g0,
      G1: g1,
      // Per-scenario rows are by index only, never by name.
      pairedL1ByScenarioIndex: paired,
      verdict: { ...verdict, livePass: verdict.L1 && verdict.notWorse && verdict.L2 && verdict.L3 && verdict.privacy && verdict.promptsProven },
    };
    if (process.env.EYES_WRITE_AI_VALUE_LIVE === "1") {
      fs.writeFileSync(liveSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(JSON.stringify(summary, null, 2));
    } else {
      expect(summary).toEqual(JSON.parse(fs.readFileSync(liveSummaryPath, "utf8")));
    }
    expect(verdict.privacy).toBe(true);
    expect(verdict.promptsProven).toBe(true);
  });
});
