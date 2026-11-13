/**
 * EXP-001…008 — Sprint 9 Acceptance Gate A, clean-room proof.
 *
 * Export a package from real workspace state, write the ZIP, extract it with
 * the system `unzip` (an independent implementation) into a fresh temporary
 * directory outside the repository, and run the packaged runner with a plain
 * `node` process: no npm install, no repository modules on the path.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalizeJson } from "../../src/domain/json/canonical.ts";
import { executeMappingBatch } from "../../src/domain/mapping/batch.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import { bindMapping } from "../../src/export/runtime/runtime.ts";
import type { MappingContract } from "../../src/domain/contracts/types.ts";
import { crmDemo, exportPackage, verifiedWorkspace } from "../helpers/export-workspace.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";

const created: string[] = [];
function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
afterAll(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function aliasOf(prepared: PreparedTwin, field: string): string {
  const alias = prepared.twin.bindings.aliasForPath(field);
  if (!alias) throw new Error(field);
  return alias;
}

/** A correct CRM mapping over aliases (labels approved for disclosure). */
function correctCrmProposal(_payload: unknown, prepared: PreparedTwin) {
  return {
    operations: [
      { op: "copy", from: aliasOf(prepared, "customer_id"), to: "id" },
      { op: "normalize_email", from: aliasOf(prepared, "email_address"), to: "email" },
      {
        op: "map_enum",
        from: aliasOf(prepared, "account_state"),
        to: "status",
        params: { map: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" }, unmapped: "fail" },
      },
      { op: "parse_date", from: aliasOf(prepared, "joined_at"), to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      { op: "trim", from: aliasOf(prepared, "company_name"), to: "organization" },
    ],
    rationale: "fictional test mapping",
  };
}

async function exportedCrm() {
  const start = { ...crmDemo(), overrides: { account_state: { discloseCategories: true } } };
  const { workspace, prepared } = await verifiedWorkspace(start, correctCrmProposal);
  const { candidate, result } = await exportPackage(workspace, prepared, "active", true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { workspace, prepared, candidate, result };
}

function extract(zip: Uint8Array): { root: string; dir: string } {
  const work = freshDir("eyes-export-zip-");
  const zipPath = path.join(work, "package.zip");
  writeFileSync(zipPath, zip);
  execFileSync("unzip", ["-tq", zipPath]);
  const dir = freshDir("eyes-clean-room-");
  execFileSync("unzip", ["-q", zipPath, "-d", dir]);
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  return { root: path.join(dir, entries[0] as string), dir };
}

function node(cwd: string, args: string[]) {
  // A bare environment: no NODE_PATH, no repository on the module path.
  return spawnSync(process.execPath, ["run.mjs", ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("EXP-001 exported package runs outside the app", () => {
  it("extracts with unzip and passes `node run.mjs verify` in a fresh directory with no install", async () => {
    const { result } = await exportedCrm();
    const { root } = extract(result.zip);
    expect(root.startsWith(path.join(process.cwd(), ""))).toBe(false);
    expect(readdirSync(root)).not.toContain("node_modules");
    const run = node(root, ["verify"]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("PASS integrity");
    expect(run.stderr).toContain("PASS canonical Mapping Contract 1.0.0 validation");
    expect(run.stderr).toContain("PASS fixture replay");
  });

  it("the bundled runtime has no imports: it needs nothing but Node", () => {
    const runtime = readFileSync("src/export/runtime/generated/eyes-mapping-runtime.mjs", "utf8");
    expect(runtime).not.toMatch(/^\s*import\s/m);
    // ajv keeps `require("ajv/dist/runtime/…")` only inside string literals for its unused standalone-code mode.
    expect(runtime).not.toMatch(/[^"`\w]require\(/);
    expect(runtime).not.toMatch(/\bfetch\(|XMLHttpRequest|node:http|node:net/);
  });
});

describe("EXP-002 the packaged runner matches the canonical engine", () => {
  it("fixture outputs equal executeMappingBatch on the alias contract", async () => {
    const { result } = await exportedCrm();
    const { root } = extract(result.zip);
    const out = path.join(freshDir("eyes-out-"), "fixtures.json");
    const run = node(root, ["fixtures", "--out", out]);
    expect(run.status, run.stderr).toBe(0);
    const produced = JSON.parse(readFileSync(out, "utf8")) as { results: Array<{ output: unknown; status: string }> };
    const mapping = JSON.parse(readFileSync(path.join(root, "mapping/mapping.alias.json"), "utf8")) as MappingContract;
    const schema = JSON.parse(readFileSync(path.join(root, "schemas/destination.schema.json"), "utf8")) as unknown;
    const fixtures = (JSON.parse(readFileSync(path.join(root, "fixtures/synthetic-records.json"), "utf8")) as { records: unknown[] }).records;
    const canonical = executeMappingBatch({ sourceRecords: fixtures, mappingContract: mapping, targetSchema: schema });
    expect(produced.results.map((item) => [item.status, item.output])).toEqual(canonical.results.map((item) => [item.status, item.output]));
  });

  it("bound to local records, it reproduces the app's Reality Check outputs exactly", async () => {
    const { workspace, prepared, result } = await exportedCrm();
    const { root } = extract(result.zip);
    const env = freshDir("eyes-destination-env-");
    const records = workspace.source?.records ?? [];
    writeFileSync(path.join(env, "records.json"), JSON.stringify(records));
    const mapping = JSON.parse(readFileSync(path.join(root, "mapping/mapping.alias.json"), "utf8")) as MappingContract;
    const aliases = Object.fromEntries(prepared.twin.bindings.entries().map((entry) => [entry.alias, entry.sourcePath]));
    const template = JSON.parse(node(root, ["bindings-template"]).stdout) as { aliases: Record<string, string> };
    writeFileSync(
      path.join(env, "bindings.local.json"),
      JSON.stringify({ bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: Object.fromEntries(Object.keys(template.aliases).map((alias) => [alias, aliases[alias]])) }),
    );
    const run = node(root, ["run", "--input", path.join(env, "records.json"), "--bindings", path.join(env, "bindings.local.json"), "--out", path.join(env, "results.json")]);
    expect(run.status, run.stderr).toBe(0);
    const produced = JSON.parse(readFileSync(path.join(env, "results.json"), "utf8")) as { results: Array<{ status: string; output: unknown; outcome: string }>; summary: { transformedValid: number } };
    const imported = (workspace.report?.rows ?? []).filter((row) => row.set === "imported");
    expect(produced.results.map((item) => [item.status, item.output])).toEqual(imported.map((row) => [row.status, row.output]));
    expect(produced.summary.transformedValid).toBe(3);
  });
});

describe("EXP-003 local bindings are validated before anything runs", () => {
  it("rejects missing, unknown, duplicate and foreign bindings with exit code 2 and no output", async () => {
    const { result } = await exportedCrm();
    const { root } = extract(result.zip);
    const env = freshDir("eyes-bindings-");
    writeFileSync(path.join(env, "records.json"), JSON.stringify([{ a: 1 }]));
    const mapping = JSON.parse(readFileSync(path.join(root, "mapping/mapping.alias.json"), "utf8")) as MappingContract;
    const template = JSON.parse(node(root, ["bindings-template"]).stdout) as { aliases: Record<string, string> };
    const aliases = Object.keys(template.aliases);
    const cases: Array<[string, unknown]> = [
      ["UNBOUND_ALIAS", { bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: template.aliases }],
      ["UNKNOWN_ALIAS", { bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: { ...Object.fromEntries(aliases.map((alias, i) => [alias, `x${i}`])), f_99: "y" } }],
      ["DUPLICATE_SOURCE_PATH", { bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: Object.fromEntries(aliases.map((alias) => [alias, "same"])) }],
      ["MAPPING_MISMATCH", { bindingsVersion: "1.0.0", mappingId: "another-mapping", aliases: Object.fromEntries(aliases.map((alias, i) => [alias, `x${i}`])) }],
      ["INVALID_SOURCE_PATH", { bindingsVersion: "1.0.0", mappingId: mapping.mappingId, aliases: Object.fromEntries(aliases.map((alias, i) => [alias, i === 0 ? "__proto__.x" : `x${i}`])) }],
    ];
    for (const [code, document] of cases) {
      writeFileSync(path.join(env, "bindings.json"), JSON.stringify(document));
      const out = path.join(env, `${code}.json`);
      const run = node(root, ["run", "--input", path.join(env, "records.json"), "--bindings", path.join(env, "bindings.json"), "--out", out]);
      expect(run.status, code).toBe(2);
      expect(run.stderr).toContain(code);
      expect(() => statSync(out)).toThrow();
    }
  });

  it("bindMapping produces the same executable operations as the app's resolveAliases", async () => {
    const { workspace, prepared } = await exportedCrm();
    const accepted = workspace.proposal?.result.ok ? workspace.proposal.result.value : null;
    if (!accepted) throw new Error("no proposal");
    const aliases = Object.fromEntries(prepared.twin.bindings.entries().map((entry) => [entry.alias, entry.sourcePath]));
    const bound = bindMapping(accepted.converted.contract, aliases);
    expect(validateContract(bound).valid).toBe(true);
    expect(bound.operations).toEqual(accepted.resolved.executable.operations);
  });
});

describe("EXP-004 integrity: a modified package fails verification", () => {
  it("detects a changed mapping and a changed runtime", async () => {
    const { result } = await exportedCrm();
    for (const target of ["mapping/mapping.alias.json", "runtime/eyes-mapping-runtime.mjs"]) {
      const { root } = extract(result.zip);
      const file = path.join(root, target);
      writeFileSync(file, readFileSync(file, "utf8").replace("normalize_email", "trim"));
      const run = node(root, target.endsWith(".mjs") ? ["fixtures"] : ["verify"]);
      expect(run.status, target).not.toBe(0);
    }
  });
});

describe("EXP-005 the package contains no private material", () => {
  it("no record value, canary, field name, binding or secret appears in any extracted file", async () => {
    const { workspace, prepared, result } = await exportedCrm();
    const { root } = extract(result.zip);
    const files = walk(root);
    const relative = files.map((file) => path.relative(root, file)).sort();
    expect(relative).toEqual(
      [
        "README.md",
        "bindings/bindings.template.json",
        "fixtures/expected-outputs.json",
        "fixtures/synthetic-records.json",
        "manifest.json",
        "mapping/mapping.alias.json",
        "package.json",
        "policy/acceptance-policy.json",
        "policy/semantic-declarations.json",
        "reports/validation-report.json",
        "run.mjs",
        "runtime/THIRD_PARTY_NOTICES.md",
        "runtime/eyes-mapping-runtime.mjs",
        "schemas/destination.schema.json",
      ].sort(),
    );
    const destination = JSON.stringify(JSON.parse(workspace.destinationText));
    const approved = new Set(["active_customer", "inactive_customer", "prospect"]);
    // Every string value of the private records, except the labels the user approved for disclosure.
    const privateValues = [...prepared.privateStrings].filter((value) => value.length >= 4 && !approved.has(value) && !destination.toLowerCase().includes(value));
    expect(privateValues.length).toBeGreaterThan(5);
    const fieldNames = prepared.twin.source.fields.map((field) => field.path);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const lowered = text.toLowerCase();
      for (const value of privateValues) expect(lowered.includes(value), `${path.relative(root, file)} contains a private value`).toBe(false);
      expect(text).not.toContain(PRIVATE_DATA_CANARY);
      for (const name of fieldNames) expect(text.includes(JSON.stringify(name)), `${path.relative(root, file)} names ${name}`).toBe(false);
      expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{35}|FIREBASE_APPCHECK_DEBUG_TOKEN|-----BEGIN [A-Z ]*PRIVATE KEY/);
    }
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.includesPrivateSourceFixtures).toBe(false);
    expect(manifest.includesSourceBindings).toBe(false);
    expect(validateContract(manifest).valid).toBe(true);
    // The template binds nothing.
    const template = JSON.parse(readFileSync(path.join(root, "bindings/bindings.template.json"), "utf8")) as { aliases: Record<string, string> };
    expect(Object.values(template.aliases).every((value) => value === "")).toBe(true);
  });

  it("does not pack the gemini rationale or engine messages", async () => {
    const { result } = await exportedCrm();
    const { root } = extract(result.zip);
    const all = walk(root).filter((file) => !file.endsWith(".mjs")).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(all).not.toContain("fictional test mapping");
    const expected = JSON.parse(readFileSync(path.join(root, "fixtures/expected-outputs.json"), "utf8")) as { results: Array<{ issues: Array<Record<string, unknown>> }> };
    expect(expected.results.flatMap((item) => item.issues).every((issue) => !("message" in issue))).toBe(true);
  });
});

describe("EXP-006 deterministic, reproducible archive", () => {
  it("the same state exports byte-identical ZIPs with stable hashes", async () => {
    const first = await exportedCrm();
    const second = await exportedCrm();
    expect(first.result.manifest.mapping.contractSha256).toBe(second.result.manifest.mapping.contractSha256);
    expect(canonicalizeJson(first.result.manifest.files)).toBe(canonicalizeJson(second.result.manifest.files));
    expect(Buffer.from(first.result.zip).equals(Buffer.from(second.result.zip))).toBe(true);
  });
});

describe("EXP-007 the committed runtime bundle is fresh", () => {
  it("rebuilding src/export/runtime/runtime.ts reproduces the committed bundle", () => {
    const run = spawnSync(process.execPath, ["scripts/build-runtime.mjs", "--check"], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
  }, 60_000);
});
