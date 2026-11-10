import { describe, expect, it } from "vitest";
import { executeMapping, isSupportedOperation } from "../../src/domain/mapping/operations.ts";

describe("mapping operations", () => {
  it("accepts the Sprint 0 operation set", () => {
    expect(isSupportedOperation("copy")).toBe(true);
    expect(isSupportedOperation("concat")).toBe(true);
    expect(isSupportedOperation("eval_js")).toBe(false);
  });

  it("does not execute mappings yet", () => {
    expect(() => executeMapping()).toThrow(/not implemented/i);
  });
});
