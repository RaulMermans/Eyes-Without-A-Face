import { describe, expect, it } from "vitest";
import sourceFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { executeMapping } from "../../src/domain/mapping/execute.ts";
import { executeMappingBatch } from "../../src/domain/mapping/batch.ts";
import { buildDisclosureDraft, prepareTwin } from "../../src/workflow/pipeline.ts";

const records = sourceFixture.records as Record<string, unknown>[];

function payload() {
  const prepared = prepareTwin({ records, datasetLabel: "crm", seed: 5 });
  if (!prepared.ok) throw new Error("prepare");
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: destinationSchema });
  if (!draft.ok) throw new Error(draft.issues.join(";"));
  return draft.value.payload;
}

describe("cloud-disclosure 1.1.0 contract", () => {
  it("accepts the projected payload with a target", () => {
    expect(validateContract(payload())).toMatchObject({ valid: true, kind: "cloud-disclosure" });
  });

  it("requires target in 1.1.0 and forbids extra target keys", () => {
    const { target, ...withoutTarget } = payload();
    expect(target).toBeDefined();
    expect(validateContract(withoutTarget).valid).toBe(false);
    const extra = payload();
    (extra.target as unknown as Record<string, unknown>).description = "confidential";
    expect(validateContract(extra).valid).toBe(false);
    const badName = payload();
    badName.target!.fields[0]!.name = "items[0]";
    expect(validateContract(badName).valid).toBe(false);
  });

  it("rejects unknown versions and keeps 1.0.0 for other kinds", () => {
    expect(validateContract({ ...payload(), schemaVersion: "2.0.0" })).toMatchObject({ valid: false, issues: [{ code: "VERSION" }] });
    expect(validateContract({ ...mappingContract, schemaVersion: "1.1.0" })).toMatchObject({ valid: false, issues: [{ code: "VERSION" }] });
  });
});

describe("engine input hardening (no uncontrolled exceptions)", () => {
  const base = { mappingContract, targetSchema: destinationSchema };

  it("returns structured errors for non-JSON source values", () => {
    for (const value of [10n, () => 1, Symbol("s"), undefined, Number.POSITIVE_INFINITY, new Map()]) {
      const result = executeMapping({ ...base, sourceRecord: { ...records[1], customer_id: value } });
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("NON_JSON_VALUE");
    }
  });

  it("returns structured errors for circular records, contracts, and schemas", () => {
    const circular: Record<string, unknown> = { ...records[1] };
    circular.loop = circular;
    expect(executeMapping({ ...base, sourceRecord: circular }).issues[0]?.code).toBe("CIRCULAR_REFERENCE");
    const contract: Record<string, unknown> = structuredClone(mappingContract) as Record<string, unknown>;
    contract.self = contract;
    expect(executeMapping({ sourceRecord: records[1], mappingContract: contract, targetSchema: destinationSchema }).ok).toBe(false);
    expect(executeMappingBatch({ ...base, sourceRecords: [records[1], circular] }).issues[0]?.code).toBe("CIRCULAR_REFERENCE");
    expect(executeMappingBatch({ ...base, sourceRecords: [{ a: 1n }] }).issues[0]?.code).toBe("NON_JSON_VALUE");
  });
});
