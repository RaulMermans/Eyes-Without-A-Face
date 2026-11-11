import { describe, expect, it } from "vitest";
import fc from "fast-check";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import edgeFixture from "../../src/examples/crm/edge-records.json" with { type: "json" };
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import expected from "../../src/examples/crm/expected-outputs.json" with { type: "json" };
import { acceptProposal, buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import { convertProposal, parseProposalText } from "../../src/proposal/convert.ts";
import { resolveAliases } from "../../src/proposal/resolve.ts";
import { deriveTestProposal } from "../../src/inference/test-proposer.ts";
import { runRealityCheck, disclosureSummary } from "../../src/verification/reality-check.ts";
import { describeTargetSchema } from "../../src/twin/target-disclosure.ts";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";

const records = sourceFixture.records as Record<string, unknown>[];
const reserved = edgeFixture.records as Record<string, unknown>[];

function prepared(overrides = { account_state: { discloseCategories: true } }): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional-crm-accounts", seed: 11, overrides });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}

function disclosure(twin: PreparedTwin): CloudDisclosurePayload {
  const draft = buildDisclosureDraft({ prepared: twin, targetSchema: destinationSchema });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  return draft.value.payload;
}

function alias(twin: PreparedTwin, path: string): string {
  const found = twin.twin.bindings.aliasForPath(path);
  if (!found) throw new Error(path);
  return found;
}

function validProposal(twin: PreparedTwin) {
  return {
    operations: [
      { op: "copy", from: alias(twin, "customer_id"), to: "id" },
      { op: "normalize_email", from: alias(twin, "email_address"), to: "email" },
      {
        op: "map_enum",
        from: alias(twin, "account_state"),
        to: "status",
        params: { map: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" }, unmapped: "fail" },
      },
      { op: "parse_date", from: alias(twin, "joined_at"), to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      { op: "trim", from: alias(twin, "company_name"), to: "organization" },
    ],
    rationale: "fictional",
  };
}

describe("target schema disclosure", () => {
  it("projects only names, types, required flags, formats, and enums", () => {
    const described = describeTargetSchema(destinationSchema);
    expect(described.ok).toBe(true);
    if (!described.ok) return;
    expect(described.value.target.fields).toEqual([
      { name: "id", type: "string", required: true },
      { name: "email", type: "string", required: true, format: "email" },
      { name: "status", type: "enum", required: true, enumValues: ["active", "inactive", "prospect"] },
      { name: "createdAt", type: "string", required: true, format: "date" },
      { name: "organization", type: "string", required: true },
    ]);
    expect(JSON.stringify(described.value)).not.toContain("Helpdesk");
  });

  it("drops titles/descriptions and refuses unsupported constructs", () => {
    const described = describeTargetSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "SECRET internal system",
      properties: {
        a: { type: "string", description: "confidential business rule" },
        b: { oneOf: [{ type: "string" }, { type: "number" }] },
        c: { type: "array", items: { type: "string" } },
        nested: { type: "object", properties: { d: { type: ["string", "null"] } } },
      },
    });
    expect(described.ok).toBe(true);
    if (!described.ok) return;
    expect(described.value.target.fields.map((item) => item.name)).toEqual(["a", "nested.d"]);
    expect(described.value.target.fields[1]).toMatchObject({ nullable: true });
    expect(JSON.stringify(described.value.target)).not.toMatch(/SECRET|confidential/);
    expect(described.value.notes.length).toBe(2);
  });
});

describe("disclosure draft", () => {
  it("builds a 1.1.0 payload with target and no private bindings, names, or values", () => {
    const twin = prepared();
    const payload = disclosure(twin);
    expect(payload.schemaVersion).toBe("1.1.0");
    expect(payload.target?.fields).toHaveLength(5);
    const serialized = JSON.stringify(payload);
    for (const banned of ["customer_id", "email_address", "joined_at", "company_name", "internal_note", "CUST-00", "alice@", "Example Studio", "fictional-crm-accounts", "sourceFieldId", "PRIVATE_CANARY"]) {
      expect(serialized).not.toContain(banned);
    }
    expect(serialized).toContain("active_customer");
  });

  it("omits fields the user keeps local", () => {
    const twin = prepared({ account_state: { discloseCategories: true }, internal_note: { shareable: false } } as never);
    const payload = disclosure(twin);
    expect(payload.fields.map((field) => field.alias)).not.toContain(alias(twin, "internal_note"));
    for (const example of payload.syntheticExamples) {
      expect(Object.keys(example)).not.toContain(alias(twin, "internal_note"));
    }
  });
});

describe("proposal conversion", () => {
  it("converts a valid proposal into an alias-level canonical contract", () => {
    const twin = prepared();
    const result = convertProposal(validProposal(twin), { disclosure: disclosure(twin), mappingId: "m1", origin: "test-adapter" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contract.operations[0]).toEqual({ op: "copy", from: alias(twin, "customer_id"), to: "id" });
    expect(result.value.warnings).toEqual([]);
  });

  const reject = (mutate: (proposal: ReturnType<typeof validProposal>, twin: PreparedTwin) => unknown, code: string) => {
    const twin = prepared();
    const proposal = mutate(validProposal(twin), twin);
    const result = convertProposal(proposal, { disclosure: disclosure(twin), mappingId: "m1", origin: "gemini-cloud" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain(code);
  };

  it("rejects unknown operations", () => reject((p) => ({ ...p, operations: [{ op: "eval_js", from: "f_01", to: "id" }] }), "UNKNOWN_OPERATION"));
  it("rejects undeclared aliases", () => reject((p) => ({ ...p, operations: [{ op: "copy", from: "customer_id", to: "id" }] }), "UNKNOWN_ALIAS"));
  it("rejects unauthorized destination fields", () => reject((p, t) => ({ ...p, operations: [{ op: "copy", from: alias(t, "customer_id"), to: "secretField" }] }), "UNKNOWN_TARGET_FIELD"));
  it("rejects duplicate destination writes", () =>
    reject((p, t) => ({ ...p, operations: [...p.operations, { op: "copy", from: alias(t, "company_name"), to: "organization" }] }), "DUPLICATE_DESTINATION"));
  it("rejects missing params", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "parse_date", from: alias(t, "joined_at"), to: "createdAt" }] }), "INVALID_PARAMS"));
  it("rejects malformed param types", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "map_enum", from: alias(t, "account_state"), to: "status", params: { map: "active", unmapped: "fail" } }] }), "INVALID_PARAMS"));
  it("rejects unexpected params", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "copy", from: alias(t, "customer_id"), to: "id", params: { coerce: true } }] }), "INVALID_PARAMS"));
  it("rejects executable content", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "copy", from: alias(t, "customer_id"), to: "id", params: { code: "function () { return 1 }" } }] }), "EXECUTABLE_CONTENT"));
  it("rejects arrow-function strings", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "default_if_missing", from: alias(t, "customer_id"), to: "id", params: { value: "() => { fetch('x') }" } }] }), "EXECUTABLE_CONTENT"));
  it("rejects prototype pollution keys", () =>
    reject((p) => JSON.parse(JSON.stringify(p).replace('"active_customer"', '"__proto__"')) as unknown, "PROTOTYPE_POLLUTION"));
  it("rejects nested/array paths", () => reject((p, t) => ({ ...p, operations: [{ op: "copy", from: alias(t, "customer_id"), to: "items[0]" }] }), "INVALID_FIELD_REF"));
  it("rejects enum keys that were never disclosed", () =>
    reject((p, t) => ({ ...p, operations: [{ op: "map_enum", from: alias(t, "account_state"), to: "status", params: { map: { vip_customer: "active" }, unmapped: "fail" } }] }), "INVALID_ENUM_MAPPING"));
  it("rejects unbounded operation chains", () =>
    reject((p, t) => ({ ...p, operations: Array.from({ length: 40 }, () => ({ op: "copy", from: alias(t, "customer_id"), to: "id" })) }), "TOO_MANY_OPERATIONS"));
  it("rejects enum mapping when labels were withheld", () => {
    const twin = prepared({} as never);
    const result = convertProposal(validProposal(twin), { disclosure: disclosure(twin), mappingId: "m", origin: "gemini-cloud" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("INVALID_ENUM_MAPPING");
  });

  it("does not repair malformed JSON text", () => {
    expect(parseProposalText('{"operations": [ {"op": "copy",')).toMatchObject({ ok: false, issues: [{ code: "MALFORMED_PROPOSAL" }] });
  });

  it("never throws and never accepts arbitrary JSON (property)", () => {
    const twin = prepared();
    const payload = disclosure(twin);
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = convertProposal(value, { disclosure: payload, mappingId: "m", origin: "gemini-cloud" });
        expect(result.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("alias resolution and private execution", () => {
  it("resolves aliases to local paths and reproduces the expected outputs", () => {
    const twin = prepared();
    const accepted = acceptProposal({ proposal: validProposal(twin), disclosure: disclosure(twin), twin: twin.twin, origin: "test-adapter", mappingId: "m1" });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.resolved.executable.operations[0]).toEqual({ op: "copy", from: "customer_id", to: "id" });
    const report = runRealityCheck({ records, mappingContract: accepted.value.resolved.executable, targetSchema: destinationSchema, bindings: twin.twin.bindings });
    expect(report.failed).toBe(0);
    expect(report.rows.map((row) => row.output)).toEqual(expected.records);
  });

  it("the deterministic test proposer yields the same executable mapping", () => {
    const twin = prepared();
    const payload = disclosure(twin);
    const accepted = acceptProposal({ proposal: deriveTestProposal(payload), disclosure: payload, twin: twin.twin, origin: "test-adapter", mappingId: "m" });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const report = runRealityCheck({ records, mappingContract: accepted.value.resolved.executable, targetSchema: destinationSchema, bindings: twin.twin.bindings });
    expect(report.rows.map((row) => row.output)).toEqual(expected.records);
  });

  it("refuses aliases kept local even if a proposal references them", () => {
    const twin = prepared();
    const result = resolveAliases({
      aliasContract: {
        contractKind: "mapping", schemaVersion: "1.0.0", mappingId: "m", mappingVersion: "1", phantomId: twin.twin.phantom.phantomId,
        destinationSchemaId: "d", operations: [{ op: "copy", from: "f_99", to: "id" }],
      },
      phantom: twin.twin.phantom,
      source: twin.twin.source,
      bindings: twin.twin.bindings,
    });
    expect(result).toMatchObject({ ok: false, issues: [{ code: "ALIAS_NOT_SHAREABLE" }] });
  });

  it("refuses a contract proposed for another twin", () => {
    const twin = prepared();
    const other = prepareTwin({ records, datasetLabel: "x", seed: 12, overrides: { account_state: { discloseCategories: true } } });
    if (!other.ok) throw new Error("x");
    const accepted = acceptProposal({ proposal: validProposal(twin), disclosure: disclosure(other.value), twin: twin.twin, origin: "test-adapter", mappingId: "m" });
    expect(accepted.ok).toBe(false);
  });

  it("detects the reserved hidden enum case and keeps the private value out of safe summaries", () => {
    const twin = prepared();
    const accepted = acceptProposal({ proposal: validProposal(twin), disclosure: disclosure(twin), twin: twin.twin, origin: "test-adapter", mappingId: "m" });
    if (!accepted.ok) throw new Error("accept");
    const report = runRealityCheck({ records, reservedRecords: reserved, mappingContract: accepted.value.resolved.executable, targetSchema: destinationSchema, bindings: twin.twin.bindings });
    expect(report.reservedTotal).toBe(3);
    expect(report.reservedFailed).toBe(3);
    const hidden = report.rows.find((row) => row.set === "reserved" && row.setIndex === 0);
    expect(hidden?.localIssues[0]?.code).toBe("UNMAPPED_ENUM");
    expect(hidden?.localIssues[0]?.message).toContain("vip_customer");
    expect(hidden?.safeIssues[0]).toMatchObject({ code: "UNMAPPED_ENUM", alias: alias(twin, "account_state"), op: "map_enum" });
    const safe = JSON.stringify({ rows: report.rows.map((row) => row.safeIssues), summary: disclosureSummary(report) });
    for (const value of ["vip_customer", "account_state", "CUST-EDGE", "email_address"]) {
      expect(safe).not.toContain(value);
    }
  });
});
