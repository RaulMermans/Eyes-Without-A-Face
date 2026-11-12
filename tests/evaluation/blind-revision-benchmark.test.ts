import { describe, expect, it } from "vitest";
import { EVALUATION_SCENARIOS, scenarioById, validateScenario } from "../../src/evaluation/scenarios.ts";
import { runScenarioPipeline, type ScenarioRun } from "../../src/evaluation/benchmark.ts";
import { deriveTestProposal, deriveTestRevision } from "../../src/inference/test-proposer.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { handWrittenInitial, prepareScenario } from "./helpers.ts";

const deterministic = (payload: Parameters<typeof deriveTestProposal>[0]) => ({ text: JSON.stringify(deriveTestProposal(payload)), origin: "test-adapter" as const });
const reviser = (payload: Parameters<typeof deriveTestRevision>[0]) => ({ text: JSON.stringify(deriveTestRevision(payload)), origin: "test-adapter" as const });

async function handWrittenRun(id: string, config: "C-nano-cloud" | "D-nano-cloud-revision"): Promise<ScenarioRun> {
  const scenario = scenarioById(id)!;
  const { alias } = prepareScenario(scenario);
  return runScenarioPipeline({
    scenario,
    config,
    seed: DEFAULT_TWIN_SEED,
    propose: () => ({ text: JSON.stringify(handWrittenInitial(id, alias)), origin: "manual-edit" }),
    revise: reviser,
  });
}

describe("EVAL-001 scenarios", () => {
  it.each(EVALUATION_SCENARIOS.map((s) => [s.scenarioId, s] as const))("%s is valid, fictional, and has disjoint case sets", (_id, scenario) => {
    expect(validateScenario(scenario)).toEqual([]);
    expect(scenario.canaries).toContain("PRIVATE_CANARY_PII_DO_NOT_SHARE");
    expect(JSON.stringify(scenario.imported)).toContain("PRIVATE_CANARY_PII_DO_NOT_SHARE");
  });
});

describe("EVAL-002 configuration A (deterministic baseline) is reproducible", () => {
  it.each(EVALUATION_SCENARIOS.map((s) => [s.scenarioId, s] as const))("%s", async (_id, scenario) => {
    const a = await runScenarioPipeline({ scenario, config: "A-deterministic", seed: DEFAULT_TWIN_SEED, propose: deterministic });
    const b = await runScenarioPipeline({ scenario, config: "A-deterministic", seed: DEFAULT_TWIN_SEED, propose: deterministic });
    expect(a.disclosureHash).toBe(b.disclosureHash);
    expect(a.initial.evaluation?.metrics).toEqual(b.initial.evaluation?.metrics);
    expect(a.initial.holdout?.metrics).toEqual(b.initial.holdout?.metrics);
    expect(a.modelCalls).toBe(0);
    expect(a.initialPromptCheck).toMatchObject({ canaryPresent: false, forbiddenKeys: [], privateMatches: 0 });
  });
});

describe("EVAL-003 blind revision machinery measures a genuine gain (hand-written initial, simulated reviser)", () => {
  it("CRM: the date-order finding fixes silently wrong imported dates and holdout dates", async () => {
    const run = await handWrittenRun("crm-eu-accounts", "D-nano-cloud-revision");
    const initial = run.initial.evaluation!.metrics;
    // Imported records pass the engine but are INCORRECT: MM/DD swapped day and month.
    expect(initial.incorrect).toBeGreaterThan(0);
    expect(run.feedback).toMatchObject({ ok: true });
    const changed = run.operationChanges!.filter((item) => item.change === "changed").map((item) => item.to).sort();
    expect(changed).toEqual(["createdAt", "status"]);
    const holdout = run.holdoutComparison!;
    expect(holdout.after.correctlyHandled!).toBeGreaterThan(holdout.before.correctlyHandled!);
    expect(holdout.regressed).toBe(0);
    expect(run.revised!.holdout!.metrics.incorrect).toBe(0);
    expect(run.modelCalls).toBe(2);
    expect(run.approvals).toBe(2);
    expect(run.revisionPromptCheck).toMatchObject({ canaryPresent: false, forbiddenKeys: [], privateMatches: 0 });
  });

  it("support: an undisclosed priority is never guessed; quarantine is not counted as a transformation", async () => {
    const run = await handWrittenRun("support-tickets", "D-nano-cloud-revision");
    const after = run.revised!.holdout!.metrics;
    expect(after.rejectedByPolicy).toBe(0);
    expect(after.quarantined).toBeGreaterThan(0);
    expect(after.correctTransformations!).toBeLessThan(after.correctlyHandled!);
    expect(run.finalState).not.toBe("VERIFIED");
  });

  it("billing: unresolvable findings stay failures; the run is not VERIFIED", async () => {
    const run = await handWrittenRun("billing-subscriptions", "D-nano-cloud-revision");
    expect(run.revised!.holdout!.metrics.quarantined).toBeGreaterThan(0);
    expect(["VERIFIED_WITH_EXCEPTIONS", "PARTIALLY_VERIFIED"]).toContain(run.finalState);
  });

  it("holdout is evaluated with the same engine for both versions and never feeds the revision", async () => {
    const run = await handWrittenRun("crm-eu-accounts", "D-nano-cloud-revision");
    const scenario = scenarioById("crm-eu-accounts")!;
    expect(run.initial.holdout!.metrics.total).toBe(scenario.holdout.length);
    expect(run.revised!.holdout!.metrics.total).toBe(scenario.holdout.length);
    // Feedback is built from imported + revision-feedback rows only.
    expect(run.initial.evaluation!.report.total).toBe(scenario.imported.length + scenario.revisionFeedback.length);
  });
});
