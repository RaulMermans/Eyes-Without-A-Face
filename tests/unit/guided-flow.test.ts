import { describe, expect, it } from "vitest";
import { exportCandidates } from "../../src/app/export-context.ts";
import { draftSchemaFromSample, EXAMPLE_DESTINATIONS, exampleFor, summarizeDestination } from "../../src/app/guided/destinations.ts";
import { guidedStatus, type InFlight } from "../../src/app/guided/guided-status.ts";
import { initialView, viewHash } from "../../src/app/experience.ts";
import { deriveRuntime } from "../../src/app/runtime-model.ts";
import { initialWorkspaceState, invalidateDownstream, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { approveReview, cancelWaiting, rejectReview, runLocalVerification, spendApproval } from "../../src/app/run-actions.ts";
import { assertTargetSchema } from "../../src/domain/mapping/target-schema.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { crmDemo, prepare, verifiedWorkspace } from "../helpers/export-workspace.ts";
import { prepareDisclosureReview } from "../../src/app/disclosure-actions.ts";

function statusOf(workspace: WorkspaceState, prepared: PreparedTwin | null, inFlight: InFlight = null) {
  const candidates = exportCandidates(workspace, prepared);
  const stages = deriveRuntime({
    workspace,
    prepared,
    profileIssues: [],
    twinIssues: [],
    events: [],
    onDeviceState: "disabled",
    simulatedAdapters: true,
    semantic: candidates.find((candidate) => candidate.id === "active")?.semantic ?? null,
    candidates: workspace.report ? candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })) : [],
  });
  return guidedStatus(stages, workspace.report ? candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })) : [], inFlight);
}

describe("GUI-STATUS the guided status is a reading of canonical state", () => {
  it("GUI-STATUS-001 follows the run from idle to approval, sending, refusal and recovery", async () => {
    expect(statusOf(initialWorkspaceState(), null).id).toBe("idle");
    const demo = crmDemo();
    const prepared = prepare(demo);
    expect(statusOf(demo, prepared).id).toBe("ready-to-build");
    expect(statusOf(demo, prepared, "preparing").id).toBe("preparing");

    const prepared1 = await prepareDisclosureReview(demo, prepared);
    if (!prepared1.ok) throw new Error(prepared1.message);
    const pending = prepared1.workspace;
    expect(statusOf(pending, prepared).id).toBe("approval");
    expect(statusOf(pending, prepared).label).toBe("Your approval is needed");

    const approved = approveReview(pending);
    expect(approved.review?.status).toBe("approved");
    expect(approved.review?.approval).not.toBeNull();
    expect(statusOf(approved, prepared).label).toBe("Approved — not sent yet");

    const spent = spendApproval(approved);
    expect(spent.review?.approval).toBeNull();
    expect(statusOf(spent, prepared).id).toBe("generating");

    const cancelled = cancelWaiting(spent);
    expect(statusOf(cancelled, prepared).id).toBe("attention");

    expect(statusOf(rejectReview(pending), prepared).id).toBe("rejected");
  });

  it("GUI-STATUS-002 approving twice is impossible and an upstream change clears the approval", async () => {
    const demo = crmDemo();
    const prepared = prepare(demo);
    const result = await prepareDisclosureReview(demo, prepared);
    if (!result.ok) throw new Error(result.message);
    const approved = approveReview(result.workspace);
    expect(approveReview(approved)).toBe(approved); // only a pending review can be approved
    const changed = invalidateDownstream({ ...approved, destinationText: EXAMPLE_DESTINATIONS[1]!.text });
    expect(changed.review).toBeNull();
    expect(statusOf(changed, prepared).id).toBe("ready-to-build");
  });

  it("GUI-STATUS-003 the verdict comes from export eligibility, never from the model", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const status = statusOf(workspace, prepared);
    const best = exportCandidates(workspace, prepared)[0]!.eligibility.state;
    const expected = { VERIFIED: "ready", VERIFIED_WITH_EXCEPTIONS: "ready-exceptions", PARTIALLY_VERIFIED: "draft", REVISION_FAILED: "failed", BLOCKED: "failed" }[best];
    expect(status.id).toBe(expected);
    expect(statusOf(workspace, prepared, "checking").id).toBe("checking");
    // Never "ready" without a Reality Check.
    expect(statusOf({ ...workspace, report: null }, prepared).id).not.toBe("ready");
  });

  it("GUI-STATUS-004 runLocalVerification is the same deterministic check the workbench runs", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const rerun = runLocalVerification({ ...workspace, report: null }, prepared, true);
    expect(rerun.report?.total).toBe(workspace.report?.total);
    expect(rerun.report?.passed).toBe(workspace.report?.passed);
    expect(runLocalVerification({ ...workspace, source: null }, prepared).mappingRunError).toMatch(/Import a source/);
  });
});

describe("GUI-DEST destinations", () => {
  it("GUI-DEST-001 every example destination is a usable 2020-12 schema with a plain summary", () => {
    for (const destination of EXAMPLE_DESTINATIONS) {
      expect(assertTargetSchema(JSON.parse(destination.text)).ok).toBe(true);
      const summary = summarizeDestination(destination.text);
      expect(summary.ok).toBe(true);
      expect(exampleFor(destination.text)?.id).toBe(destination.id);
    }
    expect(exampleFor(initialWorkspaceState().destinationText)?.id).toBe("helpdesk");
    expect(summarizeDestination("{nope").ok).toBe(false);
    expect(summarizeDestination('{"type":"string"}').ok).toBe(false);
  });

  it("GUI-DEST-002 a draft from a sample is conservative and deterministic", () => {
    const draft = draftSchemaFromSample('{"ref":"A-1","count":3,"ratio":0.5,"active":true}');
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const schema = JSON.parse(draft.text) as { required: string[]; properties: Record<string, { type: string; format?: string }>; additionalProperties: boolean };
    expect(schema.required).toEqual(["ref", "count", "ratio", "active"]);
    expect(schema.properties).toEqual({ ref: { type: "string" }, count: { type: "integer" }, ratio: { type: "number" }, active: { type: "boolean" } });
    expect(schema.additionalProperties).toBe(false);
    expect(draftSchemaFromSample('{"ref":"A-1","count":3,"ratio":0.5,"active":true}')).toEqual(draft);
    for (const bad of ["not json", "42", "{}", '{"a":{"b":1}}', '{"a":null}', '{"a b":1}']) expect(draftSchemaFromSample(bad).ok).toBe(false);
  });
});

describe("GUI-VIEW views are navigation only", () => {
  it("GUI-VIEW-001 only #technical opens the technical view", () => {
    expect(initialView("")).toBe("guided");
    expect(initialView("#technical")).toBe("technical");
    expect(initialView("#anything")).toBe("guided");
    expect(viewHash("technical")).toBe("#technical");
    expect(viewHash("guided")).toBe("");
  });
});
