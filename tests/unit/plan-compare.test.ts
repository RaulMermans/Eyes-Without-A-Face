import { describe, expect, it } from "vitest";
import { comparePlans, planRequestBudget, shouldOfferPlanRevision } from "../../src/plan/compare.ts";
import { classifyPlanIssue, classifyProviderFailure } from "../../src/plan/failures.ts";
import { PLAN_REQUEST_LIMIT, type ClassifiedFailure, type CompiledField, type CompiledIntegration } from "../../src/plan/types.ts";

function ready(target: string, over: Partial<CompiledField> = {}): CompiledField {
  return {
    target,
    required: true,
    targetType: "string",
    claimed: "ready",
    readiness: "ready",
    correspondence: { aliases: ["f_01"], by: "gemini" },
    operation: { op: "copy", from: "f_01", to: target },
    operationOrigin: "gemini",
    missing: [],
    failures: [],
    ...over,
  };
}

function open(target: string, over: Partial<CompiledField> = {}): CompiledField {
  return ready(target, { claimed: "needs_clarification", readiness: "needs_clarification", operation: null, operationOrigin: null, ...over });
}

function plan(fields: CompiledField[]): CompiledIntegration {
  const unwrittenRequired = fields.filter((field) => field.required && field.operation === null).map((field) => field.target);
  const executable = fields.filter((field) => field.operation !== null).length;
  return {
    mappingId: "gemini-plan-abcdef12",
    fields,
    aliasContract: null,
    complete: unwrittenRequired.length === 0,
    unwrittenRequired,
    clarifications: [],
    counts: { fields: fields.length, executable, byGemini: executable, byUser: 0, needsClarification: fields.length - executable, unsupported: 0, noSource: 0 },
  };
}

const semanticFailure = (target: string): ClassifiedFailure => ({ category: "semantic-disagreement", target, next: "ask-user", evidence: ["SEMANTIC_MISMATCH"] });

