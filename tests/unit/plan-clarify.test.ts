import { describe, expect, it } from "vitest";
import { buildClarifications, CLARIFICATION_COPY, clarificationProgress } from "../../src/plan/clarify.ts";
import { classifyPlanIssue } from "../../src/plan/failures.ts";
import type { ClarificationKind, CompiledField } from "../../src/plan/types.ts";

function field(over: Partial<CompiledField> & { target: string }): CompiledField {
  return {
    required: true,
    targetType: "string",
    claimed: "needs_clarification",
    readiness: "needs_clarification",
    correspondence: null,
    operation: null,
    operationOrigin: null,
    missing: [],
    failures: [],
    ...over,
  };
}

const PATHS: Record<string, string> = { f_01: "account.state", f_02: "opened", f_03: "created", f_04: "mail" };
const localPathFor = (alias: string) => PATHS[alias] ?? null;

describe("buildClarifications", () => {
  it("never asks about an executable field", () => {
    const fields = [
      field({
        target: "email",
        claimed: "ready",
        readiness: "ready",
        correspondence: { aliases: ["f_04"], by: "gemini" },
        operation: { op: "normalize_email", from: "f_04", to: "email" },
        operationOrigin: "gemini",
      }),
    ];
    expect(buildClarifications(fields, localPathFor)).toEqual([]);
  });

  it("produces every kind with the documented aliases, local paths and reasons", () => {
    const fields = [
      field({ target: "status", targetType: "enum", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["category-labels"] }),
      field({ target: "opened_at", correspondence: { aliases: ["f_02"], by: "gemini" }, missing: ["date-order"] }),
      field({ target: "created_at", correspondence: { aliases: ["f_02", "f_03"], by: "gemini" }, missing: ["field-meaning"] }),
      field({ target: "region", claimed: "no_source", readiness: "no_source", missing: ["no-matching-source"] }),
    ];
    const list = buildClarifications(fields, localPathFor);
    const byId = Object.fromEntries(list.map((item) => [item.id, item]));
    expect(byId["translate-categories:status"]).toMatchObject({ kind: "translate-categories", aliases: ["f_01"], localPaths: ["account.state"], reason: "category-labels" });
    expect(byId["confirm-date-order:opened_at"]).toMatchObject({ aliases: ["f_02"], localPaths: ["opened"], reason: "date-order" });
    expect(byId["choose-field:created_at"]).toMatchObject({ aliases: ["f_02", "f_03"], localPaths: ["opened", "created"], reason: "field-meaning" });
    expect(byId["missing-required-source:region"]).toMatchObject({ aliases: [], localPaths: [], reason: "no-matching-source" });
    const kinds = new Set(list.map((item) => item.kind));
    expect(kinds).toEqual(new Set<ClarificationKind>(["translate-categories", "confirm-date-order", "choose-field", "missing-required-source"]));
    for (const item of list) expect(item.id).toBe(`${item.kind}:${item.target}`);
  });

  it("asks choose-field for an unaddressed field without candidates", () => {
    const [only] = buildClarifications([field({ target: "phone", claimed: null })], localPathFor);
    expect(only).toMatchObject({ id: "choose-field:phone", reason: "unaddressed", aliases: [], localPaths: [] });
  });

  it("asks choose-field for a rejected entry", () => {
    const rejected = field({ target: "owner", claimed: "ready", failures: [classifyPlanIssue({ code: "UNKNOWN_ALIAS", target: "owner", entryIndex: 2, message: "x" })] });
    const [only] = buildClarifications([rejected], localPathFor);
    expect(only).toMatchObject({ id: "choose-field:owner", reason: "rejected-entry", aliases: [] });
  });

  it("marks a contradicted date order as semantic-disagreement", () => {
    const disputed = field({
      target: "opened_at",
      correspondence: { aliases: ["f_02"], by: "gemini" },
      missing: ["date-order"],
      failures: [{ category: "semantic-disagreement", target: "opened_at", next: "ask-user", evidence: ["SEMANTIC_DATE_ORDER_CONFLICT"] }],
    });
    expect(buildClarifications([disputed], localPathFor)[0]).toMatchObject({ kind: "confirm-date-order", reason: "semantic-disagreement" });
  });

  it("does not ask dependent questions before the field is chosen", () => {
    const list = buildClarifications(
      [field({ target: "opened_at", correspondence: { aliases: ["f_02", "f_03"], by: "gemini" }, missing: ["field-meaning", "date-order"] })],
      localPathFor,
    );
    expect(list.map((item) => item.id)).toEqual(["choose-field:opened_at"]);
  });

  it("never asks about an optional field nothing can fill, nor an unsupported transform", () => {
    const list = buildClarifications(
      [
        field({ target: "nickname", required: false, claimed: "no_source", readiness: "no_source", missing: ["no-matching-source"] }),
        field({ target: "score", claimed: "unsupported", readiness: "unsupported", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["unsupported-transform"] }),
      ],
      localPathFor,
    );
    expect(list).toEqual([]);
  });

  it("uses the destination-value reason for a required destination value", () => {
    const [only] = buildClarifications([field({ target: "tenant", claimed: "no_source", readiness: "no_source", missing: ["destination-value"] })], localPathFor);
    expect(only).toMatchObject({ kind: "missing-required-source", reason: "destination-value" });
  });

  it("asks translate-categories for a business rule on a fixed-list field only", () => {
    const list = buildClarifications(
      [
        field({ target: "tier", targetType: "enum", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["business-rule"] }),
        field({ target: "note", targetType: "string", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["business-rule"] }),
      ],
      localPathFor,
    );
    expect(list.map((item) => item.id)).toEqual(["translate-categories:tier"]);
    expect(list[0]?.reason).toBe("business-rule");
  });

  it("orders required before optional, then blocking kinds first, then destination order", () => {
    const fields = [
      field({ target: "opt_status", required: false, targetType: "enum", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["category-labels"] }),
      field({ target: "opened_at", correspondence: { aliases: ["f_02"], by: "gemini" }, missing: ["date-order"] }),
      field({ target: "status", targetType: "enum", correspondence: { aliases: ["f_01"], by: "gemini" }, missing: ["category-labels"] }),
      field({ target: "region", claimed: "no_source", readiness: "no_source", missing: ["no-matching-source"] }),
      field({ target: "opt_choice", required: false, claimed: null }),
      field({ target: "created_at", correspondence: { aliases: ["f_02", "f_03"], by: "gemini" }, missing: ["field-meaning"] }),
    ];
    const list = buildClarifications(fields, localPathFor);
    expect(list.map((item) => item.id)).toEqual([
      "choose-field:created_at",
      "missing-required-source:region",
      "translate-categories:status",
      "confirm-date-order:opened_at",
      "choose-field:opt_choice",
      "translate-categories:opt_status",
    ]);
    const priorities = list.map((item) => item.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    const firstOptional = list.findIndex((item) => !item.required);
    expect(list.slice(firstOptional).every((item) => !item.required)).toBe(true);
  });

  it("drops unresolvable local paths and never offers a default answer", () => {
    const [only] = buildClarifications([field({ target: "x", correspondence: { aliases: ["f_99", "f_02"], by: "gemini" }, missing: ["field-meaning"] })], localPathFor);
    expect(only?.localPaths).toEqual(["opened"]);
    for (const value of Object.values(only ?? {})) expect(typeof value === "object" && value !== null && "default" in value).toBe(false);
    expect(Object.keys(only ?? {}).sort()).toEqual(["aliases", "id", "kind", "localPaths", "priority", "reason", "required", "target"]);
  });

  it("is deterministic", () => {
    const fields = [field({ target: "b", claimed: null }), field({ target: "a", claimed: null })];
    expect(buildClarifications(fields, localPathFor)).toEqual(buildClarifications(fields, localPathFor));
  });
});

describe("CLARIFICATION_COPY", () => {
  it("is plain, one sentence, and free of jargon and defaults", () => {
    for (const [kind, copy] of Object.entries(CLARIFICATION_COPY)) {
      expect(copy.help.length, kind).toBeGreaterThan(20);
      expect(copy.help.match(/[.!?](\s|$)/g)?.length, kind).toBe(1);
      expect(copy.help, kind).not.toMatch(/alias|enum|schema|default|json|null|mapping|gemini/i);
      expect(copy.title("Status"), kind).toContain("Status");
    }
  });
});

describe("clarificationProgress", () => {
  it("counts open required and optional questions", () => {
    const list = buildClarifications([field({ target: "a", claimed: null }), field({ target: "b", claimed: null, required: false })], localPathFor);
    expect(clarificationProgress(list)).toEqual({ required: 1, optional: 1 });
    expect(clarificationProgress([])).toEqual({ required: 0, optional: 0 });
  });
});
