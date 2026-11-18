/**
 * Sprint 18F confirmatory evaluation (docs/evaluation/sprint-18f-confirmatory.md). Frozen with the pre-registration.
 *
 * EVAL-400  the eval-18f set, author files and pre-registration match the freeze (when frozen)
 * EVAL-401  zero-request rehearsal on the sealed holdout, counts only (EYES_EVAL_18F_REHEARSE=1)
 * EVAL-402  live scoring, aggregates and per-index rows only (EYES_EVAL_18F_LIVE=1)
 *
 * Baseline = arm A + policy `base`; candidate = arm RB + policy `local` (ADR 0022). Simulated user: runOracle18d.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ARMS_18D, buildScenario18d, indexRow18d, POLICIES_18D, scorePlan18d, summarize18d, type Eval18dScenario, type Score18d, type Summary18d } from "../../src/evaluation/eval-18d.ts";
import { prescanPrivacy, sampleMismatches } from "../../src/evaluation/eval-18c.ts";

const ROOT = "tests/fixtures/eval-18f";
const FREEZE = "docs/evidence/sprint-18f/freeze.json";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const holdoutFiles = () => (fs.existsSync(`${ROOT}/holdout`) ? fs.readdirSync(`${ROOT}/holdout`).filter((name) => name.endsWith(".json")).sort().map((name) => `${ROOT}/holdout/${name}`) : []);
const loadHoldout = () => holdoutFiles().map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Eval18dScenario);

describe.runIf(fs.existsSync(FREEZE))("EVAL-400 the Sprint 18F set and pre-registration match the freeze", () => {
  type Manifest = { files: Record<string, string>; holdout: { count: number; sha256: string }; preregistration: { path: string; sha256AboveResults: string }; sealed: string[] };
  const read = () => JSON.parse(fs.readFileSync(FREEZE, "utf8")) as Manifest;
  it("listed files and code", () => {
    const manifest = read();
    for (const [file, digest] of Object.entries(manifest.files)) expect(sha(fs.readFileSync(file)), file).toBe(digest);
  });
  it("sealed holdout digest (hashed, never parsed here)", () => {
    const manifest = read();
    const files = [...holdoutFiles(), ...manifest.sealed];
    expect(files.length).toBe(manifest.holdout.count);
    expect(sha(files.map((file) => sha(fs.readFileSync(file))).join("\n"))).toBe(manifest.holdout.sha256);
  });
  it("pre-registration above Results", () => {
    const manifest = read();
    const text = fs.readFileSync(manifest.preregistration.path, "utf8");
    const cut = text.indexOf("\n## Results");
    expect(sha(cut >= 0 ? text.slice(0, cut) : text)).toBe(manifest.preregistration.sha256AboveResults);
  });
});

describe.runIf(process.env.EYES_EVAL_18F_REHEARSE === "1")("EVAL-401 zero-request rehearsal (counts only)", () => {
  it("both configurations build every holdout scenario with no privacy finding; author samples agree", async () => {
    const holdout = loadHoldout();
    let mismatches = 0;
    for (const scenario of holdout) mismatches += sampleMismatches(scenario);
    const counts: Record<string, { built: number; leaks: number }> = {};
    for (const arm of [ARMS_18D.A!, ARMS_18D.RB!]) {
      const row = { built: 0, leaks: 0 };
      for (const scenario of holdout) {
        const built = await buildScenario18d(scenario, arm);
        if (!built) continue;
        row.built += 1;
        row.leaks += prescanPrivacy(built, scenario);
      }
      counts[arm.id] = row;
    }
    console.log(JSON.stringify({ scenarios: holdout.length, wedge: holdout.filter((s) => s.track === "wedge").length, completable: holdout.filter((s) => s.completable).length, sampleMismatches: mismatches, counts }));
    expect(holdout.length).toBe(24);
    expect(mismatches).toBe(0);
    for (const row of Object.values(counts)) expect(row).toEqual({ built: 24, leaks: 0 });
  }, 600_000);
});

interface LiveEntry {
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

describe.runIf(process.env.EYES_EVAL_18F_LIVE === "1")("EVAL-402 confirmatory scoring", () => {
  it("baseline A/base vs candidate RB/local; pre-registered gates", async () => {
    const holdout = loadHoldout();
    const entries = JSON.parse(fs.readFileSync("docs/evidence/sprint-18f/live.json", "utf8")) as LiveEntry[];
    const result: Record<string, { all: Summary18d; wedge: Summary18d; general: Summary18d; requests: number; ok: number; leaks: number; mismatches: number; prompt: number; output: number; rows: Array<Record<string, unknown>> }> = {};
    for (const [config, policy] of [["A", POLICIES_18D.base!], ["RB", POLICIES_18D.local!]] as const) {
      const arm = ARMS_18D[config]!;
      const mine = entries.filter((entry) => entry.config === config);
      const scores: Score18d[] = [];
      let mismatches = 0;
      for (let index = 0; index < holdout.length; index += 1) {
        const scenario = holdout[index]!;
        const built = (await buildScenario18d(scenario, arm))!;
        const attempts = mine.filter((entry) => entry.index === index).sort((a, b) => a.attempt - b.attempt);
        for (const attempt of attempts) if (attempt.promptSha256[0] && attempt.promptSha256[0] !== built.promptSha256) mismatches += 1;
        const last = attempts.at(-1);
        const text = last && last.httpStatus.at(-1) === 200 ? (last.answers.at(-1) ?? "") : "";
        scores.push(text ? scorePlan18d(scenario, built, text, { arm, policy, trial: 1, index }) : { ...scorePlan18d(scenario, built, "{}", { arm, policy, trial: 1, index }), answered: false });
      }
      const sum = (pick: (entry: LiveEntry) => number) => mine.reduce((total, entry) => total + pick(entry), 0);
      result[config] = {
        all: summarize18d(scores),
        wedge: summarize18d(scores.filter((score) => score.track === "wedge")),
        general: summarize18d(scores.filter((score) => score.track === "general")),
        requests: sum((entry) => entry.requests),
        ok: sum((entry) => entry.httpStatus.filter((code) => code === 200).length),
        leaks: sum((entry) => entry.leakCount),
        mismatches,
        prompt: sum((entry) => (entry.usage ?? []).reduce((total, usage) => total + usage.prompt, 0)),
        output: sum((entry) => (entry.usage ?? []).reduce((total, usage) => total + usage.output, 0)),
        rows: scores.map(indexRow18d),
      };
    }
    const a = result.A!, c = result.RB!;
    // Gate F1 — improvement (bold rows of the pre-registration).
    const improvement = {
      F1: c.all.e2eRate - a.all.e2eRate >= 0.2,
      F2: c.wedge.e2eRate > a.wedge.e2eRate,
      F3: c.all.falseVerified === 0,
      F4: c.all.falseComplete === 0,
      F5: c.all.invented === 0,
      F6: c.all.incorrectRate < a.all.incorrectRate,
    };
    // Original Milestone 1 / Gate D thresholds (unchanged).
    const milestone = {
      "E1-W": c.wedge.e2eRate >= 0.7,
      "E1-G": c.general.e2eRate >= 0.7,
      E2: c.all.incorrectRate <= 0.05,
      S5: c.all.falseVerified === 0,
      E3: c.all.falseComplete === 0,
      M1: c.all.correspondence >= a.all.correspondence - 0.05,
      M4: c.all.invented === 0,
      M10: c.all.hallucinated <= a.all.hallucinated,
      U1: c.all.manualOpsPerTrial <= 0.5 * c.all.baselineManualOpsPerTrial,
      U2: c.all.answersPerTrial <= 0.6 * c.all.baselineAnswersPerTrial,
      R1: c.requests > 0 && c.ok / c.requests >= 0.9,
      S1: a.leaks + c.leaks === 0,
      S2: a.mismatches + c.mismatches === 0 && entries.filter((entry) => entry.attempt === 1 && entry.requests === 1).length === 48,
      S3: entries.every((entry) => entry.requests <= 1),
    };
    const verdict = {
      improvement: Object.values(improvement).every(Boolean) ? "improvement confirmed" : "improvement not confirmed",
      milestone1: Object.values(milestone).every(Boolean) ? "Milestone 1 accepted" : Object.entries(milestone).every(([key, pass]) => pass || key === "E1-G") ? "narrow-scope success (wedge only)" : "Milestone 1 not met",
    };
    fs.writeFileSync("docs/evidence/sprint-18f/summary.json", `${JSON.stringify({ scoredAt: new Date().toISOString(), improvement, milestone, verdict, result }, null, 2)}\n`);
    console.log(JSON.stringify({ improvement, milestone, verdict, A: { e1: a.all.e2eRate, w: a.wedge.e2eRate, g: a.general.e2eRate }, RB: { e1: c.all.e2eRate, w: c.wedge.e2eRate, g: c.general.e2eRate } }));
    expect(a.leaks + c.leaks).toBe(0);
  }, 900_000);
});
