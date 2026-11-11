import { describe, expect, it } from "vitest";
import fc from "fast-check";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import { profileRecords, PROFILE_LIMITS } from "../../src/domain/profile/profile.ts";
import { inspectJsonValue } from "../../src/domain/json/inspect.ts";

const records = sourceFixture.records as Record<string, unknown>[];

function field(path: string) {
  const result = profileRecords(records);
  if (!result.ok) throw new Error("profile failed");
  const found = result.profile.fields.find((item) => item.path === path);
  if (!found) throw new Error(`missing ${path}`);
  return found;
}

describe("local source profiling", () => {
  it("infers types, formats, and categories for the fictional CRM", () => {
    expect(field("customer_id")).toMatchObject({ type: "string", required: true, allValuesUnique: true });
    expect(field("email_address")).toMatchObject({ type: "string", format: "email", hasPaddedWhitespace: true, hasMixedCase: true });
    expect(field("account_state")).toMatchObject({ type: "enum" });
    expect(field("account_state").categories?.map((item) => item.value).sort()).toEqual([
      "active_customer",
      "inactive_customer",
      "prospect",
    ]);
    expect(field("joined_at")).toMatchObject({ type: "date", dateFormat: "YYYY-MM-DD" });
    expect(field("company_name")).toMatchObject({ type: "string", hasPaddedWhitespace: true });
    expect(field("internal_note")).toMatchObject({ required: false, missingCount: 2 });
  });

  it("reports optional, null, mixed, array, and all-null fields as structured issues", () => {
    const result = profileRecords([
      { a: "x", mixed: 1, list: [1], nothing: null, maybe: null },
      { a: "y", mixed: "one", list: [2], nothing: null },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.profile.issues.map((issue) => `${issue.code}:${issue.path}`);
    expect(codes).toContain("MIXED_TYPES:mixed");
    expect(codes).toContain("UNSUPPORTED_ARRAY:list");
    expect(codes).toContain("ALL_NULL:nothing");
    const maybe = result.profile.fields.find((item) => item.path === "maybe");
    expect(maybe?.supported).toBe(false);
    expect(result.profile.fields.find((item) => item.path === "mixed")?.supported).toBe(false);
  });

  it("flattens nested objects into dotted paths and flags unusable names", () => {
    const result = profileRecords([{ contact: { email: "a@b.test" }, "bad key": "x" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.fields.map((item) => item.path)).toContain("contact.email");
    expect(result.profile.issues.some((issue) => issue.code === "UNSUPPORTED_FIELD_NAME")).toBe(true);
  });

  it("rejects empty, non-object, oversized, and unsafe inputs without throwing", () => {
    expect(profileRecords([])).toMatchObject({ ok: false, issues: [{ code: "EMPTY_DATASET" }] });
    expect(profileRecords({})).toMatchObject({ ok: false, issues: [{ code: "NOT_AN_OBJECT" }] });
    expect(profileRecords([1])).toMatchObject({ ok: false, issues: [{ code: "NOT_AN_OBJECT" }] });
    const many = Array.from({ length: PROFILE_LIMITS.maxRecords + 1 }, () => ({ a: 1 }));
    expect(profileRecords(many)).toMatchObject({ ok: false, issues: [{ code: "TOO_MANY_RECORDS" }] });
    const proto = JSON.parse('[{"__proto__": {"polluted": true}}]') as unknown;
    expect(profileRecords(proto)).toMatchObject({ ok: false, issues: [{ code: "PROTOTYPE_POLLUTION" }] });
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(profileRecords([circular])).toMatchObject({ ok: false, issues: [{ code: "CIRCULAR_REFERENCE" }] });
    expect(profileRecords([{ a: () => 1 }])).toMatchObject({ ok: false, issues: [{ code: "NON_JSON_VALUE" }] });
    expect(profileRecords([{ a: 10n }])).toMatchObject({ ok: false, issues: [{ code: "NON_JSON_VALUE" }] });
    expect(profileRecords([{ a: Number.NaN }])).toMatchObject({ ok: false, issues: [{ code: "NON_JSON_VALUE" }] });
    expect(profileRecords([{ a: new Date(0) }])).toMatchObject({ ok: false, issues: [{ code: "NON_JSON_VALUE" }] });
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(profileRecords([deep]).ok).toBe(false);
  });

  it("never throws for arbitrary JSON input (property)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = profileRecords(value);
        expect(typeof result.ok).toBe("boolean");
      }),
      { numRuns: 300 },
    );
  });

  it("issue messages never contain private values", () => {
    const secret = "PRIVATE_CANARY_PII_DO_NOT_SHARE";
    const result = profileRecords([{ a: secret, b: 1 }, { a: 7, b: secret }]);
    expect(JSON.stringify(result.ok ? result.profile.issues : result.issues)).not.toContain(secret);
  });

  it("json inspector reports structural paths only", () => {
    const issues = inspectJsonValue({ outer: { inner: undefined } });
    expect(issues[0]).toMatchObject({ code: "NON_JSON_VALUE", path: "outer.inner" });
  });
});
