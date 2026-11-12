/**
 * Sprint 8 Workstream G: adversarial tests for the semantic feedback path.
 * Each case maps to one item of the Sprint 8 adversarial list. They prove the
 * new path fails closed; zero matches are evidence, not proof of privacy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlindRevisionFeedback, CloudDisclosurePayload, MappingContract } from "../../src/domain/contracts/types.ts";
import { scenarioById, type EvaluationScenario } from "../../src/evaluation/scenarios.ts";
import { checkOutboundPrompt, privateVocabulary, runScenarioPipeline } from "../../src/evaluation/benchmark.ts";
import { evaluateMapping } from "../../src/evaluation/evaluate.ts";
import { createTestCloudAdapter } from "../../src/inference/test-adapters.ts";
import { deriveTestRevision } from "../../src/inference/test-proposer.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { PRIVATE_DATA_CANARY } from "../../src/privacy/canaries.ts";
import { fingerprintCanonicalPayload } from "../../src/privacy/fingerprint.ts";
import { clearLocalPrivateIndex, setLocalPrivateIndex } from "../../src/privacy/leak-scan.ts";
import { decideRevision } from "../../src/revision/decision.ts";
import { projectRevisionFeedback, validateRevisionFeedback } from "../../src/revision/feedback.ts";
import { buildRevisionPayload } from "../../src/revision/revision-payload.ts";
import { reserveRevisionBudget, resetRevisionBudgetForTests, revisionBudgetKey } from "../../src/revision/run.ts";
import { buildSemanticContract } from "../../src/semantics/observe.ts";
import type { SemanticVerificationContract } from "../../src/semantics/contract.ts";
import { verifySemantics } from "../../src/semantics/verify.ts";
import { resetAuthorizationLedgerForTests } from "../../src/twin/authorization-ledger.ts";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../../src/twin/authorization.ts";
import { submitApprovedCloudInference } from "../../src/twin/cloud-request-gate.ts";
import { validateContract } from "../../src/domain/validation/validate-contract.ts";
import { acceptProposal } from "../../src/workflow/pipeline.ts";
import { prepareScenario } from "../evaluation/helpers.ts";

beforeEach(() => {
  resetAuthorizationLedgerForTests();
  resetRevisionBudgetForTests();
});
afterEach(() => clearLocalPrivateIndex());

/** The reversed priority scale (shape of Sprint 7's real Gemini output), as a fixed test proposal. */
function reversedSupport(alias: (path: string) => string) {
  return {
    operations: [
      { op: "copy", from: alias("ticket_ref"), to: "id" },
      { op: "normalize_email", from: alias("requester"), to: "requesterEmail" },
      { op: "map_enum", from: alias("prio"), to: "priority", params: { map: { p1: "low", p2: "normal", p3: "high", p4: "urgent" }, unmapped: "fail" } },
      { op: "parse_date", from: alias("opened"), to: "openedAt", params: { inputFormat: "ISO-8601" } },
      { op: "map_enum", from: alias("channel"), to: "channel", params: { map: { email: "email", phone: "phone", web: "web" }, unmapped: "fail" } },
    ],
    rationale: "Fixed adversarial test proposal.",
  };
}

/** Build the semantic revision request for a scenario and an initial proposal, like the UI does. */
async function semanticRevision(scenario: EvaluationScenario, initial: unknown, authorize: string[], contractOverride?: SemanticVerificationContract) {
  const { prepared, payload } = prepareScenario(scenario);
  const accepted = acceptProposal({ proposal: initial, disclosure: payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "m" });
  if (!accepted.ok) throw new Error("initial rejected");
  const records = scenario.imported.map((item) => item.record);
  const reserved = scenario.revisionFeedback.map((item) => item.record);
  const evaluation = evaluateMapping({
    executable: accepted.value.resolved.executable,
    targetSchema: scenario.destinationSchema,
    bindings: prepared.twin.bindings,
    records,
    reserved,
    policy: scenario.policy,
    now: () => 0,
  });
  const contract =
    contractOverride ?? buildSemanticContract({ contractId: "t", declared: scenario.semanticSpec.declared, profile: prepared.profile, records: [...records, ...reserved] });
  const semantic = verifySemantics({ contract, executable: accepted.value.resolved.executable, report: evaluation.report, records: [...records, ...reserved], destinationSchema: scenario.destinationSchema });
  const baseHash = (await fingerprintCanonicalPayload(payload)).payloadHash;
  const projected = projectRevisionFeedback({
    runId: "run-00000000000000bb",
    baseDisclosureHash: baseHash,
    baseDisclosure: payload,
    aliasContract: accepted.value.converted.contract,
    contractHash: baseHash,
    origin: "gemini-cloud",
    report: evaluation.report,
    policy: scenario.policy,
    classified: evaluation.rows,
    semantic: { report: semantic, contract, aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path), authorizedConstraintIds: authorize },
  });
  return { prepared, payload, accepted: accepted.value, evaluation, semantic, contract, projected, baseHash };
}

