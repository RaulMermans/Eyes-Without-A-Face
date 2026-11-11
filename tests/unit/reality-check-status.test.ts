import { describe, expect, it } from "vitest";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import edgeFixture from "../../src/examples/crm/edge-records.json" with { type: "json" };
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import {
  mappingContractStatus,
  runRealityCheck,
  targetSchemaStatus,
} from "../../src/verification/reality-check.ts";

const records = sourceFixture.records as Record<string, unknown>[];
const reserved = edgeFixture.records as Record<string, unknown>[];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function run(overrides: Partial<Parameters<typeof runRealityCheck>[0]> = {}) {
  return runRealityCheck({
    records,
    reservedRecords: [],
    mappingContract,
    targetSchema: destinationSchema,
    bindings: null,
    ...overrides,
  });
}

describe("Reality Check stage statuses (Sprint 4 regression)", () => {
  it("all stages pass for the canonical mapping on imported records", () => {
    const report = run();
    expect(report.statuses).toEqual({
      mappingContract: "pass",
      targetSchema: "pass",
      execution: "pass",
      outputSchema: "pass",
      hiddenCases: "not_evaluated",
    });
    expect(report.overall).toBe("pass");
  });

  it("an invalid destination schema is never reported as a valid outcome", () => {
    const report = run({ targetSchema: { type: "object", properties: { id: { type: "not-a-type" } } } });
    expect(report.statuses.targetSchema).toBe("fail");
    expect(report.targetSchemaValid).toBe(false);
    // The contract itself is still valid; the stages that depend on the schema did not run.
    expect(report.statuses.mappingContract).toBe("pass");
    expect(report.statuses.execution).toBe("not_evaluated");
    expect(report.statuses.outputSchema).toBe("not_evaluated");
    expect(report.overall).toBe("fail");
  });

  it("an invalid mapping contract fails its own stage, even when every record fails earlier on source shape", () => {
    const badContract = clone(mappingContract) as { operations: Array<Record<string, unknown>> };
    badContract.operations.push({ op: "eval", from: "customer_id", to: "x" });
    // Records with a forbidden key fail before the engine ever validates the contract.
    const polluted = [JSON.parse('{"__proto__": {"x": 1}, "customer_id": "C"}') as Record<string, unknown>];
    const report = run({ records: polluted, mappingContract: badContract });
    expect(report.statuses.mappingContract).toBe("fail");
    expect(report.mappingValid).toBe(false);
    expect(report.overall).toBe("fail");
    expect(mappingContractStatus(badContract)).toBe("fail");
  });

  it("execution fails and output schema fails when a produced record violates the destination", () => {
    const strict = clone(destinationSchema) as { properties: Record<string, unknown> };
    strict.properties.status = { type: "string", enum: ["only-this"] };
    const report = run({ targetSchema: strict });
    expect(report.statuses.mappingContract).toBe("pass");
    expect(report.statuses.targetSchema).toBe("pass");
    expect(report.statuses.execution).toBe("fail");
    expect(report.statuses.outputSchema).toBe("fail");
    expect(report.overall).toBe("fail");
  });

  it("output schema is not_evaluated when no record reached output validation", () => {
    const report = run({ records: [reserved[0] as Record<string, unknown>] });
    expect(report.statuses.execution).toBe("fail");
    expect(report.statuses.outputSchema).toBe("not_evaluated");
  });

  it("hidden cases fail independently while imported records pass", () => {
    const report = run({ reservedRecords: reserved });
    expect(report.rows.filter((row) => row.set === "imported").every((row) => row.status === "pass")).toBe(true);
    expect(report.statuses.hiddenCases).toBe("fail");
    expect(report.statuses.outputSchema).toBe("pass");
    expect(report.overall).toBe("fail");
  });

  it("a batch refused before any record runs is not reported as a mapping-contract failure", () => {
    const report = run({ records: [], reservedRecords: [] });
    expect(report.total).toBe(0);
    expect(report.statuses.mappingContract).toBe("pass");
    expect(report.statuses.execution).toBe("not_evaluated");
    expect(report.overall).toBe("fail");
  });

  it("targetSchemaStatus rejects non-2020-12 drafts and circular schemas", () => {
    expect(targetSchemaStatus({ $schema: "http://json-schema.org/draft-07/schema#", type: "object" })).toBe("fail");
    const circular: Record<string, unknown> = { type: "object" };
    circular.self = circular;
    expect(targetSchemaStatus(circular)).toBe("fail");
    expect(targetSchemaStatus(destinationSchema)).toBe("pass");
  });
});
