/**
 * Sprint 18B (ADR 0018) — the plan path of the shared workflow actions:
 * evaluate an intent-plan answer → recompile on the user's answer → run the
 * canonical engine with the private bindings → export candidates (label,
 * origin, limitation) → revision gate.
 *
 * Worker A's intent-prompt / validator are mocked here: the plan is written as
 * the validator would return it, so these tests judge only the compiler path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activePolicy, exportCandidates, packageInputFor } from "../../src/app/export-context.ts";
import { computeWorkspaceSemantics } from "../../src/app/semantic-context.ts";
import { evaluateProposal, recompilePlan, runLocalVerification, sendApprovedRequest, spendApproval, approveReview } from "../../src/app/run-actions.ts";
import { deriveRuntime, planRevisionAllowed, type RuntimeInput } from "../../src/app/runtime-model.ts";
import { applyFieldDecision, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { buildIntegrationPackage } from "../../src/export/package.ts";
import { createTestCloudAdapter } from "../../src/inference/test-adapters.ts";
import { isIntentPlanRequest } from "../../src/inference/intent-prompt.ts";
import { clearWorkflowEvents, listWorkflowEvents } from "../../src/observability/workflow-log.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import type { ValidatedIntentPlan } from "../../src/plan/types.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { runRealityCheck } from "../../src/verification/reality-check.ts";
import type { PreparedTwin } from "../../src/workflow/pipeline.ts";
import { crmDemo, PACKAGE_ASSETS } from "../helpers/export-workspace.ts";
import { entry, planSetup, validatedPlan } from "../helpers/plan-fixtures.ts";

vi.mock("../../src/inference/intent-prompt.ts", async (original) => ({ ...((await original()) as object), isIntentPlanRequest: vi.fn(() => true) }));
vi.mock("../../src/plan/validate.ts", async (original) => ({
  ...((await original()) as object),
  parseIntentPlanText: vi.fn((text: string) => ({ ok: true, value: JSON.parse(text) as unknown })),
  validateIntentPlan: vi.fn(),
}));
vi.mock("../../src/plan/failures.ts", async (original) => {
  const { realOr, failuresFallback } = await import("../helpers/plan-fixtures.ts");
  return realOr(original as () => Promise<typeof import("../../src/plan/failures.ts")>, failuresFallback);
});
vi.mock("../../src/plan/clarify.ts", async (original) => {
  const { realOr, clarifyFallback } = await import("../helpers/plan-fixtures.ts");
  return realOr(original as () => Promise<typeof import("../../src/plan/clarify.ts")>, clarifyFallback);
});

const MEANING = { source: "account_state", values: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" } };

function crmPlan(s: ReturnType<typeof planSetup>, withStatus = true): ValidatedIntentPlan {
  return validatedPlan([
    entry({ target: "id", status: "ready", from: [s.alias("customer_id")], transform: "copy" }),
    entry({ target: "email", status: "ready", from: [s.alias("email_address")], transform: "normalize_email" }),
    ...(withStatus ? [entry({ target: "status", status: "needs_clarification", from: [s.alias("account_state")], transform: "map_enum", missing: ["category-labels"] })] : []),
    entry({ target: "createdAt", status: "ready", from: [s.alias("joined_at")], transform: "parse_date", inputFormat: "YYYY-MM-DD" }),
    entry({ target: "organization", status: "ready", from: [s.alias("company_name")], transform: "trim" }),
  ]);
}

async function evaluated(origin: "gemini-cloud" | "test-adapter" = "gemini-cloud", answers: Partial<WorkspaceState> = {}) {
  const s = planSetup({ ...crmDemo(), reservedRecords: null });
  const plan = crmPlan(s);
  vi.mocked(validateIntentPlan).mockReturnValue({ ok: true, value: plan });
  const preview = await createDisclosurePreview(s.disclosure);
  const workspace: WorkspaceState = { ...s.start, ...answers, review: { preview, approval: null, status: "sent" } };
  const proposal = evaluateProposal(workspace, s.prepared, { structured: plan.plan, text: JSON.stringify(plan.plan), origin, requestId: preview.requestId, provenance: null });
  return { s, plan, workspace: { ...workspace, proposal, mappingChoice: "proposal" as const }, prepared: s.prepared };
}

function runtimeInput(workspace: WorkspaceState, prepared: PreparedTwin): RuntimeInput {
  const candidates = exportCandidates(workspace, prepared);
  return {
    workspace,
    prepared,
    profileIssues: [],
    twinIssues: [],
    events: [],
    onDeviceState: "disabled",
    simulatedAdapters: false,
    semantic: null,
    candidates: candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })),
  };
}

beforeEach(() => {
  vi.mocked(isIntentPlanRequest).mockReturnValue(true);
  clearWorkflowEvents();
});

describe("PLAN-RA1 evaluate an intent-plan answer", () => {
  it("stores the receipt (validated + compiled) and the acceptance record; events carry codes and counts only", async () => {
    const { workspace, plan } = await evaluated();
    const proposal = workspace.proposal!;
    expect(proposal.plan?.validated).toBe(plan);
    expect(proposal.plan?.compiled.counts).toMatchObject({ executable: 4, byGemini: 4, byUser: 0, needsClarification: 1 });
    expect(proposal.result.ok).toBe(true);
    expect(proposal.result.ok && proposal.result.value.converted.contract.mappingId).toMatch(/^gemini-plan-/);
    const events = listWorkflowEvents().filter((event) => event.kind === "proposal-validate");
    expect(events.at(-1)).toMatchObject({ ok: true, code: "PLAN_PARTIAL", counts: expect.objectContaining({ executable: 4, unwrittenRequired: 1 }) });
    const logged = JSON.stringify(listWorkflowEvents());
    for (const secret of ["account_state", "customer_id", "active_customer", "email_address"]) expect(logged).not.toContain(secret);
  });

  it("a whole-plan rejection is a stage:plan refusal with no receipt", async () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null });
    vi.mocked(validateIntentPlan).mockReturnValue({ ok: false, issues: [{ code: "MALFORMED_PLAN", message: "Not a plan." }] });
    const preview = await createDisclosurePreview(s.disclosure);
    const workspace: WorkspaceState = { ...s.start, review: { preview, approval: null, status: "sent" } };
    const proposal = evaluateProposal(workspace, s.prepared, { structured: { nope: true }, text: "{}", origin: "gemini-cloud", requestId: preview.requestId, provenance: null })!;
    expect(proposal.result).toEqual({ ok: false, stage: "plan", issues: [{ code: "MALFORMED_PLAN", message: "Not a plan." }] });
    expect(proposal.plan).toBeNull();
    expect(listWorkflowEvents().at(-1)).toMatchObject({ kind: "proposal-validate", ok: false, code: "MALFORMED_PLAN" });
  });

  it("a plan with zero executable fields keeps its receipt but is a stage:plan refusal, never an integration", async () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null });
    const plan = validatedPlan([entry({ target: "status", status: "needs_clarification", from: [s.alias("account_state")], transform: "map_enum", missing: ["category-labels"] })], ["id", "email", "createdAt", "organization"]);
    vi.mocked(validateIntentPlan).mockReturnValue({ ok: true, value: plan });
    const preview = await createDisclosurePreview(s.disclosure);
    const proposal = evaluateProposal({ ...s.start, review: { preview, approval: null, status: "sent" } }, s.prepared, {
      structured: plan.plan,
      text: "",
      origin: "gemini-cloud",
      requestId: preview.requestId,
      provenance: null,
    })!;
    expect(proposal.result).toMatchObject({ ok: false, stage: "plan" });
    expect(proposal.plan?.compiled.aliasContract).toBeNull();
    const workspace: WorkspaceState = { ...s.start, review: { preview, approval: null, status: "sent" }, proposal, mappingChoice: "proposal" };
    expect(exportCandidates(workspace, s.prepared)[0]?.origin).toBe("hand-written");
  });

  it("the gated send path evaluates the answer as a plan (simulated adapter, labelled as such)", async () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null });
    const plan = crmPlan(s);
    vi.mocked(validateIntentPlan).mockReturnValue({ ok: true, value: plan });
    const preview = await createDisclosurePreview(s.disclosure);
    const pending: WorkspaceState = { ...s.start, review: { preview, approval: null, status: "pending" } };
    const approved = approveReview(pending);
    const spent = spendApproval(approved);
    const cloud = createTestCloudAdapter({ label: "test-harness" }, { state: "configured", reason: "adapters-ready" });
    const next = await sendApprovedRequest(spent, approved.review!, s.prepared, { cloud, onDevice: undefined as never });
    expect(next?.cloudError).toBeNull();
    expect(next?.proposal?.origin).toBe("test-adapter");
    expect(next?.proposal?.plan?.compiled.counts.executable).toBe(4);
    expect(next?.proposal?.result.ok && next.proposal.result.value.converted.origin).toBe("test-adapter");
    expect(next?.review?.status).toBe("sent");
  });
});

describe("PLAN-RA2 recompile on the user's answer", () => {
  it("re-derives compiled + result, clears the run and any revision, never touches the review", async () => {
    const { workspace, prepared } = await evaluated();
    const ran = runLocalVerification(workspace, prepared, false);
    expect(ran.report).not.toBeNull();
    const answered = applyFieldDecision({ ...ran, revision: { stale: true } as never }, { categoryMeanings: { status: MEANING } });
    const recompiled = recompilePlan({ ...answered, revision: { stale: true } as never }, prepared);
    expect(recompiled.review).toBe(answered.review);
    expect(recompiled.report).toBeNull();
    expect(recompiled.mappingRunError).toBeNull();
    expect(recompiled.revision).toBeNull();
    expect(recompiled.proposal!.plan!.validated).toBe(workspace.proposal!.plan!.validated);
    expect(recompiled.proposal!.plan!.compiled).toMatchObject({ complete: true, counts: expect.objectContaining({ executable: 5, byUser: 1 }) });
    expect(recompiled.proposal!.result.ok).toBe(true);
  });

  it("is a no-op when nothing changed, when the proposal is not a plan, or without a prepared twin", async () => {
    const { workspace, prepared } = await evaluated();
    expect(recompilePlan(workspace, prepared)).toBe(workspace);
    expect(recompilePlan(workspace, null)).toBe(workspace);
    const legacy: WorkspaceState = { ...workspace, proposal: { ...workspace.proposal!, plan: null } };
    expect(recompilePlan(legacy, prepared)).toBe(legacy);
  });

  it("a hand-written run is not cleared by recompiling the plan", async () => {
    const { workspace, prepared } = await evaluated();
    const manual = runLocalVerification({ ...workspace, mappingChoice: "manual" }, prepared, false);
    const recompiled = recompilePlan(applyFieldDecision(manual, { categoryMeanings: { status: MEANING } }), prepared);
    expect(recompiled.report).toBe(manual.report);
  });
});

describe("PLAN-RA3 local verification runs the compiled executable through the canonical engine", () => {
  it("with the private bindings; identical to a direct Reality Check of the resolved contract", async () => {
    const { workspace, prepared } = await evaluated("gemini-cloud", { categoryMeanings: { status: MEANING } });
    expect(workspace.proposal!.plan!.compiled.complete).toBe(true);
    const ran = runLocalVerification(workspace, prepared, false);
    const executable = workspace.proposal!.result.ok ? workspace.proposal!.result.value.resolved.executable : null;
    const direct = runRealityCheck({ records: workspace.source!.records, reservedRecords: [], mappingContract: executable, targetSchema: JSON.parse(workspace.destinationText), bindings: prepared.twin.bindings });
    expect(ran.report?.overall).toBe("pass");
    expect({ ...ran.report, durationMs: 0 }).toEqual({ ...direct, durationMs: 0 });
  });

  it("the user's translation is a trusted user-declared constraint the verifier checks; the policy is the guided one", async () => {
    const { workspace, prepared } = await evaluated("gemini-cloud", { categoryMeanings: { status: MEANING } });
    const ran = runLocalVerification(workspace, prepared, false);
    const semantics = computeWorkspaceSemantics(ran, prepared)!;
    const declared = semantics.contract.constraints.find((constraint) => constraint.kind === "enum-meaning" && constraint.target === "status");
    expect(declared).toMatchObject({ trust: "trusted", evidence: { kind: "user-declared" }, source: "account_state" });
    expect(semantics.report.fields.find((item) => item.target === "status")?.status).toBe("SEMANTIC_PASS");
    expect(activePolicy(ran).policyId).toBe("guided-set-aside");
  });
});

describe("PLAN-RA4 export candidates and revision gate", () => {
  it("a Gemini plan without user answers: label 'Gemini plan', origin gemini-cloud, revision allowed", async () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null, overrides: { account_state: { discloseCategories: true } } });
    const plan = validatedPlan([
      ...crmPlan(s, false).entries.map((item) => item.entry),
      entry({ target: "status", status: "ready", from: [s.alias("account_state")], transform: "map_enum", valueMap: MEANING.values }),
    ]);
    vi.mocked(validateIntentPlan).mockReturnValue({ ok: true, value: plan });
    const preview = await createDisclosurePreview(s.disclosure);
    const base: WorkspaceState = { ...s.start, review: { preview, approval: null, status: "sent" } };
    const proposal = evaluateProposal(base, s.prepared, { structured: plan.plan, text: "", origin: "gemini-cloud", requestId: preview.requestId, provenance: null })!;
    const workspace = runLocalVerification({ ...base, proposal, mappingChoice: "proposal" }, s.prepared, false);
    const [candidate] = exportCandidates(workspace, s.prepared);
    expect(candidate).toMatchObject({ label: "Gemini plan", origin: "gemini-cloud", userDeclaredFields: 0 });
    expect(planRevisionAllowed(workspace.proposal)).toBe(true);
  });

  it("completed with the user's answers: label, origin unchanged, one count-only limitation line, revision refused", async () => {
    const { workspace: evaluatedWorkspace, prepared } = await evaluated("gemini-cloud", { categoryMeanings: { status: MEANING }, packageLabelSources: ["account_state"] });
    const workspace = runLocalVerification(evaluatedWorkspace, prepared, false);
    const [candidate] = exportCandidates(workspace, prepared);
    expect(candidate).toMatchObject({ label: "Gemini plan, completed with your answers", origin: "gemini-cloud", userDeclaredFields: 1 });
    const input = packageInputFor({ workspace, prepared, candidate: candidate!, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null })!;
    expect(input.userDeclaredFields).toBe(1);
    const built = await buildIntegrationPackage(input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.manifest.schemaVersion).toBe("1.1.0");
    expect(built.manifest.mapping.origin).toBe("gemini-cloud");
    const lines = built.manifest.knownLimitations.filter((line) => line.includes("completed from the data owner's own answers"));
    expect(lines).toEqual([expect.stringMatching(/^1 destination field\(s\) were completed/)]);
    expect(lines[0]).not.toContain("status");
    // Revision: never offered with user-declared operations (private labels must never enter feedback).
    expect(planRevisionAllowed(workspace.proposal)).toBe(false);
    const stage = deriveRuntime(runtimeInput(workspace, prepared)).find((item) => item.id === "revision-prepared")!;
    expect(stage.summary).not.toBe("available · optional");
    expect(stage.next).toBeNull();
  });

  it("a simulated plan is never labelled Gemini", async () => {
    const { workspace: evaluatedWorkspace, prepared } = await evaluated("test-adapter", { categoryMeanings: { status: MEANING } });
    const workspace = runLocalVerification(evaluatedWorkspace, prepared, false);
    expect(exportCandidates(workspace, prepared)[0]).toMatchObject({ label: "Simulated test plan, completed with your answers", origin: "test-adapter" });
  });
});
