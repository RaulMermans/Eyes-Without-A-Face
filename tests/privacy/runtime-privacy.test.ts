import { describe, expect, it } from "vitest";
import { exportCandidates } from "../../src/app/export-context.ts";
import { deriveRuntime, runHeadline, timelineEntries } from "../../src/app/runtime-model.ts";
import { clearWorkflowEvents, listWorkflowEvents, recordWorkflowEvent } from "../../src/observability/workflow-log.ts";
import { crmDemo, scenario, verifiedWorkspace } from "../helpers/export-workspace.ts";

/**
 * Sprint 10 privacy (PRV-RT-*): the runtime presentation (stages, inspector
 * text, headline, timeline) must not carry private source values, source field
 * names, the dataset's private strings or the canary.
 */
const CRM_PRIVATE = [
  "PRIVATE_CANARY_PII_DO_NOT_SHARE",
  "customer_id",
  "email_address",
  "account_state",
  "joined_at",
  "company_name",
  "internal_note",
  "CUST-001",
  "alice@example.com",
  "ALICE@EXAMPLE.COM",
  "Example Studio",
  "North Bridge",
  "vip_customer",
];
const DE_PRIVATE = ["KD-10031", "anna.koch@example.de", "gesperrt", "25/03/2026", "Koch Atelier", "kundennummer", "e_post", "kontostatus", "angelegt_am", "unternehmen", "notiz"];

function render(workspace: Parameters<typeof exportCandidates>[0], prepared: Parameters<typeof exportCandidates>[1]): string {
  const candidates = exportCandidates(workspace, prepared);
  const stages = deriveRuntime({
    workspace,
    prepared,
    profileIssues: [],
    twinIssues: [],
    events: listWorkflowEvents(),
    onDeviceState: "configured",
    simulatedAdapters: true,
    semantic: candidates.find((candidate) => candidate.id === "active")?.semantic ?? null,
    candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })),
  });
  return JSON.stringify({ stages, headline: runHeadline(stages), timeline: timelineEntries(listWorkflowEvents()) });
}

describe("PRV-RT-001 runtime text carries no private values", () => {
  it("CRM demo: verified run with failing hidden cases", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const text = render(workspace, prepared);
    for (const value of CRM_PRIVATE) expect(text, value).not.toContain(value);
  });

  it("crm-eu-accounts scenario (private German field names and values)", async () => {
    const { workspace, prepared } = await verifiedWorkspace(scenario("crm-eu-accounts"));
    const text = render(workspace, prepared);
    for (const value of DE_PRIVATE) expect(text, value).not.toContain(value);
  });
});

describe("PRV-RT-002 the timeline cannot be used to smuggle values", () => {
  it("unsafe codes, keys and hashes are dropped by the log before the timeline sees them", () => {
    clearWorkflowEvents();
    recordWorkflowEvent({
      kind: "reality-check",
      ok: false,
      code: "alice@example.com",
      payloadHash: "PRIVATE_CANARY_PII_DO_NOT_SHARE",
      inferenceSource: "Example Studio",
      counts: { "customer_id=CUST-001": 1, records: 3 },
    });
    const text = JSON.stringify(timelineEntries(listWorkflowEvents()));
    for (const value of CRM_PRIVATE) expect(text, value).not.toContain(value);
    expect(text).toContain("records 3");
    clearWorkflowEvents();
  });
});
