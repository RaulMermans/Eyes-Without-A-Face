import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crmReservedRecords, withImportedSource } from "../../src/app/demo.ts";
import { initialWorkspaceState, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { transformedCsv, transformedJson, transformedRecords } from "../../src/app/guided/transformed-output.ts";
import { listWorkflowEvents } from "../../src/observability/workflow-log.ts";
import { PRIVATE_DATA_CANARY as PRIVATE_CANARY } from "../../src/privacy/canaries.ts";
import { toImportedSource } from "../../src/sources/adapter.ts";
import { importFile, type FileLike } from "../../src/sources/files.ts";
import { readRestSource } from "../../src/sources/rest.ts";
import { exportPackage, verifiedWorkspace } from "../helpers/export-workspace.ts";

/**
 * Sprint 13 privacy: the new source adapters and the guided outputs keep every
 * existing boundary. Records from CSV, XLSX and a connected API are private
 * exactly like a JSON import.
 */
function fileOf(name: string, path: string): FileLike {
  const bytes = Uint8Array.from(readFileSync(path));
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
}

async function workspaceFrom(name: string, path: string): Promise<WorkspaceState> {
  const imported = await importFile(fileOf(name, path));
  if (!imported.ok) throw new Error(imported.problem.message);
  return withImportedSource(initialWorkspaceState(), toImportedSource(imported.value), crmReservedRecords());
}

const FORMATS = [
  ["crm.csv", "src/examples/crm/source-records.csv"],
  ["crm.xlsx", "src/examples/crm/source-records.xlsx"],
] as const;

describe("PRV-SRC source adapters keep records private", () => {
  it.each(FORMATS)("PRV-SRC-001 %s: the canary never reaches the disclosure payload or the outbound prompt", async (name, path) => {
    const start = await workspaceFrom(name, path);
    expect(JSON.stringify(start.source?.records)).toContain(PRIVATE_CANARY);
    const { workspace } = await verifiedWorkspace(start);
    const preview = workspace.review!.preview;
    for (const text of [preview.canonicalJson, preview.outboundPrompt, preview.outboundApplicationJson]) {
      expect(text).not.toContain(PRIVATE_CANARY);
      expect(text).not.toContain("email_address");
      expect(text).not.toContain("ALICE@EXAMPLE.COM");
    }
  });

  it.each(FORMATS)("PRV-SRC-002 %s: the portable package contains no record, field name or canary", async (name, path) => {
    const start = await workspaceFrom(name, path);
    const { workspace, prepared } = await verifiedWorkspace(start);
    const { result } = await exportPackage(workspace, prepared, "active", true);
    if (!result.ok) return; // a blocked export packs nothing at all
    // The package is a STORED (uncompressed) ZIP, so its bytes are searchable text.
    const zip = Buffer.from(result.zip).toString("latin1");
    expect(zip).not.toContain(PRIVATE_CANARY);
    expect(zip).not.toContain("email_address");
    expect(zip).not.toContain("bob@example.com");
    expect(result.manifest.includesPrivateSourceFixtures).toBe(false);
  });

  it("PRV-SRC-003 importing records writes nothing to workflow telemetry", async () => {
    const before = listWorkflowEvents().length;
    for (const [name, path] of FORMATS) await importFile(fileOf(name, path));
    expect(listWorkflowEvents().length).toBe(before);
  });

  it("PRV-SRC-004 source provenance carries no values", async () => {
    for (const [name, path] of FORMATS) {
      const start = await workspaceFrom(name, path);
      const origin = JSON.stringify(start.source?.origin);
      expect(origin).not.toContain(PRIVATE_CANARY);
      expect(origin).not.toContain("CUST-00");
      expect(origin).not.toContain("example.com");
    }
  });
});

describe("PRV-CON connector credentials never leave the request", () => {
  it("PRV-CON-001 the bearer token is absent from the normalized source, the twin, the disclosure and the package", async () => {
    const token = "tok_PRIVACY_TEST_9f2";
    const records = [
      { id: "C-1", email: "ada@example.com", tier: "gold" },
      { id: "C-2", email: "bo@example.com", tier: "silver" },
    ];
    const fetchImpl = (async () => new Response(JSON.stringify(records), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const read = await readRestSource({ url: "https://api.example.com/customers", token, fetchImpl });
    if (!read.ok) throw new Error(read.problem.message);
    const start = withImportedSource(initialWorkspaceState(), toImportedSource(read.value), null);
    const { workspace, prepared } = await verifiedWorkspace(start);
    const everything = [
      JSON.stringify(read.value),
      JSON.stringify(start),
      workspace.review!.preview.outboundPrompt,
      JSON.stringify(listWorkflowEvents()),
      JSON.stringify(prepared.twin.fields),
    ].join("\n");
    expect(everything).not.toContain(token);
    const { result } = await exportPackage(workspace, prepared, "active", true);
    if (result.ok) expect(Buffer.from(result.zip).toString("latin1")).not.toContain(token);
  });
});

describe("PRV-OUT transformed-data downloads", () => {
  it("PRV-OUT-001 include only imported records that passed, never reserved test cases", async () => {
    const start = await workspaceFrom("crm.csv", "src/examples/crm/source-records.csv");
    const { workspace } = await verifiedWorkspace(start);
    const output = transformedRecords(workspace.report!);
    const imported = workspace.report!.rows.filter((row) => row.set === "imported");
    expect(output.records.length + output.excluded).toBe(imported.length);
    const reservedOutputs = workspace.report!.rows.filter((row) => row.set === "reserved" && row.output).map((row) => JSON.stringify(row.output));
    for (const text of reservedOutputs) expect(transformedJson(output)).not.toContain(text);
  });

  it("PRV-OUT-002 CSV output neutralizes spreadsheet formulas", () => {
    const csv = transformedCsv({ records: [{ name: "=HYPERLINK(\"https://evil.example\")", n: 5, note: "@SUM(A1)", ok: "plain" }], excluded: 0 });
    const row = csv.split("\r\n")[1]!;
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("'@SUM");
    expect(row).toContain(",5,");
    expect(row).toContain("plain");
  });
});
