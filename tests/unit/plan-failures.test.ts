import { describe, expect, it } from "vitest";
import { MAPPING_FAILURE_CODES } from "../../src/domain/mapping/codes.ts";
import type { MappingContract } from "../../src/domain/contracts/types.ts";
import type { InferenceErrorCode } from "../../src/inference/errors.ts";
import {
  classifyEngineCode,
  classifyOutcome,
  classifyPlanIssue,
  classifyProviderFailure,
  FAILURE_CATEGORIES,
  FAILURE_COPY,
  nextActionFor,
} from "../../src/plan/failures.ts";
import type { CompiledField, FailureCategory, NextAction, PlanIssueCode } from "../../src/plan/types.ts";
import type { SemanticReport, SemanticStatus } from "../../src/semantics/verify.ts";
import type { ClassifiedRow } from "../../src/verification/outcomes.ts";
import type { RealityCheckRow } from "../../src/verification/reality-check.ts";

const ALL_CATEGORIES: Record<FailureCategory, true> = {
  "incorrect-correspondence": true,
  "missing-correspondence": true,
  "invalid-parameters": true,
  "missing-category-values": true,
  "invented-values": true,
  "semantic-disagreement": true,
  "unsupported-operation": true,
  "invalid-source-data": true,
  "provider-failure": true,
  "privacy-blocker": true,
  "destination-incompatible": true,
};

const ALL_ISSUES: Record<PlanIssueCode, FailureCategory> = {
  MALFORMED_PLAN: "provider-failure",
  DISCLOSURE_MISSING_TARGET: "destination-incompatible",
  UNKNOWN_TARGET_FIELD: "incorrect-correspondence",
  DUPLICATE_TARGET: "incorrect-correspondence",
  UNKNOWN_ALIAS: "incorrect-correspondence",
  INCONSISTENT_ENTRY: "invalid-parameters",
  INVENTED_CATEGORY_LABEL: "invented-values",
  INVALID_ENUM_VALUE: "invented-values",
};

const ALL_INFERENCE_CODES: Record<InferenceErrorCode, FailureCategory> = {
  INFERENCE_UNAVAILABLE: "provider-failure",
  INFERENCE_NOT_IMPLEMENTED: "provider-failure",
  MISSING_CONFIG: "provider-failure",
  FEATURE_DISABLED: "provider-failure",
  APP_CHECK_REJECTED: "provider-failure",
  MODEL_UNAVAILABLE: "provider-failure",
  UNSUPPORTED_BROWSER: "provider-failure",
  NETWORK: "provider-failure",
  TIMEOUT: "provider-failure",
  INVALID_STRUCTURED_OUTPUT: "provider-failure",
  DISCLOSURE_REJECTED: "privacy-blocker",
  STALE_AUTHORIZATION: "provider-failure",
  USER_REJECTED: "privacy-blocker",
  SDK_INIT_FAILED: "provider-failure",
  ON_DEVICE_RUNTIME_ERROR: "provider-failure",
  PROVENANCE_MISMATCH: "provider-failure",
  PROVENANCE_UNVERIFIED: "provider-failure",
  PROVENANCE_UNKNOWN: "provider-failure",
  SIMULATED_RESULT: "provider-failure",
  PAYLOAD_TOO_LARGE: "provider-failure",
  EXECUTABLE_OUTPUT: "provider-failure",
  CANCELLED: "provider-failure",
  IN_FLIGHT: "provider-failure",
  DESTINATION_MISMATCH: "provider-failure",
  PROVIDER_OVERLOADED: "provider-failure",
  RATE_LIMITED: "provider-failure",
};

