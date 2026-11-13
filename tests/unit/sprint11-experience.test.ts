import { describe, expect, it } from "vitest";
import { exportCandidates } from "../../src/app/export-context.ts";
import { prepareDisclosureReview } from "../../src/app/disclosure-actions.ts";
import { invalidationCause } from "../../src/app/invalidation.ts";
import { ledgerFacts } from "../../src/app/ledger-facts.ts";
import { meaningSentence, outcomeVerdict } from "../../src/app/outcome-verdict.ts";
import {
  actionLabel,
  boundaryState,
  currentStage,
  deriveRuntime,
  groupOf,
  groupTally,
  lastCompletedStage,
  nextStep,
  RUNTIME_GROUPS,
  timelineEntries,
  type RuntimeInput,
} from "../../src/app/runtime-model.ts";
import { applyTwinOverride, initialWorkspaceState, type WorkspaceState } from "../../src/app/workspace-state.ts";
import type { ExportEligibility } from "../../src/export/eligibility.ts";
import type { SemanticReport } from "../../src/semantics/verify.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { crmDemo, prepare, verifiedWorkspace } from "../helpers/export-workspace.ts";

/**
 * Sprint 11 — compact runtime, privacy boundary, invalidation notice and
 * outcome verdict. All are pure readings of canonical state: they group,
 * pick and word; they never add a stage, a status or an approval.
 */

function input(workspace: WorkspaceState, prepared: PreparedTwin | null, extra: Partial<RuntimeInput> = {}): RuntimeInput {
  const candidates = workspace.report && prepared ? exportCandidates(workspace, prepared) : [];
  return {
    workspace,
    prepared,
    profileIssues: [],
    twinIssues: [],
    events: [],
    onDeviceState: "disabled",
    simulatedAdapters: false,
    semantic: candidates.find((candidate) => candidate.id === "active")?.semantic ?? null,
    candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })),
    ...extra,
  };
}

async function awaitingApproval(): Promise<{ workspace: WorkspaceState; prepared: PreparedTwin }> {
  const workspace = crmDemo();
  const prepared = prepare(workspace);
  const built = await prepareDisclosureReview(workspace, prepared);
  if (!built.ok) throw new Error(built.message);
  return { workspace: built.workspace, prepared };
}

describe("RT-009 phase groups cover the canonical runtime exactly once", () => {
  it("17 stages, five groups, every stage in exactly one group, in runtime order", () => {
    const stages = deriveRuntime(input(initialWorkspaceState(), null));
    const grouped = RUNTIME_GROUPS.flatMap((group) => group.stageIds);
    expect(grouped).toHaveLength(17);
    expect(new Set(grouped).size).toBe(17);
    expect(grouped).toEqual(stages.map((stage) => stage.id));
    for (const stage of stages) expect(groupOf(stage.id).stageIds).toContain(stage.id);
  });

  it("a group tally counts real statuses only", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const stages = deriveRuntime(input(workspace, prepared));
    expect(groupTally(stages, RUNTIME_GROUPS[1]!)).toBe("1 awaiting approval · 1 completed · 2 not started");
    expect(groupTally(stages, RUNTIME_GROUPS[2]!)).toBe("3 not started");
  });
});

