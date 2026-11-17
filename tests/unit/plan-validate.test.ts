/**
 * Sprint 18B (ADR 0018) — Integration Intent Plan validator.
 *
 * S18B-V-001  readiness states accepted as written
 * S18B-V-002  whole-plan rejection (MALFORMED_PLAN, DISCLOSURE_MISSING_TARGET)
 * S18B-V-003  entry-level rejection (UNKNOWN_TARGET_FIELD, UNKNOWN_ALIAS, INCONSISTENT_ENTRY, DUPLICATE_TARGET)
 * S18B-V-004  translation rejected, correspondence kept (INVENTED_CATEGORY_LABEL, INVALID_ENUM_VALUE)
 * S18B-V-005  unaddressed destination fields
 * S18B-V-006  messages never quote model text beyond 32 characters
 */
import { describe, expect, it } from "vitest";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";
import type { IntentPlanEntry, PlanIssue, ValidatedIntentPlan } from "../../src/plan/types.ts";
import { MAX_PLAN_TEXT_BYTES, parseIntentPlanText, validateIntentPlan } from "../../src/plan/validate.ts";

const disclosure = (overrides: Partial<CloudDisclosurePayload> = {}): CloudDisclosurePayload =>
  ({
    contractKind: "cloud-disclosure",
    schemaVersion: "1.1.0",
    payloadId: "p",
    phantomId: "phantom-x",
    destination: { provider: "firebase-ai-logic", backend: "google-ai", model: "gemini-3.5-flash-lite", purpose: "mapping-proposal" },
    purpose: "mapping-proposal",
    entities: [{ id: "record", label: "Source record" }],
    fields: [
      { alias: "f_01", entityId: "record", type: "string", semanticDescriptor: "Email address" },
      { alias: "f_02", entityId: "record", type: "enum", semanticDescriptor: "Lifecycle status category; category labels withheld" },
      { alias: "f_03", entityId: "record", type: "enum", semanticDescriptor: "Lifecycle status category", enumValues: ["live", "gone"] },
      { alias: "f_04", entityId: "record", type: "date", semanticDescriptor: "Calendar date in MM/DD/YYYY format" },
      { alias: "f_05", entityId: "record", type: "date", semanticDescriptor: "Calendar date" },
      { alias: "f_06", entityId: "record", type: "string", semanticDescriptor: "Person name" },
      { alias: "f_07", entityId: "record", type: "string", semanticDescriptor: "Person name" },
    ],
    syntheticExamples: [],
    target: {
      fields: [
        { name: "email", type: "string", required: true, format: "email" },
        { name: "status", type: "enum", required: true, enumValues: ["active", "inactive"] },
        { name: "opened_at", type: "string", required: false, format: "date" },
        { name: "full_name", type: "string", required: false },
        { name: "region", type: "string", required: false },
      ],
    },
    ...overrides,
  }) as CloudDisclosurePayload;

const e = (entry: Partial<IntentPlanEntry> & Pick<IntentPlanEntry, "target" | "status">): IntentPlanEntry => ({
  from: [],
  transform: "none",
  confidence: "high",
  evidence: [],
  missing: [],
  ...entry,
});

const EMAIL = e({ target: "email", status: "ready", from: ["f_01"], transform: "normalize_email", evidence: ["format"] });
const STATUS_WITHHELD = e({ target: "status", status: "needs_clarification", from: ["f_02"], transform: "map_enum", missing: ["category-labels"] });
const DATE_ORDER = e({ target: "opened_at", status: "needs_clarification", from: ["f_05"], transform: "parse_date", missing: ["date-order"] });
const NAME_CANDIDATES = e({ target: "full_name", status: "needs_clarification", from: ["f_06", "f_07"], transform: "copy", missing: ["field-meaning"] });
const REGION_NONE = e({ target: "region", status: "no_source", missing: ["no-matching-source"] });

function ok(fields: IntentPlanEntry[] | unknown, payload = disclosure()): ValidatedIntentPlan {
  const result = validateIntentPlan({ fields, summary: "s" }, payload);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result.value;
}

