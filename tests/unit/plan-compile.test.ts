/**
 * Sprint 18B (ADR 0018) — Intent Plan compiler. Every row of the "Compiled
 * readiness" table (docs/contracts/integration-intent-plan.md), per-operation
 * gate isolation, the user's explicit override, origin labelling, local date
 * evidence, and the absence of any default.
 */
import { describe, expect, it, vi } from "vitest";
import type { MappingContract, MappingOperation } from "../../src/domain/contracts/types.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { acceptCompiledPlan, compileIntentPlan } from "../../src/plan/compile.ts";
import { buildClarifications } from "../../src/plan/clarify.ts";
import { PLAN_MAPPING_PREFIX, type CompiledField, type CompiledIntegration } from "../../src/plan/types.ts";
import type { WorkspaceState } from "../../src/app/workspace-state.ts";
import { crmDemo } from "../helpers/export-workspace.ts";
import { entry, planSetup, SLASH_DESTINATION, SLASH_RECORDS, validatedPlan } from "../helpers/plan-fixtures.ts";

vi.mock("../../src/plan/failures.ts", async (original) => {
  const { realOr, failuresFallback } = await import("../helpers/plan-fixtures.ts");
  return realOr(original as () => Promise<typeof import("../../src/plan/failures.ts")>, failuresFallback);
});
vi.mock("../../src/plan/clarify.ts", async (original) => {
  const real = (await original()) as typeof import("../../src/plan/clarify.ts");
  return {
    ...real,
    buildClarifications: vi.fn((fields: Parameters<typeof real.buildClarifications>[0], localPathFor: Parameters<typeof real.buildClarifications>[1]) => {
      try {
        return real.buildClarifications(fields, localPathFor);
      } catch {
        return [];
      }
    }),
  };
});

const crm = () => planSetup({ ...crmDemo(), reservedRecords: null });
const field = (compiled: CompiledIntegration, target: string): CompiledField => {
  const found = compiled.fields.find((item) => item.target === target);
  if (!found) throw new Error(target);
  return found;
};
const MEANING = { source: "account_state", values: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" } };

/** The Gemini part of a good CRM plan: every non-enum field ready. */
function crmReadyEntries(s: ReturnType<typeof crm>) {
  return [
    entry({ target: "id", status: "ready", from: [s.alias("customer_id")], transform: "copy" }),
    entry({ target: "email", status: "ready", from: [s.alias("email_address")], transform: "normalize_email" }),
    entry({ target: "createdAt", status: "ready", from: [s.alias("joined_at")], transform: "parse_date", inputFormat: "YYYY-MM-DD" }),
    entry({ target: "organization", status: "ready", from: [s.alias("company_name")], transform: "trim" }),
  ];
}
const statusWithheld = (s: ReturnType<typeof crm>) =>
  entry({ target: "status", status: "needs_clarification", from: [s.alias("account_state")], transform: "map_enum", missing: ["category-labels"] });

function slashSetup(overrides: WorkspaceState["overrides"] = {}) {
  const base = crmDemo();
  const start: WorkspaceState = { ...base, source: { ...base.source!, label: "fictional-renewals", records: SLASH_RECORDS }, reservedRecords: null, destinationText: SLASH_DESTINATION, overrides };
  return planSetup(start);
}

function allOperations(contract: MappingContract | null): MappingOperation[] {
  return contract?.operations ?? [];
}

describe("PLAN-C1 ready entries become Gemini operations through the unchanged gate", () => {
  it("every accepted ready entry compiles; mapping id, origin, destination order, alias-level contract", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan(crmReadyEntries(s))));
    expect(compiled.mappingId).toBe(`${PLAN_MAPPING_PREFIX}abcdef01`);
    expect(compiled.fields.map((item) => item.target)).toEqual(["id", "email", "status", "createdAt", "organization"]);
    for (const target of ["id", "email", "createdAt", "organization"]) {
      expect(field(compiled, target)).toMatchObject({ readiness: "ready", claimed: "ready", operationOrigin: "gemini", missing: [], correspondence: { by: "gemini" } });
    }
    expect(validateContract(compiled.aliasContract).valid).toBe(true);
    expect(compiled.aliasContract!.operations.map((op) => op.to)).toEqual(["id", "email", "createdAt", "organization"]);
    expect(compiled.aliasContract!.operations.find((op) => op.to === "createdAt")).toEqual({ op: "parse_date", from: s.alias("joined_at"), to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } });
    expect(compiled.counts).toMatchObject({ fields: 5, executable: 4, byGemini: 4, byUser: 0 });
  });
});

