import { describe, expect, it } from "vitest";
import { validateStructuredOutput } from "../../src/domain/inference-output/validate-output.ts";

describe("structured model output", () => {
  it("accepts a field interpretation", () => {
    const result = validateStructuredOutput("field-interpretation", {
      fieldAlias: "lifecycle_status",
      semanticRole: "lifecycle-state",
      valueKind: "enum",
      shareabilityHint: "synthetic-ok",
      rationale: "Enumerated account state.",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects additional properties and malformed mapping proposals", () => {
    expect(
      validateStructuredOutput("field-interpretation", {
        fieldAlias: "lifecycle_status",
        semanticRole: "lifecycle-state",
        valueKind: "enum",
        shareabilityHint: "synthetic-ok",
        rationale: "ok",
        secret: "nope",
      }).valid,
    ).toBe(false);
    expect(
      validateStructuredOutput("mapping-proposal", {
        operations: [],
        rationale: "empty",
      }).valid,
    ).toBe(false);
  });
});
