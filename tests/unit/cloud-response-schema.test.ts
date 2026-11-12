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

describe("Sprint 7 revision response schema", () => {
  it("constrains params per operation and declares exactly the converter's param keys", async () => {
    const { MAPPING_REVISION_JSON_SCHEMA } = await import("../../src/inference/prompts.ts");
    const { PARAM_KEYS } = await import("../../src/proposal/convert.ts");
    const branches = MAPPING_REVISION_JSON_SCHEMA.properties.operations.items.anyOf;
    const covered = new Map<string, string[]>();
    for (const branch of branches) {
      const props = branch.properties as Record<string, { enum?: readonly string[]; properties?: Record<string, unknown> }>;
      for (const op of props.op?.enum ?? []) covered.set(op, Object.keys(props.params?.properties ?? {}).sort());
    }
    for (const [op, keys] of Object.entries(PARAM_KEYS)) {
      expect(covered.get(op), op).toEqual([...keys].sort());
    }
  });
});