describe("PLAN-C2 category names withheld: Gemini gives the field, the user the translation", () => {
  it("not yet translated: needs_clarification(category-labels), the correspondence is kept, nothing is built", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)])));
    expect(field(compiled, "status")).toMatchObject({
      readiness: "needs_clarification",
      missing: ["category-labels"],
      operation: null,
      operationOrigin: null,
      correspondence: { aliases: [s.alias("account_state")], by: "gemini" },
    });
    expect(compiled.complete).toBe(false);
    expect(compiled.unwrittenRequired).toEqual(["status"]);
  });

  it("translated by the user: map_enum with unmapped fail, origin gemini+user", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)]), { categoryMeanings: { status: MEANING } }));
    const status = field(compiled, "status");
    expect(status).toMatchObject({ readiness: "ready", operationOrigin: "gemini+user", correspondence: { by: "gemini" } });
    expect(status.operation).toEqual({ op: "map_enum", from: s.alias("account_state"), to: "status", params: { map: MEANING.values, unmapped: "fail" } });
    expect(compiled.complete).toBe(true);
    expect(compiled.unwrittenRequired).toEqual([]);
    expect(compiled.counts).toMatchObject({ executable: 5, byGemini: 4, byUser: 1 });
  });

  it("an incomplete translation, or one of a different field, builds nothing", () => {
    const s = crm();
    const plan = validatedPlan([...crmReadyEntries(s), statusWithheld(s)]);
    const partial = compileIntentPlan(s.input(plan, { categoryMeanings: { status: { source: "account_state", values: { active_customer: "active" } } } }));
    expect(field(partial, "status").operation).toBeNull();
    const other = compileIntentPlan(s.input(plan, { categoryMeanings: { status: { source: "company_name", values: MEANING.values } } }));
    expect(field(other, "status").operation).toBeNull();
  });

  it("an invented translation (correspondence-only) keeps the field match and drops the model's labels", () => {
    const s = crm();
    const invented = entry({ target: "status", status: "ready", from: [s.alias("account_state")], transform: "map_enum", valueMap: { Active: "active", Gone: "inactive" } });
    const plan = validatedPlan([
      ...crmReadyEntries(s),
      { entry: invented, verdict: "correspondence-only", issues: [{ code: "INVENTED_CATEGORY_LABEL", target: "status", message: "Label not disclosed." }] },
    ]);
    const open = compileIntentPlan(s.input(plan));
    expect(field(open, "status")).toMatchObject({ readiness: "needs_clarification", missing: ["category-labels"], operation: null, correspondence: { by: "gemini" } });
    expect(field(open, "status").failures.map((item) => item.evidence).flat()).toContain("INVENTED_CATEGORY_LABEL");
    expect(JSON.stringify(open.aliasContract)).not.toContain("Gone");
    const done = compileIntentPlan(s.input(plan, { categoryMeanings: { status: MEANING } }));
    expect(field(done, "status").operation).toMatchObject({ params: { map: MEANING.values, unmapped: "fail" } });
    expect(JSON.stringify(done.aliasContract)).not.toContain("Gone");
  });

  it("with the names disclosed, Gemini's own translation compiles (origin gemini) through the gate", () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null, overrides: { account_state: { discloseCategories: true } } });
    const status = entry({ target: "status", status: "ready", from: [s.alias("account_state")], transform: "map_enum", valueMap: MEANING.values });
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), status])));
    expect(field(compiled, "status")).toMatchObject({ readiness: "ready", operationOrigin: "gemini" });
    expect(field(compiled, "status").operation).toMatchObject({ params: { unmapped: "fail" } });
  });
});

