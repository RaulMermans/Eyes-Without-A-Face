import { describe, expect, it } from "vitest";
import { executeMapping, isSupportedOperation } from "../../src/domain/mapping/operations.ts";

describe("mapping operations", () => {
  it("accepts the Sprint 2 operation set", () => {
    expect(isSupportedOperation("copy")).toBe(true);
    expect(isSupportedOperation("concat")).toBe(true);
    expect(isSupportedOperation("eval_js")).toBe(false);
  });

  it("returns structured failures instead of throwing for invalid input", () => {
    const result = executeMapping({
      sourceRecord: "not-json-object",
      mappingContract: {},
      targetSchema: {},
    });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
