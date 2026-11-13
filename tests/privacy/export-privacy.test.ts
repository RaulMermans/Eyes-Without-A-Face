/**
 * PRIV-090…095 — export package privacy (Sprint 9). The scan must block, not
 * warn: each case injects one kind of leak and expects no archive.
 */
import { describe, expect, it } from "vitest";
import { exportCandidates, packageInputFor } from "../../src/app/export-context.ts";
import { buildIntegrationPackage, scanPackageFiles, type PrivacyContext } from "../../src/export/package.ts";
import { createZip, isSafeZipPath, readStoredZip } from "../../src/export/zip.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import { crmDemo, PACKAGE_ASSETS, verifiedWorkspace } from "../helpers/export-workspace.ts";

const privacy: PrivacyContext = {
  privateStrings: new Set(["alice@example.com", "north bridge co", "active_customer", "cust-001"]),
  sourceFieldPaths: ["email_address", "account_state", "contact.phone_number"],
  approvedLabels: { f_03: ["active_customer"] },
};
const destination = { type: "object", properties: { email: { type: "string" }, status: { enum: ["active"] } } };

describe("PRIV-090 the export scan finds every kind of leak", () => {
  it("flags private values, field names, secrets and the canary; allows approved labels and destination strings", () => {
    const scan = (path: string, content: string) => scanPackageFiles([{ path, content }], privacy, destination).map((item) => item.kind);
    expect(scan("mapping/mapping.alias.json", JSON.stringify({ params: { default: "North Bridge Co" } }))).toEqual(["private-value"]);
    expect(scan("mapping/mapping.alias.json", JSON.stringify({ params: { map: { "cust-001": "active" } } }))).toEqual(["private-value"]);
    expect(scan("mapping/mapping.alias.json", JSON.stringify({ from: "email_address" }))).toEqual(["source-field-name"]);
    expect(scan("mapping/mapping.alias.json", JSON.stringify({ from: "phone_number" }))).toEqual(["source-field-name"]);
    expect(scan("README.md", "Bind `account_state` here")).toEqual(["source-field-name"]);
    expect(scan("README.md", "Contact alice@example.com")).toEqual(["private-value"]);
    expect(scan("manifest.json", JSON.stringify({ k: "AIza" + "x".repeat(35) }))).toContain("secret-pattern");
    expect(scan("reports/validation-report.json", JSON.stringify({ note: PRIVATE_DATA_CANARY }))).toContain("canary");
    // Sanctioned: a label approved for disclosure, a destination field name, a JSON key that happens to match a field leaf.
    expect(scan("mapping/mapping.alias.json", JSON.stringify({ params: { map: { active_customer: "active" } }, to: "email", status: "x" }))).toEqual([]);
    // App-owned static files cannot carry user data; only secret patterns apply there.
    expect(scan("run.mjs", "const email_address = 'alice@example.com';")).toEqual([]);
    expect(scan("run.mjs", `const t = "${PRIVATE_DATA_CANARY}";`)).toEqual(["canary"]);
  });
});