describe("PLAN-C3 per-operation gate isolation", () => {
  it("one operation the gate refuses never sinks the others", () => {
    const s = crm();
    // An accepted map_enum over WITHHELD labels: convertProposal refuses it (INVALID_ENUM_MAPPING).
    const bad = entry({ target: "status", status: "ready", from: [s.alias("account_state")], transform: "map_enum", valueMap: { active_customer: "active" } });
    const longSeparator = entry({ target: "organization", status: "ready", from: [s.alias("company_name"), s.alias("customer_id")], transform: "concat", separator: "x".repeat(20) });
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s).slice(0, 3), bad, longSeparator])));
    expect(field(compiled, "status")).toMatchObject({ readiness: "needs_clarification", operation: null, missing: ["category-labels"] });
    expect(field(compiled, "status").failures).toEqual(expect.arrayContaining([expect.objectContaining({ category: "invented-values", target: "status", evidence: ["INVALID_ENUM_MAPPING"] })]));
    expect(field(compiled, "organization")).toMatchObject({ readiness: "unsupported", operation: null });
    expect(field(compiled, "organization").failures).toEqual(expect.arrayContaining([expect.objectContaining({ category: "invalid-parameters", evidence: ["INVALID_PARAMS"] })]));
    expect(compiled.aliasContract!.operations.map((op) => op.to)).toEqual(["id", "email", "createdAt"]);
  });

  it("a refused Gemini translation can still be completed by the user's own translation", () => {
    const s = crm();
    const bad = entry({ target: "status", status: "ready", from: [s.alias("account_state")], transform: "map_enum", valueMap: { active_customer: "active" } });
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), bad]), { categoryMeanings: { status: MEANING } }));
    expect(field(compiled, "status")).toMatchObject({ readiness: "ready", operationOrigin: "gemini+user" });
    expect(field(compiled, "status").failures.map((item) => item.category)).toContain("invented-values");
  });
});

describe("PLAN-C4 slash dates and local evidence", () => {
  it("unproven order, not confirmed: needs_clarification(date-order); confirmed: the user's order, gemini+user", () => {
    const s = slashSetup();
    const signed = entry({ target: "signedOn", status: "ready", from: [s.alias("signed")], transform: "parse_date", inputFormat: "MM/DD/YYYY" });
    const plan = validatedPlan([entry({ target: "ref", status: "ready", from: [s.alias("ref")], transform: "copy" }), signed]);
    const open = compileIntentPlan(s.input(plan));
    expect(field(open, "signedOn")).toMatchObject({ readiness: "needs_clarification", missing: ["date-order"], operation: null, correspondence: { by: "gemini" } });
    const confirmed = compileIntentPlan(s.input(plan, { semanticConfirmations: { signed: "DD/MM/YYYY" } }));
    expect(field(confirmed, "signedOn")).toMatchObject({ readiness: "ready", operationOrigin: "gemini+user" });
    expect(field(confirmed, "signedOn").operation).toEqual({ op: "parse_date", from: s.alias("signed"), to: "signedOn", params: { inputFormat: "DD/MM/YYYY" } });
  });

  it("the plan itself says date-order is missing: asked, then built only from the user's confirmation", () => {
    const s = slashSetup();
    const signed = entry({ target: "signedOn", status: "needs_clarification", from: [s.alias("signed")], transform: "parse_date", missing: ["date-order"] });
    const open = compileIntentPlan(s.input(validatedPlan([signed])));
    expect(field(open, "signedOn")).toMatchObject({ readiness: "needs_clarification", missing: ["date-order"], operation: null });
    const done = compileIntentPlan(s.input(validatedPlan([signed]), { semanticConfirmations: { signed: "MM/DD/YYYY" } }));
    expect(field(done, "signedOn").operation).toMatchObject({ params: { inputFormat: "MM/DD/YYYY" } });
    expect(field(done, "signedOn").operationOrigin).toBe("gemini+user");
  });

  it("an order that contradicts proven local evidence is a semantic disagreement: asked, never switched silently", () => {
    const s = slashSetup();
    const renewed = entry({ target: "renewedOn", status: "ready", from: [s.alias("renewed")], transform: "parse_date", inputFormat: "MM/DD/YYYY" });
    const compiled = compileIntentPlan(s.input(validatedPlan([renewed])));
    const result = field(compiled, "renewedOn");
    expect(result).toMatchObject({ readiness: "needs_clarification", missing: ["date-order"], operation: null });
    expect(result.failures).toEqual([expect.objectContaining({ category: "semantic-disagreement", target: "renewedOn" })]);
    // Never switched to the proven order behind the user's back.
    expect(JSON.stringify(compiled.aliasContract)).not.toContain("DD/MM/YYYY");
    const confirmed = compileIntentPlan(s.input(validatedPlan([renewed]), { semanticConfirmations: { renewed: "DD/MM/YYYY" } }));
    expect(field(confirmed, "renewedOn").operation).toMatchObject({ params: { inputFormat: "DD/MM/YYYY" } });
    expect(field(confirmed, "renewedOn").operationOrigin).toBe("gemini+user");
  });

  it("an order the profile proves compiles as Gemini's", () => {
    const s = slashSetup();
    const renewed = entry({ target: "renewedOn", status: "ready", from: [s.alias("renewed")], transform: "parse_date", inputFormat: "DD/MM/YYYY" });
    const compiled = compileIntentPlan(s.input(validatedPlan([renewed])));
    expect(field(compiled, "renewedOn")).toMatchObject({ readiness: "ready", operationOrigin: "gemini", failures: [] });
  });
});