function rejected(raw: unknown, payload = disclosure()): PlanIssue[] {
  const result = validateIntentPlan(raw, payload);
  if (result.ok) throw new Error("expected whole-plan rejection");
  return result.issues;
}

describe("S18B-V-001 readiness states are accepted as written", () => {
  it("ready, needs_clarification (category-labels, date-order, field-meaning), unsupported and no_source", () => {
    const unsupported = e({ target: "opened_at", status: "unsupported", from: ["f_04"], transform: "parse_date", missing: ["unsupported-transform"] });
    const plan = ok([EMAIL, STATUS_WITHHELD, NAME_CANDIDATES, REGION_NONE, unsupported]);
    expect(plan.planVersion).toBe("1.0.0");
    expect(plan.entries.map((item) => item.verdict)).toEqual(["accepted", "accepted", "accepted", "accepted", "accepted"]);
    expect(plan.issues).toEqual([]);
    expect(plan.unaddressed).toEqual([]);
    expect(ok([DATE_ORDER]).entries[0]!.verdict).toBe("accepted");
  });

  it("ready parse_date with inputFormat, ready concat with separator, ready map_enum from disclosed labels", () => {
    const plan = ok([
      e({ target: "opened_at", status: "ready", from: ["f_04"], transform: "parse_date", inputFormat: "MM/DD/YYYY" }),
      e({ target: "full_name", status: "ready", from: ["f_06", "f_07"], transform: "concat", separator: " " }),
      e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: { live: "active", gone: "inactive" } }),
    ]);
    expect(plan.entries.every((item) => item.verdict === "accepted")).toBe(true);
    expect(plan.unaddressed).toEqual(["email", "region"]);
  });

  it("unsupported with business-rule and no_source with destination-value are consistent", () => {
    const plan = ok([
      e({ target: "status", status: "unsupported", from: ["f_03"], transform: "map_enum", missing: ["business-rule"] }),
      e({ target: "region", status: "no_source", missing: ["destination-value"] }),
    ]);
    expect(plan.entries.map((item) => item.verdict)).toEqual(["accepted", "accepted"]);
  });

  it("returns the plan as received, unchanged", () => {
    const fields = [EMAIL, STATUS_WITHHELD];
    const raw = { fields, summary: "s" };
    const before = JSON.stringify(raw);
    const result = validateIntentPlan(raw, disclosure());
    expect(result.ok && result.value.plan).toBe(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("S18B-V-002 whole-plan rejection", () => {
  it("parseIntentPlanText: invalid JSON and > 65,536 bytes are MALFORMED_PLAN; valid JSON parses", () => {
    expect(parseIntentPlanText("{not json")).toEqual({ ok: false, issues: [expect.objectContaining({ code: "MALFORMED_PLAN" })] });
    const big = JSON.stringify({ fields: [EMAIL], summary: "x".repeat(MAX_PLAN_TEXT_BYTES) });
    const tooBig = parseIntentPlanText(big);
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.issues[0]!.code).toBe("MALFORMED_PLAN");
    // Multi-byte characters count as bytes, not as string length.
    const multibyte = parseIntentPlanText(`"${"é".repeat(MAX_PLAN_TEXT_BYTES / 2)}"`);
    expect(multibyte.ok).toBe(false);
    expect(parseIntentPlanText(JSON.stringify({ fields: [EMAIL], summary: "s" }))).toEqual({ ok: true, value: { fields: [EMAIL], summary: "s" } });
  });

  it("schema-invalid plans: not an object, no entries, extra properties, unknown codes, bad alias shape, long summary", () => {
    const cases: unknown[] = [
      null,
      [],
      "plan",
      { fields: [], summary: "s" },
      { fields: [EMAIL] },
      { fields: [EMAIL], summary: "s", extra: 1 },
      { fields: [{ ...EMAIL, rationale: "free text" }], summary: "s" },
      { fields: [{ ...EMAIL, status: "done" }], summary: "s" },
      { fields: [{ ...EMAIL, transform: "default_if_missing" }], summary: "s" },
      { fields: [{ ...EMAIL, from: ["email"] }], summary: "s" },
      { fields: [{ ...EMAIL, from: ["f_01", "f_01"] }], summary: "s" },
      { fields: [{ ...EMAIL, missing: ["something"] }], summary: "s" },
      { fields: [EMAIL], summary: "x".repeat(281) },
      { fields: [EMAIL], summary: "" },
      { fields: Array.from({ length: 25 }, () => EMAIL), summary: "s" },
      { fields: [{ ...STATUS_WITHHELD, valueMap: { a: 1 } }], summary: "s" },
    ];
    for (const raw of cases) {
      const issues = rejected(raw);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.code === "MALFORMED_PLAN")).toBe(true);
    }
  });

  it("executable content anywhere is MALFORMED_PLAN", () => {
    for (const summary of ["function () { return 1 }", "x => { y }", "eval(1)", "<script>"]) {
      expect(rejected({ fields: [EMAIL], summary })[0]!.code).toBe("MALFORMED_PLAN");
    }
    const issues = rejected({ fields: [{ ...STATUS_WITHHELD, valueMap: { live: "new Function('x')" } }], summary: "s" });
    expect(issues.map((issue) => issue.code)).toEqual(["MALFORMED_PLAN"]);
    expect(issues[0]!.message).toMatch(/Executable content/);
  });

  it("prototype keys are MALFORMED_PLAN, including inside valueMap", () => {
    const polluted = JSON.parse('{"fields":[{"target":"status","status":"ready","from":["f_03"],"transform":"map_enum","valueMap":{"__proto__":"active"},"confidence":"high","evidence":[],"missing":[]}],"summary":"s"}') as unknown;
    const issues = rejected(polluted);
    expect(issues.map((issue) => issue.code)).toEqual(["MALFORMED_PLAN"]);
    expect(issues[0]!.message).toMatch(/Forbidden object key/);
    expect(rejected(JSON.parse('{"fields":[],"summary":"s","constructor":1}') as unknown)[0]!.code).toBe("MALFORMED_PLAN");
    expect(({} as Record<string, unknown>).active).toBeUndefined();
  });

  it("non-JSON values (functions, circular graphs) are MALFORMED_PLAN", () => {
    const circular: Record<string, unknown> = { fields: [EMAIL], summary: "s" };
    circular.self = circular;
    expect(rejected(circular)[0]!.code).toBe("MALFORMED_PLAN");
    expect(rejected({ fields: [EMAIL], summary: () => "s" })[0]!.code).toBe("MALFORMED_PLAN");
  });

  it("DISCLOSURE_MISSING_TARGET: revision payloads and 1.1.0 without a target", () => {
    for (const payload of [disclosure({ schemaVersion: "1.2.0" }), disclosure({ schemaVersion: "1.0.0" }), disclosure({ target: undefined })]) {
      expect(rejected({ fields: [EMAIL], summary: "s" }, payload)).toEqual([expect.objectContaining({ code: "DISCLOSURE_MISSING_TARGET" })]);
    }
  });
});

