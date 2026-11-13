/**
 * Sprint 12 Nano-value experiment (docs/evaluation/sprint-12-nano-value.md).
 *
 * EVAL-120 the experiment scenario is valid and its inputs are frozen.
 * EVAL-121 configuration A: what deterministic profiling alone establishes about
 *          the fields whose meaning the experiment asks about (no model).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EVALUATION_SCENARIOS, EXPERIMENT_SCENARIOS, scenarioById, validateScenario } from "../../src/evaluation/scenarios.ts";
import { prepareScenario } from "./helpers.ts";

const freezePath = "docs/evidence/sprint-12/nano-value-freeze.json";
const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8")) as {
  files: Record<string, string>;
  budget: { maxCloudRequests: number; trials: number[]; retries: string };
  groundTruthSemantics: Record<string, { role: string; dateOrder?: string }>;
};

describe("EVAL-120 the Nano-value scenario is valid and frozen", () => {
  const scenario = scenarioById("crm-nl-relations")!;

  it("is valid, fictional, carries the canary and stays out of the Sprint 8 benchmark set", () => {
    expect(validateScenario(scenario)).toEqual([]);
    expect(JSON.stringify(scenario.imported)).toContain("PRIVATE_CANARY_PII_DO_NOT_SHARE");
    expect(EXPERIMENT_SCENARIOS.map((s) => s.scenarioId)).toEqual(["crm-nl-relations"]);
    expect(EVALUATION_SCENARIOS.map((s) => s.scenarioId)).not.toContain("crm-nl-relations");
  });

  it("every imported date is ambiguous; the hidden sets prove the day-first order", () => {
    const parts = (cases: typeof scenario.imported) => cases.map((c) => String(c.record.sinds).split("/").map(Number));
    expect(parts(scenario.imported).every(([a, b]) => a! <= 12 && b! <= 12)).toBe(true);
    expect(parts([...scenario.revisionFeedback, ...scenario.holdout]).some(([a]) => a! > 12)).toBe(true);
  });

  it.each(Object.entries(freeze.files))("%s matches the freeze manifest", (path, hash) => {
    expect(createHash("sha256").update(fs.readFileSync(path)).digest("hex")).toBe(hash);
  });

  it("declares a modest budget and no retries", () => {
    expect(freeze.budget.maxCloudRequests).toBe(6);
    expect(freeze.budget.trials).toEqual([1, 2, 3]);
    expect(freeze.budget.retries).toMatch(/^none/);
  });
});

describe("EVAL-121 configuration A: deterministic profiling alone", () => {
  it("records the role and date order the deterministic twin assigns, against the frozen ground truth", () => {
    const scenario = scenarioById("crm-nl-relations")!;
    const { prepared } = prepareScenario(scenario);
    const byPath = new Map(prepared.profile.fields.map((field) => [field.path, field]));
    const local = Object.fromEntries(
      prepared.twin.fields.map((field) => {
        const profile = byPath.get(field.localPath)!;
        return [field.localPath, { role: field.role, dateFormat: profile.dateFormat ?? null, dateOrderProven: profile.dateFormat ? !profile.dateFormatAmbiguous : null, descriptor: field.descriptor }];
      }),
    );
    // The deterministic result, pinned. H1 is about exactly these three fields.
    expect(local.bedrijf?.role).toBe("text");
    expect(local.contactpersoon?.role).toBe("text");
    expect(local.bedrijf?.descriptor).toBe(local.contactpersoon?.descriptor);
    expect(local.sinds).toMatchObject({ role: "date", dateFormat: "MM/DD/YYYY", dateOrderProven: false });
    const truth = freeze.groundTruthSemantics;
    const roleMatches = Object.entries(local).filter(([path, v]) => truth[path]?.role === v.role).map(([path]) => path).sort();
    expect(roleMatches).toEqual(["fase", "mailadres", "relatienr", "sinds"]);
  });
});
