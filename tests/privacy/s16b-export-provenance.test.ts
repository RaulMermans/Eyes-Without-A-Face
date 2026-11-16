/**
 * Sprint 16B (D3) — the export privacy scan judges text by provenance.
 *
 * Sprint 16A found that an ordinary source value (e.g. "failed" in an UNMAPPED
 * column) blocked a safe package because the same word is part of the package's
 * own fixed text (the report key `realityCheck.failed`; README prose; status
 * codes). The fix may only exempt application-owned text. Every user-derived
 * string is still scanned, and secrets, canaries and field names still block.
 */
import { describe, expect, it } from "vitest";
import { exportCandidates, packageInputFor } from "../../src/app/export-context.ts";
import type { WorkspaceState } from "../../src/app/workspace-state.ts";
import { buildIntegrationPackage, scanPackageFiles, type PackageBuildResult } from "../../src/export/package.ts";
import { appCode, owned } from "../../src/export/provenance.ts";
import { readStoredZip } from "../../src/export/zip.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import { crmDemo, PACKAGE_ASSETS, verifiedWorkspace } from "../helpers/export-workspace.ts";

/** Ordinary words that the package's own fixed text contains (report keys, README, codes, sentences). */
const APP_WORDS = ["failed", "approved", "verified", "resolved", "pass", "imported", "review", "unknown"];
const DATASET_CANARY = "S16B_CANARY_7F3A9C21D04E";

/** The CRM demo plus unmapped columns whose values are ordinary words (and one dataset-specific canary). */
function demoWithOrdinaryWords(): WorkspaceState {
  const start = crmDemo();
  const records = (start.source?.records ?? []).map((record, index) => ({
    ...(record as Record<string, unknown>),
    reminder_status: APP_WORDS[index % APP_WORDS.length],
    review_state: APP_WORDS[(index + 3) % APP_WORDS.length],
    audit_flag: APP_WORDS.slice(index).join(" "),
    tracking_note: DATASET_CANARY,
  }));
  return { ...start, reservedRecords: null, source: start.source ? { ...start.source, records } : null };
}

async function build(workspace: WorkspaceState, prepared: NonNullable<Parameters<typeof exportCandidates>[1]>): Promise<PackageBuildResult> {
  const [candidate] = exportCandidates(workspace, prepared);
  if (!candidate) throw new Error("no candidate");
  const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
  if (!input) throw new Error("no input");
  return buildIntegrationPackage(input);
}