describe("S18B-V-003 entry-level rejection keeps the other entries", () => {
  it("UNKNOWN_TARGET_FIELD", () => {
    const plan = ok([EMAIL, e({ target: "phone", status: "ready", from: ["f_06"], transform: "copy" })]);
    expect(plan.entries.map((item) => item.verdict)).toEqual(["accepted", "rejected"]);
    expect(plan.entries[1]!.issues.map((issue) => issue.code)).toEqual(["UNKNOWN_TARGET_FIELD"]);
    expect(plan.entries[1]!.issues[0]!.target).toBeUndefined();
    expect(plan.issues).toEqual(plan.entries[1]!.issues);
  });

  it("UNKNOWN_ALIAS (hallucinated reference), also among field-meaning candidates", () => {
    const plan = ok([
      e({ ...EMAIL, from: ["f_99"] }),
      e({ ...NAME_CANDIDATES, from: ["f_06", "f_42"] }),
    ]);
    expect(plan.entries.map((item) => item.verdict)).toEqual(["rejected", "rejected"]);
    expect(plan.issues.map((issue) => [issue.code, issue.entryIndex, issue.target])).toEqual([
      ["UNKNOWN_ALIAS", 0, "email"],
      ["UNKNOWN_ALIAS", 1, "full_name"],
    ]);
  });

  it("DUPLICATE_TARGET rejects every entry for that target", () => {
    const plan = ok([EMAIL, e({ ...EMAIL, transform: "copy" }), STATUS_WITHHELD]);
    expect(plan.entries.map((item) => item.verdict)).toEqual(["rejected", "rejected", "accepted"]);
    expect(plan.issues.map((issue) => issue.code)).toEqual(["DUPLICATE_TARGET", "DUPLICATE_TARGET"]);
    expect(plan.unaddressed).toContain("email");
  });

  const inconsistent: Array<[string, IntentPlanEntry]> = [
    ["ready without a source", e({ target: "email", status: "ready", transform: "copy" })],
    ["ready with two sources (not concat)", e({ target: "email", status: "ready", from: ["f_01", "f_06"], transform: "copy" })],
    ["ready with transform none", e({ target: "email", status: "ready", from: ["f_01"] })],
    ["ready parse_date without inputFormat", e({ target: "opened_at", status: "ready", from: ["f_04"], transform: "parse_date" })],
    ["ready concat without separator", e({ target: "full_name", status: "ready", from: ["f_06", "f_07"], transform: "concat" })],
    ["ready concat with one source", e({ target: "full_name", status: "ready", from: ["f_06"], transform: "concat", separator: " " })],
    ["ready map_enum without valueMap", e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum" })],
    ["ready map_enum with an empty valueMap", e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: {} })],
    ["ready with something missing", e({ ...EMAIL, missing: ["business-rule"] })],
    ["needs_clarification with nothing missing", e({ target: "status", status: "needs_clarification", from: ["f_02"], transform: "map_enum" })],
    ["field-meaning without candidates", e({ target: "full_name", status: "needs_clarification", transform: "copy", missing: ["field-meaning"] })],
    ["unsupported without unsupported-transform or business-rule", e({ target: "opened_at", status: "unsupported", from: ["f_04"], transform: "parse_date", missing: ["date-order"] })],
    ["no_source with a source", e({ target: "region", status: "no_source", from: ["f_06"], missing: ["no-matching-source"] })],
    ["no_source with a transform", e({ target: "region", status: "no_source", transform: "copy", missing: ["no-matching-source"] })],
    ["no_source without the reason", e({ target: "region", status: "no_source", missing: ["business-rule"] })],
    ["inputFormat on a copy", e({ ...EMAIL, transform: "copy", inputFormat: "ISO-8601" })],
    ["separator on a copy", e({ ...EMAIL, transform: "copy", separator: " " })],
    ["valueMap on a parse_date", e({ ...DATE_ORDER, valueMap: { live: "active" } })],
  ];
  it.each(inconsistent)("INCONSISTENT_ENTRY: %s", (_name, entry) => {
    const plan = ok([entry]);
    expect(plan.entries[0]!.verdict).toBe("rejected");
    expect(plan.entries[0]!.issues.map((issue) => issue.code)).toContain("INCONSISTENT_ENTRY");
    expect(plan.unaddressed).toContain(entry.target);
  });
});