describe("nextActionFor", () => {
  it("is total over the categories, with one meaningful action each", () => {
    expect([...FAILURE_CATEGORIES].sort()).toEqual(Object.keys(ALL_CATEGORIES).sort());
    for (const category of FAILURE_CATEGORIES) {
      const next = nextActionFor(category);
      expect(next, category).not.toBe("none");
    }
  });

  it("follows the documented table", () => {
    const expected: Record<FailureCategory, NextAction> = {
      "incorrect-correspondence": "revise-with-model",
      "missing-correspondence": "revise-with-model",
      "invalid-parameters": "revise-with-model",
      "missing-category-values": "review-records",
      "invented-values": "ask-user",
      "semantic-disagreement": "ask-user",
      "unsupported-operation": "map-manually",
      "invalid-source-data": "fix-source-data",
      "provider-failure": "new-request",
      "privacy-blocker": "map-manually",
      "destination-incompatible": "change-destination",
    };
    for (const category of FAILURE_CATEGORIES) expect(nextActionFor(category), category).toBe(expected[category]);
  });

  it("throws on an unknown category instead of guessing", () => {
    expect(() => nextActionFor("nope" as FailureCategory)).toThrow();
  });
});

describe("classifyPlanIssue", () => {
  it("classifies every issue code", () => {
    for (const [code, category] of Object.entries(ALL_ISSUES) as Array<[PlanIssueCode, FailureCategory]>) {
      const failure = classifyPlanIssue({ code, target: "status", entryIndex: 0, message: "m" });
      expect(failure, code).toEqual({ category, target: "status", next: nextActionFor(category), evidence: [code] });
    }
  });

  it("uses a null target for plan-level issues", () => {
    expect(classifyPlanIssue({ code: "MALFORMED_PLAN", message: "m" }).target).toBeNull();
  });
});

describe("classifyProviderFailure", () => {
  it("classifies every inference error code", () => {
    for (const [code, category] of Object.entries(ALL_INFERENCE_CODES)) {
      expect(classifyProviderFailure(code).category, code).toBe(category);
    }
  });

  it("sends timeouts and overload to a new request, and privacy refusals to manual mapping", () => {
    expect(classifyProviderFailure("TIMEOUT").next).toBe("new-request");
    expect(classifyProviderFailure("PROVIDER_OVERLOADED").next).toBe("new-request");
    expect(classifyProviderFailure("DISCLOSURE_REJECTED")).toEqual({ category: "privacy-blocker", target: null, next: "map-manually", evidence: ["DISCLOSURE_REJECTED"] });
  });

  it("handles workspace cloudError codes and unknown codes", () => {
    expect(classifyProviderFailure("NOT_APPROVED").category).toBe("provider-failure");
    expect(classifyProviderFailure("CLOUD_FAILED").category).toBe("provider-failure");
    expect(classifyProviderFailure("DISCLOSURE_MISSING_TARGET").category).toBe("destination-incompatible");
    expect(classifyProviderFailure("SOMETHING_NEW").category).toBe("provider-failure");
  });
});

describe("classifyEngineCode", () => {
  it("is total over engine failure codes", () => {
    for (const code of MAPPING_FAILURE_CODES) expect(FAILURE_CATEGORIES, code).toContain(classifyEngineCode(code));
    expect(classifyEngineCode("UNMAPPED_ENUM")).toBe("missing-category-values");
    expect(classifyEngineCode("INVALID_DATE")).toBe("invalid-source-data");
    expect(classifyEngineCode("OUTPUT_SCHEMA_MISMATCH")).toBe("destination-incompatible");
    expect(classifyEngineCode("INVALID_OPERATION_PARAMS")).toBe("invalid-parameters");
    expect(classifyEngineCode("UNSUPPORTED_OPERATION")).toBe("unsupported-operation");
  });
});

