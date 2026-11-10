import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { executeMappingBatch } from "../../src/domain/mapping/batch.ts";
import { executeMapping } from "../../src/domain/mapping/execute.ts";
import { MAPPING_LIMITS } from "../../src/domain/mapping/limits.ts";
import { isSupportedOperation } from "../../src/domain/mapping/operations.ts";
import type { MappingContract, MappingOperation } from "../../src/domain/contracts/types.ts";
import destinationSchema from "../../src/examples/crm/destination.schema.json" with { type: "json" };
import expectedOutputs from "../../src/examples/crm/expected-outputs.json" with { type: "json" };
import mappingContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import sourceRecords from "../../src/examples/crm/source-records.json" with { type: "json" };
import edgeRecords from "../../src/examples/crm/edge-records.json" with { type: "json" };

const mapping = mappingContract as MappingContract;
const target = destinationSchema as object;

function contract(operations: MappingOperation[], rest: Partial<MappingContract> = {}): MappingContract {
  return {
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId: "test-map",
    mappingVersion: "1",
    phantomId: "phantom-test",
    destinationSchemaId: "helpdesk-account",
    operations,
    ...rest,
  };
}

const identitySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: true,
} as const;

describe("mapping operations catalog", () => {
  it("accepts the eight supported operations and rejects eval_js", () => {
    expect(isSupportedOperation("copy")).toBe(true);
    expect(isSupportedOperation("rename")).toBe(true);
    expect(isSupportedOperation("trim")).toBe(true);
    expect(isSupportedOperation("normalize_email")).toBe(true);
    expect(isSupportedOperation("parse_date")).toBe(true);
    expect(isSupportedOperation("map_enum")).toBe(true);
    expect(isSupportedOperation("default_if_missing")).toBe(true);
    expect(isSupportedOperation("concat")).toBe(true);
    expect(isSupportedOperation("eval_js")).toBe(false);
  });
});

