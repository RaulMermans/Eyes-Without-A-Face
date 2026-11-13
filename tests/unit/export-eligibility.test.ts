/**
 * EXP-010…017 — deterministic export eligibility (Sprint 9, A4). Ground-truth
 * blind: every case below is computed from real workspace state through the
 * same exportCandidates() the UI uses.
 */
import { describe, expect, it } from "vitest";
import manualContract from "../../src/examples/crm/mapping-contract.json" with { type: "json" };
import { exportCandidates } from "../../src/app/export-context.ts";
import type { WorkspaceState } from "../../src/app/workspace-state.ts";
import { exportEligibility } from "../../src/export/eligibility.ts";
import { runRecords } from "../../src/export/runtime/runtime.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import { STRICT_POLICY, type AcceptancePolicy } from "../../src/verification/outcomes.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { crmDemo, exportPackage, prepare, scenario, verifiedWorkspace } from "../helpers/export-workspace.ts";

function aliasOf(prepared: PreparedTwin, field: string): string {
  const alias = prepared.twin.bindings.aliasForPath(field);
  if (!alias) throw new Error(field);
  return alias;
}

function correct(_payload: unknown, prepared: PreparedTwin) {
  return {
    operations: [
      { op: "copy", from: aliasOf(prepared, "customer_id"), to: "id" },
      { op: "normalize_email", from: aliasOf(prepared, "email_address"), to: "email" },
      { op: "map_enum", from: aliasOf(prepared, "account_state"), to: "status", params: { map: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" }, unmapped: "fail" } },
      { op: "parse_date", from: aliasOf(prepared, "joined_at"), to: "createdAt", params: { inputFormat: "YYYY-MM-DD" } },
      { op: "trim", from: aliasOf(prepared, "company_name"), to: "organization" },
    ],
    rationale: "fictional",
  };
}

const crm = (patch: Partial<WorkspaceState> = {}): WorkspaceState => ({ ...crmDemo(), overrides: { account_state: { discloseCategories: true } }, ...patch });

function withPolicy(workspace: WorkspaceState, policy: AcceptancePolicy): WorkspaceState {
  return { ...workspace, scenario: { id: "policy-test", title: "policy test", policy, expected: [], holdout: [], semanticDeclared: [] } };
}

describe("EXP-010 export status follows verification, never the model", () => {
  it("VERIFIED only when every record ran clean and no hidden case exists", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm({ reservedRecords: null }), correct);
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.eligibility).toMatchObject({ state: "VERIFIED", decision: "EXPORTABLE", status: "VERIFIED", reasons: [] });
    expect(candidate?.eligibility.notes.join(" ")).toContain("imported record(s) only");
  });

  it("imported records passing is not VERIFIED when hidden cases fail", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm(), correct);
    const [candidate] = exportCandidates(workspace, prepared);
    expect(workspace.report?.rows.filter((row) => row.set === "imported").every((row) => row.status === "pass")).toBe(true);
    expect(candidate?.eligibility).toMatchObject({ state: "PARTIALLY_VERIFIED", decision: "DRAFT_ONLY", status: "DRAFT" });
    expect(candidate?.eligibility.reasons.join(" ")).toContain("3 record(s) are unresolved");
  });

  it("hidden cases that exist but were not run prevent VERIFIED", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm(), correct, { includeReserved: false });
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.eligibility.state).toBe("PARTIALLY_VERIFIED");
    expect(candidate?.eligibility.reasons.join(" ")).toContain("3 reserved hidden case(s) were not run");
  });

  it("a semantic mismatch makes a structurally valid mapping a draft", async () => {
    const { workspace, prepared } = await verifiedWorkspace(scenario("crm-eu-accounts"));
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.semantic?.overall).toBe("SEMANTIC_MISMATCH");
    expect(candidate?.eligibility.state).toBe("PARTIALLY_VERIFIED");
    expect(candidate?.eligibility.reasons.join(" ")).toContain("structurally valid but means something wrong");
  });
});

