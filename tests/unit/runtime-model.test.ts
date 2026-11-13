import { describe, expect, it } from "vitest";
import { exportCandidates } from "../../src/app/export-context.ts";
import { prepareDisclosureReview } from "../../src/app/disclosure-actions.ts";
import { currentStage, deriveRuntime, runHeadline, timelineEntries, type RuntimeInput, type RuntimeStage } from "../../src/app/runtime-model.ts";
import { initialWorkspaceState, invalidateDownstream, type WorkspaceState } from "../../src/app/workspace-state.ts";
import type { WorkflowEvent } from "../../src/observability/workflow-log.ts";
import type { SemanticReport } from "../../src/semantics/verify.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { crmDemo, prepare, verifiedWorkspace } from "../helpers/export-workspace.ts";

/**
 * Sprint 10 runtime (RT-*): the presentation model must reflect canonical
 * state only — no fabricated completion, skipped ≠ completed, failures shown,
 * approval checkpoints interrupt, invalidation removes dependent results.
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

function byId(stages: RuntimeStage[]): Record<string, RuntimeStage> {
  return Object.fromEntries(stages.map((stage) => [stage.id, stage]));
}

function event(kind: WorkflowEvent["kind"], ok: boolean, extra: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return { at: "2026-11-13T10:00:00.000Z", kind, ok, ...extra };
}

describe("RT-001 nothing is completed before it happened", () => {
  it("an empty workspace has no completed, running or awaiting stage", () => {
    const stages = deriveRuntime(input(initialWorkspaceState(), null));
    expect(stages).toHaveLength(17);
    expect(stages.every((stage) => stage.status === "not-started")).toBe(true);
    expect(stages.map((stage) => stage.number)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(runHeadline(stages)).toBe("Connect a source to begin.");
  });

  it("a loaded source completes import, profile and twin only", () => {
    const workspace = crmDemo();
    const stages = byId(deriveRuntime(input(workspace, prepare(workspace))));
    expect(stages["source-imported"]!.status).toBe("completed");
    expect(stages["source-profiled"]!.status).toBe("completed");
    expect(stages.twin!.status).toBe("completed");
    for (const id of ["disclosure-prepared", "authorization", "cloud-inference", "mapping-proposed", "contract-validated", "reality-check", "semantic", "outcome", "export"]) {
      expect(stages[id]!.status, id).toBe("not-started");
    }
  });
});

describe("RT-002 skipped is never completed", () => {
  it("on-device inference that is unavailable is skipped and says the session is not hybrid", () => {
    const workspace = crmDemo();
    const stage = byId(deriveRuntime(input(workspace, prepare(workspace), { onDeviceState: "disabled" })))["on-device"]!;
    expect(stage.status).toBe("skipped");
    expect(stage.note).toContain("not hybrid");
  });

  it("available but never run: not started before the disclosure, skipped after — never completed", async () => {
    const workspace = crmDemo();
    const prepared = prepare(workspace);
    expect(byId(deriveRuntime(input(workspace, prepared, { onDeviceState: "configured" })))["on-device"]!.status).toBe("not-started");
    const built = await prepareDisclosureReview(workspace, prepared);
    if (!built.ok) throw new Error(built.message);
    expect(byId(deriveRuntime(input(built.workspace, prepared, { onDeviceState: "configured" })))["on-device"]!.status).toBe("skipped");
  });

  it("a probe alone is not an interpretation; a real interpretation event completes it, a failed one fails it", () => {
    const workspace = crmDemo();
    const prepared = prepare(workspace);
    const probe = deriveRuntime(input(workspace, prepared, { onDeviceState: "configured", events: [event("on-device-probe", true, { code: "ON_DEVICE_AVAILABLE" })] }));
    expect(byId(probe)["on-device"]!.status).toBe("not-started");
    const ran = deriveRuntime(input(workspace, prepared, { onDeviceState: "configured", events: [event("on-device-probe", true, { code: "PRIVATE_SEMANTICS", counts: { fields: 4 } })] }));
    expect(byId(ran)["on-device"]!.status).toBe("completed");
    expect(byId(ran)["on-device"]!.summary).toContain("Gemini Nano · ONLY_ON_DEVICE");
    const failed = deriveRuntime(input(workspace, prepared, { onDeviceState: "configured", events: [event("on-device-probe", false, { code: "TIMEOUT" })] }));
    expect(byId(failed)["on-device"]!.status).toBe("failed");
  });
});

describe("RT-003 approval checkpoints interrupt the run", () => {
  it("Build Integration's preview stops at the authorization; nothing is approved or sent", async () => {
    const workspace = crmDemo();
    const prepared = prepare(workspace);
    const built = await prepareDisclosureReview(workspace, prepared);
    if (!built.ok) throw new Error(built.message);
    expect(built.workspace.review?.status).toBe("pending");
    expect(built.workspace.review?.approval).toBeNull();
    const stages = deriveRuntime(input(built.workspace, prepared));
    const map = byId(stages);
    expect(map["disclosure-prepared"]!.status).toBe("completed");
    expect(map.authorization!.status).toBe("awaiting-approval");
    expect(map["cloud-inference"]!.status).toBe("not-started");
    expect(currentStage(stages).id).toBe("authorization");
    expect(runHeadline(stages)).toBe("Waiting for your approval of one cloud request.");
  });

  it("a rejected disclosure blocks; an approved one is ready but not yet run", async () => {
    const workspace = crmDemo();
    const prepared = prepare(workspace);
    const built = await prepareDisclosureReview(workspace, prepared);
    if (!built.ok || !built.workspace.review) throw new Error("no review");
    const rejected = { ...built.workspace, review: { ...built.workspace.review, status: "rejected" as const } };
    expect(byId(deriveRuntime(input(rejected, prepared))).authorization!.status).toBe("blocked");
    const approved = { ...built.workspace, review: { ...built.workspace.review, status: "approved" as const } };
    const map = byId(deriveRuntime(input(approved, prepared)));
    expect(map.authorization!.status).toBe("completed");
    expect(map["cloud-inference"]!.status).toBe("not-started");
    expect(map["cloud-inference"]!.summary).toContain("ready");
  });

  it("a sent request without a result is running; with a classified error it failed and blocks the proposal", async () => {
    const workspace = crmDemo();
    const prepared = prepare(workspace);
    const built = await prepareDisclosureReview(workspace, prepared);
    if (!built.ok || !built.workspace.review) throw new Error("no review");
    const sent = { ...built.workspace, review: { ...built.workspace.review, status: "sent" as const } };
    expect(byId(deriveRuntime(input(sent, prepared)))["cloud-inference"]!.status).toBe("running");
    const failed = { ...sent, cloudError: { code: "PROVIDER_OVERLOADED", detail: "raw provider text" } };
    const map = byId(deriveRuntime(input(failed, prepared)));
    expect(map["cloud-inference"]!.status).toBe("failed");
    expect(map["cloud-inference"]!.summary).toContain("PROVIDER_OVERLOADED");
    expect(map["cloud-inference"]!.summary).not.toContain("raw provider text");
    expect(map["mapping-proposed"]!.status).toBe("blocked");
  });
});

describe("RT-004 failures are shown as failures", () => {
  it("a rejected proposal fails contract validation and is labeled not repaired", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo(), () => ({ operations: [{ op: "eval", from: "f_01", to: "id" }] }));
    const map = byId(deriveRuntime(input(workspace, prepared)));
    expect(map["mapping-proposed"]!.status).toBe("completed");
    expect(map["contract-validated"]!.status).toBe("failed");
    expect(map["contract-validated"]!.summary).toContain("not repaired");
    expect(map["reality-check"]!.status).toBe("not-started");
  });

  it("a Reality Check with failing hidden cases requires review, it is not completed", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const map = byId(deriveRuntime(input(workspace, prepared)));
    expect(workspace.report?.overall).toBe("fail");
    expect(map["reality-check"]!.status).toBe("requires-review");
    expect(map.outcome!.status).not.toBe("completed");
  });
});

describe("RT-005 semantic unknown is not a pass", () => {
  it("a PASS over partial coverage requires review; a mismatch fails", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const base: SemanticReport = {
      verifierVersion: "1.0.0" as SemanticReport["verifierVersion"],
      contractId: "x",
      contractValid: true,
      contractIssues: [],
      results: [],
      fields: [],
      overall: "SEMANTIC_PASS",
      coverage: { fields: 5, verified: 2, mismatched: 0, unknown: 3 },
      violatingRows: [],
    };
    expect(byId(deriveRuntime(input(workspace, prepared, { semantic: base }))).semantic!.status).toBe("requires-review");
    const full = { ...base, coverage: { fields: 5, verified: 5, mismatched: 0, unknown: 0 } };
    expect(byId(deriveRuntime(input(workspace, prepared, { semantic: full }))).semantic!.status).toBe("completed");
    const mismatch = { ...base, overall: "SEMANTIC_MISMATCH" as const };
    expect(byId(deriveRuntime(input(workspace, prepared, { semantic: mismatch }))).semantic!.status).toBe("failed");
  });
});

describe("RT-006 invalidating upstream state removes dependent results", () => {
  it("after invalidateDownstream nothing past the twin is completed", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const before = byId(deriveRuntime(input(workspace, prepared)));
    expect(before["reality-check"]!.status).not.toBe("not-started");
    const after = deriveRuntime(input(invalidateDownstream(workspace), prepared));
    const later = after.slice(after.findIndex((stage) => stage.id === "disclosure-prepared"));
    expect(later.every((stage) => stage.status === "not-started" || stage.status === "skipped")).toBe(true);
    expect(later.some((stage) => stage.status === "completed")).toBe(false);
  });
});

describe("RT-007 model provenance is preserved", () => {
  it("a simulated proposal is never presented as Gemini; a real one says IN_CLOUD", async () => {
    const { workspace, prepared } = await verifiedWorkspace(crmDemo());
    const simulated = byId(deriveRuntime(input(workspace, prepared)))["cloud-inference"]!;
    expect(simulated.summary).toBe("simulated test adapter — not Gemini");
    const real = {
      ...workspace,
      proposal: {
        ...workspace.proposal!,
        origin: "gemini-cloud" as const,
        provenance: {
          provider: "firebase-ai-logic" as const,
          requestedMode: "ONLY_IN_CLOUD" as const,
          actualSource: "IN_CLOUD" as const,
          inferenceSourceReported: true,
          model: "gemini-3.5-flash-lite",
          simulated: false,
          schemaValid: true,
          durationMs: 4200,
          retries: 0,
          resultKind: "live-cloud" as never,
        },
      },
    };
    const stage = byId(deriveRuntime(input(real, prepared)))["cloud-inference"]!;
    expect(stage.summary).toBe("real Gemini output · IN_CLOUD");
    expect(stage.durationMs).toBe(4200);
  });
});

describe("RT-008 timeline maps only safe event fields", () => {
  it("labels zones and carries codes, counts, durations and short hashes only", () => {
    const entries = timelineEntries([
      event("profile", true, { counts: { records: 3, fields: 6 }, durationMs: 2 }),
      event("disclosure-approve", true, { payloadHash: "a".repeat(64) }),
      event("cloud-proposal", false, { code: "TIMEOUT" }),
      event("disclosure-approve", true, { code: "REVISION" }),
    ]);
    expect(entries.map((entry) => entry.zone)).toEqual(["local", "approval", "cloud", "approval"]);
    expect(entries[0]!.summary).toBe("records 3 · fields 6");
    expect(entries[1]!.summary).toBe("sha aaaaaaaa…");
    expect(entries[2]!.label).toContain("did not succeed");
    expect(entries[3]!.label).toBe("You approved one revision request");
  });
});