describe("PLAN-C5 the user's explicit field choice", () => {
  it("overrides the plan: rule as Sprint 15 deriveRule, origin user", () => {
    const s = crm();
    const wrong = entry({ target: "email", status: "ready", from: [s.alias("company_name")], transform: "copy" });
    const compiled = compileIntentPlan(s.input(validatedPlan([wrong]), { fieldMatches: { email: "email_address" } }));
    expect(field(compiled, "email")).toMatchObject({
      readiness: "ready",
      operationOrigin: "user",
      correspondence: { aliases: [s.alias("email_address")], by: "user" },
      operation: { op: "normalize_email", from: s.alias("email_address"), to: "email" },
    });
  });

  it("chooses a field for an unaddressed or no-source destination field; a translation of the chosen field completes an enum", () => {
    const s = crm();
    const compiled = compileIntentPlan(
      s.input(validatedPlan([entry({ target: "status", status: "no_source", missing: ["no-matching-source"] })], ["id"]), {
        fieldMatches: { id: "customer_id", status: "account_state" },
        categoryMeanings: { status: MEANING },
      }),
    );
    expect(field(compiled, "id")).toMatchObject({ claimed: null, readiness: "ready", operationOrigin: "user", operation: { op: "copy", from: s.alias("customer_id"), to: "id" } });
    expect(field(compiled, "status")).toMatchObject({ claimed: "no_source", readiness: "ready", operationOrigin: "user", operation: { op: "map_enum", params: { unmapped: "fail" } } });
  });

  it("null = the user chose no field: nothing is built, even when Gemini had a ready operation", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan(crmReadyEntries(s)), { fieldMatches: { organization: null } }));
    expect(field(compiled, "organization")).toMatchObject({ readiness: "no_source", operation: null, correspondence: null, missing: ["no-matching-source"] });
    expect(compiled.unwrittenRequired).toContain("organization");
  });

  it("choosing the very field Gemini chose keeps Gemini's operation (agreement)", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan(crmReadyEntries(s)), { fieldMatches: { organization: "company_name" } }));
    expect(field(compiled, "organization")).toMatchObject({ operationOrigin: "gemini", correspondence: { by: "gemini" }, operation: { op: "trim" } });
  });

  it("a field kept local cannot be chosen: nothing is built (privacy blocker)", () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null, overrides: { company_name: { shareable: false } } });
    const compiled = compileIntentPlan(s.input(validatedPlan([]), { fieldMatches: { organization: "company_name" } }));
    expect(field(compiled, "organization")).toMatchObject({ operation: null, readiness: "unsupported" });
    expect(field(compiled, "organization").failures.map((item) => item.category)).toContain("privacy-blocker");
  });
});