describe("comparePlans", () => {
  it("equal plans are NOT_BETTER", () => {
    const a = plan([ready("email"), open("status")]);
    const result = comparePlans(a, plan([ready("email"), open("status")]));
    expect(result).toMatchObject({ verdict: "NOT_BETTER", gains: [], regressions: [] });
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("a gain with no regression is BETTER", () => {
    expect(comparePlans(plan([ready("email"), open("status")]), plan([ready("email"), ready("status")]))).toMatchObject({ verdict: "BETTER", gains: ["status"], regressions: [] });
  });

  it("never BETTER when any regression exists, even with more gains", () => {
    const before = plan([ready("email"), open("status"), open("region"), open("tier")]);
    const after = plan([open("email"), ready("status"), ready("region"), ready("tier")]);
    const result = comparePlans(before, after);
    expect(result.verdict).toBe("WORSE");
    expect(result.regressions).toEqual(["email"]);
    expect(result.gains).toEqual(["status", "region", "tier"]);
  });

  it("a newly failing verified outcome on an executable field is a regression", () => {
    const before = plan([ready("email"), ready("opened_at")]);
    const after = plan([ready("email"), ready("opened_at", { failures: [semanticFailure("opened_at")] })]);
    expect(comparePlans(before, after)).toMatchObject({ verdict: "WORSE", regressions: ["opened_at"] });
  });

  it("a resolved verified failure on an executable field is BETTER", () => {
    const before = plan([ready("opened_at", { failures: [semanticFailure("opened_at")] })]);
    expect(comparePlans(before, plan([ready("opened_at")])).verdict).toBe("BETTER");
  });

  it("a target missing from the revised plan counts as a regression when it was executable", () => {
    expect(comparePlans(plan([ready("email"), ready("phone")]), plan([ready("email")])).verdict).toBe("WORSE");
  });

  it("losing completeness is WORSE", () => {
    const before = plan([ready("email"), ready("status", { required: false })]);
    const after = plan([ready("email"), open("x")]);
    expect(comparePlans(before, after).verdict).toBe("WORSE");
  });
});

describe("planRequestBudget", () => {
  it("allows the first request and one revision, then stops", () => {
    expect(PLAN_REQUEST_LIMIT).toBe(2);
    expect(planRequestBudget(0)).toEqual({ allowed: true, remaining: 2 });
    expect(planRequestBudget(1)).toEqual({ allowed: true, remaining: 1 });
    expect(planRequestBudget(2)).toEqual({ allowed: false, remaining: 0 });
    expect(planRequestBudget(7)).toEqual({ allowed: false, remaining: 0 });
  });

  it("fails closed on an invalid count", () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(planRequestBudget(bad)).toEqual({ allowed: false, remaining: 0 });
  });
});

describe("shouldOfferPlanRevision", () => {
  it("offers a revision for an incorrect or missing correspondence, or invalid parameters", () => {
    const compiled = plan([
      ready("email"),
      open("owner", { correspondence: null, failures: [classifyPlanIssue({ code: "UNKNOWN_ALIAS", target: "owner", message: "m" })] }),
      open("phone", { claimed: null, correspondence: null }),
      open("score", { failures: [classifyPlanIssue({ code: "INCONSISTENT_ENTRY", target: "score", message: "m" })] }),
    ]);
    const offer = shouldOfferPlanRevision(compiled, []);
    expect(offer).toMatchObject({ offer: true, reason: "model-can-resolve", revisable: ["owner", "phone", "score"] });
  });

  it("offers a revision for a field-meaning ambiguity among Gemini's candidates", () => {
    const offer = shouldOfferPlanRevision(plan([open("opened_at", { correspondence: { aliases: ["f_02", "f_03"], by: "gemini" }, missing: ["field-meaning"] })]), []);
    expect(offer).toMatchObject({ offer: true, revisable: ["opened_at"] });
  });

  it("never offers the identical unresolvable request: only user answers remain", () => {
    const compiled = plan([
      ready("email"),
      open("status", { targetType: "enum", missing: ["category-labels"], failures: [classifyPlanIssue({ code: "INVENTED_CATEGORY_LABEL", target: "status", message: "m" })] }),
      open("opened_at", { missing: ["date-order"] }),
    ]);
    expect(shouldOfferPlanRevision(compiled, [])).toMatchObject({ offer: false, reason: "identical-request-will-fail", revisable: [], askUser: ["opened_at", "status"] });
  });

  it("never offers a revision for source-data problems or unsupported operations", () => {
    const failures: ClassifiedFailure[] = [
      { category: "invalid-source-data", target: "opened_at", next: "fix-source-data", evidence: ["UNRESOLVED:INVALID_DATE"] },
      { category: "missing-category-values", target: "status", next: "review-records", evidence: ["QUARANTINED:UNMAPPED_ENUM"] },
      { category: "unsupported-operation", target: "score", next: "map-manually", evidence: ["UNSUPPORTED_OPERATION"] },
      classifyProviderFailure("DISCLOSURE_REJECTED"),
    ];
    const offer = shouldOfferPlanRevision(plan([ready("opened_at"), ready("status"), ready("score")]), failures);
    expect(offer).toMatchObject({ offer: false, reason: "identical-request-will-fail", sourceData: ["opened_at", "status"] });
  });

  it("never asks the model to override the user's own field match", () => {
    const compiled = plan([ready("status", { correspondence: { aliases: ["f_02"], by: "user" }, operationOrigin: "user" })]);
    const failures: ClassifiedFailure[] = [{ category: "incorrect-correspondence", target: "status", next: "revise-with-model", evidence: ["SEMANTIC_MISMATCH"] }];
    expect(shouldOfferPlanRevision(compiled, failures)).toMatchObject({ offer: false, revisable: [], askUser: ["status"] });
  });

  it("reports nothing unresolved for a complete clean plan", () => {
    expect(shouldOfferPlanRevision(plan([ready("email")]), [])).toMatchObject({ offer: false, reason: "nothing-unresolved" });
  });

  it("respects the request budget when given", () => {
    const compiled = plan([open("phone", { claimed: null, correspondence: null })]);
    expect(shouldOfferPlanRevision(compiled, [], 1).offer).toBe(true);
    expect(shouldOfferPlanRevision(compiled, [], 2)).toMatchObject({ offer: false, reason: "budget-exhausted", revisable: ["phone"] });
  });

  it("does not treat a required no-source field as revisable", () => {
    const compiled = plan([open("region", { claimed: "no_source", readiness: "no_source", correspondence: null, missing: ["no-matching-source"] })]);
    expect(shouldOfferPlanRevision(compiled, [])).toMatchObject({ offer: false, reason: "identical-request-will-fail", askUser: ["region"] });
  });
});