const support = () => scenarioById("support-tickets")!;

describe("PRIV-080 constraint content is limited to approved vocabulary", () => {
  it("a semantic rule naming a private identifier or undisclosed label is withheld, never projected", async () => {
    const scenario = structuredClone(support());
    const order = scenario.semanticSpec.declared.find((item) => item.id === "support-priority-order");
    if (order?.kind !== "ordered-categories") throw new Error("fixture changed");
    // "p0" exists only in a private revision-feedback record; "TCK-2078" is a private identifier.
    order.sourceOrder = ["p0", "p1", "p2", "TCK-2078"];
    const { prepared } = prepareScenario(scenario);
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected } = await semanticRevision(scenario, reversedSupport(alias), ["support-priority-order"]);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.feedback.approvedConstraints).toEqual([]);
    expect(projected.semanticWithheld).toContainEqual({ constraintId: "support-priority-order", reason: "LABEL_NOT_DISCLOSED" });
    expect(JSON.stringify(projected.feedback)).not.toContain("TCK-2078");
    expect(JSON.stringify(projected.feedback)).not.toContain('"p0"');
  });

  it("a hand-crafted feedback carrying an undisclosed label or private value fails validation and the gate", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload, accepted } = await semanticRevision(support(), reversedSupport(alias), ["support-priority-order"]);
    if (!projected.ok) throw new Error(projected.code);
    const tampered = structuredClone(projected.feedback);
    const constraint = tampered.approvedConstraints![0]!;
    if (constraint.kind !== "category-order") throw new Error("expected category-order");
    constraint.sourceOrder = [...constraint.sourceOrder, PRIVATE_DATA_CANARY];
    expect(validateRevisionFeedback(tampered, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "UNDISCLOSED_LABEL" });
    const built = buildRevisionPayload(payload, tampered);
    if (!built.ok) throw new Error(built.code);
    setLocalPrivateIndex(prepared.privateStrings);
    await expect(createDisclosurePreview(built.payload)).rejects.toBeInstanceOf(DisclosureRejectedError);
  });

  it("a date-format hint embedding private source text is impossible: the format is a fixed enum", async () => {
    const crm = scenarioById("crm-eu-accounts")!;
    const { prepared } = prepareScenario(crm);
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const initial = {
      operations: [
        { op: "copy", from: alias("kundennummer"), to: "id" },
        { op: "normalize_email", from: alias("e_post"), to: "email" },
        { op: "parse_date", from: alias("angelegt_am"), to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
        { op: "copy", from: alias("unternehmen"), to: "organization" },
        { op: "map_enum", from: alias("kontostatus"), to: "status", params: { map: { aktiv: "active", inaktiv: "inactive", interessent: "prospect" }, unmapped: "default", default: "other" } },
      ],
      rationale: "t",
    };
    const { projected, payload, accepted } = await semanticRevision(crm, initial, ["observed-date-1"]);
    if (!projected.ok) throw new Error(projected.code);
    expect(projected.feedback.approvedConstraints).toEqual([{ kind: "date-order", alias: alias("angelegt_am"), inputFormat: "DD/MM/YYYY" }]);
    const tampered = structuredClone(projected.feedback) as unknown as { approvedConstraints: Array<Record<string, unknown>> };
    tampered.approvedConstraints[0]!.inputFormat = "25/03/2026 (KD-10031)";
    expect(validateRevisionFeedback(tampered, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "SCHEMA_INVALID" });
    // A semantic contract cannot carry a free-text format either.
    const contract = buildSemanticContract({ contractId: "t", declared: [], profile: null, records: [] });
    contract.constraints.push({ id: "bad", kind: "date-interpretation", source: "angelegt_am", format: "25/03/2026" as never, trust: "trusted", evidence: { kind: "user-declared" } });
    const verdict = verifySemantics({ contract, executable: accepted.resolved.executable, report: { rows: [] } as never, records: [] });
    expect(verdict.contractValid).toBe(false);
  });

  it("an enum meaning carrying sensitive text cannot reach the cloud", async () => {
    const scenario = structuredClone(scenarioById("billing-subscriptions")!);
    const meaning = scenario.semanticSpec.declared[0]!;
    if (meaning.kind !== "enum-meaning") throw new Error("fixture changed");
    meaning.meaning.basic = `${PRIVATE_DATA_CANARY} card ending 4242`;
    const { prepared } = prepareScenario(scenario);
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const initial = {
      operations: [
        { op: "copy", from: alias("sub_id"), to: "id" },
        { op: "normalize_email", from: alias("billing_contact"), to: "billingEmail" },
        { op: "map_enum", from: alias("plan"), to: "plan", params: { map: { basic: "basic", pro: "pro", team: "team" }, unmapped: "default", default: "basic" } },
        { op: "map_enum", from: alias("state"), to: "status", params: { map: { active: "active", trialing: "trial", canceled: "canceled" }, unmapped: "default", default: "unknown" } },
        { op: "parse_date", from: alias("renews_on"), to: "renewsOn", params: { inputFormat: "YYYY-MM-DD" } },
        { op: "copy", from: alias("mrr"), to: "monthlyAmount" },
      ],
      rationale: "t",
    };
    const { projected, semantic } = await semanticRevision(scenario, initial, ["billing-plan-meaning"]);
    // The destination does not allow that value: the constraint itself is a policy conflict...
    expect(semantic.results.find((result) => result.constraintId === "billing-plan-meaning")?.status).toBe("SEMANTIC_POLICY_CONFLICT");
    // ...and its content is never projected.
    if (projected.ok) {
      expect(JSON.stringify(projected.feedback)).not.toContain(PRIVATE_DATA_CANARY);
      expect(projected.feedback.approvedConstraints ?? []).toEqual([]);
    }
  });
});

