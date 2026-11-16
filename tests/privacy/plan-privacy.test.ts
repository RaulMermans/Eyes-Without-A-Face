/**
 * PRV-PLAN-001…004 — Sprint 18B (ADR 0018) privacy of the compiled plan.
 *
 * The alias contract carries aliases only; the user's category labels appear
 * only inside a user-declared map_enum, never in a cloud payload or the
 * workflow log, and enter the downloaded package only through the existing
 * per-field label opt-in (`packageLabelSources`). The scan is unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { exportCandidates, packageInputFor } from "../../src/app/export-context.ts";
import { evaluateProposal, prepareFreshReview, recompilePlan, runLocalVerification } from "../../src/app/run-actions.ts";
import { planRevisionAllowed } from "../../src/app/runtime-model.ts";
import { applyFieldDecision, type WorkspaceState } from "../../src/app/workspace-state.ts";
import { buildIntegrationPackage } from "../../src/export/package.ts";
import { readStoredZip } from "../../src/export/zip.ts";
import { clearWorkflowEvents, listWorkflowEvents } from "../../src/observability/workflow-log.ts";
import { compileIntentPlan } from "../../src/plan/compile.ts";
import { validateIntentPlan } from "../../src/plan/validate.ts";
import type { ValidatedIntentPlan } from "../../src/plan/types.ts";
import { createDisclosurePreview } from "../../src/twin/authorization.ts";
import { crmDemo, PACKAGE_ASSETS } from "../helpers/export-workspace.ts";
import { entry, planSetup, validatedPlan } from "../helpers/plan-fixtures.ts";

vi.mock("../../src/inference/intent-prompt.ts", async (original) => ({ ...((await original()) as object), isIntentPlanRequest: vi.fn(() => true) }));
vi.mock("../../src/plan/validate.ts", async (original) => ({ ...((await original()) as object), validateIntentPlan: vi.fn() }));
vi.mock("../../src/plan/failures.ts", async (original) => {
  const { realOr, failuresFallback } = await import("../helpers/plan-fixtures.ts");
  return realOr(original as () => Promise<typeof import("../../src/plan/failures.ts")>, failuresFallback);
});
vi.mock("../../src/plan/clarify.ts", async (original) => {
  const { realOr, clarifyFallback } = await import("../helpers/plan-fixtures.ts");
  return realOr(original as () => Promise<typeof import("../../src/plan/clarify.ts")>, clarifyFallback);
});

const LABELS = ["active_customer", "inactive_customer"];
const LOCAL_PATHS = ["customer_id", "email_address", "account_state", "joined_at", "company_name", "internal_note"];
const MEANING = { source: "account_state", values: { active_customer: "active", inactive_customer: "inactive", prospect: "prospect" } };

function crmPlan(s: ReturnType<typeof planSetup>): ValidatedIntentPlan {
  return validatedPlan([
    entry({ target: "id", status: "ready", from: [s.alias("customer_id")], transform: "copy" }),
    entry({ target: "email", status: "ready", from: [s.alias("email_address")], transform: "normalize_email" }),
    entry({ target: "status", status: "needs_clarification", from: [s.alias("account_state")], transform: "map_enum", missing: ["category-labels"] }),
    entry({ target: "createdAt", status: "ready", from: [s.alias("joined_at")], transform: "parse_date", inputFormat: "YYYY-MM-DD" }),
    entry({ target: "organization", status: "needs_clarification", from: [s.alias("company_name"), s.alias("internal_note")], transform: "trim", missing: ["field-meaning"] }),
  ]);
}

async function planWorkspace(extra: Partial<WorkspaceState> = {}) {
  const s = planSetup({ ...crmDemo(), reservedRecords: null });
  const plan = crmPlan(s);
  vi.mocked(validateIntentPlan).mockReturnValue({ ok: true, value: plan });
  const preview = await createDisclosurePreview(s.disclosure);
  const base: WorkspaceState = { ...s.start, ...extra, review: { preview, approval: null, status: "sent" } };
  const proposal = evaluateProposal(base, s.prepared, { structured: plan.plan, text: "", origin: "gemini-cloud", requestId: preview.requestId, provenance: null })!;
  return { s, plan, preview, workspace: { ...base, proposal, mappingChoice: "proposal" as const } };
}

describe("PRV-PLAN-001 the compiled alias contract carries no local path and no label unless user-declared", () => {
  it("Gemini-only, user-override and gemini+user contracts: aliases only; labels only inside the user's map_enum", () => {
    const s = planSetup({ ...crmDemo(), reservedRecords: null });
    const plan = crmPlan(s);
    const gemini = compileIntentPlan(s.input(plan));
    const answered = compileIntentPlan(s.input(plan, { categoryMeanings: { status: MEANING }, fieldMatches: { organization: "company_name" } }));
    for (const compiled of [gemini, answered]) {
      const text = JSON.stringify(compiled.aliasContract);
      for (const path of LOCAL_PATHS) expect(text).not.toContain(`"${path}"`);
      for (const operation of compiled.aliasContract!.operations) {
        const refs = operation.op === "concat" ? operation.from : "from" in operation && operation.from ? [operation.from] : [];
        for (const ref of refs) expect(ref).toMatch(/^f_\d{2,3}$/);
      }
    }
    for (const label of LABELS) expect(JSON.stringify(gemini.aliasContract)).not.toContain(label);
    const withLabels = answered.aliasContract!.operations.filter((operation) => LABELS.some((label) => JSON.stringify(operation).includes(label)));
    expect(withLabels).toHaveLength(1);
    expect(withLabels[0]).toMatchObject({ op: "map_enum", to: "status" });
    expect(answered.fields.find((field) => field.target === "status")?.operationOrigin).toBe("gemini+user");
  });
});

describe("PRV-PLAN-002 the user's labels never reach a payload or the log", () => {
  it("answers do not change the reviewed request; a fresh request carries no label or path; events carry none", async () => {
    clearWorkflowEvents();
    const { workspace, preview, s } = await planWorkspace();
    const answered = recompilePlan(applyFieldDecision(workspace, { categoryMeanings: { status: MEANING }, fieldMatches: { organization: "company_name" } }), s.prepared);
    expect(answered.review).toBe(workspace.review);
    expect(answered.review!.preview.payloadHash).toBe(preview.payloadHash);
    const fresh = await prepareFreshReview(answered, s.prepared);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const outbound = `${fresh.workspace.review!.preview.canonicalJson}\n${fresh.workspace.review!.preview.outboundPrompt}`;
    for (const label of LABELS) expect(outbound).not.toContain(label);
    for (const path of LOCAL_PATHS) expect(outbound).not.toContain(path);
    expect(fresh.workspace.review!.preview.payloadHash).toBe(preview.payloadHash);
    const logged = JSON.stringify(listWorkflowEvents());
    for (const secret of [...LABELS, ...LOCAL_PATHS]) expect(logged).not.toContain(secret);
  });

  it("a blind revision is never offered once a user-declared operation holds the labels", async () => {
    const { workspace, s } = await planWorkspace();
    expect(planRevisionAllowed(workspace.proposal)).toBe(true);
    const answered = recompilePlan(applyFieldDecision(workspace, { categoryMeanings: { status: MEANING } }), s.prepared);
    expect(planRevisionAllowed(answered.proposal)).toBe(false);
  });
});

describe("PRV-PLAN-003 the package of a plan completed with the user's labels", () => {
  async function verified(extra: Partial<WorkspaceState>) {
    const { workspace, s } = await planWorkspace(extra);
    const answered = recompilePlan(applyFieldDecision(workspace, { categoryMeanings: { status: MEANING }, fieldMatches: { organization: "company_name" } }), s.prepared);
    expect(answered.proposal!.plan!.compiled.complete).toBe(true);
    const ran = runLocalVerification(answered, s.prepared, false);
    const [candidate] = exportCandidates(ran, s.prepared);
    const input = packageInputFor({ workspace: ran, prepared: s.prepared, candidate: candidate!, draftConfirmed: true, assets: PACKAGE_ASSETS, buildSha: null })!;
    return { candidate: candidate!, result: await buildIntegrationPackage(input) };
  }

  it("is blocked by the unchanged privacy scan without the per-field opt-in, naming no value", async () => {
    const { candidate, result } = await verified({});
    expect(candidate.origin).toBe("gemini-cloud");
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
    if (result.ok) return;
    expect(result.findings.map((item) => item.kind)).toContain("private-value");
    for (const label of LABELS) expect(JSON.stringify(result)).not.toContain(label);
  });

  it("approving another field's names does not unblock it", async () => {
    const { result } = await verified({ packageLabelSources: ["company_name"] });
    expect(result).toMatchObject({ ok: false, code: "PRIVACY_SCAN_FAILED" });
  });

  it("with the opt-in for exactly that field, it builds; no records, paths or bindings; the new limitation is owned text", async () => {
    const { result } = await verified({ packageLabelSources: ["account_state"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const files = readStoredZip(result.zip);
    const text = files.map((file) => `${file.path}\n${new TextDecoder().decode(file.data)}`).join("\n");
    for (const path of LOCAL_PATHS) expect(text).not.toContain(`"${path}"`);
    expect(files.some((file) => /bindings\.local/.test(file.path))).toBe(false);
    expect(text).toContain("active_customer");
    expect(text).toContain("2 destination field(s) were completed from the data owner's own answers");
  });
});
