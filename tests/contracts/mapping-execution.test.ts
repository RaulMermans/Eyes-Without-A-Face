import { describe, expect, it } from "vitest";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { assertTargetSchema } from "../../src/domain/mapping/target-schema.ts";
import { executeMapping } from "../../src/domain/mapping/execute.ts";
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import sourceRecords from "../../src/examples/crm/source-records.json" with { type: "json" };

describe("CRM mapping contracts", () => {
  it("accepts the fictional CRM mapping contract and destination schema", () => {
    expect(validateContract(mappingContract).valid).toBe(true);
    expect(assertTargetSchema(destinationSchema).ok).toBe(true);
  });

  it("executes the first CRM record against the destination schema", () => {
    const result = executeMapping({
      sourceRecord: sourceRecords.records[0],
      mappingContract,
      targetSchema: destinationSchema,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.email).toBe("alice@example.com");
      expect(result.output.status).toBe("active");
    }
  });
});
