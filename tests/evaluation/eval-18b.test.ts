/**
 * Sprint 18B frozen scorer (docs/evaluation/sprint-18b-intent-plan.md).
 *
 * EVAL-190  the evaluation set and the pre-registration match the freeze
 * EVAL-191  prompt reconstruction (dev): P0 = Sprint 3 text, P2 = the prompt this app previews
 * EVAL-192  every metric on hand-built answers (dev)
 * EVAL-193  oracle user loop (dev)
 * EVAL-194  zero-request offline rehearsal with the SIMULATED test planner / proposer (dev)
 * EVAL-195  the pre-registered verdict
 * EVAL-196  holdout rehearsal, counts only (EYES_EVAL_18B_REHEARSE=1, via scripts/eval-18b.mjs --rehearse)
 * EVAL-197  live holdout scoring, aggregates + per-index rows (EYES_EVAL_18B_LIVE=1, via scripts/eval-18b.mjs)
 *
 * Only EVAL-196/197 read the holdout, and only when run by scripts/eval-18b.mjs.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildScenario,
  indexRow,
  prescanPrivacy,
  proveReconstruction,
  rescanEntry18b,
  runOracle,
  scoreAnswer,
  scoreLiveEntry,
  summarize18b,
  verdict18b,
  type Built18b,
  type Eval18bScenario,
  type LiveEntry18b,
} from "../../src/evaluation/eval-18b.ts";
import { deriveTestPlan } from "../../src/inference/test-planner.ts";
import { deriveTestProposal } from "../../src/inference/test-proposer.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import type { IntentPlan, IntentPlanEntry } from "../../src/plan/types.ts";

const root = "tests/fixtures/eval-18b";
const freezePath = "docs/evidence/sprint-18b/intent-plan-freeze.json";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const list = (dir: string) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(root, dir, name));
const load = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Eval18bScenario;
const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8")) as {
  preregistration: { path: string; sha256AboveResults: string };
  files: Record<string, string>;
  holdout: { count: number; sha256: string };
};

describe("EVAL-190 the Sprint 18B evaluation set is frozen", () => {
  it.each(Object.entries(freeze.files))("%s matches the freeze manifest", (file, hash) => {
    expect(sha(fs.readFileSync(file))).toBe(hash);
  });
  it("the holdout matches its digest (bytes are hashed; no name or content is read)", () => {
    const files = list("holdout");
    expect(files.length).toBe(freeze.holdout.count);
    expect(sha(files.map((file) => sha(fs.readFileSync(file))).join("\n"))).toBe(freeze.holdout.sha256);
  });
  it("the pre-registration text above § Results is unchanged", () => {
    const text = fs.readFileSync(freeze.preregistration.path, "utf8");
    expect(sha(text.slice(0, text.indexOf("\n## Results")))).toBe(freeze.preregistration.sha256AboveResults);
  });
});

const dev = list("dev").map(load);
const byId = (id: string) => dev.find((item) => item.scenarioId === id)!;
const crm = byId("crm-contacts-to-helpdesk-requester");
const library = byId("public-library-patrons-to-notification-service");

/** The plan a perfect planner writes: ground-truth correspondences, translations and unproven date orders left to the user. */
function perfectPlan(scenario: Eval18bScenario, built: Built18b): IntentPlan {
  const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
  const fields = Object.entries(scenario.groundTruth).map(([target, g]): IntentPlanEntry => {
    const base = { target, confidence: "high" as const, evidence: ["meaning" as const] };
    if (g.transform === "none") return { ...base, status: "no_source", from: [], transform: "none", missing: ["no-matching-source"] };
    if (g.transform === "concat") return { ...base, status: "ready", from: g.sources!.map(alias), transform: "concat", separator: g.separator!, missing: [] };
    if (g.transform === "map_enum") return { ...base, status: "needs_clarification", from: [alias(g.source!)], transform: "map_enum", missing: ["category-labels"] };
    if (g.transform === "parse_date") {
      const field = built.prepared.profile.fields.find((item) => item.path === g.source)!;
      return field.dateFormatAmbiguous
        ? { ...base, status: "needs_clarification", from: [alias(g.source!)], transform: "parse_date", missing: ["date-order"] }
        : { ...base, status: "ready", from: [alias(g.source!)], transform: "parse_date", inputFormat: g.dateFormat as "DD/MM/YYYY", missing: [] };
    }
    return { ...base, status: "ready", from: [alias(g.source!)], transform: g.transform, missing: [] };
  });
  return { fields, summary: "perfect" };
}

