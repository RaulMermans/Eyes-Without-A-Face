/**
 * Sprint 18F (ADR 0022): answerable questions, the user's field combination, the labelled trim
 * refinement and the new local contradictions. Fictional inline data only.
 */
import { describe, expect, it } from "vitest";
import { buildDisclosureDraft, prepareTwin } from "../../src/workflow/pipeline.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import { compileIntentPlan } from "../../src/plan/compile.ts";
import { matchLocally } from "../../src/matching/local-matcher.ts";
import type { IntentPlanEntry, PlanAnswers } from "../../src/plan/types.ts";

const RECORDS = Array.from({ length: 10 }, (_, i) => ({
  code: `K-${100 + i}`,
  vorname: ["Lena", "Paul", "Mia", "Jan", "Eva"][i % 5],
  nachname: ["Klein", "Wolf", "Roth", "Graf", "Lang"][i % 5],
  firma: ["  Nordlicht GmbH", "Weber AG  "][i % 2],
  plz: ["10115", "20095"][i % 2],
  verwalter_email: `verwaltung${i}@example.com`,
  betrag_netto: 100 + i,
}));
const DESTINATION = {
  type: "object",
  properties: {
    id: { type: "string" },
    full_name: { type: "string" },
    company: { type: "string" },
    postal_code: { type: "string" },
    email: { type: "string", format: "email", description: "Email address of the customer." },
    amount_gross: { type: "number", description: "Amount including tax." },
  },
  required: ["id", "full_name", "postal_code"],
};

function setup() {
  const prep = prepareTwin({ records: RECORDS, datasetLabel: "imported.json", seed: 11 });
  if (!prep.ok) throw new Error("twin");
  const draft = buildDisclosureDraft({ prepared: prep.value, targetSchema: DESTINATION, destinationSemantics: false });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  const alias = (path: string) => prep.value.twin.bindings.aliasForPath(path)!;
  const compile = (entries: IntentPlanEntry[], answers: Partial<PlanAnswers> = {}) => {
    const validated = validateIntentPlan({ fields: entries, summary: "x" }, draft.value.payload);
    if (!validated.ok) throw new Error("plan");
    return compileIntentPlan({
      validated: validated.value,
      disclosure: draft.value.payload,
      prepared: prep.value,
      records: RECORDS,
      answers: { fieldMatches: {}, categoryMeanings: {}, semanticConfirmations: {}, ...answers },
      requestId: "00000000-18f",
    });
  };
  return { alias, compile };
}
const ready = (target: string, from: string[], transform: IntentPlanEntry["transform"], extra: Partial<IntentPlanEntry> = {}): IntentPlanEntry => ({ target, status: "ready", from, transform, confidence: "high", evidence: ["meaning"], missing: [], ...extra });

describe("18F compiler", () => {
  it("a user combination compiles as the existing concat, labelled the user's", () => {
    const { alias, compile } = setup();
    const compiled = compile([ready("id", [alias("code")], "copy")], { fieldCombinations: { full_name: { paths: ["vorname", "nachname"], separator: " " } } });
    const field = compiled.fields.find((item) => item.target === "full_name")!;
    expect(field.operation).toEqual({ op: "concat", from: [alias("vorname"), alias("nachname")], to: "full_name", params: { separator: " " } });
    expect(field.operationOrigin).toBe("user");
    // A single path or an undisclosed path never compiles.
    expect(compile([ready("id", [alias("code")], "copy")], { fieldCombinations: { full_name: { paths: ["vorname"], separator: " " } } }).fields.find((item) => item.target === "full_name")!.operation).toBeNull();
  });

  it("Gemini's copy of a padded text field compiles as trim, labelled as a local refinement", () => {
    const { alias, compile } = setup();
    const field = compile([ready("company", [alias("firma")], "copy")]).fields.find((item) => item.target === "company")!;
    expect(field.operation).toMatchObject({ op: "trim", from: alias("firma") });
    expect(field.refinement).toBe("trim-padded-whitespace");
    // An unpadded source keeps Gemini's copy.
    expect(compile([ready("id", [alias("code")], "copy")]).fields.find((item) => item.target === "id")!.refinement).toBeUndefined();
  });

  it("a translation for a free-text field and a required 'unsupported' field become answerable field questions", () => {
    const { alias, compile } = setup();
    const compiled = compile([
      { target: "postal_code", status: "needs_clarification", from: [alias("plz")], transform: "map_enum", confidence: "high", evidence: ["meaning"], missing: ["category-labels"] },
      { target: "full_name", status: "unsupported", from: [alias("vorname")], transform: "none", confidence: "low", evidence: [], missing: ["unsupported-transform"] },
    ]);
    for (const target of ["full_name", "postal_code"]) {
      expect(compiled.clarifications.filter((item) => item.target === target).map((item) => item.kind)).toEqual(["choose-field"]);
    }
  });
});

describe("18F local contradictions", () => {
  const prep = prepareTwin({ records: RECORDS, datasetLabel: "imported.json", seed: 11 });
  if (!prep.ok) throw new Error("twin");
  const sets = matchLocally({
    profile: prep.value.profile,
    records: RECORDS,
    targets: [
      { name: "email", type: "string", format: "email", required: false, localDescription: "Email address of the customer." },
      { name: "amount_gross", type: "number", required: false, localDescription: "Amount including tax." },
      { name: "full_name", type: "string", required: true },
    ],
  });
  const byTarget = new Map(sets.map((set) => [set.target, set]));
  it("another party's field, an opposed qualifier and a single name part are contradicted", () => {
    expect(byTarget.get("email")!.contradicted).toContain("verwalter_email");
    expect(byTarget.get("amount_gross")!.contradicted).toContain("betrag_netto");
    expect(byTarget.get("full_name")!.contradicted).toEqual(expect.arrayContaining(["vorname", "nachname"]));
  });
});
