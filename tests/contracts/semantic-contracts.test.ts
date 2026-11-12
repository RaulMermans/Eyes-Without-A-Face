/**
 * Sprint 8 contract tests: Semantic Verification Contract 1.0.0, Blind
 * Revision Feedback 1.1.0, cloud disclosure 1.3.0, and the migration rule that
 * keeps Sprint 7 output (feedback 1.0.0 / disclosure 1.2.0) byte-identical
 * when there is no semantic finding.
 */
import { describe, expect, it } from "vitest";
import { EVALUATION_SCENARIOS, scenarioById, validateScenario } from "../../src/evaluation/scenarios.ts";
import { evaluateMapping } from "../../src/evaluation/evaluate.ts";
import { canonicalizeJson } from "../../src/domain/json/canonical.ts";
import { validateContract, validateRevisionFeedbackSchema, validateSemanticContractSchema } from "../../src/domain/validation/validate-contract.ts";
import { SUPPORTED_SCHEMA_VERSIONS } from "../../src/domain/contracts/kinds.ts";
import { buildCloudPromptText, BLIND_REVISION_INSTRUCTIONS, SEMANTIC_REVISION_INSTRUCTIONS, SEMANTIC_REVISION_PROMPT_VERSION } from "../../src/inference/prompts.ts";
import { projectRevisionFeedback } from "../../src/revision/feedback.ts";
import { buildRevisionPayload, isRevisionSchemaVersion } from "../../src/revision/revision-payload.ts";
import { buildSemanticContract } from "../../src/semantics/observe.ts";
import { validateSemanticContract } from "../../src/semantics/contract.ts";
import { verifySemantics } from "../../src/semantics/verify.ts";
import { acceptProposal } from "../../src/workflow/pipeline.ts";
import { handWrittenInitial, prepareScenario } from "../evaluation/helpers.ts";

describe("CON-080 Semantic Verification Contract 1.0.0", () => {
  it("every scenario's declared spec is a valid, trusted, user-declared contract", () => {
    for (const scenario of EVALUATION_SCENARIOS) {
      expect(validateScenario(scenario)).toEqual([]);
      const contract = buildSemanticContract({ contractId: `${scenario.scenarioId}-semantics`, declared: scenario.semanticSpec.declared, profile: null, records: [] });
      expect(validateSemanticContractSchema(contract)).toEqual([]);
      const result = validateSemanticContract(contract, scenario.destinationSchema);
      expect(result.valid).toBe(true);
      expect([...result.conflicts.values()].flat()).toEqual([]);
      for (const constraint of scenario.semanticSpec.declared) expect(constraint).toMatchObject({ trust: "trusted", evidence: { kind: "user-declared" } });
    }
  });

  it("is strict: unknown keys, kinds, trust levels and evidence kinds are rejected", () => {
    const base = { contractKind: "semantic-verification", semanticContractVersion: "1.0.0", contractId: "x", localOnly: true, constraints: [] };
    expect(validateSemanticContractSchema(base)).toEqual([]);
    expect(validateSemanticContractSchema({ ...base, localOnly: false })).not.toEqual([]);
    expect(validateSemanticContractSchema({ ...base, extra: 1 })).not.toEqual([]);
    const date = { id: "d", kind: "date-interpretation", source: "a", format: "DD/MM/YYYY", trust: "trusted", evidence: { kind: "user-declared" } };
    expect(validateSemanticContractSchema({ ...base, constraints: [date] })).toEqual([]);
    for (const bad of [
      { ...date, kind: "regex" },
      { ...date, trust: "certain" },
      { ...date, evidence: { kind: "gut-feeling" } },
      { ...date, evidence: { kind: "user-declared", note: "free text" } },
      { ...date, format: "DD.MM.YYYY" },
      { ...date, rationale: "x" },
    ]) {
      expect(validateSemanticContractSchema({ ...base, constraints: [bad] }), JSON.stringify(bad)).not.toEqual([]);
    }
  });

  it("scenario v2.0.0 keeps four disjoint case sets; the Sprint 7 holdout is development data", () => {
    for (const scenario of EVALUATION_SCENARIOS) {
      expect(scenario.scenarioVersion).toBe("2.0.0");
      expect(scenario.development.length).toBe(6);
      expect(scenario.holdout.length).toBe(10);
      const poisoned = { ...scenario, holdout: [...scenario.holdout, scenario.development[0]!] };
      expect(validateScenario(poisoned)).toContain("A holdout case also appears in another set.");
    }
  });
});

