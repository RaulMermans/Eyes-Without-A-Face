import { describe, expect, it } from "vitest";
import type { MappingContract } from "../../src/domain/contracts/types.ts";
import { profileRecords } from "../../src/domain/profile/profile.ts";
import { scenarioById } from "../../src/evaluation/scenarios.ts";
import { evaluateMapping } from "../../src/evaluation/evaluate.ts";
import { generatePhantomTwin, DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { buildPrivateFieldContexts, evaluateSemanticSuggestion, PRIVATE_CONTEXT_LIMITS, type PrivateFieldSemantics } from "../../src/private-semantics/semantics.ts";
import { buildPrivateSemanticsPrompt } from "../../src/inference/prompts.ts";
import { validateStructuredOutput } from "../../src/domain/inference-output/validate-output.ts";
import { completionState, STRICT_POLICY, summarizeOutcomes, validateAcceptancePolicy, type AcceptancePolicy } from "../../src/verification/outcomes.ts";

const target = {
  type: "object",
  additionalProperties: false,
  required: ["id", "status"],
  properties: { id: { type: "string" }, status: { enum: ["active", "other"] } },
};

function contract(ops: MappingContract["operations"]): MappingContract {
  return { contractKind: "mapping", schemaVersion: "1.0.0", mappingId: "m", mappingVersion: "1.0.0", phantomId: "p", destinationSchemaId: "d", operations: ops };
}

const records = [
  { id: "A1", s: "on" },
  { id: "A2", s: "mystery" },
  { id: "A3" },
];

describe("OUT-001 outcome classification", () => {
  const policy: AcceptancePolicy = {
    ...STRICT_POLICY,
    policyId: "t",
    quarantine: [{ code: "MISSING_SOURCE_FIELD", to: "status" }],
    approvedFallbacks: [{ to: "status", value: "other", appliesTo: "undisclosed-category" }],
    maxQuarantineRate: 0.5,
  };

  it("separates transformed, rule-handled, and quarantined records", () => {
    const evaluation = evaluateMapping({
      executable: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "map_enum", from: "s", to: "status", params: { map: { on: "active" }, unmapped: "default", default: "other" } },
      ]),
      targetSchema: target,
      bindings: null,
      records,
      policy,
      now: () => 0,
    });
    expect(evaluation.rows.map((row) => row.outcome)).toEqual(["TRANSFORMED_VALID", "HANDLED_BY_APPROVED_RULE", "QUARANTINED"]);
    expect(evaluation.metrics).toMatchObject({ transformedValid: 1, handledByApprovedRule: 1, quarantined: 1, unresolved: 0 });
    expect(evaluation.state).toBe("VERIFIED_WITH_EXCEPTIONS");
  });

  it("an unapproved fallback is an invented value: REJECTED_BY_POLICY, never VERIFIED", () => {
    const evaluation = evaluateMapping({
      executable: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "map_enum", from: "s", to: "status", params: { map: { on: "active" }, unmapped: "default", default: "active" } },
      ]),
      targetSchema: target,
      bindings: null,
      records: records.slice(0, 2),
      policy,
      now: () => 0,
    });
    expect(evaluation.rows[1]?.outcome).toBe("REJECTED_BY_POLICY");
    expect(evaluation.state).toBe("PARTIALLY_VERIFIED");
  });

  it("an unapproved constant default is REJECTED_BY_POLICY", () => {
    const evaluation = evaluateMapping({
      executable: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "default_if_missing", to: "status", params: { value: "active" } },
      ]),
      targetSchema: target,
      bindings: null,
      records: records.slice(0, 1),
      policy,
      now: () => 0,
    });
    expect(evaluation.rows[0]?.outcome).toBe("REJECTED_BY_POLICY");
  });

  it("quarantining everything is never VERIFIED and exceeds the policy limit", () => {
    const evaluation = evaluateMapping({
      executable: contract([{ op: "copy", from: "id", to: "id" }, { op: "copy", from: "s", to: "status" }]),
      targetSchema: target,
      bindings: null,
      records: [{ id: "A" }, { id: "B" }],
      policy: { ...policy, maxQuarantineRate: 0.5 },
      now: () => 0,
    });
    expect(evaluation.metrics.quarantined).toBe(2);
    expect(evaluation.metrics.transformedValid).toBe(0);
    expect(evaluation.state).toBe("PARTIALLY_VERIFIED");
  });

  it("ground truth turns a schema-valid but wrong output into INCORRECT_TRANSFORMATION", () => {
    const evaluation = evaluateMapping({
      executable: contract([{ op: "copy", from: "id", to: "id" }, { op: "map_enum", from: "s", to: "status", params: { map: { on: "other" }, unmapped: "fail" } }]),
      targetSchema: target,
      bindings: null,
      records: records.slice(0, 1),
      policy,
      expected: [{ kind: "transform", output: { id: "A1", status: "active" } }],
      now: () => 0,
    });
    expect(evaluation.rows[0]?.outcome).toBe("INCORRECT_TRANSFORMATION");
    expect(summarizeOutcomes(evaluation.rows)).toMatchObject({ incorrect: 1, correctlyHandled: 0, correctTransformations: 0 });
  });

  it("contract failures and missing reports are BLOCKED; policies cannot quarantine contract failures", () => {
    expect(completionState({ report: null, rows: [], policy })).toBe("BLOCKED");
    expect(completionState({ report: null, rows: [], policy, revisionRejected: true })).toBe("REVISION_FAILED");
    expect(validateAcceptancePolicy({ ...policy, quarantine: [{ code: "UNSAFE_MAPPING" }] })).not.toEqual([]);
  });
});

