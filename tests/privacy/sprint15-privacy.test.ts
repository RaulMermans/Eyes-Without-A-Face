/**
 * PRV-S15-001…006 — Sprint 15 privacy. Target-first questions, local
 * translations and the on-device build must not move anything off the device
 * by themselves; the default integration package stays free of the user's
 * category names, field names, bindings and records.
 */
import { describe, expect, it } from "vitest";
import { exportCandidates, packageInputFor, privacyContext } from "../../src/app/export-context.ts";
import { localContract, planFields, type CategoryMeaning } from "../../src/app/guided/field-plan.ts";
import { runLocalVerification } from "../../src/app/run-actions.ts";
import { applyFieldDecision, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { buildIntegrationPackage } from "../../src/export/package.ts";
import { readStoredZip } from "../../src/export/zip.ts";
import { listWorkflowEvents } from "../../src/observability/workflow-log.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { buildDisclosureDraft } from "../../src/workflow/pipeline.ts";
import { crmDemo, PACKAGE_ASSETS, prepare } from "../helpers/export-workspace.ts";

const meaning: CategoryMeaning = { source: "account_state", values: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" } };
const LABELS = ["active_customer", "inactive_customer"];

function localWorkspace(extra: Partial<WorkspaceState> = {}): { workspace: WorkspaceState; prepared: ReturnType<typeof prepare> } {
  const start: WorkspaceState = { ...crmDemo(), reservedRecords: null, categoryMeanings: { status: meaning }, ...extra };
  const prepared = prepare(start);
  const plan = planFields(prepared, start.source!.records, start.destinationText, { fieldMatches: start.fieldMatches, categoryMeanings: start.categoryMeanings })!;
  const contract = localContract(plan, prepared, start.destinationText);
  if (!contract) throw new Error(plan.localBlocker ?? "not ready");
  const built = runLocalVerification({ ...start, mappingText: JSON.stringify(contract), mappingChoice: "manual" }, prepared, false);
  return { workspace: built, prepared };
}

async function zipFor(workspace: WorkspaceState, prepared: ReturnType<typeof prepare>) {
  const [candidate] = exportCandidates(workspace, prepared);
  if (!candidate) throw new Error("no candidate");
  const input = packageInputFor({ workspace, prepared, candidate, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null });
  if (!input) throw new Error(`no package input: ${candidate.eligibility.reasons.join("; ")}`);
  return { candidate, result: await buildIntegrationPackage(input) };
}

describe("PRV-S15-001 decisions stay out of the cloud request", () => {
  it("a local translation and field matches never appear in the disclosure payload or prompt", async () => {
    const start: WorkspaceState = { ...crmDemo(), categoryMeanings: { status: meaning }, fieldMatches: { status: "account_state", id: "customer_id" } };
    const prepared = prepare(start);
    const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(start.destinationText) as unknown });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const preview = await createDisclosurePreview(draft.value.payload);
    const outbound = `${JSON.stringify(preview.payload)}\n${preview.outboundPrompt}`;
    for (const label of LABELS) expect(outbound).not.toContain(label);
    for (const field of ["account_state", "customer_id", "email_address", "company_name"]) expect(outbound).not.toContain(field);
  });

  it("making a decision records no workflow event (nothing to send, nothing logged)", () => {
    const before = listWorkflowEvents().length;
    applyFieldDecision(crmDemo(), { categoryMeanings: { status: meaning } });
    expect(listWorkflowEvents().length).toBe(before);
  });
});

describe("PRV-S15-002 the default package of a mapping built here is not allowed to carry private category names", () => {
  it("is blocked by the unchanged privacy scan, naming the file but not the value", async () => {
    const { workspace, prepared } = localWorkspace();
    const { candidate, result } = await zipFor(workspace, prepared);
    expect(candidate.origin).toBe("hand-written");
    expect(candidate.label).toContain("not AI");
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (!result.ok) {
      expect(result.findings.map((item) => item.kind)).toContain("private-value");
      for (const label of LABELS) expect(JSON.stringify(result)).not.toContain(label);
    }
  });
});

describe("PRV-S15-003 explicit label approval for the package", () => {
  it("adds only that field's names to the sanctioned set; the archive has no records, field names or bindings", async () => {
    const { workspace, prepared } = localWorkspace({ packageLabelSources: ["account_state"] });
    const context = privacyContext(workspace, prepared);
    const alias = prepared.twin.bindings.aliasForPath("account_state")!;
    expect(context.approvedLabels[alias]).toEqual(expect.arrayContaining(["active_customer", "inactive_customer", "prospect"]));
    // No other field gains approved labels.
    expect(Object.entries(context.approvedLabels).filter(([key, labels]) => key !== alias && labels.length > 0)).toEqual([]);
    const { result } = await zipFor(workspace, prepared);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const files = readStoredZip(result.zip);
    const text = files.map((file) => `${file.path}\n${new TextDecoder().decode(file.data)}`).join("\n");
    expect(files.map((file) => file.path).some((path) => /bindings\.local/.test(path))).toBe(false);
    for (const field of ["email_address", "customer_id", "company_name", "joined_at", "account_state"]) expect(text).not.toContain(`"${field}"`);
    for (const record of workspace.source!.records as Array<Record<string, unknown>>) {
      expect(text).not.toContain(String(record.email_address));
      expect(text).not.toContain(String(record.company_name));
    }
    expect(text).toContain("active_customer");
  });

  it("approving another field's names does not unblock this package", async () => {
    const { workspace, prepared } = localWorkspace({ packageLabelSources: ["company_name"] });
    const { result } = await zipFor(workspace, prepared);
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
  });
});

describe("PRV-S15-004 the local build sends nothing", () => {
  it("runs entirely through the local engine: no approval, no review, no proposal", () => {
    const { workspace } = localWorkspace();
    expect(workspace.review).toBeNull();
    expect(workspace.proposal).toBeNull();
    expect(workspace.report?.overall).toBe("pass");
  });
});