const ctx = (config: "P0" | "P2") => ({ config, trial: 1, index: 0 });

describe("EVAL-191 prompt reconstruction (dev)", () => {
  it.each(dev.map((s) => [s.scenarioId, s] as const))("%s: P0 and P2 rebuild deterministically; P2 equals this app's preview", async (_id, scenario) => {
    expect(await proveReconstruction(scenario, "P0")).toBe(true);
    expect(await proveReconstruction(scenario, "P2")).toBe(true);
    const p0 = (await buildScenario(scenario, "P0"))!;
    const p2 = (await buildScenario(scenario, "P2"))!;
    expect(p0.promptSha256).not.toBe(p2.promptSha256);
    expect(p0.canonicalJson).toBe(p2.canonicalJson);
    expect(prescanPrivacy(p2, scenario)).toBe(0);
    expect(prescanPrivacy(p0, scenario)).toBe(0);
  });
});

describe("EVAL-192 metrics on hand-built answers (dev)", () => {
  it("a perfect plan: every correspondence correct, nothing invented, E1 success, no field choice asked", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const s = scoreAnswer(crm, built, JSON.stringify(perfectPlan(crm, built)), ctx("P2"));
    expect([s.correct, s.targets, s.mappableCorrect, s.mappableTargets, s.categoryCorrect, s.categoryTargets]).toEqual([11, 11, 8, 8, 2, 2]);
    expect([s.mappableNoCorrespondence, s.nullNoCorrespondence, s.invented, s.invalidEnumTranslations, s.hallucinated, s.incorrectUnsupported]).toEqual([0, 1, 0, 0, 0, 0]);
    expect(s.e2eSuccess).toBe(true);
    expect(s.e2e.incorrectTransformed).toBe(0);
    expect(s.e2e.quarantinedCorrect).toBe(4);
    expect(s.effort).toEqual({ manualOps: 0, allAnswers: 2, unnecessary: 0 });
    expect(s.baseline).toEqual({ manualOps: 10, allAnswers: 12 });
  });

  it("an over-abstaining plan: every mappable target unmatched, incomplete, required fields become questions", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const plan: IntentPlan = {
      fields: Object.keys(crm.groundTruth).map((target) => ({ target, status: "no_source", from: [], transform: "none", confidence: "low", evidence: [], missing: ["no-matching-source"] })),
      summary: "abstain",
    };
    const s = scoreAnswer(crm, built, JSON.stringify(plan), ctx("P2"));
    expect([s.correct, s.mappableNoCorrespondence, s.categoryCorrect]).toEqual([1, 8, 0]);
    expect(s.e2e.complete).toBe(false);
    expect(s.e2eSuccess).toBe(false);
    expect(s.effort.manualOps).toBe(4); // missing-required-source for the 4 required fields
  });

  it("an invented-label plan: the translation counts as invalid (M5), the correspondence is kept (M3), nothing executes from it (M4)", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const plan = perfectPlan(crm, built);
    const entry = plan.fields.find((item) => item.target === "requester_type")!;
    Object.assign(entry, { status: "ready", missing: [], valueMap: { Customer: "customer", Lead: "prospect" } });
    const s = scoreAnswer(crm, built, JSON.stringify(plan), ctx("P2"));
    expect(s.invalidEnumTranslations).toBe(1);
    expect(s.categoryCorrect).toBe(2);
    expect(s.invented).toBe(0);
  });

  it("a multi-candidate field-meaning entry is a question: not correct, not abstention", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const plan = perfectPlan(crm, built);
    const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
    Object.assign(plan.fields.find((item) => item.target === "phone")!, { status: "needs_clarification", from: [alias("c_Phone"), alias("c_MobilePhone")], transform: "copy", missing: ["field-meaning"] });
    const s = scoreAnswer(crm, built, JSON.stringify(plan), ctx("P2"));
    expect([s.correct, s.mappableNoCorrespondence]).toEqual([10, 0]);
    expect(s.effort.manualOps).toBe(1);
    expect(s.e2eSuccess).toBe(true); // the oracle picks the ground-truth field
  });

  it("a hallucinated alias and a malformed plan", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const plan = perfectPlan(crm, built);
    plan.fields[0] = { ...plan.fields[0]!, from: ["f_999"] };
    expect(scoreAnswer(crm, built, JSON.stringify(plan), ctx("P2")).hallucinated).toBe(1);
    const malformed = scoreAnswer(crm, built, "not json", ctx("P2"));
    expect([malformed.wholePlanRejected, malformed.usable, malformed.correct]).toEqual([true, false, 0]);
  });

  it("a P0 proposal with defaults: invented values, an invalid translation, refused by the gate", async () => {
    const built = (await buildScenario(crm, "P0"))!;
    const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
    const operations = [
      { op: "copy", from: alias("c_ContactId"), to: "external_id" },
      { op: "concat", from: [alias("c_FirstName"), alias("c_LastName")], to: "name", params: { separator: " " } },
      { op: "normalize_email", from: alias("c_Email"), to: "email" },
      { op: "map_enum", from: alias("c_LifecycleStage"), to: "requester_type", params: { map: { Customer: "customer" }, unmapped: "default", default: "prospect" } },
      { op: "default_if_missing", to: "time_zone", params: { value: "UTC" } },
    ];
    const s = scoreAnswer(crm, built, JSON.stringify({ operations, rationale: "test" }), ctx("P0"));
    expect([s.invented, s.invalidEnumTranslations, s.hallucinated]).toEqual([2, 1, 0]);
    expect(s.correct).toBe(5); // external_id, name (concat set), email, requester_type correspondence, time_zone (from-less default = none)
    // The unchanged gate refuses the undisclosed labels: nothing runs, so E1 fails.
    expect(s.accepted).toBe(false);
    expect([s.e2e.ran, s.e2eSuccess]).toEqual([false, false]);
  });
});