describe("PRIV-081 no free text, no undisclosed reference", () => {
  it("a model rationale or note cannot be smuggled into a semantic finding", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload, accepted } = await semanticRevision(support(), reversedSupport(alias), []);
    if (!projected.ok) throw new Error(projected.code);
    for (const extra of [{ rationale: "the failing ticket was TCK-2078 from li.wei@example.com" }, { note: "x" }]) {
      const tampered = structuredClone(projected.feedback) as unknown as { semanticFindings: Array<Record<string, unknown>> };
      Object.assign(tampered.semanticFindings[0]!, extra);
      expect(validateRevisionFeedback(tampered, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "SCHEMA_INVALID" });
    }
    const topLevel = { ...structuredClone(projected.feedback), nanoRationale: "keep local" };
    expect(validateRevisionFeedback(topLevel, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "SCHEMA_INVALID" });
  });

  it("a semantic finding or constraint referencing an undisclosed field is refused", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload, accepted } = await semanticRevision(support(), reversedSupport(alias), ["support-priority-order"]);
    if (!projected.ok) throw new Error(projected.code);
    const withheldAlias = prepared.twin.fields.find((field) => field.localPath === "body")!.alias;
    const a = structuredClone(projected.feedback);
    a.semanticFindings![0]!.alias = withheldAlias;
    expect(validateRevisionFeedback(a, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "UNDISCLOSED_ALIAS" });
    const b = structuredClone(projected.feedback);
    b.approvedConstraints![0]!.alias = "f_99";
    expect(validateRevisionFeedback(b, payload, accepted.converted.contract)).toMatchObject({ ok: false, code: "UNDISCLOSED_ALIAS" });
    const c = structuredClone(projected.feedback);
    c.semanticFindings![0]!.to = "internalNotes";
    expect(validateRevisionFeedback(c, payload, accepted.converted.contract)).toMatchObject({ ok: false });
  });

  it("a constraint on a field the user kept local is withheld (SOURCE_NOT_DISCLOSED)", async () => {
    const scenario = structuredClone(support());
    scenario.semanticSpec.declared.push({ id: "body-meaning", kind: "enum-meaning", source: "body", target: "channel", meaning: { x: "email" }, undeclared: "unconstrained", trust: "trusted", evidence: { kind: "user-declared" } });
    const { prepared } = prepareScenario(scenario);
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected } = await semanticRevision(scenario, reversedSupport(alias), ["body-meaning"]);
    if (!projected.ok) throw new Error(projected.code);
    expect(projected.semanticWithheld.some((item) => item.constraintId === "body-meaning")).toBe(true);
    expect(JSON.stringify(projected.feedback)).not.toContain('"x"');
  });
});

