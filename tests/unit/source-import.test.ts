import { describe, expect, it } from "vitest";
import { parseSourceDataset } from "../../src/app/source-import.ts";

describe("source import", () => {
  it("accepts a records wrapper and a raw array", () => {
    const wrapped = parseSourceDataset(JSON.stringify({ datasetId: "demo", records: [{ id: "1" }] }));
    expect(wrapped.ok && wrapped.value.records).toEqual([{ id: "1" }]);
    const array = parseSourceDataset(JSON.stringify([{ id: "2" }]));
    expect(array.ok && array.value.records).toEqual([{ id: "2" }]);
  });

  it("rejects malformed JSON", () => {
    const result = parseSourceDataset("{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/malformed/i);
    }
  });
});
