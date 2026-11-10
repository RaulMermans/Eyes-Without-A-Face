import { describe, expect, it } from "vitest";
import { executeMappingBatch } from "../../src/domain/mapping/batch.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import sourceRecords from "../../src/examples/crm/source-records.json" with { type: "json" };
import expectedOutputs from "../../src/examples/crm/expected-outputs.json" with { type: "json" };

describe("local mapping privacy", () => {
  it("keeps the private canary in source fixtures and out of mapping output", () => {
    expect(JSON.stringify(sourceRecords)).toContain(PRIVATE_DATA_CANARY);
    expect(JSON.stringify(mappingContract)).not.toContain(PRIVATE_DATA_CANARY);
    expect(JSON.stringify(destinationSchema)).not.toContain(PRIVATE_DATA_CANARY);
    const batch = executeMappingBatch({
      sourceRecords: sourceRecords.records,
      mappingContract,
      targetSchema: destinationSchema,
    });
    expect(batch.ok).toBe(true);
    expect(JSON.stringify(batch.results.map((item) => item.output))).not.toContain(PRIVATE_DATA_CANARY);
    expect(batch.results[0]?.output).toEqual(expectedOutputs.records[0]);
  });
});