describe("fictional CRM mapping", () => {
  it("transforms the sample records into the expected destination records", () => {
    const batch = executeMappingBatch({
      sourceRecords: sourceRecords.records,
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(batch.ok).toBe(true);
    expect(batch.results.map((item) => item.output)).toEqual(expectedOutputs.records);
  });

  it("is deterministic across repeated runs", () => {
    const first = executeMapping({
      sourceRecord: sourceRecords.records[0],
      mappingContract: mapping,
      targetSchema: target,
    });
    const second = executeMapping({
      sourceRecord: sourceRecords.records[0],
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(first).toEqual(second);
  });
});

describe("copy and rename", () => {
  it("copies primitives without coercion", () => {
    const result = executeMapping({
      sourceRecord: { id: "CUST-001", n: 3, ok: true },
      mappingContract: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "copy", from: "n", to: "n" },
        { op: "copy", from: "ok", to: "ok" },
      ]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ id: "CUST-001", n: 3, ok: true });
    }
  });

  it("rename writes a new destination key and does not mutate the source", () => {
    const source = { customer_id: "CUST-001" };
    const result = executeMapping({
      sourceRecord: source,
      mappingContract: contract([{ op: "rename", from: "customer_id", to: "id" }]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ id: "CUST-001" });
    }
    expect(source).toEqual({ customer_id: "CUST-001" });
  });
});

describe("trim, email, concat, default, dates, enums", () => {
  it("trims strings and rejects trim on numbers", () => {
    const ok = executeMapping({
      sourceRecord: { name: "  Example Studio  " },
      mappingContract: contract([{ op: "trim", from: "name", to: "organization" }]),
      targetSchema: identitySchema,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.output.organization).toBe("Example Studio");
    }
    const bad = executeMapping({
      sourceRecord: { name: 12 },
      mappingContract: contract([{ op: "trim", from: "name", to: "organization" }]),
      targetSchema: identitySchema,
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("normalizes emails and rejects invalid email input", () => {
    const ok = executeMapping({
      sourceRecord: { email_address: " ALICE@EXAMPLE.COM " },
      mappingContract: contract([{ op: "normalize_email", from: "email_address", to: "email" }]),
      targetSchema: identitySchema,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.output.email).toBe("alice@example.com");
    }
    const invalid = executeMapping({
      sourceRecord: { email_address: "not-an-email" },
      mappingContract: contract([{ op: "normalize_email", from: "email_address", to: "email" }]),
      targetSchema: identitySchema,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues[0]?.code).toBe("INVALID_EMAIL");
  });

  it("concatenates strings with the declared separator and rejects numbers", () => {
    const ok = executeMapping({
      sourceRecord: { given_name: "Ada", family_name: "Example" },
      mappingContract: contract([
        { op: "concat", from: ["given_name", "family_name"], to: "name", params: { separator: " " } },
      ]),
      targetSchema: identitySchema,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.output.name).toBe("Ada Example");
    }
    const bad = executeMapping({
      sourceRecord: { given_name: "Ada", family_name: 7 },
      mappingContract: contract([
        { op: "concat", from: ["given_name", "family_name"], to: "name", params: { separator: " " } },
      ]),
      targetSchema: identitySchema,
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("applies default_if_missing only when the source field is absent, not for explicit null", () => {
    const missing = executeMapping({
      sourceRecord: { id: "1" },
      mappingContract: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "default_if_missing", from: "region", to: "region", params: { value: "unspecified" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.output.region).toBe("unspecified");
    }
    const presentNull = executeMapping({
      sourceRecord: { id: "1", region: null },
      mappingContract: contract([
        { op: "copy", from: "id", to: "id" },
        { op: "default_if_missing", from: "region", to: "region", params: { value: "unspecified" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(presentNull.ok).toBe(true);
    if (presentNull.ok) {
      expect(presentNull.output.region).toBeUndefined();
    }
  });

  it("parses YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, and ISO-8601 UTC", () => {
    const ymd = executeMapping({
      sourceRecord: { joined_at: "2026-01-15" },
      mappingContract: contract([
        { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(ymd.ok && ymd.output.createdAt).toBe("2026-01-15");

    const mdy = executeMapping({
      sourceRecord: { joined_at: "01/15/2026" },
      mappingContract: contract([
        { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(mdy.ok && mdy.output.createdAt).toBe("2026-01-15");

    const dmy = executeMapping({
      sourceRecord: { joined_at: "15/01/2026" },
      mappingContract: contract([
        { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "DD/MM/YYYY" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(dmy.ok && dmy.output.createdAt).toBe("2026-01-15");

    const iso = executeMapping({
      sourceRecord: { joined_at: "2026-01-15T00:00:00-05:00" },
      mappingContract: contract([
        { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "ISO-8601" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(iso.ok && iso.output.createdAt).toBe("2026-01-15T05:00:00.000Z");
  });

  it("rejects invalid calendar dates", () => {
    const result = executeMapping({
      sourceRecord: { joined_at: "2026-02-30" },
      mappingContract: contract([
        { op: "parse_date", from: "joined_at", to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      ]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("INVALID_DATE");
  });

  it("maps enums and fails closed on unmapped values", () => {
    const ok = executeMapping({
      sourceRecord: { account_state: "active_customer" },
      mappingContract: contract([
        {
          op: "map_enum",
          from: "account_state",
          to: "status",
          params: { map: { active_customer: "active" }, unmapped: "fail" },
        },
      ]),
      targetSchema: identitySchema,
    });
    expect(ok.ok && ok.output.status).toBe("active");
    const unmapped = executeMapping({
      sourceRecord: edgeRecords.records[0],
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(unmapped.ok).toBe(false);
    expect(unmapped.issues.some((issue) => issue.code === "UNMAPPED_ENUM")).toBe(true);
  });

  it("uses map_enum default when unmapped=default", () => {
    const result = executeMapping({
      sourceRecord: { account_state: "unknown" },
      mappingContract: contract([
        {
          op: "map_enum",
          from: "account_state",
          to: "status",
          params: { map: { active_customer: "active" }, unmapped: "default", default: "prospect" },
        },
      ]),
      targetSchema: identitySchema,
    });
    expect(result.ok && result.output.status).toBe("prospect");
  });
});

describe("failure modes", () => {
  it("rejects invalid mapping contracts", () => {
    const result = executeMapping({
      sourceRecord: { customer_id: "CUST-001" },
      mappingContract: { contractKind: "mapping", schemaVersion: "1.0.0" },
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("INVALID_MAPPING_CONTRACT");
  });

  it("rejects unsupported schema versions", () => {
    const result = executeMapping({
      sourceRecord: sourceRecords.records[0],
      mappingContract: { ...mapping, schemaVersion: "0.0.1" },
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("rejects missing required source fields", () => {
    const result = executeMapping({
      sourceRecord: { email_address: "a@example.com" },
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("MISSING_SOURCE_FIELD");
  });

  it("treats explicit null as null, not missing, for copy", () => {
    const result = executeMapping({
      sourceRecord: { customer_id: null },
      mappingContract: contract([{ op: "copy", from: "customer_id", to: "id" }]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.id).toBeNull();
    }
  });

  it("rejects invalid mapping references", () => {
    const result = executeMapping({
      sourceRecord: { id: "1" },
      mappingContract: contract([{ op: "copy", from: "id[0]", to: "id" }]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_NESTED_STRUCTURE");
  });

  it("rejects unsupported operations through contract validation", () => {
    const result = executeMapping({
      sourceRecord: { id: "1" },
      mappingContract: {
        ...contract([{ op: "copy", from: "id", to: "id" }]),
        operations: [{ op: "eval_js", from: "id", to: "id" }],
      },
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("INVALID_MAPPING_CONTRACT");
  });

  it("rejects incorrect output types against the target schema", () => {
    const result = executeMapping({
      sourceRecord: { customer_id: 99, email_address: "a@example.com", account_state: "active_customer", joined_at: "2026-01-15", company_name: "X" },
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "OUTPUT_SCHEMA_MISMATCH")).toBe(true);
  });

  it("rejects conflicting destination fields", () => {
    const result = executeMapping({
      sourceRecord: { a: "1", b: "2" },
      mappingContract: contract([
        { op: "copy", from: "a", to: "id" },
        { op: "copy", from: "b", to: "id" },
      ]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("CONFLICTING_DESTINATION");
  });

  it("rejects prototype-pollution keys", () => {
    const result = executeMapping({
      sourceRecord: JSON.parse('{"customer_id":"CUST-001","__proto__":{"polluted":true}}') as Record<string, unknown>,
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("PROTOTYPE_POLLUTION");
  });

  it("rejects a draft-07 destination schema", () => {
    const result = executeMapping({
      sourceRecord: { id: "1" },
      mappingContract: contract([{ op: "copy", from: "id", to: "id" }]),
      targetSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("does not coerce objects or arrays on copy", () => {
    const result = executeMapping({
      sourceRecord: { id: { nested: true } },
      mappingContract: contract([{ op: "copy", from: "id", to: "id" }]),
      targetSchema: identitySchema,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("rejects a non-object source record", () => {
    const result = executeMapping({
      sourceRecord: [{ customer_id: "CUST-001" }],
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("MALFORMED_JSON");
  });
});

describe("batch execution", () => {
  it("reports per-record failures without dropping successful rows", () => {
    const batch = executeMappingBatch({
      sourceRecords: [...sourceRecords.records, edgeRecords.records[0]],
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(batch.ok).toBe(false);
    expect(batch.passed).toBe(3);
    expect(batch.failed).toBe(1);
    expect(batch.results[3]?.issues.some((issue) => issue.code === "UNMAPPED_ENUM")).toBe(true);
    expect(batch.results[0]?.output).toEqual(expectedOutputs.records[0]);
  });

  it("fails the reserved type-incompatible email record", () => {
    const result = executeMapping({
      sourceRecord: edgeRecords.records[1],
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("rejects oversized batches before running records", () => {
    const records = Array.from({ length: MAPPING_LIMITS.maxBatchRecords + 1 }, (_, index) => ({
      customer_id: `CUST-${index}`,
    }));
    const batch = executeMappingBatch({
      sourceRecords: records,
      mappingContract: mapping,
      targetSchema: target,
    });
    expect(batch.ok).toBe(false);
    expect(batch.results).toEqual([]);
    expect(batch.issues[0]?.code).toBe("BATCH_LIMIT_EXCEEDED");
  });
});

describe("property-based mapping", () => {
  it("copy is the identity for strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (value) => {
        const result = executeMapping({
          sourceRecord: { id: value },
          mappingContract: contract([{ op: "copy", from: "id", to: "id" }]),
          targetSchema: identitySchema,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.output.id).toBe(value);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("trim is idempotent on strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (value) => {
        const once = executeMapping({
          sourceRecord: { name: value },
          mappingContract: contract([{ op: "trim", from: "name", to: "name" }]),
          targetSchema: identitySchema,
        });
        expect(once.ok).toBe(true);
        if (!once.ok) {
          return;
        }
        const twice = executeMapping({
          sourceRecord: { name: once.output.name },
          mappingContract: contract([{ op: "trim", from: "name", to: "name" }]),
          targetSchema: identitySchema,
        });
        expect(twice.ok && twice.output.name).toEqual(once.output.name);
      }),
      { numRuns: 20 },
    );
  });
});

describe("domain isolation", () => {
  it("mapping engine source files do not import React, Firebase, or DOM APIs", () => {
    const dir = path.join(process.cwd(), "src/domain/mapping");
    const files = ["execute.ts", "batch.ts", "operations.ts", "ops.ts", "paths.ts", "safety.ts", "target-schema.ts"];
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text).not.toMatch(/from ["']react["']/);
      expect(text).not.toMatch(/from ["']firebase/);
      expect(text).not.toMatch(/window\.|document\.|localStorage/);
    }
  });
});
