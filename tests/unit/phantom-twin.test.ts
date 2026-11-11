import { describe, expect, it } from "vitest";
import fc from "fast-check";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import { collectPrivateStrings, profileRecords, type SourceProfile } from "../../src/domain/profile/profile.ts";
import { generatePhantomTwin, validateGeneratedTwin, type TwinOptions } from "../../src/phantom/generate.ts";
import { PrivateBindings, validateBindings } from "../../src/phantom/bindings.ts";
import { canonicalizeJson } from "../../src/domain/json/canonical.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";

const records = sourceFixture.records as Record<string, unknown>[];
const SOURCE_NAMES = ["customer_id", "email_address", "account_state", "joined_at", "company_name", "internal_note"];

function profile(input: unknown = records): SourceProfile {
  const result = profileRecords(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.profile;
}

function twin(options: Partial<TwinOptions> = {}, input: unknown = records) {
  const result = generatePhantomTwin(profile(input), {
    seed: 7,
    datasetLabel: "fictional-crm-accounts",
    privateStrings: collectPrivateStrings(input as unknown[]),
    ...options,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.twin;
}

describe("Phantom Twin generation", () => {
  it("produces valid Phantom and Source contracts", () => {
    const generated = twin();
    expect(validateContract(generated.phantom).valid).toBe(true);
    expect(validateContract(generated.source).valid).toBe(true);
    expect(generated.source.localOnly).toBe(true);
    expect(validateGeneratedTwin(generated, collectPrivateStrings(records))).toEqual([]);
  });

  it("is deterministic for the same seed and input", () => {
    expect(canonicalizeJson(twin({ seed: 99 }).phantom)).toBe(canonicalizeJson(twin({ seed: 99 }).phantom));
  });

  it("changes synthetic data and alias order with the seed", () => {
    const a = twin({ seed: 1 }).phantom;
    const b = twin({ seed: 2 }).phantom;
    expect(canonicalizeJson(a.syntheticExamples)).not.toBe(canonicalizeJson(b.syntheticExamples));
    expect(a.phantomId).not.toBe(b.phantomId);
  });

  it("assigns unique f_NN aliases with consistent private bindings", () => {
    const generated = twin();
    const aliases = generated.phantom.fields.map((field) => field.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.every((alias) => /^f_\d{2}$/.test(alias))).toBe(true);
    expect(validateBindings(generated.bindings, generated.phantom, generated.source)).toEqual([]);
    for (const entry of generated.bindings.entries()) {
      expect(generated.bindings.resolve(entry.alias)).toBe(entry.sourcePath);
      expect(generated.bindings.aliasForPath(entry.sourcePath)).toBe(entry.alias);
    }
  });

  it("keeps aliases stable when descriptors or disclosure choices change", () => {
    const base = twin();
    const edited = twin({
      overrides: { company_name: { descriptor: "Organization display name" }, account_state: { discloseCategories: true } },
    });
    const pairs = (t: ReturnType<typeof twin>) => t.bindings.entries().map((entry) => `${entry.alias}=${entry.sourcePath}`).sort();
    expect(pairs(edited)).toEqual(pairs(base));
  });

  it("does not put original field names or private values in the Phantom Contract", () => {
    const serialized = JSON.stringify(twin().phantom);
    for (const name of SOURCE_NAMES) {
      expect(serialized).not.toContain(name);
    }
    for (const value of ["CUST-001", "alice@example.com", "ALICE@EXAMPLE.COM", "Example Studio", "North Bridge", "active_customer", PRIVATE_DATA_CANARY]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("withholds category labels by default and discloses them only on explicit opt-in", () => {
    const hidden = twin();
    const statusAlias = hidden.fields.find((view) => view.localPath === "account_state")?.alias;
    const hiddenField = hidden.phantom.fields.find((field) => field.alias === statusAlias);
    expect(hiddenField?.enumValues).toBeUndefined();
    expect(hiddenField?.semanticDescriptor).toContain("withheld");
    expect(hidden.limitations.join(" ")).toMatch(/withheld/);

    const shown = twin({ overrides: { account_state: { discloseCategories: true } } });
    const shownField = shown.phantom.fields.find((field) => field.alias === statusAlias);
    expect(shownField?.enumValues?.sort()).toEqual(["active_customer", "inactive_customer", "prospect"]);
    expect(shown.fields.find((view) => view.alias === statusAlias)?.rareCategoryCount).toBe(3);
  });

  it("preserves cleaning needs (padding, case, optional, null) without copying values", () => {
    const generated = twin();
    const emailAlias = generated.fields.find((view) => view.localPath === "email_address")?.alias as string;
    const noteAlias = generated.fields.find((view) => view.localPath === "internal_note")?.alias as string;
    const emails = generated.phantom.syntheticExamples.map((row) => row[emailAlias]).filter((value): value is string => typeof value === "string");
    expect(emails.some((value) => value !== value.trim())).toBe(true);
    expect(emails.some((value) => value !== value.toLowerCase())).toBe(true);
    expect(emails.every((value) => /@(example|sample|demo)\.(test|invalid)\s*$/i.test(value))).toBe(true);
    expect(generated.phantom.syntheticExamples.some((row) => !(noteAlias in row))).toBe(true);
  });

  it("keeps withheld fields out of shareable aliases", () => {
    const generated = twin({ overrides: { internal_note: { shareable: false } } });
    const noteAlias = generated.fields.find((view) => view.localPath === "internal_note")?.alias;
    expect(generated.phantom.shareableFieldAliases).not.toContain(noteAlias);
    expect(generated.phantom.nonShareableSourceFieldIds).toHaveLength(1);
  });

  it("rejects descriptors that repeat source names, values, or the canary", () => {
    for (const descriptor of ["the customer_id column", "like CUST-001 codes", `note ${PRIVATE_DATA_CANARY}`, "line\nbreak"]) {
      const result = generatePhantomTwin(profile(), {
        seed: 7,
        datasetLabel: "x",
        privateStrings: collectPrivateStrings(records),
        overrides: { customer_id: { descriptor } },
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a source with no supported fields", () => {
    const result = generatePhantomTwin(profile([{ list: [1] }, { list: [2] }]), { seed: 1, datasetLabel: "x" });
    expect(result).toMatchObject({ ok: false, issues: [{ code: "NO_SUPPORTED_FIELDS" }] });
  });

  it("handles unusual enum labels without disclosing them by default", () => {
    const input = [{ tier: "vip-gold" }, { tier: "x__internal_only" }, { tier: "vip-gold" }];
    const generated = twin({}, input);
    expect(JSON.stringify(generated.phantom)).not.toContain("x__internal_only");
  });

  it("never reproduces a private string value in synthetic examples (property)", () => {
    const recordArb = fc.record({
      code: fc.stringMatching(/^[A-Z]{2}-[0-9]{2}$/),
      label: fc.constantFrom("alpha", "beta", "gamma"),
      when: fc.constantFrom("2026-01-01", "2025-02-02"),
    });
    fc.assert(
      fc.property(fc.array(recordArb, { minLength: 2, maxLength: 30 }), fc.integer({ min: 0, max: 2 ** 31 }), (rows, seed) => {
        const privateStrings = collectPrivateStrings(rows);
        const result = generatePhantomTwin(profile(rows), { seed, datasetLabel: "p", privateStrings });
        if (!result.ok) return;
        for (const example of result.twin.phantom.syntheticExamples) {
          for (const value of Object.values(example)) {
            if (typeof value === "string") expect(privateStrings.has(value.trim().toLowerCase())).toBe(false);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it("private bindings cannot be serialized", () => {
    const bindings = new PrivateBindings("phantom-x", [{ alias: "f_01", sourceFieldId: "src_01", sourcePath: "customer_email" }]);
    expect(() => JSON.stringify(bindings)).toThrow(/local-only/);
    expect(canonicalizeJson(bindings)).not.toContain("customer_email");
    expect(Object.keys(bindings)).not.toContain("entries");
  });
});