describe("EVAL-193 oracle user (dev)", () => {
  it("answers translations and date orders from the ground truth, never the required field without a source", async () => {
    const built = (await buildScenario(library, "P2"))!;
    const validation = validateIntentPlan(perfectPlan(library, built), built.payload);
    if (!validation.ok) throw new Error("plan invalid");
    const run = runOracle({ validated: validation.value, disclosure: built.payload, prepared: built.prepared, records: library.records, requestId: "oracle-test" }, library);
    const kinds = run.asked.map((item) => item.kind).sort();
    expect(kinds).toContain("missing-required-source");
    expect(run.answered).toBe(run.asked.length - 1);
    expect(run.compiled.complete).toBe(false);
    expect(run.compiled.unwrittenRequired).toEqual(["notification_language"]);
  });

  it("a non-completable scenario with a confident wrong source for the required field is a false complete (E3)", async () => {
    const built = (await buildScenario(library, "P2"))!;
    const plan = perfectPlan(library, built);
    Object.assign(plan.fields.find((item) => item.target === "notification_language")!, {
      status: "ready",
      from: [built.prepared.twin.bindings.aliasForPath("voornaam")!],
      transform: "copy",
      missing: [],
    });
    const s = scoreAnswer(library, built, JSON.stringify(plan), { config: "P2", trial: 1, index: 3 });
    expect(s.falseComplete).toBe(s.e2e.complete);
  });
});

describe("EVAL-194 zero-request offline rehearsal on dev (SIMULATED planner, not Gemini)", () => {
  it("scores the simulated test planner (P2) and test proposer (P0) end to end", async () => {
    const p0 = [];
    const p2 = [];
    for (const [index, scenario] of dev.entries()) {
      const b0 = (await buildScenario(scenario, "P0"))!;
      const b2 = (await buildScenario(scenario, "P2"))!;
      p0.push(scoreAnswer(scenario, b0, JSON.stringify(deriveTestProposal(b0.payload)), { config: "P0", trial: 1, index }));
      p2.push(scoreAnswer(scenario, b2, JSON.stringify(deriveTestPlan(b2.payload)), { config: "P2", trial: 1, index }));
    }
    const summary = { simulated: true, P0: summarize18b(p0), P2: summarize18b(p2) };
    console.log(JSON.stringify(summary, null, 2));
    expect(summary.P2.requests).toBe(4);
    expect(summary.P2.M4_invented).toBe(0);
    expect(summary.P2.E3_falseCompletes).toBe(0);
    expect(summary.P2.M9_rejectionsAndFailures).toBe(0);
  });
});

