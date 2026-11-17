import { describe, expect, it } from "vitest";
import { executeMapping } from "../../src/domain/mapping/execute.ts";
import type { MappingContract, MappingOperation } from "../../src/domain/contracts/types.ts";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["id", "email"],
  properties: {
    id: { type: "string" },
    email: { type: "string", format: "email" },
    ended_on: { type: "string", format: "date" },
    backup_email: { type: "string", format: "email" },
    note: { type: ["string", "null"] },
    full_name: { type: "string" },
    address: { type: "object", additionalProperties: false, required: ["city"], properties: { city: { type: "string" }, region: { type: "string" } } },
  },
};
const contract = (operations: MappingOperation[]): MappingContract => ({ contractKind: "mapping", schemaVersion: "1.0.0", mappingId: "t", mappingVersion: "1", phantomId: "p", destinationSchemaId: "d", operations }) as MappingContract;
const base: MappingOperation[] = [
  { op: "copy", from: "id", to: "id" },
  { op: "normalize_email", from: "mail", to: "email" },
];
const run = (record: Record<string, unknown>, extra: MappingOperation[]) => executeMapping({ sourceRecord: record, mappingContract: contract([...base, ...extra]), targetSchema: schema });

describe("ADR 0019 an absent input for an optional destination field omits the field", () => {
  it("OPT-001 null or missing input on optional fields: the record transforms without them", () => {
    const result = run({ id: "1", mail: "A@example.com", ended: null }, [
      { op: "parse_date", from: "ended", to: "ended_on", params: { inputFormat: "DD/MM/YYYY" } },
      { op: "normalize_email", from: "alt", to: "backup_email" },
      { op: "concat", from: ["first", "last"], to: "full_name", params: { separator: " " } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toEqual({ id: "1", email: "a@example.com" });
  });

  it("OPT-002 present values are still transformed and validated", () => {
    const result = run({ id: "1", mail: "a@example.com", ended: "31/12/2025", first: "Ana", last: "Lind" }, [
      { op: "parse_date", from: "ended", to: "ended_on", params: { inputFormat: "DD/MM/YYYY" } },
      { op: "concat", from: ["first", "last"], to: "full_name", params: { separator: " " } },
    ]);
    expect(result.ok && result.output).toEqual({ id: "1", email: "a@example.com", ended_on: "2025-12-31", full_name: "Ana Lind" });
    const bad = run({ id: "1", mail: "a@example.com", ended: "2025-12-31" }, [{ op: "parse_date", from: "ended", to: "ended_on", params: { inputFormat: "DD/MM/YYYY" } }]);
    expect(bad.ok).toBe(false);
  });

  it("OPT-003 required destination fields still refuse the record", () => {
    expect(run({ id: "1", mail: null }, []).ok).toBe(false);
    expect(run({ id: "1" }, []).ok).toBe(false);
  });

  it("OPT-004 a null copied into an optional field that accepts null is written (ADR 0006)", () => {
    const result = run({ id: "1", mail: "a@example.com", n: null }, [{ op: "copy", from: "n", to: "note" }]);
    expect(result.ok && result.output).toEqual({ id: "1", email: "a@example.com", note: null });
  });

  it("OPT-005 nested: an optional leaf is omitted; a required leaf still fails", () => {
    const optional = run({ id: "1", mail: "a@example.com", c: "Leiden", r: null }, [
      { op: "copy", from: "c", to: "address.city" },
      { op: "trim", from: "r", to: "address.region" },
    ]);
    expect(optional.ok && optional.output).toEqual({ id: "1", email: "a@example.com", address: { city: "Leiden" } });
    expect(run({ id: "1", mail: "a@example.com", c: null }, [{ op: "trim", from: "c", to: "address.city" }]).ok).toBe(false);
  });
});
