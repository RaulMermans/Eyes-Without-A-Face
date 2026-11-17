/**
 * Sprint 18C (ADR 0020 §7) — an uncertain Gemini match is a question, never an executed match.
 *
 * S18C-K-001  high confidence: executed as before, no question
 * S18C-K-002  medium / low confidence: choose-field with Gemini's pick first; nothing executed
 * S18C-K-003  the user confirms the pick: the field runs (origin user); the integration completes
 * S18C-K-004  a wrong low-confidence match no longer transforms wrong records
 *
 * Data: the readable Sprint 18B dev split only.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildScenario18c, scorePlan18c, type Eval18cScenario } from "../../src/evaluation/eval-18c.ts";
import { compileIntentPlan } from "../../src/plan/compile.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import type { IntentPlan, IntentPlanEntry, PlanConfidence } from "../../src/plan/types.ts";
import type { Built18b } from "../../src/evaluation/eval-18b.ts";

const crm = JSON.parse(fs.readFileSync("tests/fixtures/eval-18b/dev/crm-contacts-to-helpdesk-requester.json", "utf8")) as Eval18cScenario;
const ctx = { config: "P1" as const, trial: 1, index: 0 };

function plan(built: Built18b, confidence: Partial<Record<string, PlanConfidence>> = {}, source: Partial<Record<string, string>> = {}): IntentPlan {
  const alias = (p: string) => built.prepared.twin.bindings.aliasForPath(p)!;
  const fields = Object.entries(crm.groundTruth).map(([target, g]): IntentPlanEntry => {
    const base = { target, confidence: confidence[target] ?? ("high" as const), evidence: ["meaning" as const] };
    const from = source[target] ?? g.source;
    if (g.transform === "none") return { ...base, status: "no_source", from: [], transform: "none", missing: ["no-matching-source"] };
    if (g.transform === "concat") return { ...base, status: "ready", from: g.sources!.map(alias), transform: "concat", separator: g.separator!, missing: [] };
    if (g.transform === "map_enum") return { ...base, status: "needs_clarification", from: [alias(from!)], transform: "map_enum", missing: ["category-labels"] };
    if (g.transform === "parse_date") return { ...base, status: "needs_clarification", from: [alias(from!)], transform: "parse_date", missing: ["date-order"] };
    return { ...base, status: "ready", from: [alias(from!)], transform: g.transform, missing: [] };
  });
  return { fields, summary: "test" };
}

async function compiled(confidence: Partial<Record<string, PlanConfidence>>) {
  const built = (await buildScenario18c(crm, "P1"))!;
  const validation = validateIntentPlan(plan(built, confidence), built.payload);
  if (!validation.ok) throw new Error("invalid plan");
  return {
    built,
    result: compileIntentPlan({ validated: validation.value, disclosure: built.payload, prepared: built.prepared, records: crm.records, requestId: "s18ck000", answers: { fieldMatches: {}, categoryMeanings: {}, semanticConfirmations: {} } }),
  };
}

describe("ADR 0020 §7 confidence gate", () => {
  it("S18C-K-001 high confidence: executed, no field question", async () => {
    const { result } = await compiled({});
    expect(result.fields.find((field) => field.target === "external_id")).toMatchObject({ readiness: "ready", operationOrigin: "gemini" });
    expect(result.clarifications.filter((item) => item.kind === "choose-field")).toHaveLength(0);
  });

  it.each(["medium", "low"] as const)("S18C-K-002 %s confidence: a choose-field question with Gemini's pick first; nothing executed", async (level) => {
    const { built, result } = await compiled({ external_id: level });
    const field = result.fields.find((item) => item.target === "external_id")!;
    expect(field).toMatchObject({ readiness: "needs_clarification", operation: null, correspondence: { by: "gemini" } });
    const question = result.clarifications.find((item) => item.id === "choose-field:external_id")!;
    expect(question.reason).toBe("field-meaning");
    expect(question.localPaths[0]).toBe("c_ContactId");
    expect(question.aliases).toEqual([built.prepared.twin.bindings.aliasForPath("c_ContactId")]);
    expect(result.complete).toBe(false);
  });

  it("S18C-K-003 the user confirms the pick: one field choice, then a complete, correct integration", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    const score = scorePlan18c(crm, built, JSON.stringify(plan(built, { external_id: "low", phone: "medium" })), ctx);
    expect(score.effort.manualOps).toBe(2);
    expect(score.e2eSuccess).toBe(true);
  });

  it("S18C-K-004 a wrong low-confidence match is asked, so no wrong record is transformed", async () => {
    const built = (await buildScenario18c(crm, "P1"))!;
    // Wrong id field, low confidence: the oracle (the user) answers with the true field.
    const wrong = scorePlan18c(crm, built, JSON.stringify(plan(built, { external_id: "low" }, { external_id: "c_OpportunityId" })), ctx);
    expect(wrong.e2e.incorrectTransformed).toBe(0);
    expect(wrong.e2eSuccess).toBe(true);
    // The same wrong match at high confidence is executed and every transformed record is wrong: the remaining limit.
    const confident = scorePlan18c(crm, built, JSON.stringify(plan(built, {}, { external_id: "c_OpportunityId" })), ctx);
    expect(confident.e2eSuccess).toBe(false);
  });
});

describe("ADR 0020 §7 exemption", () => {
  it("S18C-K-005 a medium-confidence category match awaiting translation is asked once, as the translation", async () => {
    const { result } = await compiled({ requester_type: "medium" });
    expect(result.clarifications.filter((item) => item.target === "requester_type").map((item) => item.kind)).toEqual(["translate-categories"]);
  });
  it("S18C-K-006 a medium-confidence date match is still confirmed first", async () => {
    const { result } = await compiled({ created_at: "medium" });
    expect(result.clarifications.filter((item) => item.target === "created_at").map((item) => item.kind)).toEqual(["choose-field"]);
  });
});