describe("S18B-V-004 a rejected translation keeps the correspondence", () => {
  it("INVENTED_CATEGORY_LABEL: labels were withheld, so any valueMap key is invented", () => {
    const plan = ok([e({ target: "status", status: "ready", from: ["f_02"], transform: "map_enum", valueMap: { active: "active" } })]);
    const entry = plan.entries[0]!;
    expect(entry.verdict).toBe("correspondence-only");
    expect(entry.issues.map((issue) => issue.code)).toEqual(["INVENTED_CATEGORY_LABEL"]);
    expect(entry.entry.from).toEqual(["f_02"]);
    expect(entry.entry.valueMap).toEqual({ active: "active" }); // not rewritten; the compiler ignores the rejected part
    expect(plan.unaddressed).not.toContain("status");
  });

  it("INVENTED_CATEGORY_LABEL: a key that is not a disclosed label of the source alias", () => {
    const plan = ok([e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: { live: "active", paused: "inactive" } })]);
    expect(plan.entries[0]!.verdict).toBe("correspondence-only");
    expect(plan.entries[0]!.issues.map((issue) => issue.code)).toEqual(["INVENTED_CATEGORY_LABEL"]);
  });

  it("INVENTED_CATEGORY_LABEL on a needs_clarification entry with several aliases (no single source)", () => {
    const plan = ok([e({ target: "status", status: "needs_clarification", from: ["f_02", "f_03"], transform: "map_enum", valueMap: { live: "active" }, missing: ["field-meaning"] })]);
    expect(plan.entries[0]!.verdict).toBe("correspondence-only");
    expect(plan.entries[0]!.issues.map((issue) => issue.code)).toEqual(["INVENTED_CATEGORY_LABEL"]);
  });

  it("INVALID_ENUM_VALUE: a value outside the destination enum", () => {
    const plan = ok([e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: { live: "active", gone: "archived" } })]);
    expect(plan.entries[0]!.verdict).toBe("correspondence-only");
    expect(plan.entries[0]!.issues.map((issue) => [issue.code, issue.target])).toEqual([["INVALID_ENUM_VALUE", "status"]]);
  });

  it("both at once, and both are reported at plan level", () => {
    const plan = ok([EMAIL, e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: { nope: "archived" } })]);
    expect(plan.entries[1]!.issues.map((issue) => issue.code)).toEqual(["INVENTED_CATEGORY_LABEL", "INVALID_ENUM_VALUE"]);
    expect(plan.issues.map((issue) => issue.code)).toEqual(["INVENTED_CATEGORY_LABEL", "INVALID_ENUM_VALUE"]);
  });

  it("a rejecting issue wins: an invented translation on an unknown alias is rejected, not correspondence-only", () => {
    const plan = ok([e({ target: "status", status: "ready", from: ["f_77"], transform: "map_enum", valueMap: { a: "active" } })]);
    expect(plan.entries[0]!.verdict).toBe("rejected");
  });
});