describe("NANO-001 private semantic context and validation", () => {
  const scenario = scenarioById("crm-eu-accounts")!;
  const imported = scenario.imported.map((item) => item.record);
  const profiled = profileRecords(imported);
  if (!profiled.ok) throw new Error();
  const field = (path: string) => profiled.profile.fields.find((item) => item.path === path)!;
  const twin = generatePhantomTwin(profiled.profile, { seed: DEFAULT_TWIN_SEED, datasetLabel: "x", overrides: scenario.twinOverrides });
  if (!twin.ok) throw new Error();
  const aliasByPath = new Map(twin.twin.fields.map((item) => [item.localPath, item.alias]));
  const alias = (path: string) => aliasByPath.get(path)!;
  const reply = (path: string, extra: Partial<PrivateFieldSemantics>): PrivateFieldSemantics => ({
    fieldAlias: alias(path),
    semanticRole: "text",
    valueKind: "string",
    dateFormat: "none",
    relationHint: "none",
    confidence: "medium",
    reviewRequired: false,
    rationale: "local",
    ...extra,
  });

  it("bounds the local context", () => {
    const contexts = buildPrivateFieldContexts({ records: imported, fields: profiled.profile.fields, aliasByPath, targetFields: ["id", "email"] });
    for (const context of contexts) {
      expect(context.samples.length).toBeLessThanOrEqual(PRIVATE_CONTEXT_LIMITS.maxSamples);
      for (const sample of context.samples) expect(sample.length).toBeLessThanOrEqual(PRIVATE_CONTEXT_LIMITS.maxSampleChars);
    }
    const date = contexts.find((item) => item.fieldName === "angelegt_am")!;
    expect(date.facts.join(" ")).toMatch(/NOT proven/);
    expect(buildPrivateSemanticsPrompt(date)).toContain("angelegt_am");
  });

  it("the profile marks the CRM date as ambiguous and the default twin assumes MM/DD", () => {
    expect(field("angelegt_am")).toMatchObject({ type: "date", dateFormat: "MM/DD/YYYY", dateFormatAmbiguous: true });
  });

  it("accepts a role refinement and an ambiguity resolution", () => {
    const org = evaluateSemanticSuggestion(reply("unternehmen", { semanticRole: "organization" }), field("unternehmen"), alias("unternehmen"));
    expect(org).toMatchObject({ status: "applicable", override: { role: "organization" } });
    const date = evaluateSemanticSuggestion(reply("angelegt_am", { semanticRole: "date", valueKind: "date", dateFormat: "DD/MM/YYYY" }), field("angelegt_am"), alias("angelegt_am"));
    expect(date).toMatchObject({ status: "applicable", override: { dateFormat: "DD/MM/YYYY" } });
  });

  it("rejects suggestions that contradict observed facts or answer for another field", () => {
    expect(evaluateSemanticSuggestion(reply("e_post", { semanticRole: "date", valueKind: "date" }), field("e_post"), alias("e_post")).status).toBe("rejected");
    expect(evaluateSemanticSuggestion(reply("kundennummer", { valueKind: "number" }), field("kundennummer"), alias("kundennummer")).status).toBe("rejected");
    expect(evaluateSemanticSuggestion(reply("unternehmen", { fieldAlias: "f_99" }), field("unternehmen"), alias("unternehmen")).status).toBe("rejected");
    expect(evaluateSemanticSuggestion(reply("unternehmen", { dateFormat: "DD/MM/YYYY" }), field("unternehmen"), alias("unternehmen")).status).toBe("rejected");
  });

  it("a proven date order cannot be overridden", () => {
    const proven = profileRecords([{ d: "25/01/2026" }, { d: "02/03/2026" }]);
    if (!proven.ok) throw new Error();
    const f = proven.profile.fields[0]!;
    expect(f.dateFormat).toBe("DD/MM/YYYY");
    expect(evaluateSemanticSuggestion({ ...reply("angelegt_am", {}), fieldAlias: "f_01", semanticRole: "date", valueKind: "date", dateFormat: "MM/DD/YYYY" }, f, "f_01").status).toBe("rejected");
  });

  it("applied overrides change the twin descriptor; incompatible overrides fail closed", () => {
    const applied = generatePhantomTwin(profiled.profile, {
      seed: DEFAULT_TWIN_SEED,
      datasetLabel: "x",
      overrides: { ...scenario.twinOverrides, angelegt_am: { dateFormat: "DD/MM/YYYY" }, unternehmen: { role: "organization" } },
    });
    if (!applied.ok) throw new Error();
    const byPath = new Map(applied.twin.fields.map((item) => [item.localPath, item.descriptor]));
    expect(byPath.get("angelegt_am")).toContain("DD/MM/YYYY");
    expect(byPath.get("unternehmen")).toContain("Organization");
    const bad = generatePhantomTwin(profiled.profile, { seed: DEFAULT_TWIN_SEED, datasetLabel: "x", overrides: { e_post: { role: "date" } } });
    expect(bad.ok).toBe(false);
  });

  it("the output contract is strict", () => {
    expect(validateStructuredOutput("private-field-semantics", reply("unternehmen", {})).valid).toBe(true);
    expect(validateStructuredOutput("private-field-semantics", { ...reply("unternehmen", {}), extra: 1 }).valid).toBe(false);
    expect(validateStructuredOutput("private-field-semantics", { ...reply("unternehmen", {}), semanticRole: "password" }).valid).toBe(false);
  });
});

describe("NANO-002 proven formats are facts", () => {
  it("an email field cannot be relabelled (live run 2 finding)", () => {
    const scenario = scenarioById("support-tickets")!;
    const profiled = profileRecords(scenario.imported.map((item) => item.record));
    if (!profiled.ok) throw new Error();
    const field = profiled.profile.fields.find((item) => item.path === "requester")!;
    expect(field.format).toBe("email");
    const verdict = evaluateSemanticSuggestion(
      { fieldAlias: "f_04", semanticRole: "identifier", valueKind: "string", dateFormat: "none", relationHint: "contact-channel", confidence: "high", reviewRequired: false, rationale: "x" },
      field,
      "f_04",
    );
    expect(verdict.status).toBe("rejected");
  });
});
