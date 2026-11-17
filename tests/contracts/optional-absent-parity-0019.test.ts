/**
 * OAP-001…012 — independent qualification of ADR 0019 (an absent input for an
 * optional destination field omits the field).
 *
 * Every case runs the same contract, schema and records through:
 *  (a) the browser engine: executeMapping, executeMappingBatch, runRealityCheck,
 *      classifyReport + completionState under STRICT_POLICY (what the app uses);
 *  (b) the committed portable runtime bundle, `runRecords`, exactly as run.mjs calls it;
 * and requires equal outputs, decisions, failure codes and record counts.
 * OAP-012 replays an exported ZIP with `node run.mjs run` in a clean directory.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { MappingContract, MappingOperation } from "../../src/domain/contracts/types.ts";
import { executeMapping } from "../../src/domain/mapping/execute.ts";
import { executeMappingBatch } from "../../src/domain/mapping/batch.ts";
import { parseSourceDataset } from "../../src/app/source-import.ts";
import { initialWorkspaceState, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import { classifyReport, completionState, STRICT_POLICY } from "../../src/verification/outcomes.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { exportPackage, verifiedWorkspace } from "../helpers/export-workspace.ts";

type Runtime = typeof import("../../src/export/runtime/runtime.ts");
const runtime = (await import(pathToFileURL(path.resolve("src/export/runtime/generated/eyes-mapping-runtime.mjs")).href)) as Runtime;

const contract = (operations: MappingOperation[]): MappingContract =>
  ({ contractKind: "mapping", schemaVersion: "1.0.0", mappingId: "oap-0019", mappingVersion: "1", phantomId: "p", destinationSchemaId: "d", operations }) as MappingContract;

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    ended_on: { type: "string", format: "date" },
    note: { type: ["string", "null"] },
    full_name: { type: "string" },
    tier: { type: "string" },
    profile: {
      type: "object",
      additionalProperties: false,
      properties: {
        email: { type: "string" },
        note: { type: ["string", "null"] },
        name: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] },
        since: { type: "string", format: "date" },
      },
    },
  },
};

interface Row {
  status: "pass" | "fail";
  output: Record<string, unknown> | null;
  codes: Array<[string, number | null]>;
  outcome: string;
}

/** Run one case through both engines, assert parity and conservation, return the shared per-record rows. */
function parity(operations: MappingOperation[], records: Record<string, unknown>[], targetSchema: unknown = schema) {
  const mapping = contract(operations);
  // (a) browser engine
  const single = records.map((record) => executeMapping({ sourceRecord: record, mappingContract: mapping, targetSchema }));
  const batch = executeMappingBatch({ sourceRecords: records, mappingContract: mapping, targetSchema });
  const report = runRealityCheck({ records, mappingContract: mapping, targetSchema, bindings: null, now: () => 0 });
  const classified = classifyReport({ report, records, executable: mapping, policy: STRICT_POLICY });
  const browser: Row[] = report.rows.map((row, i) => ({
    status: row.status,
    output: row.output,
    codes: row.localIssues.map((issue) => [issue.code, typeof issue.operationIndex === "number" ? issue.operationIndex + 1 : null]),
    outcome: classified[i]?.outcome ?? "MISSING",
  }));
  expect(batch.results.map((r) => [r.status, r.output])).toEqual(single.map((r) => [r.ok ? "pass" : "fail", r.output]));
  expect(report.rows.map((r) => [r.status, r.output])).toEqual(batch.results.map((r) => [r.status, r.output]));

  // (b) portable runtime bundle, as run.mjs calls it
  const run = runtime.runRecords({ contract: mapping, targetSchema, records, policy: STRICT_POLICY, detail: true });
  if (!run.ok) throw new Error(JSON.stringify(run.error));
  const portable: Row[] = run.results.map((r) => ({ status: r.status, output: r.output, codes: r.issues.map((issue) => [issue.code, issue.operation ?? null]), outcome: r.outcome }));

  expect(portable).toEqual(browser);
  // Conservation: no record is silently dropped.
  expect(report.total).toBe(records.length);
  expect(report.passed + report.failed).toBe(records.length);
  expect(run.summary.total).toBe(records.length);
  expect(run.summary.transformedValid + run.summary.unresolved + run.summary.quarantined + run.summary.handledByApprovedRule + run.summary.rejectedByPolicy).toBe(records.length);
  expect(run.summary.transformedValid).toBe(browser.filter((r) => r.outcome === "TRANSFORMED_VALID").length);
  expect(run.summary.unresolved).toBe(browser.filter((r) => r.outcome === "UNRESOLVED").length);
  const state = completionState({ report, rows: classified, policy: STRICT_POLICY });
  return { rows: browser, report, state };
}

