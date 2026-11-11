import { describe, expect, it } from "vitest";
import { MAPPING_PROPOSAL_JSON_SCHEMA } from "../../src/inference/prompts.ts";
import { PARAM_KEYS } from "../../src/proposal/convert.ts";

describe("cloud responseJsonSchema", () => {
  const item = MAPPING_PROPOSAL_JSON_SCHEMA.properties.operations.items;

  it("declares every param the converter accepts (empty params object was forced otherwise)", () => {
    const declared = Object.keys(item.properties.params.properties);
    const accepted = [...new Set(Object.values(PARAM_KEYS).flat())];
    expect(declared.sort()).toEqual(accepted.sort());
  });

  it("restricts op to the eight-operation allowlist", () => {
    expect([...item.properties.op.enum].sort()).toEqual(Object.keys(PARAM_KEYS).sort());
  });
});
