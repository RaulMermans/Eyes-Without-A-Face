import { beforeEach, describe, expect, it } from "vitest";
import type { MappingContract } from "../../src/domain/contracts/types.ts";
import { scenarioById } from "../../src/evaluation/scenarios.ts";
import { evaluateMapping } from "../../src/evaluation/evaluate.ts";
import { fingerprintCanonicalPayload } from "../../src/privacy/fingerprint.ts";
import { acceptProposal } from "../../src/workflow/pipeline.ts";
import { countBucket, describeNewInformation, projectRevisionFeedback, validateRevisionFeedback } from "../../src/revision/feedback.ts";
import { assertSameBase, buildRevisionPayload } from "../../src/revision/revision-payload.ts";
import {
  canTransition,
  nextPhase,
  reserveRevisionBudget,
  resetRevisionBudgetForTests,
  revisionsUsed,
  RevisionStateError,
  type RevisionPhase,
} from "../../src/revision/run.ts";
import { deriveTestRevision } from "../../src/inference/test-proposer.ts";
import { handWrittenInitial, prepareScenario } from "../evaluation/helpers.ts";

async function crmFixture() {
  const scenario = scenarioById("crm-eu-accounts")!;
  const { prepared, payload, alias } = prepareScenario(scenario);
  const accepted = acceptProposal({
    proposal: handWrittenInitial(scenario.scenarioId, alias),
    disclosure: payload,
    twin: prepared.twin,
    origin: "manual-edit",
    mappingId: "crm-initial",
  });
  if (!accepted.ok) throw new Error("fixture proposal rejected");
  const evaluation = evaluateMapping({
    executable: accepted.value.resolved.executable,
    targetSchema: scenario.destinationSchema,
    bindings: prepared.twin.bindings,
    records: scenario.imported.map((item) => item.record),
    reserved: scenario.revisionFeedback.map((item) => item.record),
    policy: scenario.policy,
    now: () => 0,
  });
  const baseHash = (await fingerprintCanonicalPayload(payload)).payloadHash;
  const contractHash = (await fingerprintCanonicalPayload(accepted.value.converted.contract)).payloadHash;
  const project = (report = evaluation.report, contract: MappingContract = accepted.value.converted.contract) =>
    projectRevisionFeedback({
      runId: "run-0123456789abcdef",
      baseDisclosureHash: baseHash,
      baseDisclosure: payload,
      aliasContract: contract,
      contractHash,
      origin: "gemini-cloud",
      report,
      policy: scenario.policy,
    });
  return { scenario, prepared, payload, accepted, evaluation, project };
}

