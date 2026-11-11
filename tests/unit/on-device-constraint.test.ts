import { describe, expect, it } from "vitest";
import canonical from "../../src/domain/inference-output/schemas/field-interpretation.v1.schema.json" with { type: "json" };
import { FIELD_INTERPRETATION_JSON_SCHEMA } from "../../src/inference/prompts.ts";

describe("on-device responseConstraint", () => {
  it("mirrors the canonical field-interpretation schema exactly (minus $id/$schema/title)", () => {
    const { $schema: _s, $id: _i, title: _t, ...rest } = canonical as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(FIELD_INTERPRETATION_JSON_SCHEMA))).toEqual(rest);
  });
});