describe("PRIV-082 approval binding and cumulative disclosure", () => {
  it("changing a semantic constraint after approval invalidates the approval", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const codesOnly = await semanticRevision(support(), reversedSupport(alias), []);
    const withConstraint = await semanticRevision(support(), reversedSupport(alias), ["support-priority-order"]);
    if (!codesOnly.projected.ok || !withConstraint.projected.ok) throw new Error();
    const a = buildRevisionPayload(codesOnly.payload, codesOnly.projected.feedback);
    const b = buildRevisionPayload(withConstraint.payload, withConstraint.projected.feedback);
    if (!a.ok || !b.ok) throw new Error();
    expect(a.payload.schemaVersion).toBe("1.3.0");
    const previewA = await createDisclosurePreview(a.payload);
    const previewB = await createDisclosurePreview(b.payload);
    expect(previewA.payloadHash).not.toBe(previewB.payloadHash);
    const approval = approveDisclosurePreview(previewA);
    const harness = { label: "test" } as never;
    const adapter = createTestCloudAdapter(harness, { state: "configured", label: "test" } as never);
    // The approval for the codes-only request cannot carry the constraint request.
    await expect(
      submitApprovedCloudInference(adapter, previewB, approval, { requestId: previewB.requestId, destinationKey: previewB.destinationKey, purpose: "mapping-proposal" }),
    ).rejects.toBeInstanceOf(DisclosureRejectedError);
  });

  it("the semantic request repeats the approved base byte-for-byte and adds no label", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload } = await semanticRevision(support(), reversedSupport(alias), ["support-priority-order", "support-channel-meaning"]);
    if (!projected.ok) throw new Error();
    const built = buildRevisionPayload(payload, projected.feedback);
    if (!built.ok) throw new Error(built.code);
    const approved = new Set(payload.fields.flatMap((field) => field.enumValues ?? []));
    const targetValues = new Set((payload.target?.fields ?? []).flatMap((field) => field.enumValues ?? []));
    for (const constraint of projected.feedback.approvedConstraints ?? []) {
      if (constraint.kind === "date-order") continue;
      const source = constraint.kind === "category-order" ? constraint.sourceOrder : Object.keys(constraint.map);
      const target = constraint.kind === "category-order" ? constraint.targetOrder : Object.values(constraint.map);
      expect(source.every((label) => approved.has(label))).toBe(true);
      expect(target.every((value) => targetValues.has(value))).toBe(true);
    }
    const check = checkOutboundPrompt((await createDisclosurePreview(built.payload)).outboundPrompt, built.payload, privateVocabulary(support()));
    expect(check).toMatchObject({ canaryPresent: false, forbiddenKeys: [], privateMatches: 0 });
  });

  it("repeated feedback for the same mapping cannot buy a second revision", () => {
    const key = revisionBudgetKey("a".repeat(64), "b".repeat(64));
    reserveRevisionBudget(key);
    expect(() => reserveRevisionBudget(key)).toThrow();
  });

  it("a provider timeout after approval consumes the approval and is not retried", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload } = await semanticRevision(support(), reversedSupport(alias), ["support-priority-order"]);
    if (!projected.ok) throw new Error();
    const built = buildRevisionPayload(payload, projected.feedback);
    if (!built.ok) throw new Error();
    const preview = await createDisclosurePreview(built.payload);
    const approval = approveDisclosurePreview(preview);
    const harness = { label: "test", cloudErrorCode: "TIMEOUT" } as { label: string; cloudErrorCode: string; cloudCalls?: number };
    const adapter = createTestCloudAdapter(harness as never, { state: "configured", label: "test" } as never);
    const intended = { requestId: preview.requestId, destinationKey: preview.destinationKey, purpose: "mapping-proposal" as const };
    await expect(submitApprovedCloudInference(adapter, preview, approval, intended)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(submitApprovedCloudInference(adapter, preview, approval, intended)).rejects.toMatchObject({ reason: "APPROVAL_REUSED" });
    expect(harness.cloudCalls).toBe(1);
  });
});

