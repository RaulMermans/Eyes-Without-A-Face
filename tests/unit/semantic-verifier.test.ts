/**
 * Sprint 8 unit tests: generic semantic checks on synthetic rows (no
 * scenario), revision decision rules, and the labeled simulated reviser.
 */
import { describe, expect, it } from "vitest";
import type { CloudDisclosurePayload, MappingContract } from "../../src/domain/contracts/types.ts";
import { deriveTestRevision } from "../../src/inference/test-proposer.ts";
import { buildSemanticContract, observeDateOrder } from "../../src/semantics/observe.ts";
import type { SemanticConstraint, SemanticVerificationContract } from "../../src/semantics/contract.ts";
import { compareSemanticReports, verifySemantics } from "../../src/semantics/verify.ts";
import type { RealityCheckReport } from "../../src/verification/reality-check.ts";

function contract(constraints: SemanticConstraint[]): SemanticVerificationContract {
  return { contractKind: "semantic-verification", semanticContractVersion: "1.0.0", contractId: "unit", localOnly: true, constraints };
}

function mapping(operations: unknown[]): MappingContract {
  return { operations } as unknown as MappingContract;
}

/** A fake Reality Check: one passing row per record with the given outputs. */
function report(outputs: Array<Record<string, unknown> | null>): RealityCheckReport {
  return {
    rows: outputs.map((output, index) => ({ index, set: "imported", setIndex: index + 1, status: output ? "pass" : "fail", output, localIssues: [], safeIssues: [] })),
  } as unknown as RealityCheckReport;
}

const trusted = { trust: "trusted" as const, evidence: { kind: "user-declared" as const } };
const destination = { type: "object", properties: { level: { enum: ["high", "mid", "low"] }, day: { type: "string" } } };