describe("EVAL-195 pre-registered verdict", () => {
  it("passes only when every bold condition holds", async () => {
    const built = (await buildScenario(crm, "P2"))!;
    const good = summarize18b([scoreAnswer(crm, built, JSON.stringify(perfectPlan(crm, built)), ctx("P2"))]);
    const bad = summarize18b([scoreAnswer(crm, built, "not json", ctx("P2"))]);
    expect(verdict18b({ p0: bad, p2: good, sourceDerivedFindings: 0 }).gateBAI).toBe(true);
    expect(verdict18b({ p0: bad, p2: good, sourceDerivedFindings: 1 }).gateBAI).toBe(false);
    expect(verdict18b({ p0: good, p2: bad, sourceDerivedFindings: 0 }).gateBAI).toBe(false);
    expect(verdict18b({ p0: bad, p2: good, sourceDerivedFindings: 0, expectedRequests: 40 }).S2).toBe(false);
  });
});

describe.runIf(process.env.EYES_EVAL_18B_REHEARSE === "1")("EVAL-196 holdout rehearsal: counts only, zero requests", () => {
  it("builds every holdout scenario for P0 and P2, proves reconstruction, pre-scans privacy", async () => {
    let built = 0;
    let failed = 0;
    let unproven = 0;
    let privacyFindings = 0;
    for (const file of list("holdout")) {
      const scenario = load(file);
      for (const config of ["P0", "P2"] as const) {
        const result = await buildScenario(scenario, config);
        if (!result) {
          failed += 1;
          continue;
        }
        built += 1;
        if (!(await proveReconstruction(scenario, config))) unproven += 1;
        privacyFindings += prescanPrivacy(result, scenario);
      }
    }
    console.log(JSON.stringify({ rehearsal: "holdout", built, failedToBuild: failed, reconstructionUnproven: unproven, privacyPrescanFindings: privacyFindings }));
    expect(failed + unproven + privacyFindings).toBe(0);
  });
});

const livePath = process.env.EYES_EVAL_18B_EVIDENCE ?? "docs/evidence/sprint-18b/intent-plan-live.json"; // path only; scoring unchanged
const liveSummaryPath = "docs/evidence/sprint-18b/intent-plan-live-summary.json";

describe.runIf(process.env.EYES_EVAL_18B_LIVE === "1")("EVAL-197 live holdout scoring (P0 vs P2)", () => {
  it("scores the recorded run and writes aggregates, per-index rows and the gate verdict", async () => {
    const raw = fs.readFileSync(livePath);
    const entries = JSON.parse(raw.toString("utf8")) as LiveEntry18b[];
    const scenarios = list("holdout").map(load);
    const scores = [];
    let sourceDerivedFindings = 0;
    for (const entry of entries) {
      scores.push(await scoreLiveEntry(entry, scenarios[entry.index]!));
      sourceDerivedFindings += (await rescanEntry18b(entry, scenarios[entry.index]!)) ?? 0;
    }
    const p0 = summarize18b(scores.filter((score) => score.config === "P0"));
    const p2 = summarize18b(scores.filter((score) => score.config === "P2"));
    const summary = {
      experiment: "sprint-18b-intent-plan",
      split: "holdout",
      evidenceSha256: sha(raw),
      scorerSha256: sha(fs.readFileSync("src/evaluation/eval-18b.ts")),
      privacyScan: { harnessMatches: p0.harnessLeakMatches + p2.harnessLeakMatches, sourceDerivedFindings },
      provenance: entries.map((entry) => ({ config: entry.config, trial: entry.trial, index: entry.index, origin: entry.origin ?? null, httpStatus: entry.httpStatus })),
      P0: p0,
      P2: p2,
      rows: scores.map(indexRow),
      verdict: verdict18b({ p0, p2, sourceDerivedFindings, expectedRequests: 40 }),
    };
    fs.writeFileSync(liveSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ P0: p0, P2: p2, verdict: summary.verdict }, null, 2));
  });
});