describe("RT-010 focus: current, last completed and next action come from state", () => {
  it("at the approval: current = authorization, last completed = disclosure, next = review", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const stages = deriveRuntime(input(workspace, prepared));
    expect(currentStage(stages).id).toBe("authorization");
    expect(lastCompletedStage(stages)?.id).toBe("disclosure-prepared");
    const step = nextStep(stages)!;
    expect(step.id).toBe("authorization");
    expect(actionLabel(step)).toBe("Review what crosses the boundary");
  });

  it("before anything: no completed stage and the next step is choosing a source", () => {
    const stages = deriveRuntime(input(initialWorkspaceState(), null));
    expect(lastCompletedStage(stages)).toBeNull();
    expect(nextStep(stages)?.id).toBe("source-imported");
  });

  it("after a validated mapping the next step is the Reality Check, found on a later stage", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const unrun = { ...workspace, report: null };
    const stages = deriveRuntime(input(unrun, prepared));
    expect(currentStage(stages).id).toBe("contract-validated");
    expect(nextStep(stages)?.id).toBe("reality-check");
    expect(actionLabel(nextStep(stages)!)).toBe("Run the Reality Check");
  });

  it("an approved, unsent request: next is sending it, and the gate reads open", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const approved = { ...workspace, review: { ...workspace.review!, status: "approved" as const } };
    const stages = deriveRuntime(input(approved, prepared));
    expect(actionLabel(nextStep(stages)!)).toBe("Send the approved request");
    expect(boundaryState(stages).gate).toBe("open");
  });
});

describe("RT-011 privacy boundary reads stage statuses only", () => {
  it("empty: every station pending, gate closed, no on-device claim", () => {
    const state = boundaryState(deriveRuntime(input(initialWorkspaceState(), null)));
    expect(state).toEqual({ source: "pending", twin: "pending", gate: "closed", cloud: "pending", outcome: "pending", onDevice: false });
  });

  it("awaiting approval: local stations reached, gate awaiting, cloud and outcome pending", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const state = boundaryState(deriveRuntime(input(workspace, prepared)));
    expect(state).toMatchObject({ source: "reached", twin: "reached", gate: "awaiting", cloud: "pending", outcome: "pending" });
  });

  it("a cloud failure shows the cloud station failed, never reached", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const failed = { ...workspace, review: { ...workspace.review!, status: "sent" as const }, cloudError: { code: "PROVIDER_OVERLOADED", detail: "x" } };
    expect(boundaryState(deriveRuntime(input(failed, prepared))).cloud).toBe("failed");
  });

  it("on-device is claimed only from a successful on-device event", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const at = "2026-11-13T10:00:00.000Z";
    const without = boundaryState(deriveRuntime(input(workspace, prepared, { onDeviceState: "configured" })));
    const failed = boundaryState(deriveRuntime(input(workspace, prepared, { onDeviceState: "configured", events: [{ at, kind: "on-device-probe", ok: false, code: "ON_DEVICE_RUNTIME_ERROR" }] })));
    const real = boundaryState(deriveRuntime(input(workspace, prepared, { onDeviceState: "configured", events: [{ at, kind: "on-device-probe", ok: true, code: "PRIVATE_SEMANTICS", counts: { fields: 6 } }] })));
    expect(without.onDevice).toBe(false);
    expect(failed.onDevice).toBe(false);
    expect(real.onDevice).toBe(true);
  });
});

describe("RT-012 an unavailable on-device model is a fact, not a failed step", () => {
  it("the timeline labels ON_DEVICE_BLOCKED as unavailable; real on-device failures still say so", () => {
    const at = "2026-11-13T10:00:00.000Z";
    const [blocked, failed] = timelineEntries([
      { at, kind: "on-device-probe", ok: false, code: "ON_DEVICE_BLOCKED" },
      { at, kind: "on-device-probe", ok: false, code: "ON_DEVICE_RUNTIME_ERROR" },
    ]);
    expect(blocked!.label).toBe("On-device AI unavailable in this browser");
    expect(failed!.label).toBe("On-device model — did not succeed");
    expect(failed!.ok).toBe(false);
  });
});