describe("CON-081 Feedback 1.1.0 and disclosure 1.3.0", () => {
  it("1.3.0 is registered, is a revision version, and uses prompt v3; 1.2.0 keeps prompt v2 unchanged", () => {
    expect(SUPPORTED_SCHEMA_VERSIONS["cloud-disclosure"]).toContain("1.3.0");
    expect(isRevisionSchemaVersion("1.3.0")).toBe(true);
    expect(isRevisionSchemaVersion("1.2.0")).toBe(true);
    expect(isRevisionSchemaVersion("1.1.0")).toBe(false);
    expect(SEMANTIC_REVISION_PROMPT_VERSION).toBe("3");
    expect(buildCloudPromptText("{}", "1.3.0")).toBe(`${SEMANTIC_REVISION_INSTRUCTIONS}\n{}`);
    expect(buildCloudPromptText("{}", "1.2.0")).toBe(`${BLIND_REVISION_INSTRUCTIONS}\n{}`);
    // v3 keeps every v2 rule and the same closing lines.
    for (const line of BLIND_REVISION_INSTRUCTIONS.split("\n")) expect(SEMANTIC_REVISION_INSTRUCTIONS).toContain(line);
    expect(SEMANTIC_REVISION_INSTRUCTIONS.endsWith("Approved revision payload:")).toBe(true);
  });

  it("feedback versions are exact: 1.0.0 cannot carry semantic fields, 1.1.0 must", () => {
    const scenario = scenarioById("crm-eu-accounts")!;
    const { prepared, payload, alias } = prepareScenario(scenario);
    const accepted = acceptProposal({ proposal: handWrittenInitial(scenario.scenarioId, alias), disclosure: payload, twin: prepared.twin, origin: "manual-edit", mappingId: "m" });
    if (!accepted.ok) throw new Error();
    const evaluation = evaluateMapping({
      executable: accepted.value.resolved.executable,
      targetSchema: scenario.destinationSchema,
      bindings: prepared.twin.bindings,
      records: scenario.imported.map((item) => item.record),
      reserved: scenario.revisionFeedback.map((item) => item.record),
      policy: scenario.policy,
      now: () => 0,
    });
    const projected = projectRevisionFeedback({
      runId: "run-0000000000000001",
      baseDisclosureHash: "a".repeat(64),
      baseDisclosure: payload,
      aliasContract: accepted.value.converted.contract,
      contractHash: "b".repeat(64),
      origin: "manual-edit",
      report: evaluation.report,
      policy: scenario.policy,
    });
    if (!projected.ok) throw new Error(projected.code);
    expect(projected.feedback.feedbackVersion).toBe("1.0.0");
    expect(validateRevisionFeedbackSchema(projected.feedback)).toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...projected.feedback, semanticFindings: [] })).not.toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...projected.feedback, feedbackVersion: "1.1.0" })).not.toEqual([]);
    expect(validateRevisionFeedbackSchema({ ...projected.feedback, feedbackVersion: "9.9.9" })).toEqual([{ path: "/feedbackVersion", message: "Unsupported feedback version", code: "VERSION" }]);
  });

  it("migration: with no semantic finding the output is byte-identical to Sprint 7 (feedback 1.0.0, disclosure 1.2.0)", () => {
    const scenario = scenarioById("crm-eu-accounts")!;
    const { prepared, payload, alias } = prepareScenario(scenario);
    // A mapping with the correct date order: no semantic mismatch remains.
    const proposal = handWrittenInitial(scenario.scenarioId, alias) as { operations: Array<Record<string, unknown>> };
    proposal.operations = proposal.operations.map((op) => (op.op === "parse_date" ? { ...op, params: { inputFormat: "DD/MM/YYYY" } } : op));
    const accepted = acceptProposal({ proposal, disclosure: payload, twin: prepared.twin, origin: "manual-edit", mappingId: "m" });
    if (!accepted.ok) throw new Error();
    const records = scenario.imported.map((item) => item.record);
    const reserved = scenario.revisionFeedback.map((item) => item.record);
    const evaluation = evaluateMapping({ executable: accepted.value.resolved.executable, targetSchema: scenario.destinationSchema, bindings: prepared.twin.bindings, records, reserved, policy: scenario.policy, now: () => 0 });
    const contract = buildSemanticContract({ contractId: "c", declared: scenario.semanticSpec.declared, profile: prepared.profile, records: [...records, ...reserved] });
    const semantic = verifySemantics({ contract, executable: accepted.value.resolved.executable, report: evaluation.report, records: [...records, ...reserved] });
    expect(semantic.results.every((result) => result.status === "SEMANTIC_PASS" || result.status === "SEMANTIC_UNVERIFIED")).toBe(true);
    const common = {
      runId: "run-0000000000000002",
      baseDisclosureHash: "a".repeat(64),
      baseDisclosure: payload,
      aliasContract: accepted.value.converted.contract,
      contractHash: "b".repeat(64),
      origin: "manual-edit" as const,
      report: evaluation.report,
      policy: scenario.policy,
      classified: evaluation.rows,
    };
    const sprint7 = projectRevisionFeedback(common);
    const sprint8 = projectRevisionFeedback({ ...common, semantic: { report: semantic, contract, aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path), authorizedConstraintIds: ["observed-date-1"] } });
    if (!sprint7.ok || !sprint8.ok) throw new Error();
    expect(canonicalizeJson(sprint8.feedback)).toBe(canonicalizeJson(sprint7.feedback));
    const built = buildRevisionPayload(payload, sprint8.feedback);
    if (!built.ok) throw new Error();
    expect(built.payload.schemaVersion).toBe("1.2.0");
    expect(validateContract(built.payload).valid).toBe(true);
  });
});