describe("EXP-011 quarantine is visible and bounded by the policy", () => {
  const quarantine = (max: number): AcceptancePolicy => ({
    ...STRICT_POLICY,
    policyId: "quarantine-test",
    description: "Quarantine malformed hidden records.",
    quarantine: [{ code: "UNMAPPED_ENUM" }, { code: "TYPE_MISMATCH" }, { code: "NULL_VALUE" }],
    maxQuarantineRate: max,
  });

  it("VERIFIED_WITH_EXCEPTIONS within the limit, with the quarantine disclosed", async () => {
    const { workspace, prepared } = await verifiedWorkspace(withPolicy(crm(), quarantine(0.6)), correct);
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.eligibility).toMatchObject({ state: "VERIFIED_WITH_EXCEPTIONS", decision: "EXPORTABLE" });
    expect(candidate?.eligibility.notes.join(" ")).toContain("3 record(s) are quarantined");
    const { result } = await exportPackage(workspace, prepared);
    expect(result.ok && result.manifest.verification.outcomes).toMatchObject({ transformedValid: 3, quarantined: 3 });
  });

  it("PARTIALLY_VERIFIED when quarantine exceeds the policy limit", async () => {
    const { workspace, prepared } = await verifiedWorkspace(withPolicy(crm(), quarantine(0.2)), correct);
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.eligibility.state).toBe("PARTIALLY_VERIFIED");
    expect(candidate?.eligibility.reasons.join(" ")).toContain("above the policy limit of 20%");
  });

  it("the portable runtime lists quarantined records and never counts them as transformed", () => {
    const contract = {
      contractKind: "mapping",
      schemaVersion: "1.0.0",
      mappingId: "m",
      mappingVersion: "1",
      phantomId: "p",
      destinationSchemaId: "d",
      operations: [{ op: "map_enum", from: "f_01", to: "status", params: { map: { a: "active" }, unmapped: "fail" } }],
    };
    const schema = { type: "object", properties: { status: { enum: ["active"] } }, required: ["status"], additionalProperties: false };
    const run = runRecords({ contract, targetSchema: schema, records: [{ f_01: "a" }, { f_01: "zzz" }], policy: quarantine(0.6) });
    if (!run.ok) throw new Error(run.error.message);
    expect(run.summary).toMatchObject({ total: 2, transformedValid: 1, quarantined: 1, quarantinedIndices: [1], withinQuarantinePolicy: true });
    expect(run.results[1]).toMatchObject({ status: "fail", outcome: "QUARANTINED", output: null });
  });
});

describe("EXP-012 drafts need explicit confirmation and are labeled", () => {
  it("refuses an unconfirmed draft and labels a confirmed one DRAFT, never production-ready", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm(), correct);
    const refused = await exportPackage(workspace, prepared, "active", false);
    expect(refused.result).toMatchObject({ ok: false, code: "DRAFT_NOT_CONFIRMED" });
    const confirmed = await exportPackage(workspace, prepared, "active", true);
    if (!confirmed.result.ok) throw new Error("expected a draft");
    expect(confirmed.result.manifest).toMatchObject({ status: "DRAFT", draftConfirmed: true });
    expect(confirmed.result.manifest.knownLimitations[0]).toContain("Not production-ready");
  });
});

describe("EXP-013 blocked states export nothing", () => {
  it("BLOCKED without a Reality Check, REVISION_FAILED for a rejected revision", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm(), correct);
    const [noReport] = exportCandidates({ ...workspace, report: null }, prepared);
    expect(noReport?.eligibility).toMatchObject({ state: "BLOCKED", decision: "BLOCKED", status: null });
    expect(exportEligibility({ variant: "revised", aliasContract: null, report: null, rows: [], policy: STRICT_POLICY, semanticOverall: null, hiddenCasesAvailable: 0, revisionRejected: true })).toMatchObject({
      state: "REVISION_FAILED",
      decision: "BLOCKED",
    });
  });

  it("a revised mapping whose local decision is not ACCEPTED is at most a draft", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crm({ reservedRecords: null }), correct);
    const [candidate] = exportCandidates(workspace, prepared);
    if (!candidate?.aliasContract || !candidate.report) throw new Error("no candidate");
    const eligibility = exportEligibility({
      variant: "revised",
      aliasContract: candidate.aliasContract,
      report: candidate.report,
      rows: candidate.rows,
      policy: STRICT_POLICY,
      semanticOverall: candidate.semantic?.overall ?? null,
      hiddenCasesAvailable: 0,
      revisionVerdict: "HUMAN_REVIEW_REQUIRED",
    });
    expect(eligibility).toMatchObject({ state: "PARTIALLY_VERIFIED", decision: "DRAFT_ONLY" });
  });
});

describe("EXP-014 the no-cloud path can export a hand-written contract as aliases", () => {
  it("rewrites local field references to aliases and exports without field names", async () => {
    const start = crm({ reservedRecords: null, mappingChoice: "manual" });
    const prepared = prepare(start);
    const report = runRealityCheck({ records: start.source?.records ?? [], reservedRecords: [], mappingContract: manualContract, targetSchema: JSON.parse(start.destinationText) as unknown, bindings: null });
    const workspace: WorkspaceState = { ...start, report };
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate?.origin).toBe("hand-written");
    expect(candidate?.aliasContract?.operations.every((operation) => !("from" in operation) || [operation.from].flat().every((ref) => /^f_\d{2}$/.test(String(ref))))).toBe(true);
    const { result } = await exportPackage(workspace, prepared);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.mapping).toMatchObject({ origin: "hand-written", inference: null, approvedDisclosureSha256: null });
  });

  it("blocks a hand-written contract that references a field the profile does not know", async () => {
    const start = crm({ reservedRecords: null, mappingChoice: "manual" });
    const prepared = prepare(start);
    const bad = { ...manualContract, operations: [...manualContract.operations, { op: "copy", from: "not_a_field", to: "organization" }] };
    const report = runRealityCheck({ records: start.source?.records ?? [], reservedRecords: [], mappingContract: bad, targetSchema: JSON.parse(start.destinationText) as unknown, bindings: null });
    const [candidate] = exportCandidates({ ...start, mappingText: JSON.stringify(bad), report }, prepared);
    expect(candidate?.eligibility.decision).toBe("BLOCKED");
    expect(candidate?.eligibility.reasons.join(" ")).toContain("cannot be expressed as Phantom aliases");
  });
});