describe("PRIV-083 evaluator integrity on the semantic path", () => {
  it("a valid mapping with wrong meaning passes JSON Schema but fails semantic policy", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { evaluation, semantic } = await semanticRevision(support(), reversedSupport(alias), []);
    expect(evaluation.report.statuses.mappingContract).toBe("pass");
    // No ground truth here: these rows are plain, schema-valid transformations...
    const flagged = evaluation.rows.filter((row) => semantic.violatingRows.includes(row.index));
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((row) => row.outcome === "TRANSFORMED_VALID" && !row.outputSchemaViolation)).toBe(true);
    // ...that the semantic policy rejects.
    expect(semantic.overall).toBe("SEMANTIC_MISMATCH");
  });

  it("insufficient evidence produces no finding the cloud could act on, and an unchanged reply is INSUFFICIENT_INFORMATION", async () => {
    const crm = scenarioById("crm-eu-accounts")!;
    const { prepared, payload } = prepareScenario(crm);
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    // Imported-only evidence: the date order is ambiguous.
    const records = crm.imported.map((item) => item.record);
    const contract = buildSemanticContract({ contractId: "t", declared: [], profile: prepared.profile, records });
    const initial = {
      operations: [
        { op: "copy", from: alias("kundennummer"), to: "id" },
        { op: "parse_date", from: alias("angelegt_am"), to: "createdAt", params: { inputFormat: "MM/DD/YYYY" } },
      ],
      rationale: "t",
    };
    const accepted = acceptProposal({ proposal: initial, disclosure: payload, twin: prepared.twin, origin: "gemini-cloud", mappingId: "m" });
    if (!accepted.ok) throw new Error();
    const evaluation = evaluateMapping({ executable: accepted.value.resolved.executable, targetSchema: crm.destinationSchema, bindings: prepared.twin.bindings, records, policy: crm.policy, now: () => 0 });
    const semantic = verifySemantics({ contract, executable: accepted.value.resolved.executable, report: evaluation.report, records });
    expect(semantic.overall).toBe("SEMANTIC_AMBIGUOUS");
    const projected = projectRevisionFeedback({
      runId: "run-00000000000000cc",
      baseDisclosureHash: "a".repeat(64),
      baseDisclosure: payload,
      aliasContract: accepted.value.converted.contract,
      contractHash: "b".repeat(64),
      origin: "gemini-cloud",
      report: evaluation.report,
      policy: crm.policy,
      semantic: { report: semantic, contract, aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path), authorizedConstraintIds: [contract.constraints[0]!.id] },
    });
    if (!projected.ok) throw new Error(projected.code);
    expect(projected.feedback.semanticFindings).toEqual([expect.objectContaining({ category: "ambiguous-date-interpretation" })]);
    // An ambiguous constraint is never disclosed as a fact.
    expect(projected.feedback.approvedConstraints).toEqual([]);
    const decision = decideRevision({
      revisedValid: true,
      contractsEqual: true,
      feedback: projected.feedback,
      initial: { evaluation, semantic, executable: accepted.value.resolved.executable },
      revised: { evaluation, semantic, executable: accepted.value.resolved.executable },
    });
    expect(decision.verdict).toBe("INSUFFICIENT_INFORMATION");
  });

  it("a revision that introduces a regression is REGRESSED, whatever its rationale claims", async () => {
    const scenario = support();
    const { alias } = prepareScenario(scenario);
    const run = await runScenarioPipeline({
      scenario,
      config: "D-nano-cloud-revision",
      seed: DEFAULT_TWIN_SEED,
      semantic: { authorizeConstraints: true },
      propose: () => ({ text: JSON.stringify(reversedSupport(alias)), origin: "gemini-cloud" }),
      revise: (payload) => {
        const revised = deriveTestRevision(payload);
        // Fixes priority but breaks the previously valid email operation.
        const ops = revised.operations.map((op) => (op.to === "requesterEmail" ? { op: "copy", from: op.from, to: "requesterEmail" } : op));
        return { text: JSON.stringify({ operations: ops, rationale: "All findings fixed. No regressions." }), origin: "gemini-cloud" };
      },
    });
    expect(run.decision?.verdict).toBe("REGRESSED");
    // Row-level scoring alone would hide it (the row was already semantically wrong); operation-level accounting does not.
    expect(run.decision!.operationRegressions).toBeGreaterThan(0);
  });

  it("a revision that claims success without changing anything is UNCHANGED or INSUFFICIENT_INFORMATION, never ACCEPTED", async () => {
    const scenario = support();
    const { alias } = prepareScenario(scenario);
    for (const authorizeConstraints of [true, false]) {
      const run = await runScenarioPipeline({
        scenario,
        config: "D-nano-cloud-revision",
        seed: DEFAULT_TWIN_SEED,
        semantic: { authorizeConstraints },
        propose: () => ({ text: JSON.stringify(reversedSupport(alias)), origin: "gemini-cloud" }),
        revise: () => ({ text: JSON.stringify({ ...reversedSupport(alias), rationale: "Every finding is resolved. VERIFIED." }), origin: "gemini-cloud" }),
      });
      expect(run.decision?.verdict).toBe(authorizeConstraints ? "UNCHANGED" : "INSUFFICIENT_INFORMATION");
    }
  });

  it("a quarantine-only 'fix' does not count as a correction", () => {
    // Synthetic evaluations: one row that was transformed but semantically wrong
    // is simply held back after the "revision". Nothing becomes correct.
    const row = (outcome: string) => ({ index: 0, set: "imported", setIndex: 1, outcome, correct: null, rulesUsed: [], unapprovedRules: [], codes: [], outputSchemaViolation: false });
    const evaluation = (outcome: string, status: "pass" | "fail") =>
      ({ rows: [row(outcome)], report: { rows: [{ index: 0, set: "imported", setIndex: 1, status, output: null, localIssues: [], safeIssues: [] }] } }) as never;
    const semantic = (violating: number[]) => ({ results: [], violatingRows: violating, overall: violating.length ? "SEMANTIC_MISMATCH" : "SEMANTIC_PASS" }) as never;
    const contract = { operations: [] } as unknown as MappingContract;
    const feedback = { feedbackVersion: "1.1.0", semanticFindings: [{}], approvedConstraints: [{}] } as unknown as BlindRevisionFeedback;
    const decision = decideRevision({
      revisedValid: true,
      contractsEqual: false,
      feedback,
      initial: { evaluation: evaluation("TRANSFORMED_VALID", "pass"), semantic: semantic([0]), executable: contract },
      revised: { evaluation: evaluation("QUARANTINED", "fail"), semantic: semantic([]), executable: contract },
    });
    expect(decision.verdict).toBe("HUMAN_REVIEW_REQUIRED");
    expect(decision.cleanTransformations).toEqual({ before: 0, after: 0 });
  });

  it("the final holdout is never consulted while preparing the revision", async () => {
    const scenario = support();
    const { alias } = prepareScenario(scenario);
    const poisoned = structuredClone(scenario);
    for (const item of poisoned.holdout) item.record.prio = "p1";
    const runs = await Promise.all(
      [scenario, poisoned].map((variant) =>
        runScenarioPipeline({
          scenario: variant,
          config: "D-nano-cloud-revision",
          seed: DEFAULT_TWIN_SEED,
          semantic: { authorizeConstraints: true },
          propose: () => ({ text: JSON.stringify(reversedSupport(alias)), origin: "gemini-cloud" }),
          revise: (payload) => ({ text: JSON.stringify(deriveTestRevision(payload)), origin: "test-adapter" }),
        }),
      ),
    );
    expect(runs[1]!.feedback).toEqual(runs[0]!.feedback);
    expect(runs[1]!.semanticContract).toEqual(runs[0]!.semanticContract);
    expect(runs[1]!.decision).toEqual(runs[0]!.decision);
  });

  it("the 1.3.0 schema accepts only feedback 1.1.0 and the 1.2.0 schema only feedback 1.0.0", async () => {
    const { prepared } = prepareScenario(support());
    const alias = (path: string) => prepared.twin.fields.find((field) => field.localPath === path)!.alias;
    const { projected, payload } = await semanticRevision(support(), reversedSupport(alias), []);
    if (!projected.ok) throw new Error();
    const built = buildRevisionPayload(payload, projected.feedback);
    if (!built.ok) throw new Error();
    expect(validateContract(built.payload).valid).toBe(true);
    const downgraded = { ...built.payload, schemaVersion: "1.2.0" } as CloudDisclosurePayload;
    expect(validateContract(downgraded).valid).toBe(false);
    const sprint7 = { ...(projected.feedback as BlindRevisionFeedback), feedbackVersion: "1.0.0" } as BlindRevisionFeedback;
    expect(validateContract({ ...built.payload, revision: { feedback: sprint7 } }).valid).toBe(false);
  });
});