describe("INV-001 applying a twin change after preparation clears the request and says why", () => {
  it("applyTwinOverride invalidates review, approval and results; the cause is the twin", async () => {
    const { workspace, prepared } = await awaitingApproval();
    const approved = { ...workspace, review: { ...workspace.review!, status: "approved" as const } };
    const path = prepared.twin.fields[0]!.localPath;
    const next = applyTwinOverride(approved, path, { role: "identifier" });
    expect(next.review).toBeNull();
    expect(next.proposal).toBeNull();
    expect(next.report).toBeNull();
    expect(invalidationCause(approved, next)).toEqual({ cause: "twin", hadApproval: true, hadResults: false });
  });

  it("a destination change is reported as such", async () => {
    const { workspace } = await awaitingApproval();
    const next = { ...workspace, review: null, destinationText: workspace.destinationText.replace('"title": "', '"title": "Edited ') };
    expect(invalidationCause(workspace, next).cause).toBe("destination");
    expect(invalidationCause(workspace, next).hadApproval).toBe(false);
  });

  it("the ledger never reports a send that did not happen", async () => {
    const { workspace, prepared } = await awaitingApproval();
    expect(ledgerFacts(workspace, prepared).transmitted).toBe("Nothing sent");
    expect(ledgerFacts(workspace, prepared).approved).toBe("Awaiting your decision");
  });
});

describe("OV-001 the outcome verdict never overclaims", () => {
  const eligibility = (state: ExportEligibility["state"], reasons: string[] = []): ExportEligibility => ({
    state,
    decision: state === "VERIFIED" || state === "VERIFIED_WITH_EXCEPTIONS" ? "EXPORTABLE" : state === "PARTIALLY_VERIFIED" ? "DRAFT_ONLY" : "BLOCKED",
    status: state === "VERIFIED" || state === "VERIFIED_WITH_EXCEPTIONS" ? state : state === "PARTIALLY_VERIFIED" ? "DRAFT" : null,
    reasons,
    notes: [],
  });
  const semantic = (overall: SemanticReport["overall"], verified: number, fields: number, unknown: number) =>
    ({ overall, coverage: { fields, verified, unknown, mismatched: 0 } }) as unknown as SemanticReport;

  it("VERIFIED with unchecked meaning is not headlined 'Verified locally.'", () => {
    const verdict = outcomeVerdict(eligibility("VERIFIED"), null, []);
    expect(verdict.headline).toBe("Verified for structure and policy. Meaning partly unknown.");
    expect(verdict.meaningComplete).toBe(false);
    expect(verdict.detail).toContain("unknown, not verified");
  });

  it("VERIFIED with partial semantic coverage is not headlined as fully verified", () => {
    const verdict = outcomeVerdict(eligibility("VERIFIED"), semantic("SEMANTIC_PASS", 3, 5, 2), []);
    expect(verdict.headline).not.toBe("Verified locally.");
    expect(verdict.detail).toContain("3 of 5");
  });

  it("only full meaning coverage earns 'Verified locally.'", () => {
    expect(outcomeVerdict(eligibility("VERIFIED"), semantic("SEMANTIC_PASS", 5, 5, 0), []).headline).toBe("Verified locally.");
  });

  it("export is described as a download, never a deployment", () => {
    const next = outcomeVerdict(eligibility("VERIFIED_WITH_EXCEPTIONS"), null, []).next;
    expect(next).toContain("Nothing is deployed");
  });

  it("a semantic mismatch is named as wrong meaning, not as a pass", () => {
    expect(meaningSentence(semantic("SEMANTIC_MISMATCH", 4, 5, 0)).text).toContain("wrong");
    expect(meaningSentence(semantic("SEMANTIC_MISMATCH", 4, 5, 0)).complete).toBe(false);
  });
});

describe("OV-002 quarantine is never described as transformed", () => {
  it("the verdict for real CRM evidence counts quarantine separately", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const candidate = exportCandidates(workspace, prepared).find((item) => item.id === "active")!;
    const verdict = outcomeVerdict(candidate.eligibility, candidate.semantic, candidate.rows);
    expect(verdict.headline.length).toBeGreaterThan(0);
    if (/quarantined/.test(verdict.detail)) expect(verdict.detail).toContain("not counted as transformed");
    if (candidate.eligibility.state === "VERIFIED") expect(verdict.meaningComplete || verdict.headline !== "Verified locally.").toBe(true);
  });
});
