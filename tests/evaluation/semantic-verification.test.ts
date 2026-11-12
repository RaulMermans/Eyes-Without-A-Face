/**
 * Sprint 8 Workstream A: semantic verification.
 *
 * SEM-001 reproduces the Sprint 7 limitation with the RECORDED real Gemini
 * outputs (run 3): the CRM and support mappings pass the Mapping Contract,
 * alias resolution and the destination schema, yet are wrong.
 * SEM-002…008 prove the semantic verifier detects these errors from trusted
 * evidence only, reports ambiguity and missing evidence explicitly, and never
 * consults ground truth.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import run3 from "../../docs/evidence/sprint-7/live-blind-revision-run3.json" with { type: "json" };
import { runScenarioPipeline } from "../../src/evaluation/benchmark.ts";
import { scenarioById, type EvaluationScenario } from "../../src/evaluation/scenarios.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { acceptProposal, buildDisclosureDraft, prepareTwin } from "../../src/workflow/pipeline.ts";
import { buildSemanticContract, observeDateOrder } from "../../src/semantics/observe.ts";
import { validateSemanticContract, type SemanticVerificationContract } from "../../src/semantics/contract.ts";
import { verifySemantics } from "../../src/semantics/verify.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import type { MappingContract } from "../../src/domain/contracts/types.ts";

interface Entry {
  check: string;
  scenarioId: string;
  initial: { text: string; origin: string };
}
const recorded = (run3 as unknown as { entries: Entry[] }).entries;
const geminiB = (id: string) => recorded.find((entry) => entry.check === "BENCH-B" && entry.scenarioId === id)!.initial.text;

async function semanticRun(scenarioId: string, text: string, scenario: EvaluationScenario = scenarioById(scenarioId)!) {
  return runScenarioPipeline({
    scenario,
    config: "B-cloud",
    seed: DEFAULT_TWIN_SEED,
    propose: () => ({ text, origin: "gemini-cloud" }),
    semantic: { authorizeConstraints: false },
  });
}

describe("SEM-001 failure analysis: Sprint 7 real Gemini mappings are schema-valid but wrong", () => {
  it.each(["crm-eu-accounts", "support-tickets"])("%s passes every structural check and still fails ground truth", async (id) => {
    const run = await semanticRun(id, geminiB(id));
    const evaluation = run.initial.evaluation!;
    // Structural layers: contract, destination schema, output schema of every produced record.
    expect(run.initial.accepted).toBe(true);
    expect(evaluation.report.statuses.mappingContract).toBe("pass");
    expect(evaluation.report.statuses.targetSchema).toBe("pass");
    const produced = evaluation.rows.filter((row) => row.outcome === "INCORRECT_TRANSFORMATION");
    expect(produced.length).toBeGreaterThan(0);
    expect(produced.every((row) => !row.outputSchemaViolation && row.codes.length === 0)).toBe(true);
  });

  it("explains why: nothing structural encodes day/month order or priority rank", () => {
    const crm = JSON.parse(geminiB("crm-eu-accounts")) as MappingContract;
    const support = JSON.parse(geminiB("support-tickets")) as MappingContract;
    const date = crm.operations.find((operation) => operation.op === "parse_date");
    const priority = support.operations.find((operation) => operation.to === "priority");
    // MM/DD/YYYY and DD/MM/YYYY are both allowed formats; a date with both parts ≤ 12 parses either way.
    expect(date).toMatchObject({ params: { inputFormat: "MM/DD/YYYY" } });
    // Every value is a destination enum member, so JSON Schema accepts the reversed scale.
    expect(priority).toMatchObject({ params: { map: { p1: "low", p4: "urgent" } } });
  });
});

describe("SEM-002 date interpretation from a sufficient local observation", () => {
  it("observes day-first order only with a disambiguating value and no conflict", () => {
    expect(observeDateOrder(["03/02/2026", "11/09/2025"]).verdict).toBe("ambiguous");
    expect(observeDateOrder(["03/02/2026", "25/03/2026"])).toMatchObject({ verdict: "day-first", disambiguating: 1, conflicting: 0 });
    expect(observeDateOrder(["25/03/2026", "03/25/2026"]).verdict).toBe("conflicting");
    expect(observeDateOrder(["2026-03-01", 42, null]).verdict).toBe("ambiguous");
  });

  it("detects the real CRM date-order error as SEMANTIC_MISMATCH on the parse_date operation", async () => {
    const run = await semanticRun("crm-eu-accounts", geminiB("crm-eu-accounts"));
    const semantic = run.initial.semantic!;
    const date = semantic.results.find((result) => result.kind === "date-interpretation")!;
    expect(run.semanticContract!.constraints.find((item) => item.kind === "date-interpretation")).toMatchObject({
      trust: "trusted",
      format: "DD/MM/YYYY",
      evidence: { kind: "deterministic-observation" },
    });
    expect(date).toMatchObject({ status: "SEMANTIC_MISMATCH", code: "SEMANTIC_DATE_ORDER_CONFLICT" });
    expect(date.reasons).toEqual(expect.arrayContaining(["STATIC_FORMAT_CONTRADICTS", "OUTPUT_CONTRADICTS_INTERPRETATION"]));
    expect(date.operations).toEqual([4]);
    expect(semantic.overall).toBe("SEMANTIC_MISMATCH");
  });
});

describe("SEM-003 ordered categories", () => {
  it("detects the real reversed priority scale from the user-declared order", async () => {
    const run = await semanticRun("support-tickets", geminiB("support-tickets"));
    const priority = run.initial.semantic!.results.find((result) => result.constraintId === "support-priority-order")!;
    expect(priority).toMatchObject({ status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ORDER_INVERSION", operations: [3] });
    expect(priority.violatingRows.length).toBeGreaterThan(0);
  });

  it("the same engine detects both errors; a correct mapping passes", async () => {
    const corrected = JSON.parse(geminiB("support-tickets")) as { operations: Array<Record<string, unknown>> };
    corrected.operations[2] = { op: "map_enum", from: "f_01", to: "priority", params: { map: { p1: "urgent", p2: "high", p3: "normal", p4: "low" }, unmapped: "fail" } };
    const run = await semanticRun("support-tickets", JSON.stringify(corrected));
    const priority = run.initial.semantic!.results.find((result) => result.constraintId === "support-priority-order")!;
    expect(priority.status).toBe("SEMANTIC_PASS");
    expect(priority.violatingRows).toEqual([]);
  });

  it("reports an undeclared category turned into output as SEMANTIC_POLICY_CONFLICT", async () => {
    // Sprint 7 real billing mapping files unknown plans under "basic".
    const text = recorded.find((entry) => entry.check === "BENCH-B" && entry.scenarioId === "billing-subscriptions")!.initial.text;
    const run = await semanticRun("billing-subscriptions", text);
    const plan = run.initial.semantic!.results.find((result) => result.constraintId === "billing-plan-meaning")!;
    expect(plan.status).toBe("SEMANTIC_PASS");
    const holdout = run.initial.holdoutSemantic!.results.find((result) => result.constraintId === "billing-plan-meaning")!;
    expect(holdout).toMatchObject({ status: "SEMANTIC_POLICY_CONFLICT", code: "SEMANTIC_POLICY_VIOLATION" });
  });
});

describe("SEM-004 insufficient evidence is never a pass", () => {
  it("imported records alone cannot establish the CRM date order: SEMANTIC_AMBIGUOUS", async () => {
    const scenario = scenarioById("crm-eu-accounts")!;
    const records = scenario.imported.map((item) => item.record);
    const prepared = prepareTwin({ records, datasetLabel: scenario.datasetLabel, seed: DEFAULT_TWIN_SEED, overrides: scenario.twinOverrides });
    if (!prepared.ok) throw new Error("twin failed");
    const contract = buildSemanticContract({ contractId: "crm-imported-only", declared: [], profile: prepared.value.profile, records });
    expect(contract.constraints).toEqual([
      expect.objectContaining({ kind: "date-interpretation", trust: "ambiguous", format: null, candidates: ["MM/DD/YYYY", "DD/MM/YYYY"] }),
    ]);
    const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destinationSchema });
    if (!draft.ok) throw new Error("disclosure failed");
    const accepted = acceptProposal({
      proposal: undefined,
      proposalText: geminiB("crm-eu-accounts"),
      disclosure: draft.value.payload,
      twin: prepared.value.twin,
      origin: "gemini-cloud",
      mappingId: "crm-imported-only",
    });
    if (!accepted.ok) throw new Error("proposal rejected");
    const executable = accepted.value.resolved.executable;
    const report = runRealityCheck({ records, reservedRecords: [], mappingContract: executable, targetSchema: scenario.destinationSchema, bindings: null, now: () => 0 });
    const semantic = verifySemantics({ contract, executable, report, records });
    expect(semantic.results.find((result) => result.kind === "date-interpretation")).toMatchObject({ status: "SEMANTIC_AMBIGUOUS", code: "SEMANTIC_AMBIGUOUS_DATE" });
    expect(semantic.overall).not.toBe("SEMANTIC_PASS");
    // The status map_enum has no constraint here: explicit unknown, not pass.
    expect(semantic.fields.find((field) => field.target === "status")?.status).toBe("SEMANTIC_EVIDENCE_MISSING");
    expect(semantic.fields.find((field) => field.target === "id")?.status).toBe("SEMANTIC_UNVERIFIED");
  });

  it("a model suggestion can never be trusted, and an invalid contract verifies nothing", () => {
    const contract: SemanticVerificationContract = {
      contractKind: "semantic-verification",
      semanticContractVersion: "1.0.0",
      contractId: "suggested",
      localOnly: true,
      constraints: [{ id: "nano-date", kind: "date-interpretation", source: "x", format: "DD/MM/YYYY", trust: "trusted", evidence: { kind: "model-suggestion" } }],
    };
    expect(validateSemanticContract(contract).issues.map((issue) => issue.code)).toContain("MODEL_SUGGESTION_TRUSTED");
    const proposed = { ...contract, constraints: [{ ...contract.constraints[0]!, trust: "proposed" as const }] };
    expect(validateSemanticContract(proposed).valid).toBe(true);
    const insufficient = {
      ...contract,
      constraints: [{ ...contract.constraints[0]!, evidence: { kind: "deterministic-observation" as const, observation: { checkedValues: 6, disambiguating: 0, conflicting: 0 } } }],
    };
    expect(validateSemanticContract(insufficient).issues.map((issue) => issue.code)).toContain("OBSERVATION_INSUFFICIENT");
  });

  it("a constraint that contradicts the destination is a SEMANTIC_POLICY_CONFLICT", async () => {
    const scenario = structuredClone(scenarioById("support-tickets")!);
    const order = scenario.semanticSpec.declared.find((item) => item.id === "support-priority-order");
    if (order?.kind !== "ordered-categories") throw new Error("fixture changed");
    order.targetOrder = ["critical", "high", "normal", "low"];
    const run = await semanticRun("support-tickets", geminiB("support-tickets"), scenario);
    expect(run.initial.semantic!.results.find((result) => result.constraintId === "support-priority-order")).toMatchObject({
      status: "SEMANTIC_POLICY_CONFLICT",
      reasons: ["VALUE_NOT_IN_DESTINATION"],
    });
  });
});

describe("SEM-005 no ground-truth leakage into the semantic engine", () => {
  it("verifier results are identical when every expected output is removed or falsified", async () => {
    for (const id of ["crm-eu-accounts", "support-tickets", "billing-subscriptions"]) {
      const text = recorded.find((entry) => entry.check === "BENCH-B" && entry.scenarioId === id)!.initial.text;
      const scenario = scenarioById(id)!;
      const blind = structuredClone(scenario);
      for (const set of [blind.imported, blind.revisionFeedback, blind.development, blind.holdout]) {
        for (const item of set) item.expected = { kind: "quarantine" };
      }
      const a = await semanticRun(id, text, scenario);
      const b = await semanticRun(id, text, blind);
      expect(b.initial.semantic).toEqual(a.initial.semantic);
      expect(b.semanticContract).toEqual(a.semanticContract);
    }
  });

  it("holdout records never contribute to the semantic contract", async () => {
    const scenario = scenarioById("crm-eu-accounts")!;
    const poisoned = structuredClone(scenario);
    // A holdout date proving the OPPOSITE order must not change anything.
    poisoned.holdout[0]!.record.angelegt_am = "01/31/2026";
    const a = await semanticRun("crm-eu-accounts", geminiB("crm-eu-accounts"), scenario);
    const b = await semanticRun("crm-eu-accounts", geminiB("crm-eu-accounts"), poisoned);
    expect(b.semanticContract).toEqual(a.semanticContract);
  });

  it("src/semantics imports no fixture, scenario or evaluation module and names no scenario field", () => {
    const dir = path.resolve("src/semantics");
    const banned = [/examples\//, /evaluation\//, /expected/, /scenario/i, /kundennummer|angelegt_am|prio\b|ticket_ref|sub_id/];
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const pattern of banned) expect(code, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });
});

