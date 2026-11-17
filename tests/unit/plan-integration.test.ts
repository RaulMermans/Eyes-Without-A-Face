/**
 * Sprint 18B (ADR 0018) — compiler integration with the REAL intent prompt,
 * validator, clarification and failure modules (no mocks), through the gated
 * send path with the labelled simulated test planner (never Gemini).
 */
import { describe, expect, it } from "vitest";
import { approveReview, recompilePlan, runLocalVerification, sendApprovedRequest, spendApproval } from "../../src/app/run-actions.ts";
import { applyFieldDecision, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { exportCandidates } from "../../src/app/export-context.ts";
import { isIntentPlanRequest } from "../../src/inference/intent-prompt.ts";
import { createTestCloudAdapter } from "../../src/inference/test-adapters.ts";
import { deriveTestPlan } from "../../src/inference/test-planner.ts";
import { compileIntentPlan } from "../../src/plan/compile.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { crmDemo } from "../helpers/export-workspace.ts";
import { planSetup, SLASH_RECORDS } from "../helpers/plan-fixtures.ts";

const AMBIGUOUS_DESTINATION = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fictional signing destination",
  type: "object",
  additionalProperties: false,
  required: ["ref", "signedOn", "email"],
  properties: { ref: { type: "string", minLength: 1 }, signedOn: { type: "string", format: "date" }, email: { type: "string", format: "email" } },
});

function ambiguousSetup() {
  const base = crmDemo();
  const records = SLASH_RECORDS.map(({ ref, signed, contact }) => ({ ref, signed, contact }));
  return planSetup({ ...base, source: { ...base.source!, label: "fictional-signing", records }, reservedRecords: null, destinationText: AMBIGUOUS_DESTINATION });
}

async function sent(s: ReturnType<typeof planSetup>): Promise<WorkspaceState> {
  const preview = await createDisclosurePreview(s.disclosure);
  expect(isIntentPlanRequest(preview.outboundPrompt)).toBe(true);
  const approved = approveReview({ ...s.start, review: { preview, approval: null, status: "pending" } });
  const cloud = createTestCloudAdapter({ label: "test-harness" }, { state: "configured", reason: "adapters-ready" });
  const next = await sendApprovedRequest(spendApproval(approved), approved.review!, s.prepared, { cloud, onDevice: undefined as never });
  if (!next) throw new Error("no workspace");
  return next;
}

describe("PLAN-I1 an ambiguous slash date claimed ready is never compiled without the user's order", () => {
  it("the planner reads the twin's MM/DD/YYYY wording; the local profile proves nothing; the compiler asks", () => {
    const s = ambiguousSetup();
    const plan = deriveTestPlan(s.disclosure);
    const signed = plan.fields.find((item) => item.target === "signedOn")!;
    expect(signed).toMatchObject({ status: "ready", transform: "parse_date", inputFormat: "MM/DD/YYYY" });
    const validated = validateIntentPlan(plan, s.disclosure);
    if (!validated.ok) throw new Error("plan rejected");
    const compiled = compileIntentPlan(s.input(validated.value));
    expect(compiled.fields.find((item) => item.target === "signedOn")).toMatchObject({ readiness: "needs_clarification", missing: ["date-order"], operation: null });
    expect(JSON.stringify(compiled.aliasContract)).not.toContain("MM/DD/YYYY");
    expect(compiled.clarifications.map((item) => item.id)).toContain("confirm-date-order:signedOn");
    const question = compiled.clarifications.find((item) => item.id === "confirm-date-order:signedOn")!;
    expect(question.localPaths).toEqual(["signed"]);
  });

  it("end to end: send → partial plan → the user confirms the order → recompiled, verified, labelled simulated", async () => {
    const s = ambiguousSetup();
    const workspace = await sent(s);
    expect(workspace.cloudError).toBeNull();
    const proposal = workspace.proposal!;
    expect(proposal.origin).toBe("test-adapter");
    expect(proposal.plan?.compiled.complete).toBe(false);
    expect(proposal.plan?.compiled.unwrittenRequired).toEqual(["ref", "signedOn"]);
    const answered = recompilePlan(applyFieldDecision(workspace, { fieldMatches: { ref: "ref" }, semanticConfirmations: { signed: "DD/MM/YYYY" } }), s.prepared);
    const field = answered.proposal!.plan!.compiled.fields.find((item) => item.target === "signedOn")!;
    expect(field).toMatchObject({ readiness: "ready", operationOrigin: "gemini+user", operation: { params: { inputFormat: "DD/MM/YYYY" } } });
    expect(answered.proposal!.plan!.compiled.complete).toBe(true);
    const ran = runLocalVerification(answered, s.prepared, false);
    expect(ran.report?.overall).toBe("pass");
    expect(exportCandidates(ran, s.prepared)[0]).toMatchObject({ label: "Simulated test plan, completed with your answers", origin: "test-adapter" });
  });
});

describe("PLAN-I2 the CRM demo with withheld category names", () => {
  it("compiles the four plain fields, keeps the status correspondence, and asks to translate", async () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null });
    const workspace = await sent(s);
    const compiled = workspace.proposal!.plan!.compiled;
    expect(compiled.counts.executable).toBe(4);
    // ADR 0020 §7 exemption: a category match awaiting translation is asked once, as the translation (it shows that field's values).
    expect(compiled.fields.find((item) => item.target === "status")).toMatchObject({ readiness: "needs_clarification", missing: ["category-labels"], correspondence: { by: "gemini" } });
    expect(compiled.clarifications.map((item) => item.kind)).toEqual(["translate-categories"]);
  });
});