const ID: MappingOperation = { op: "copy", from: "id", to: "id" };
const firstCode = (row: Row | undefined) => row?.codes[0]?.[0];

describe("ADR 0019 parity: browser engine ≡ portable runtime", () => {
  it("OAP-001 optional field, source key missing → field absent, record transforms (flat and nested)", () => {
    const { rows, state } = parity(
      [ID, { op: "normalize_email", from: "mail", to: "email" }, { op: "trim", from: "c.mail", to: "profile.email" }],
      [{ id: "1" }, { id: "2", c: {} }],
    );
    expect(rows.map((r) => [r.status, r.output, r.outcome])).toEqual([
      ["pass", { id: "1" }, "TRANSFORMED_VALID"],
      ["pass", { id: "2" }, "TRANSFORMED_VALID"],
    ]);
    expect(state).toBe("VERIFIED");
  });

  it("OAP-002 optional field, source explicitly null → field absent (flat and nested)", () => {
    const { rows } = parity(
      [ID, { op: "normalize_email", from: "mail", to: "email" }, { op: "copy", from: "c.mail", to: "profile.email" }],
      [{ id: "1", mail: null, c: { mail: null } }],
    );
    expect(rows.map((r) => [r.status, r.output])).toEqual([["pass", { id: "1" }]]);
  });

  it("OAP-003 optional field under a null parent object → absent", () => {
    const { rows } = parity(
      [ID, { op: "trim", from: "c.mail", to: "email" }, { op: "parse_date", from: "c.since", to: "profile.since", params: { inputFormat: "YYYY-MM-DD" } }],
      [{ id: "1", c: null }],
    );
    expect(rows.map((r) => [r.status, r.output])).toEqual([["pass", { id: "1" }]]);
  });

  it("OAP-004 optional field present and valid → written (flat and nested)", () => {
    const { rows } = parity(
      [ID, { op: "normalize_email", from: "mail", to: "email" }, { op: "trim", from: "c.mail", to: "profile.email" }],
      [{ id: "1", mail: " A@Example.com ", c: { mail: " b@example.com " } }],
    );
    expect(rows[0]?.output).toEqual({ id: "1", email: "a@example.com", profile: { email: "b@example.com" } });
  });

  it("OAP-005 optional field present but invalid → record fails with the same code in both", () => {
    const { rows, state } = parity(
      [ID, { op: "parse_date", from: "ended", to: "ended_on", params: { inputFormat: "DD/MM/YYYY" } }, { op: "normalize_email", from: "c.mail", to: "profile.email" }],
      [
        { id: "1", ended: "2025-12-31" },
        { id: "2", c: { mail: 42 } },
        { id: "3", ended: "" },
        { id: "4", c: "not-an-object" },
      ],
    );
    expect(rows.map((r) => [r.status, firstCode(r), r.outcome])).toEqual([
      ["fail", "INVALID_DATE", "UNRESOLVED"],
      ["fail", "TYPE_MISMATCH", "UNRESOLVED"],
      ["fail", "EMPTY_VALUE", "UNRESOLVED"],
      ["fail", "TYPE_MISMATCH", "UNRESOLVED"],
    ]);
    expect(state).toBe("PARTIALLY_VERIFIED");
  });

  it("OAP-006 required field missing → record refused, same code", () => {
    const required = { ...schema, required: ["id", "email"] };
    const { rows } = parity([ID, { op: "normalize_email", from: "mail", to: "email" }], [{ id: "1" }, { id: "2", mail: "x@example.com" }], required);
    expect(rows.map((r) => [r.status, firstCode(r)])).toEqual([["fail", "MISSING_SOURCE_FIELD"], ["pass", undefined]]);
  });

  it("OAP-007 required field null → record refused, same code (string op and copy)", () => {
    const required = { ...schema, required: ["id", "email"] };
    expect(parity([ID, { op: "normalize_email", from: "mail", to: "email" }], [{ id: "1", mail: null }], required).rows.map(firstCode)).toEqual(["NULL_VALUE"]);
    expect(parity([ID, { op: "copy", from: "mail", to: "email" }], [{ id: "1", mail: null }], required).rows.map(firstCode)).toEqual(["OUTPUT_SCHEMA_MISMATCH"]);
  });

  it("OAP-008 nullable optional field with an explicit copy of null → null written (flat and nested)", () => {
    const { rows } = parity(
      [ID, { op: "copy", from: "n", to: "note" }, { op: "rename", from: "c.n", to: "profile.note" }],
      [{ id: "1", n: null, c: { n: null } }, { id: "2" }, { id: "3", c: null }],
    );
    expect(rows.map((r) => r.output)).toEqual([{ id: "1", note: null, profile: { note: null } }, { id: "2" }, { id: "3" }]);
    // A string op into a nullable optional field still omits (only copy/rename write null).
    expect(parity([ID, { op: "trim", from: "n", to: "note" }], [{ id: "1", n: null }]).rows[0]?.output).toEqual({ id: "1" });
  });

  it("OAP-009 schema constraints that reject the omission → both refuse identically", () => {
    // Leaf required in its own (optional) parent object: not optional under ADR 0019.
    const nestedRequired = {
      ...schema,
      properties: { ...schema.properties, profile: { type: "object", additionalProperties: false, required: ["email"], properties: { email: { type: "string" }, name: { type: "string" } } } },
    };
    const nested = parity(
      [ID, { op: "trim", from: "c.mail", to: "profile.email" }, { op: "trim", from: "c.name", to: "profile.name" }],
      [{ id: "1", c: { name: "Ana" } }, { id: "2", c: { mail: null, name: "Ana" } }, { id: "3" }, { id: "4", c: { mail: "x" } }],
      nestedRequired,
    );
    expect(nested.rows.map((r) => [r.status, firstCode(r)])).toEqual([
      ["fail", "MISSING_SOURCE_FIELD"],
      ["fail", "NULL_VALUE"],
      ["fail", "MISSING_SOURCE_FIELD"],
      ["pass", undefined],
    ]);
    // Optional sibling written, required leaf never mapped: the schema refuses the incomplete parent.
    expect(parity([ID, { op: "trim", from: "c.name", to: "profile.name" }], [{ id: "1", c: { name: "Ana" } }, { id: "2" }], nestedRequired).rows.map((r) => [r.status, firstCode(r)])).toEqual([
      ["fail", "OUTPUT_SCHEMA_MISMATCH"],
      ["pass", undefined],
    ]);
    // Leaf optional by `required`, but the schema still demands it: the omission is judged by the schema.
    const anyOf = { ...schema, anyOf: [{ required: ["email"] }] };
    expect(parity([ID, { op: "trim", from: "mail", to: "email" }], [{ id: "1" }, { id: "2", mail: "a" }], anyOf).rows.map((r) => [r.status, firstCode(r)])).toEqual([
      ["fail", "OUTPUT_SCHEMA_MISMATCH"],
      ["pass", undefined],
    ]);
  });

  it("OAP-010 nested concat / map_enum / parse_date: a missing input → absent; all inputs → written", () => {
    const ops: MappingOperation[] = [
      ID,
      { op: "concat", from: ["n.first", "n.last"], to: "profile.name", params: { separator: " " } },
      { op: "map_enum", from: "n.state", to: "profile.status", params: { map: { A: "active", I: "inactive" }, unmapped: "fail" } },
      { op: "parse_date", from: "n.since", to: "profile.since", params: { inputFormat: "DD/MM/YYYY" } },
    ];
    const { rows } = parity(ops, [
      { id: "1", n: { first: "Ana" } },
      { id: "2", n: { first: "Ana", last: null, state: null, since: null } },
      { id: "3", n: { first: "Ana", last: "Lind", state: "A", since: "31/12/2025" } },
      { id: "4", n: { first: "Ana", last: "Lind", state: "X" } },
    ]);
    expect(rows.map((r) => [r.status, r.output ?? firstCode(r)])).toEqual([
      ["pass", { id: "1" }],
      ["pass", { id: "2" }],
      ["pass", { id: "3", profile: { name: "Ana Lind", status: "active", since: "2025-12-31" } }],
      ["fail", "UNMAPPED_ENUM"],
    ]);
  });

  it("OAP-010b concat with one present non-string input and one missing input → omitted in both (ADR rule: any absent input omits)", () => {
    const { rows } = parity([ID, { op: "concat", from: ["first", "last"], to: "full_name", params: { separator: " " } }], [{ id: "1", first: 7 }, { id: "2", first: 7, last: "x" }]);
    expect(rows.map((r) => [r.status, r.output ?? firstCode(r)])).toEqual([["pass", { id: "1" }], ["fail", "TYPE_MISMATCH"]]);
  });

  it("OAP-011 default_if_missing unchanged", () => {
    const ops: MappingOperation[] = [ID, { op: "copy", from: "t", to: "tier" }, { op: "default_if_missing", from: "t", to: "tier", params: { value: "basic" } }];
    const { rows } = parity(ops, [{ id: "1" }, { id: "2", t: "gold" }, { id: "3", t: null }]);
    // Missing → default; present → copied; null is present (ADR 0006), so no default, and the optional field is omitted.
    expect(rows.map((r) => r.output)).toEqual([{ id: "1", tier: "basic" }, { id: "2", tier: "gold" }, { id: "3" }]);
    const bare = parity([ID, { op: "default_if_missing", to: "profile.status", params: { value: "active" } }], [{ id: "1" }]);
    expect(bare.rows[0]?.output).toEqual({ id: "1", profile: { status: "active" } });
  });
});