describe("REV-001 feedback projection", () => {
  it("builds schema-valid feedback from allowlisted pieces only", async () => {
    const { project, payload, accepted } = await crmFixture();
    const result = project();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const feedback = result.feedback;
    expect(validateRevisionFeedback(feedback, payload, accepted.value.converted.contract)).toEqual({ ok: true });
    expect(feedback.findings.map((f) => f.category).sort()).toEqual(["date-format-mismatch", "invalid-email", "undisclosed-category"]);
    for (const finding of feedback.findings) expect(Object.keys(finding).sort()).toEqual(expect.arrayContaining(["affectedCases", "category", "code"]));
    expect(feedback.revisionBudget).toEqual({ maxRevisions: 1, remainingAfterThisRequest: 0 });
    expect(feedback.approvedFallbacks).toEqual([{ to: "status", value: "other", appliesTo: "undisclosed-category" }]);
  });

  it("is deterministic (same input, same canonical bytes)", async () => {
    const { project } = await crmFixture();
    const a = project();
    const b = project();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never copies record values, source names, or engine messages", async () => {
    const { project, scenario } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    const text = JSON.stringify(result.feedback).toLowerCase();
    for (const item of [...scenario.imported, ...scenario.revisionFeedback]) {
      for (const [key, value] of Object.entries(item.record)) {
        expect(text).not.toContain(key.toLowerCase());
        if (typeof value === "string" && value.length >= 4 && !["aktiv", "inaktiv", "interessent"].includes(value)) {
          expect(text).not.toContain(value.toLowerCase());
        }
      }
    }
    expect(text).not.toContain("is not mm/dd/yyyy");
  });

  it("buckets counts coarsely", () => {
    expect([1, 2, 4, 5, 40].map(countBucket)).toEqual(["1", "2-4", "2-4", "5+", "5+"]);
  });

  it("refuses when nothing allowlisted failed", async () => {
    const { project, evaluation } = await crmFixture();
    const clean = { ...evaluation.report, rows: evaluation.report.rows.filter((row) => row.status === "pass") };
    const result = project(clean);
    expect(result).toMatchObject({ ok: false, code: "NO_FINDINGS" });
  });

  it("rejects tampered feedback: unknown fields, undisclosed aliases, foreign targets, operation drift", async () => {
    const { project, payload, accepted } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    const contract = accepted.value.converted.contract;
    const base = result.feedback;
    const cases: Array<[string, unknown]> = [
      ["extra key", { ...base, rawRecords: [] }],
      ["finding message", { ...base, findings: [{ ...base.findings[0], message: "x" }] }],
      ["undisclosed alias", { ...base, findings: [{ ...base.findings[0], alias: "f_99" }] }],
      ["foreign target", { ...base, findings: [{ ...base.findings[0], to: "secret_column" }] }],
      ["unknown code", { ...base, findings: [{ ...base.findings[0], code: "STACK_TRACE" }] }],
      ["second revision", { ...base, revisionBudget: { maxRevisions: 2, remainingAfterThisRequest: 1 } }],
      ["operation drift", { ...base, previousMapping: { ...base.previousMapping, operations: base.previousMapping.operations.slice(1) } }],
      ["fallback outside target", { ...base, approvedFallbacks: [{ to: "status", value: "vip", appliesTo: "undisclosed-category" }] }],
      ["__proto__ key", JSON.parse(JSON.stringify(base).replace('"feedbackVersion"', '"__proto__":{"polluted":true},"feedbackVersion"'))],
    ];
    for (const [label, candidate] of cases) {
      expect(validateRevisionFeedback(candidate, payload, contract).ok, label).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("describes newly disclosed information in plain language", async () => {
    const { project } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    const lines = describeNewInformation(result.feedback);
    expect(lines.join("\n")).toMatch(/date-format-mismatch/);
    expect(lines.join("\n")).toMatch(/Approved fallback/);
  });
});

describe("REV-002 revision payload (cloud-disclosure 1.2.0)", () => {
  it("reproduces the approved base byte-for-byte and adds only the feedback", async () => {
    const { project, payload } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    const built = buildRevisionPayload(payload, result.feedback);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.schemaVersion).toBe("1.2.0");
    expect(assertSameBase(payload, built.payload)).toBe(true);
    const { revision, schemaVersion, payloadId, ...rest } = built.payload;
    const { schemaVersion: _v, payloadId: _p, ...baseRest } = payload;
    expect(rest).toEqual(baseRest);
    expect(revision?.feedback).toEqual(result.feedback);
    expect(schemaVersion).toBe("1.2.0");
    expect(payloadId).toBe("revision-run-0123456789abcdef");
  });

  it("refuses a base that is not an approved 1.1.0 disclosure", async () => {
    const { project, payload } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    expect(buildRevisionPayload({ ...payload, schemaVersion: "1.0.0", target: undefined }, result.feedback)).toMatchObject({ ok: false, code: "BASE_NOT_1_1" });
  });

  it("the simulated reviser only reads the payload and keeps unaffected operations", async () => {
    const { project, payload } = await crmFixture();
    const result = project();
    if (!result.ok) throw new Error();
    const built = buildRevisionPayload(payload, result.feedback);
    if (!built.ok) throw new Error();
    const revised = deriveTestRevision(built.payload);
    expect(revised.rationale).toMatch(/Not a live Gemini response/);
    for (const number of result.feedback.unaffectedOperations) {
      expect(revised.operations[number - 1]).toEqual(result.feedback.previousMapping.operations[number - 1]);
    }
  });
});

describe("REV-003 revision state machine", () => {
  beforeEach(() => resetRevisionBudgetForTests());

  it("walks the happy path once", () => {
    const events = ["initial-evaluated", "feedback-prepared", "request-previewed", "approved", "sent", "revision-valid", "revised-evaluated"] as const;
    const history: RevisionPhase[] = ["INITIAL_PROPOSAL_VALIDATED"];
    for (const event of events) history.push(nextPhase(history.at(-1)!, event));
    expect(history.at(-1)).toBe("REVISION_EVALUATED");
    expect(revisionsUsed(history)).toBe(1);
  });

  it("cannot send without approval, cannot send twice, and has no path back to SENT", () => {
    expect(() => nextPhase("REVISION_REVIEW_REQUIRED", "sent")).toThrow(RevisionStateError);
    expect(() => nextPhase("FEEDBACK_PREPARED", "approved")).toThrow(RevisionStateError);
    for (const phase of ["REVISION_VALIDATED", "REVISION_REJECTED", "REVISION_EVALUATED", "REVISION_BLOCKED"] as const) {
      expect(canTransition(phase, "sent")).toBe(false);
      expect(canTransition(phase, "approved")).toBe(false);
      expect(canTransition(phase, "feedback-prepared")).toBe(false);
    }
  });

  it("enforces one revision per (base disclosure, initial contract) in this browser session", () => {
    reserveRevisionBudget("a:b");
    expect(() => reserveRevisionBudget("a:b")).toThrow(RevisionStateError);
    expect(() => reserveRevisionBudget("a:c")).not.toThrow();
  });
});

describe("REV-004 policy findings", () => {
  it("an unapproved fallback becomes an UNAPPROVED_FALLBACK finding with operation references only", async () => {
    const scenario = scenarioById("support-tickets")!;
    const { prepared, payload, alias } = prepareScenario(scenario);
    const proposal = handWrittenInitial(scenario.scenarioId, alias) as { operations: Array<Record<string, unknown>> };
    proposal.operations = proposal.operations.map((op) =>
      op.to === "priority" ? { ...op, params: { ...(op.params as object), unmapped: "default", default: "normal" } } : op,
    );
    const accepted = acceptProposal({ proposal, disclosure: payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "m" });
    if (!accepted.ok) throw new Error();
    const evaluation = evaluateMapping({
      executable: accepted.value.resolved.executable,
      targetSchema: scenario.destinationSchema,
      bindings: prepared.twin.bindings,
      records: scenario.imported.map((item) => item.record),
      reserved: scenario.revisionFeedback.map((item) => item.record),
      policy: scenario.policy,
      now: () => 0,
    });
    const hash = (await fingerprintCanonicalPayload(payload)).payloadHash;
    const result = projectRevisionFeedback({
      runId: "run-0123456789abcdef",
      baseDisclosureHash: hash,
      baseDisclosure: payload,
      aliasContract: accepted.value.converted.contract,
      contractHash: hash,
      origin: "gemini-cloud",
      report: evaluation.report,
      policy: scenario.policy,
      classified: evaluation.rows,
    });
    if (!result.ok) throw new Error(result.code);
    const finding = result.feedback.findings.find((item) => item.code === "UNAPPROVED_FALLBACK");
    expect(finding).toMatchObject({ category: "unapproved-fallback", op: "map_enum", to: "priority", operation: 3, alias: alias("prio"), affectedCases: "1" });
    expect(JSON.stringify(result.feedback)).not.toContain("p0");
    const built = buildRevisionPayload(payload, result.feedback);
    if (!built.ok) throw new Error(built.code);
    const revised = deriveTestRevision(built.payload);
    expect(revised.operations[2]?.params).toMatchObject({ unmapped: "fail" });
  });
});