describe("PLAN-C6 unresolved fields and planning artifacts", () => {
  it("no_source stays no_source; unaddressed is unresolved (needs_clarification), never no_source; never a default", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan([entry({ target: "status", status: "no_source", missing: ["no-matching-source"] })], ["id", "email", "createdAt", "organization"])));
    expect(field(compiled, "status")).toMatchObject({ readiness: "no_source", operation: null, missing: ["no-matching-source"] });
    for (const target of ["id", "email", "createdAt", "organization"]) expect(field(compiled, target)).toMatchObject({ claimed: null, readiness: "needs_clarification", operation: null });
    expect(compiled.unwrittenRequired).toEqual(["id", "email", "status", "createdAt", "organization"]);
  });

  it("a plan with zero executable fields is not an integration", () => {
    const s = crm();
    const input = s.input(validatedPlan([statusWithheld(s)], ["id", "email", "createdAt", "organization"]));
    const compiled = compileIntentPlan(input);
    expect(compiled.aliasContract).toBeNull();
    expect(compiled.complete).toBe(false);
    expect(compiled.counts.executable).toBe(0);
    const result = acceptCompiledPlan(compiled, input);
    expect(result).toMatchObject({ ok: false, stage: "plan" });
  });

  it("rejected entries give no correspondence; their issues are classified failures", () => {
    const s = crm();
    const dup = entry({ target: "id", status: "ready", from: [s.alias("customer_id")], transform: "copy" });
    const issue = { code: "DUPLICATE_TARGET" as const, target: "id", message: "Two entries." };
    const compiled = compileIntentPlan(s.input(validatedPlan([{ entry: dup, verdict: "rejected", issues: [issue] }, { entry: dup, verdict: "rejected", issues: [issue] }])));
    expect(field(compiled, "id")).toMatchObject({ readiness: "needs_clarification", correspondence: null, operation: null });
    expect(field(compiled, "id").failures).toHaveLength(2);
  });

  it("no compiled contract ever contains a default or a non-fail enum fallback", () => {
    const s = crm();
    const variants = [
      compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)]), { categoryMeanings: { status: { source: "account_state", values: { active_customer: "active", inactive_customer: null, prospect: "prospect" } } } })),
      compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)]), { categoryMeanings: { status: MEANING } })),
      compileIntentPlan(s.input(validatedPlan(crmReadyEntries(s)), { fieldMatches: { status: "account_state" }, categoryMeanings: { status: MEANING } })),
    ];
    for (const compiled of variants) {
      for (const operation of allOperations(compiled.aliasContract)) {
        expect(operation.op).not.toBe("default_if_missing");
        if (operation.op === "map_enum") {
          expect(operation.params.unmapped).toBe("fail");
          expect(Object.hasOwn(operation.params, "default")).toBe(false);
        }
      }
    }
    // A label the user set aside is never translated.
    expect(field(variants[0]!, "status").operation).toMatchObject({ params: { map: { active_customer: "active", prospect: "prospect" } } });
    expect(JSON.stringify(field(variants[0]!, "status").operation)).not.toContain("inactive_customer");
  });
});

describe("PLAN-C7 acceptance and clarifications", () => {
  it("acceptCompiledPlan resolves the alias contract locally; origin and rationale come from the plan", () => {
    const s = crm();
    const input = s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)]));
    const compiled = compileIntentPlan(input);
    const result = acceptCompiledPlan(compiled, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.converted.origin).toBe("gemini-cloud");
    expect(result.value.converted.rationale).toBe(input.validated.plan.summary);
    expect(result.value.converted.contract).toBe(compiled.aliasContract);
    expect(result.value.converted.warnings).toEqual([expect.objectContaining({ code: "REQUIRED_TARGET_UNMAPPED" })]);
    expect(result.value.resolved.executable.operations.map((op) => ("from" in op ? op.from : null))).toEqual(["customer_id", "email_address", "joined_at", "company_name"]);
    // A simulated answer is never labelled Gemini.
    const simulated = acceptCompiledPlan(compiled, { ...input, origin: "test-adapter" });
    expect(simulated.ok && simulated.value.converted.origin).toBe("test-adapter");
  });

  it("clarifications come from buildClarifications(fields, alias → local path)", () => {
    const s = crm();
    const compiled = compileIntentPlan(s.input(validatedPlan([...crmReadyEntries(s), statusWithheld(s)])));
    const calls = vi.mocked(buildClarifications).mock.calls;
    const [fields, localPathFor] = calls.at(-1)!;
    expect(fields).toEqual(compiled.fields);
    expect(localPathFor(s.alias("account_state"))).toBe("account_state");
    expect(localPathFor("f_99")).toBeNull();
    expect(Array.isArray(compiled.clarifications)).toBe(true);
  });
});