// ---------------------------------------------------------------------------
// OAP-012 exported ZIP replay
// ---------------------------------------------------------------------------

const created: string[] = [];
const freshDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};
afterAll(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const zipSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["id", "email"],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    nickname: { type: "string" },
    region: { type: "string" },
  },
};

// Fictional records: 1 missing optional, 2 null optional, 3 present optional, 4 required missing, 5 null parent.
const zipRecords = [
  { cust_ref: "r-001", mail_addr: "one@example.test", alias_text: " Bo ", where: { area: "north" } },
  { cust_ref: "r-002", mail_addr: "two@example.test", where: { area: "south" } },
  { cust_ref: "r-003", mail_addr: "three@example.test", alias_text: null, where: {} },
  { cust_ref: "r-004", alias_text: "Cy", where: { area: "east" } },
  { cust_ref: "r-005", mail_addr: "five@example.test", alias_text: "Di", where: null },
];

function aliasOf(prepared: PreparedTwin, field: string): string {
  const alias = prepared.twin.bindings.aliasForPath(field);
  if (!alias) throw new Error(`no alias for ${field}`);
  return alias;
}

describe("OAP-012 ZIP replay of cases 1, 2, 4, 6", () => {
  it("node run.mjs run on the extracted package reproduces the browser engine per record", async () => {
    const parsed = parseSourceDataset(JSON.stringify(zipRecords), "oap-0019.json");
    if (!parsed.ok) throw new Error(parsed.message);
    const start: WorkspaceState = { ...initialWorkspaceState(), source: parsed.value, reservedRecords: [], destinationText: JSON.stringify(zipSchema) };
    const { workspace, prepared } = await verifiedWorkspace(start, (_payload, twin) => ({
      operations: [
        { op: "copy", from: aliasOf(twin, "cust_ref"), to: "id" },
        { op: "normalize_email", from: aliasOf(twin, "mail_addr"), to: "email" },
        { op: "trim", from: aliasOf(twin, "alias_text"), to: "nickname" },
        { op: "trim", from: aliasOf(twin, "where.area"), to: "region" },
      ],
      rationale: "fictional test mapping",
    }));
    const report = workspace.report;
    if (!report) throw new Error(`no report: ${JSON.stringify(workspace.proposal?.result)}`);
    const browser = report.rows.map((row) => [row.status, row.output, row.localIssues.map((issue) => issue.code)]);
    expect(browser).toEqual([
      ["pass", { id: "r-001", email: "one@example.test", nickname: "Bo", region: "north" }, []],
      ["pass", { id: "r-002", email: "two@example.test", region: "south" }, []],
      ["pass", { id: "r-003", email: "three@example.test" }, []],
      ["fail", null, ["MISSING_SOURCE_FIELD"]],
      ["pass", { id: "r-005", email: "five@example.test", nickname: "Di" }, []],
    ]);

    // One unresolved record makes the package a confirmed DRAFT; it still replays.
    const { result } = await exportPackage(workspace, prepared, "active", true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const work = freshDir("eyes-oap-zip-");
    const zipPath = path.join(work, "package.zip");
    writeFileSync(zipPath, result.zip);
    const dir = freshDir("eyes-oap-room-");
    execFileSync("unzip", ["-q", zipPath, "-d", dir]);
    const root = path.join(dir, readdirSync(dir)[0] as string);
    const node = (args: string[]) => spawnSync(process.execPath, ["run.mjs", ...args], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });

    const env = freshDir("eyes-oap-env-");
    writeFileSync(path.join(env, "records.json"), JSON.stringify(zipRecords));
    const mapping = JSON.parse(readFileSync(path.join(root, "mapping/mapping.alias.json"), "utf8")) as MappingContract;
    const aliases = Object.fromEntries(prepared.twin.bindings.entries().map((entry) => [entry.alias, entry.sourcePath]));
    const template = JSON.parse(node(["bindings-template"]).stdout) as { aliases: Record<string, string> };
    writeFileSync(
      path.join(env, "bindings.json"),
      JSON.stringify({ bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: Object.fromEntries(Object.keys(template.aliases).map((alias) => [alias, aliases[alias]])) }),
    );
    const out = path.join(env, "results.json");
    const run = node(["run", "--input", path.join(env, "records.json"), "--bindings", path.join(env, "bindings.json"), "--out", out]);
    // 3 = EXIT_RECORDS_NEED_REVIEW: record 4 (required field missing) is unresolved, as in the browser.
    expect(run.status, run.stderr).toBe(3);
    const produced = JSON.parse(readFileSync(out, "utf8")) as {
      results: Array<{ status: string; output: unknown; outcome: string; issues: Array<{ code: string }> }>;
      summary: { total: number; transformedValid: number; unresolved: number };
    };
    expect(produced.results.map((r) => [r.status, r.output, r.issues.map((issue) => issue.code)])).toEqual(browser);
    const classified = classifyReport({ report, records: zipRecords, executable: workspace.proposal?.result.ok ? workspace.proposal.result.value.resolved.executable : contract([]), policy: STRICT_POLICY });
    expect(produced.results.map((r) => r.outcome)).toEqual(classified.map((row) => row.outcome));
    expect(produced.summary.total).toBe(zipRecords.length);
    expect(produced.summary.transformedValid + produced.summary.unresolved).toBe(zipRecords.length);
    expect([produced.summary.transformedValid, produced.summary.unresolved]).toEqual([4, 1]);
  }, 60_000);
});