describe("SEMV-001 generic checks on synthetic rows", () => {
  it("enum meaning: a declared label mapped elsewhere is a mismatch; undeclared under review is a policy conflict", () => {
    const c = contract([{ id: "m", kind: "enum-meaning", source: "s", target: "level", meaning: { a: "high", b: "low" }, undeclared: "review", ...trusted }]);
    const m = mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { a: "high", b: "mid" }, unmapped: "default", default: "low" } }]);
    const records = [{ s: "a" }, { s: "b" }, { s: "zz" }];
    const out = verifySemantics({ contract: c, executable: m, report: report([{ level: "high" }, { level: "mid" }, { level: "low" }]), records, destinationSchema: destination });
    expect(out.results[0]).toMatchObject({ status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ENUM_MEANING_CONFLICT", violatingRows: [1, 2] });
    const fixed = mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { a: "high", b: "low" }, unmapped: "default", default: "low" } }]);
    const out2 = verifySemantics({ contract: c, executable: fixed, report: report([{ level: "high" }, { level: "low" }, { level: "low" }]), records, destinationSchema: destination });
    expect(out2.results[0]).toMatchObject({ status: "SEMANTIC_POLICY_CONFLICT", code: "SEMANTIC_POLICY_VIOLATION", violatingRows: [2] });
  });

  it("ordered categories: a collapse that keeps order passes; an inversion is caught even with no record (static map)", () => {
    const c = contract([{ id: "o", kind: "ordered-categories", source: "s", target: "level", sourceOrder: ["x1", "x2", "x3"], targetOrder: ["high", "mid", "low"], undeclared: "unconstrained", ...trusted }]);
    const keepsOrder = mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { x1: "high", x2: "high", x3: "low" }, unmapped: "fail" } }]);
    expect(verifySemantics({ contract: c, executable: keepsOrder, report: report([]), records: [] }).results[0]!.status).toBe("SEMANTIC_PASS");
    const inverted = mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { x1: "low", x3: "high" }, unmapped: "fail" } }]);
    expect(verifySemantics({ contract: c, executable: inverted, report: report([]), records: [] }).results[0]).toMatchObject({ status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ORDER_INVERSION" });
  });

  it("dates: a mapping that reads the other order is caught statically and per record; ISO dates are untouched", () => {
    const c = contract([{ id: "d", kind: "date-interpretation", source: "when", format: "DD/MM/YYYY", ...trusted }]);
    const wrong = mapping([{ op: "parse_date", from: "when", to: "day", params: { inputFormat: "MM/DD/YYYY" } }]);
    // "02/03/2026" read month-first is 2026-02-03; the trusted day-first reading is 2026-03-02.
    const out = verifySemantics({ contract: c, executable: wrong, report: report([{ day: "2026-02-03" }]), records: [{ when: "02/03/2026" }] });
    expect(out.results[0]).toMatchObject({ status: "SEMANTIC_MISMATCH", code: "SEMANTIC_DATE_ORDER_CONFLICT", violatingRows: [0] });
    const right = mapping([{ op: "parse_date", from: "when", to: "day", params: { inputFormat: "DD/MM/YYYY" } }]);
    // Output is checked independently of the declared params.
    expect(verifySemantics({ contract: c, executable: right, report: report([{ day: "2026-02-03" }]), records: [{ when: "02/03/2026" }] }).results[0]!.status).toBe("SEMANTIC_MISMATCH");
    expect(verifySemantics({ contract: c, executable: right, report: report([{ day: "2026-03-02" }]), records: [{ when: "02/03/2026" }] }).results[0]!.status).toBe("SEMANTIC_PASS");
    expect(observeDateOrder(["2026-02-03"]).checkedValues).toBe(0);
  });

  it("allowed values and contradicting constraints are policy conflicts, never passes", () => {
    const allowed = contract([{ id: "a", kind: "allowed-values", target: "level", values: ["high"], ...trusted }]);
    const m = mapping([{ op: "copy", from: "s", to: "level" }]);
    expect(verifySemantics({ contract: allowed, executable: m, report: report([{ level: "low" }]), records: [{ s: "low" }] }).overall).toBe("SEMANTIC_POLICY_CONFLICT");
    const contradicting = contract([
      { id: "d1", kind: "date-interpretation", source: "w", format: "DD/MM/YYYY", ...trusted },
      { id: "d2", kind: "date-interpretation", source: "w", format: "MM/DD/YYYY", ...trusted },
    ]);
    const parse = mapping([{ op: "parse_date", from: "w", to: "day", params: { inputFormat: "DD/MM/YYYY" } }]);
    const out = verifySemantics({ contract: contradicting, executable: parse, report: report([]), records: [], destinationSchema: destination });
    expect(out.results.map((result) => result.status)).toEqual(["SEMANTIC_POLICY_CONFLICT", "SEMANTIC_POLICY_CONFLICT"]);
  });

  it("a trusted declaration replaces an ambiguous observation; a disagreeing proven observation is kept and conflicts", () => {
    const profile = { recordCount: 1, issues: [], fields: [{ path: "w", dateFormat: "MM/DD/YYYY", dateFormatAmbiguous: true }] } as never;
    const declared: SemanticConstraint = { id: "u", kind: "date-interpretation", source: "w", format: "DD/MM/YYYY", ...trusted };
    expect(buildSemanticContract({ contractId: "x", declared: [declared], profile, records: [{ w: "01/02/2026" }] }).constraints).toEqual([declared]);
    const proven = buildSemanticContract({ contractId: "x", declared: [{ ...declared, format: "MM/DD/YYYY" }], profile, records: [{ w: "25/02/2026" }] });
    expect(proven.constraints).toHaveLength(2);
    const parse = mapping([{ op: "parse_date", from: "w", to: "day", params: { inputFormat: "MM/DD/YYYY" } }]);
    expect(verifySemantics({ contract: proven, executable: parse, report: report([]), records: [], destinationSchema: destination }).overall).toBe("SEMANTIC_POLICY_CONFLICT");
  });

  it("comparison counts resolved and newly introduced violations per constraint", () => {
    const c = contract([{ id: "m", kind: "enum-meaning", source: "s", target: "level", meaning: { a: "high", b: "low" }, undeclared: "unconstrained", ...trusted }]);
    const records = [{ s: "a" }, { s: "b" }];
    const before = verifySemantics({ contract: c, executable: mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { a: "low", b: "low" }, unmapped: "fail" } }]), report: report([{ level: "low" }, { level: "low" }]), records });
    const after = verifySemantics({ contract: c, executable: mapping([{ op: "map_enum", from: "s", to: "level", params: { map: { a: "high", b: "high" }, unmapped: "fail" } }]), report: report([{ level: "high" }, { level: "high" }]), records });
    expect(compareSemanticReports(before, after)).toMatchObject({ resolved: 1, introduced: 1 });
  });
});

describe("SEMV-002 simulated reviser (labeled test adapter, not AI)", () => {
  const payload = (approvedConstraints: unknown[]) =>
    ({
      schemaVersion: "1.3.0",
      fields: [],
      target: { fields: [] },
      revision: {
        feedback: {
          feedbackVersion: "1.1.0",
          previousMapping: { operations: [{ op: "map_enum", from: "f_01", to: "priority", params: { map: { p1: "low", p2: "high" }, unmapped: "fail" } }] },
          findings: [],
          approvedFallbacks: [],
          semanticFindings: [{ operation: 1, op: "map_enum", alias: "f_01", to: "priority", code: "SEMANTIC_ORDER_INVERSION", category: "ordered-category-inversion" }],
          approvedConstraints,
        },
      },
    }) as unknown as CloudDisclosurePayload;

  it("changes an operation only through an approved constraint, and says it is not Gemini", () => {
    const unchanged = deriveTestRevision(payload([]));
    expect(unchanged.operations[0]).toMatchObject({ params: { map: { p1: "low", p2: "high" } } });
    expect(unchanged.rationale).toContain("Not a live Gemini response");
    const fixed = deriveTestRevision(payload([{ kind: "category-order", alias: "f_01", to: "priority", sourceOrder: ["p1", "p2"], targetOrder: ["urgent", "low"] }]));
    expect(fixed.operations[0]).toMatchObject({ params: { map: { p1: "urgent", p2: "low" }, unmapped: "fail" } });
  });
});
