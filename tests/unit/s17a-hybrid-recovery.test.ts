import { describe, expect, it } from "vitest";
import crmFixture from "../../src/examples/crm/source-records.json" with { type: "json" };
import helpdesk from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import billing from "../../src/examples/destinations/billing-customer.schema.json" with { type: "json" };
import meridian from "../fixtures/sprint-17a/meridian-style-120.json" with { type: "json" };
import { cloudBlockedTargets, planFields, unwrittenRequiredTargets } from "../../src/app/guided/field-plan.ts";
import type { MappingContract } from "../../src/domain/contracts/types.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { prepareTwin, type PreparedTwin } from "../../src/workflow/pipeline.ts";

/** Sprint 17A — preflight and completeness readings (S17A-001…). Pure; nothing is sent or added. */
const pretty = (schema: unknown) => JSON.stringify(schema, null, 2);
function twin(records: Record<string, unknown>[], overrides: Record<string, TwinFieldOverride> = {}): PreparedTwin {
  const result = prepareTwin({ records, datasetLabel: "fictional", seed: DEFAULT_TWIN_SEED, overrides });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
const crm = crmFixture.records as Record<string, unknown>[];
const meridianRecords = meridian.records as unknown as Record<string, unknown>[];
const none = { fieldMatches: {}, categoryMeanings: {} };
const contract = (to: string[]): MappingContract =>
  ({ contractKind: "mapping", schemaVersion: "1.0.0", mappingId: "m", mappingVersion: "1", phantomId: "p", destinationSchemaId: "d", destinationSchemaVersion: "1.0.0", operations: to.map((name) => ({ op: "copy", from: "f_01", to: name })) }) as MappingContract;

describe("S17A-001 unwrittenRequiredTargets: a mapping that cannot satisfy the destination is named, never completed", () => {
  it("lists required destination fields no operation writes, in destination order", () => {
    expect(unwrittenRequiredTargets(contract(["id", "createdAt", "organization"]), pretty(helpdesk))).toEqual(["email", "status"]);
  });
  it("a complete mapping, a missing mapping and an invalid destination give no gap", () => {
    expect(unwrittenRequiredTargets(contract(["id", "email", "status", "createdAt", "organization"]), pretty(helpdesk))).toEqual([]);
    expect(unwrittenRequiredTargets(null, pretty(helpdesk))).toEqual([]);
    expect(unwrittenRequiredTargets(contract(["id"]), "not json")).toEqual([]);
  });
  it("is a reading only: the contract is not changed", () => {
    const mapping = contract(["id"]);
    const before = JSON.stringify(mapping);
    unwrittenRequiredTargets(mapping, pretty(helpdesk));
    expect(JSON.stringify(mapping)).toBe(before);
  });
});

describe("S17A-002 cloudBlockedTargets: only a provably unusable request is blocked", () => {
  it("names withheld for the only category field → blocked, with the field", () => {
    const plan = planFields(twin(crm), crm, pretty(helpdesk), none);
    expect(cloudBlockedTargets(plan)).toEqual([{ target: "status", source: "account_state", reason: "names-withheld", options: ["account_state"] }]);
  });
  it("names shared → not blocked", () => {
    const prepared = twin(crm, { account_state: { discloseCategories: true } });
    expect(cloudBlockedTargets(planFields(prepared, crm, pretty(helpdesk), none))).toEqual([]);
  });
  it("several category-like fields, none chosen (Meridian) → blocked as “choose the field”, not as “no source”", () => {
    const plan = planFields(twin(meridianRecords), meridianRecords, pretty(helpdesk), none);
    const [blocked] = cloudBlockedTargets(plan);
    expect(blocked?.reason).toBe("choose-source");
    expect(blocked?.options).toContain("account_state");
  });
  it("no category-like field at all → blocked as no source", () => {
    const records = crm.map((record) => ({ customer_id: record.customer_id, email_address: record.email_address }));
    expect(cloudBlockedTargets(planFields(twin(records), records, pretty(helpdesk), none))).toEqual([{ target: "status", source: null, reason: "no-source", options: [] }]);
  });
  it("uncertainty Gemini can resolve never blocks: undecided id / email / date matches, or a destination without fixed lists", () => {
    const prepared = twin(crm, { account_state: { discloseCategories: true } });
    const plan = planFields(prepared, crm, pretty(helpdesk), none)!;
    expect(plan.targets.some((item) => item.target.type !== "enum" && item.rule === null)).toBe(true);
    expect(cloudBlockedTargets(plan)).toEqual([]);
    expect(cloudBlockedTargets(planFields(twin(crm), crm, pretty(billing), none))).toEqual([]);
  });
});