describe("FAILURE_COPY", () => {
  it("has a title and one-sentence next step for every category, without values or jargon", () => {
    for (const category of FAILURE_CATEGORIES) {
      const copy = FAILURE_COPY[category];
      expect(copy.title.length, category).toBeGreaterThan(5);
      expect(copy.next.match(/[.!?](\s|$)/g)?.length, category).toBe(1);
      expect(`${copy.title} ${copy.next}`, category).not.toMatch(/alias|enum|schema|json|null|\bcode\b|“|"/i);
    }
  });
});

/* ------------------------------------------------------------------ */

function field(over: Partial<CompiledField> & { target: string }): CompiledField {
  return {
    required: true,
    targetType: "string",
    claimed: "ready",
    readiness: "ready",
    correspondence: { aliases: ["f_01"], by: "gemini" },
    operation: { op: "copy", from: "f_01", to: over.target },
    operationOrigin: "gemini",
    missing: [],
    failures: [],
    ...over,
  };
}

function row(index: number, outcome: ClassifiedRow["outcome"], over: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return { index, set: "imported", setIndex: index, outcome, correct: null, rulesUsed: [], unapprovedRules: [], codes: [], outputSchemaViolation: false, ...over };
}

function reportRow(index: number, issues: RealityCheckRow["localIssues"]): RealityCheckRow {
  return { index, set: "imported", setIndex: index, status: "fail", output: null, localIssues: issues, safeIssues: [] };
}

const CONTRACT: MappingContract = {
  version: "1.0.0",
  mappingId: "m",
  sourceSchemaRef: "s",
  targetSchemaRef: "t",
  operations: [
    { op: "parse_date", from: "opened", to: "opened_at", params: { inputFormat: "DD/MM/YYYY" } },
    { op: "map_enum", from: "state", to: "status", params: { map: { a: "active" }, unmapped: "fail" } },
    { op: "copy", from: "mail", to: "email" },
  ],
} as unknown as MappingContract;

function semantic(fields: Array<{ target: string; status: SemanticStatus; code?: SemanticReport["results"][number]["code"] }>, contractValid = true): SemanticReport {
  return {
    verifierVersion: "1.0.0",
    contractId: "c",
    contractValid,
    contractIssues: [],
    results: fields.map((item) => ({ constraintId: "k", kind: "operation", status: item.status, code: item.code, reasons: [], target: item.target, operations: [], checkedRows: 1, violatingRows: [] })),
    fields: fields.map((item) => ({ target: item.target, status: item.status, constraintIds: [] })),
    overall: "SEMANTIC_UNVERIFIED",
    coverage: { fields: fields.length, verified: 0, mismatched: 0, unknown: 0 },
    violatingRows: [],
  };
}

describe("classifyOutcome", () => {
  it("returns nothing for a clean run", () => {
    expect(classifyOutcome({ fields: [field({ target: "email" })], rows: [row(0, "TRANSFORMED_VALID")], semantic: semantic([{ target: "email", status: "SEMANTIC_PASS" }]) })).toEqual([]);
  });

  it("attributes engine failures to the destination field when the report and contract are known", () => {
    const rows = [
      row(0, "UNRESOLVED", { codes: ["INVALID_DATE"] }),
      row(1, "QUARANTINED", { codes: ["UNMAPPED_ENUM"] }),
      row(2, "UNRESOLVED", { codes: ["OUTPUT_SCHEMA_MISMATCH"], outputSchemaViolation: true }),
    ];
    const report = {
      rows: [
        reportRow(0, [{ code: "INVALID_DATE", message: "private value here", operationIndex: 0 }]),
        reportRow(1, [{ code: "UNMAPPED_ENUM", message: "private", operationIndex: 1 }]),
        reportRow(2, [{ code: "OUTPUT_SCHEMA_MISMATCH", message: "private", path: "/email" }]),
      ],
    };
    const failures = classifyOutcome({ fields: [], rows, semantic: null, report, contract: CONTRACT });
    expect(failures).toEqual([
      { category: "destination-incompatible", target: "email", next: "change-destination", evidence: ["UNRESOLVED:OUTPUT_SCHEMA_MISMATCH"] },
      { category: "invalid-source-data", target: "opened_at", next: "fix-source-data", evidence: ["UNRESOLVED:INVALID_DATE"] },
      { category: "missing-category-values", target: "status", next: "review-records", evidence: ["QUARANTINED:UNMAPPED_ENUM"] },
    ]);
    expect(JSON.stringify(failures)).not.toContain("private");
  });

  it("reports unattributed engine failures for the whole integration", () => {
    const failures = classifyOutcome({ fields: [], rows: [row(0, "QUARANTINED", { codes: ["UNMAPPED_ENUM"] })], semantic: null });
    expect(failures).toEqual([{ category: "missing-category-values", target: null, next: "review-records", evidence: ["QUARANTINED:UNMAPPED_ENUM"] }]);
  });

  it("classifies a policy-rejected invented value on the operation's destination", () => {
    const failures = classifyOutcome({ fields: [], rows: [row(0, "REJECTED_BY_POLICY", { unapprovedRules: [2] })], semantic: null, contract: CONTRACT });
    expect(failures).toEqual([{ category: "invented-values", target: "status", next: "ask-user", evidence: ["REJECTED_BY_POLICY"] }]);
  });

  it("reads ground-truth-only outcomes blind", () => {
    expect(classifyOutcome({ fields: [], rows: [row(0, "INCORRECT_TRANSFORMATION"), row(1, "HANDLED_BY_APPROVED_RULE")], semantic: null })).toEqual([]);
  });

  it("maps semantic statuses per field", () => {
    const fields = [
      field({ target: "opened_at" }),
      field({ target: "status", operationOrigin: "gemini" }),
      field({ target: "tier", operationOrigin: "gemini+user", correspondence: { aliases: ["f_02"], by: "gemini" } }),
      field({ target: "plan", operationOrigin: "user", correspondence: { aliases: ["f_03"], by: "user" } }),
      field({ target: "kind" }),
      field({ target: "since" }),
      field({ target: "email" }),
      field({ target: "phone" }),
    ];
    const report = semantic([
      { target: "opened_at", status: "SEMANTIC_MISMATCH", code: "SEMANTIC_DATE_ORDER_CONFLICT" },
      { target: "status", status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ENUM_MEANING_CONFLICT" },
      { target: "tier", status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ORDER_INVERSION" },
      { target: "plan", status: "SEMANTIC_MISMATCH", code: "SEMANTIC_ENUM_MEANING_CONFLICT" },
      { target: "kind", status: "SEMANTIC_POLICY_CONFLICT", code: "SEMANTIC_POLICY_VIOLATION" },
      { target: "since", status: "SEMANTIC_AMBIGUOUS", code: "SEMANTIC_AMBIGUOUS_DATE" },
      { target: "email", status: "SEMANTIC_EVIDENCE_MISSING", code: "SEMANTIC_EVIDENCE_MISSING" },
      { target: "phone", status: "SEMANTIC_UNVERIFIED" },
    ]);
    const byTarget = Object.fromEntries(classifyOutcome({ fields, rows: [], semantic: report }).map((item) => [item.target, item.category]));
    expect(byTarget).toEqual({
      opened_at: "semantic-disagreement",
      status: "semantic-disagreement",
      tier: "incorrect-correspondence",
      plan: "semantic-disagreement",
      kind: "missing-category-values",
      since: "semantic-disagreement",
    });
  });

  it("verifies nothing from an invalid semantic contract (unknown is not a failure and not a pass)", () => {
    const report = semantic([{ target: "status", status: "SEMANTIC_MISMATCH" }], false);
    expect(classifyOutcome({ fields: [field({ target: "status" })], rows: [], semantic: report })).toEqual([]);
  });

  it("gives every produced failure the category's next action", () => {
    const failures = classifyOutcome({
      fields: [],
      rows: MAPPING_FAILURE_CODES.map((code, index) => row(index, "UNRESOLVED", { codes: [code] })),
      semantic: null,
    });
    for (const failure of failures) expect(failure.next).toBe(nextActionFor(failure.category));
    expect(failures.every((failure) => failure.target === null)).toBe(true);
  });
});