describe("S18B-V-005 unaddressed destination fields", () => {
  it("lists approved fields with no surviving entry, in destination order", () => {
    const plan = ok([e({ ...REGION_NONE }), STATUS_WITHHELD]);
    expect(plan.unaddressed).toEqual(["email", "opened_at", "full_name"]);
  });

  it("a rejected entry does not address its field; no_source does", () => {
    const plan = ok([e({ ...EMAIL, from: ["f_98"] }), REGION_NONE]);
    expect(plan.unaddressed).toEqual(["email", "status", "opened_at", "full_name"]);
  });
});

describe("S18B-V-006 issue messages are application-owned", () => {
  it("quotes at most 32 characters of a model-written target, alias or key", () => {
    const longTarget = `target_${"x".repeat(100)}_SECRETTAIL`;
    const plan = ok([e({ target: longTarget, status: "ready", from: ["f_01"], transform: "copy" })]);
    for (const issue of plan.issues) {
      expect(issue.message).not.toContain("SECRETTAIL");
      expect(issue.message).not.toContain("x".repeat(33));
    }
    const longKey = `k${"y".repeat(80)}TAIL`;
    const schemaIssues = rejected({ fields: [{ ...STATUS_WITHHELD, valueMap: { [longKey]: 5 } }], summary: "s" });
    for (const issue of schemaIssues) expect(issue.message).not.toContain("TAIL");
  });

  it("never echoes valueMap labels or summary text", () => {
    const plan = ok([e({ target: "status", status: "ready", from: ["f_03"], transform: "map_enum", valueMap: { PRIVATE_LABEL_ABC: "WRONGVALUE" } })]);
    for (const issue of plan.issues) {
      expect(issue.message).not.toContain("PRIVATE_LABEL_ABC");
      expect(issue.message).not.toContain("WRONGVALUE");
    }
  });
});