describe("PRIV-091 a leaking mapping produces no archive", () => {
  it("a manual edit that writes a private value as a default is blocked, naming the file but not the value", async () => {
    const start = { ...crmDemo(), reservedRecords: null };
    const { workspace, prepared } = await verifiedWorkspace(start, (payload) => ({
      operations: [
        { op: "copy", from: payload.fields[2]?.alias, to: "id" },
        { op: "normalize_email", from: payload.fields[0]?.alias, to: "email" },
        { op: "default_if_missing", to: "status", params: { value: "prospect" } },
        { op: "parse_date", from: payload.fields[1]?.alias, to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
        { op: "default_if_missing", to: "organization", params: { value: "North Bridge Co" } },
      ],
      rationale: "leaks a private company name",
    }));
    expect(workspace.proposal?.result.ok).toBe(true);
    const [candidate] = exportCandidates(workspace, prepared);
    if (!candidate) throw new Error("no candidate");
    const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
    if (!input) throw new Error("no input");
    const result = await buildIntegrationPackage(input);
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (!result.ok) {
      expect(result.findings.map((item) => item.file)).toContain("mapping/mapping.alias.json");
      expect(JSON.stringify(result)).not.toContain("North Bridge");
    }
  });

  it("an alias contract that reads a local field name is refused", async () => {
    const { workspace, prepared } = await verifiedWorkspace({ ...crmDemo(), reservedRecords: null });
    const [candidate] = exportCandidates(workspace, prepared);
    if (!candidate?.aliasContract) throw new Error("no candidate");
    const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
    if (!input) throw new Error("no input");
    const tampered = { ...input, aliasContract: { ...candidate.aliasContract, operations: [{ op: "copy" as const, from: "email_address", to: "email" }] } };
    expect(await buildIntegrationPackage(tampered)).toMatchObject({ ok: false, code: "INVALID_INPUT", findings: [{ kind: "non-alias-reference" }] });
  });
});

describe("PRIV-092 ZIP paths cannot escape the extraction directory", () => {
  it("rejects traversal, absolute, backslash, empty-segment and odd-character paths", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a\\b", "a//b", "./a", "a/./b", "", "a b", "C:/x", "a/~/b", "é.json", "x".repeat(201)]) {
      expect(isSafeZipPath(bad), bad).toBe(false);
      expect(() => createZip([{ path: bad, content: "x" }]), bad).toThrow();
    }
    expect(() => createZip([{ path: "a.json", content: "1" }, { path: "a.json", content: "2" }])).toThrow(/Duplicate/);
  });

  it("every entry of a real export is a safe path under one root directory, and nothing is executable", async () => {
    const { workspace, prepared } = await verifiedWorkspace({ ...crmDemo(), reservedRecords: null });
    const [candidate] = exportCandidates(workspace, prepared);
    if (!candidate) throw new Error("no candidate");
    const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
    if (!input) throw new Error("no input");
    const result = await buildIntegrationPackage(input);
    if (!result.ok) throw new Error(result.code);
    const entries = readStoredZip(result.zip);
    expect(entries.every((entry) => isSafeZipPath(entry.path) && entry.path.startsWith(`${result.rootDir}/`))).toBe(true);
    // Only the two reviewed app-owned modules are code.
    expect(entries.filter((entry) => /\.(m?js|cjs|sh|exe|bat|ps1|py)$/.test(entry.path)).map((entry) => entry.path.slice(result.rootDir.length + 1)).sort()).toEqual([
      "run.mjs",
      "runtime/eyes-mapping-runtime.mjs",
    ]);
    // Unix mode 0644 in the central directory: no executable bit.
    const view = new DataView(result.zip.buffer, result.zip.byteOffset, result.zip.byteLength);
    for (let offset = 0; offset < result.zip.length - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) expect((view.getUint32(offset + 38, true) >>> 16) & 0o111).toBe(0);
    }
  });
});

describe("PRIV-093 the packaged code is exactly the reviewed code", () => {
  it("the manifest pins the runtime and runner by SHA-256 of the committed files", async () => {
    const { workspace, prepared } = await verifiedWorkspace({ ...crmDemo(), reservedRecords: null });
    const [candidate] = exportCandidates(workspace, prepared);
    if (!candidate) throw new Error("no candidate");
    const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
    if (!input) throw new Error("no input");
    const result = await buildIntegrationPackage(input);
    if (!result.ok) throw new Error(result.code);
    const { createHash } = await import("node:crypto");
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(result.manifest.runtime.runtimeSha256).toBe(hash(PACKAGE_ASSETS.runtimeSource));
    expect(result.manifest.runtime.runnerSha256).toBe(hash(PACKAGE_ASSETS.runnerSource));
    expect(result.manifest.runtime.npmDependencies).toEqual([]);
  });
});
