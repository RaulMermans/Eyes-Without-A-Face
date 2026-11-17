import { describe, expect, it } from "vitest";
import { profileRecords } from "../../src/domain/profile/profile.ts";
import { prepareTwin } from "../../src/workflow/pipeline.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { buildDisclosureDraft } from "../../src/workflow/pipeline.ts";

const rows = (values: string[]) => values.map((value, index) => ({ id: `r${index}`, value }));
const typeOf = (values: string[], labelCategories?: boolean) => {
  const result = profileRecords(rows(values), { labelCategories });
  if (!result.ok) throw new Error("profile failed");
  return result.profile.fields.find((field) => field.path === "value")!;
};
const REAL = ["Marketing Qualified Lead", "Customer", "Lead", "Customer", "Lead", "Marketing Qualified Lead", "Customer", "TEST RECORD", "Lead", "Customer"];

describe("S18B-CAT category detection accepts real-world labels", () => {
  it("S18B-CAT-001 repeated labels with capitals, spaces, accents and codes are categories", () => {
    expect(typeOf(REAL).type).toBe("enum");
    expect(typeOf(["Básico", "Premium", "Básico", "Prueba 7 días", "Premium", "Básico"]).type).toBe("enum");
    expect(typeOf(["aktiv", "ALT-IMPORT 2019", "aktiv", "pausiert", "aktiv", "pausiert"]).type).toBe("enum");
    expect(typeOf(REAL).categories!.map((item) => item.value)).toContain("Marketing Qualified Lead");
  });

  it("S18B-CAT-002 names, identifiers and rarely repeated text stay plain text", () => {
    expect(typeOf(["Ana García", "Bo Lind", "Cy Moreau", "Di Novak", "Ed Okafor", "Flo Petit"]).type).toBe("string");
    expect(typeOf(["Ana García", "Bo Lind", "Ana García", "Di Novak", "Ed Okafor", "Flo Petit"]).type).toBe("string");
    expect(typeOf(["INV-0001", "INV-0002", "INV-0003", "INV-0004"]).type).toBe("string");
  });

  it("S18B-CAT-003 limits still hold: more than 12 labels or labels over 32 characters are not categories", () => {
    const many = Array.from({ length: 13 }, (_, index) => `Label ${String.fromCharCode(65 + index)}`);
    expect(typeOf([...many, ...many]).type).toBe("string");
    const long = "A label that is far longer than thirty-two characters";
    expect(typeOf([long, "Short", long, "Short"]).type).toBe("string");
  });

  it("S18B-CAT-004 token labels behave as before; labelCategories: false reproduces the pre-18B rule", () => {
    expect(typeOf(["active", "inactive", "active"]).type).toBe("enum");
    expect(typeOf(REAL, false).type).toBe("string");
  });

  it("S18B-CAT-005 the new category labels are withheld from the disclosure by default", () => {
    const records = REAL.map((value, index) => ({ id: `r${index}`, status: value, email: `p${index}@example.com` }));
    const prepared = prepareTwin({ records, datasetLabel: "t.json", seed: DEFAULT_TWIN_SEED });
    if (!prepared.ok) throw new Error("twin failed");
    const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { status: { type: "string", enum: ["lead", "customer"] } }, required: ["status"] } });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const text = JSON.stringify(draft.value.payload);
    for (const label of ["Marketing Qualified Lead", "TEST RECORD"]) expect(text).not.toContain(label);
    const field = draft.value.payload.fields.find((item) => item.type === "enum");
    expect(field).toBeDefined();
    expect(field!.enumValues).toBeUndefined();
  });
});
