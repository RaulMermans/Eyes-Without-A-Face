import { describe, expect, it } from "vitest";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import exportManifest from "../fixtures/valid/export-manifest.json" with { type: "json" };
import mappingContract from "../fixtures/valid/mapping-contract.json" with { type: "json" };
import phantomContract from "../fixtures/valid/phantom-contract.json" with { type: "json" };
import sourceContract from "../fixtures/valid/source-contract.json" with { type: "json" };
import validationReport from "../fixtures/valid/validation-report.json" with { type: "json" };
import executableMapping from "../fixtures/invalid/mapping-executable-code.json" with { type: "json" };
import exportPrivate from "../fixtures/invalid/export-includes-private.json" with { type: "json" };
import mappingUnknownOp from "../fixtures/invalid/mapping-unknown-op.json" with { type: "json" };
import sourceEnum from "../fixtures/invalid/source-enum-without-values.json" with { type: "json" };
import sourceMissing from "../fixtures/invalid/source-missing-required.json" with { type: "json" };
import sourceVersion from "../fixtures/invalid/source-unsupported-version.json" with { type: "json" };

describe("valid contracts", () => {
  it.each([
    ["source", sourceContract],
    ["phantom", phantomContract],
    ["mapping", mappingContract],
    ["validation", validationReport],
    ["export", exportManifest],
  ] as const)("accepts the %s example", (kind, value) => {
    const result = validateContract(value);
    expect(result.kind).toBe(kind);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("invalid contracts", () => {
  it("rejects unsupported schema versions", () => {
    const result = validateContract(sourceVersion);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "VERSION")).toBe(true);
  });

  it("rejects missing required fields and empty field lists", () => {
    const result = validateContract(sourceMissing);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects enum fields without enumValues", () => {
    const result = validateContract(sourceEnum);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path.includes("enumValues"))).toBe(true);
  });

  it("rejects unknown mapping operations", () => {
    const result = validateContract(mappingUnknownOp);
    expect(result.valid).toBe(false);
  });

  it("rejects executable javascript on mapping contracts", () => {
    const result = validateContract(executableMapping);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.code === "SAFETY" || issue.message.includes("javascript"),
      ),
    ).toBe(true);
  });

  it("rejects export manifests that include private source fixtures", () => {
    const result = validateContract(exportPrivate);
    expect(result.valid).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateContract(null).valid).toBe(false);
    expect(validateContract("source").valid).toBe(false);
  });

  it("rejects unknown contract kinds", () => {
    const result = validateContract({
      contractKind: "agent",
      schemaVersion: "1.0.0",
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("KIND");
  });
});