const goodProposal = (payload: { fields: Array<{ alias: string }> }, extra: object[] = []) => ({
  operations: [
    { op: "copy", from: payload.fields[2]?.alias, to: "id" },
    { op: "normalize_email", from: payload.fields[0]?.alias, to: "email" },
    { op: "default_if_missing", to: "status", params: { value: "prospect" } },
    { op: "parse_date", from: payload.fields[1]?.alias, to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
    ...extra,
  ],
  rationale: "fixed test proposal",
});

describe("S16B-D3-001 ordinary words in unmapped columns no longer block a safe package (failed before the fix)", () => {
  it("exports; the scan found nothing; no source value, field name or canary is in any file", async () => {
    const start = demoWithOrdinaryWords();
    const { workspace, prepared } = await verifiedWorkspace(start, (payload) =>
      goodProposal(payload, [{ op: "default_if_missing", to: "organization", params: { value: "Fictional Org" } }]),
    );
    expect(workspace.proposal?.result.ok).toBe(true);
    const result = await build(workspace, prepared);
    expect(result.ok, JSON.stringify(result.ok ? "" : result.findings)).toBe(true);
    if (!result.ok) return;
    const text = readStoredZip(result.zip).map((entry) => new TextDecoder().decode(entry.data)).join("\n");
    expect(text).not.toContain(DATASET_CANARY);
    expect(text).not.toContain(PRIVATE_DATA_CANARY);
    expect(text).not.toContain("reminder_status");
    expect(text).not.toContain("audit_flag");
  });
});

describe("S16B-D3-002 positive controls: the same scan still blocks genuine leaks", () => {
  it("the SAME ordinary word in a user-derived position (a mapping default) is still a private-value leak", async () => {
    const start = demoWithOrdinaryWords();
    const { workspace, prepared } = await verifiedWorkspace(start, (payload) => goodProposal(payload, [{ op: "default_if_missing", to: "organization", params: { value: "approved" } }]));
    const result = await build(workspace, prepared);
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (!result.ok) expect(result.findings).toContainEqual({ file: "mapping/mapping.alias.json", kind: "private-value" });
  });

  it("a dataset-specific canary placed in a user-derived export field blocks the package", async () => {
    const start = demoWithOrdinaryWords();
    const { workspace, prepared } = await verifiedWorkspace(start, (payload) => goodProposal(payload, [{ op: "default_if_missing", to: "organization", params: { value: DATASET_CANARY } }]));
    const result = await build(workspace, prepared);
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (!result.ok) expect(JSON.stringify(result)).not.toContain(DATASET_CANARY);
  });

  it("the application's private canary in a user-derived field blocks with the canary finding", async () => {
    const start = demoWithOrdinaryWords();
    const { workspace, prepared } = await verifiedWorkspace(start, (payload) => goodProposal(payload, [{ op: "default_if_missing", to: "organization", params: { value: PRIVATE_DATA_CANARY } }]));
    const result = await build(workspace, prepared);
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (!result.ok) expect(result.findings.map((item) => item.kind)).toContain("canary");
  });
});

describe("S16B-D3-003 provenance-aware scanning, unit level", () => {
  const privacy = { privateStrings: new Set(["failed", "approved", "verified", "north bridge co"]), sourceFieldPaths: ["reminder_status"], approvedLabels: {} };
  const destination = { type: "object", properties: { status: { enum: ["active"] } } };

  it("owned text masks only the fixed fragments and closed codes; interpolated user text is still scanned", () => {
    const doc = owned`Status: ${appCode("VERIFIED")} · checks failed: ${appCode(0)} · title ${"North Bridge Co"}`;
    expect(doc.text).toBe("Status: VERIFIED · checks failed: 0 · title North Bridge Co");
    const findings = scanPackageFiles([{ path: "README.md", content: doc.text, scan: doc.scan }], privacy, destination);
    expect(findings).toEqual([{ file: "README.md", kind: "private-value" }]);
    const clean = owned`Status: ${appCode("VERIFIED")} · checks failed: ${appCode(0)}`;
    expect(scanPackageFiles([{ path: "README.md", content: clean.text, scan: clean.scan }], privacy, destination)).toEqual([]);
  });

  it("fail-closed: a file without provenance is scanned exactly as before", () => {
    expect(scanPackageFiles([{ path: "reports/validation-report.json", content: JSON.stringify({ realityCheck: { failed: 2 } }) }], privacy, destination)).toEqual([
      { file: "reports/validation-report.json", kind: "private-value" },
    ]);
    expect(scanPackageFiles([{ path: "README.md", content: "Status: VERIFIED" }], privacy, destination)).toEqual([{ file: "README.md", kind: "private-value" }]);
  });

  it("secrets, canaries and field names are judged on the full text, never on the masked text", () => {
    const doc = owned`Fixed ${appCode(PRIVATE_DATA_CANARY)} and ${appCode("AIza" + "x".repeat(35))} and \`reminder_status\``;
    const kinds = scanPackageFiles([{ path: "README.md", content: doc.text, scan: doc.scan }], privacy, destination).map((item) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(["canary", "secret-pattern", "source-field-name"]));
  });

  it("an unapproved label used as a mapping key is still blocked (keys of user-derived files are never exempt)", () => {
    const content = JSON.stringify({ operations: [{ op: "map_enum", params: { map: { failed: "active" } } }] });
    expect(scanPackageFiles([{ path: "mapping/mapping.alias.json", content }], privacy, destination)).toEqual([{ file: "mapping/mapping.alias.json", kind: "private-value" }]);
  });
});
