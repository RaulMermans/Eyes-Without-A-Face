/**
 * Blind Integration pipeline for one scenario and one configuration (Sprint 7,
 * Workstreams E and G). Pure and deterministic given its proposers, so the
 * same function evaluates:
 *
 *   A  deterministic baseline proposer (no AI, no revision)
 *   B  Gemini Cloud over the approved disclosure (replayed from recorded text)
 *   C  Gemini Nano reviewed overrides + Gemini Cloud
 *   D  C + one blind revision
 *
 * Proposers receive ONLY the disclosure payload object, exactly what the cloud
 * adapter would send. Holdout cases are evaluated only after the final mapping
 * exists, for both the initial and revised contracts.
 */
import type { CloudDisclosurePayload, MappingContract } from "../domain/contracts/types.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { buildCloudPromptText } from "../inference/prompts.ts";
import type { TwinFieldOverride } from "../phantom/generate.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import { PRIVATE_DATA_CANARY } from "../privacy/canaries.ts";
import { findForbiddenCloudSubstrings } from "../privacy/forbidden-cloud-fields.ts";
import { findPrivateValueLeaks } from "../privacy/leak-scan.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { acceptProposal, buildDisclosureDraft, prepareTwin, type AcceptProposalResult } from "../workflow/pipeline.ts";
import { projectRevisionFeedback, type FeedbackRejectionCode } from "../revision/feedback.ts";
import { buildRevisionPayload, isRevisionSchemaVersion } from "../revision/revision-payload.ts";
import type { ClassifiedRow, CompletionState, OutcomeMetrics } from "../verification/outcomes.ts";
import type { BlindRevisionFeedback } from "../domain/contracts/types.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import { buildSemanticContract } from "../semantics/observe.ts";
import type { SemanticVerificationContract } from "../semantics/contract.ts";
import { verifySemantics, type SemanticReport } from "../semantics/verify.ts";
import { decideRevision, type RevisionDecision } from "../revision/decision.ts";
import { compareEvaluations, diffContracts, evaluateMapping, type EvaluationComparison, type MappingEvaluation, type OperationChange } from "./evaluate.ts";
import type { EvaluationScenario } from "./scenarios.ts";

export type BenchmarkConfig = "A-deterministic" | "B-cloud" | "C-nano-cloud" | "D-nano-cloud-revision";

export interface ProposerReply {
  text: string;
  origin: ProposalOrigin;
}

export type Proposer = (payload: CloudDisclosurePayload) => ProposerReply | null;

export interface StageResult {
  accepted: boolean;
  rejectionStage?: "parse" | "convert" | "resolve";
  rejectionCodes?: string[];
  aliasContract?: MappingContract;
  evaluation?: MappingEvaluation;
  holdout?: MappingEvaluation;
  /** Sprint 8: local semantic verification of the same rows (imported + revision-feedback). */
  semantic?: SemanticReport;
  /** Sprint 8: the same frozen contract applied to the final holdout rows (scoring only). */
  holdoutSemantic?: SemanticReport;
}

/**
 * Detection quality of the semantic verifier against fixture ground truth.
 * Scoring only: ground truth never reaches the verifier or the decision.
 */
export interface SemanticDetection {
  /** Schema-valid outputs that ground truth says are wrong. */
  incorrect: number;
  /** ...of which the verifier flagged. */
  detected: number;
  missed: number;
  /** Flagged rows whose output ground truth says is right. */
  falseAlarms: number;
}

export function semanticDetection(rows: readonly ClassifiedRow[], report: SemanticReport | undefined): SemanticDetection | null {
  if (!report) return null;
  const flagged = new Set(report.violatingRows);
  const incorrect = rows.filter((row) => row.outcome === "INCORRECT_TRANSFORMATION");
  const detected = incorrect.filter((row) => flagged.has(row.index)).length;
  const falseAlarms = rows.filter((row) => row.correct === true && flagged.has(row.index)).length;
  return { incorrect: incorrect.length, detected, missed: incorrect.length - detected, falseAlarms };
}

export interface PromptPrivacyCheck {
  /** Bytes of the outbound application prompt. */
  promptBytes: number;
  canaryPresent: boolean;
  forbiddenKeys: string[];
  /** Private strings (record values ≥ 4 chars, original field names) found verbatim, excluding approved vocabulary. */
  privateMatches: number;
  approvedVocabularyExcluded: number;
}

export interface ScenarioRun {
  scenarioId: string;
  config: BenchmarkConfig;
  disclosureHash: string;
  initialPromptCheck: PromptPrivacyCheck;
  initial: StageResult;
  feedback?: { ok: true; findings: number; hash: string } | { ok: false; code: FeedbackRejectionCode };
  revisionPromptCheck?: PromptPrivacyCheck;
  revised?: StageResult;
  comparison?: EvaluationComparison;
  holdoutComparison?: EvaluationComparison;
  operationChanges?: OperationChange[];
  modelCalls: number;
  approvals: number;
  finalState: CompletionState;
  finalHoldout: OutcomeMetrics | null;
  /** Sprint 8 (semantic runs only). */
  semanticContract?: SemanticVerificationContract;
  feedbackVersion?: BlindRevisionFeedback["feedbackVersion"];
  feedbackValue?: BlindRevisionFeedback;
  decision?: RevisionDecision;
  humanInterventions?: { declaredConstraints: number; constraintDisclosureApprovals: number };
}

/** Every private string in all three case sets plus original field names. */
export function privateVocabulary(scenario: EvaluationScenario): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (key && key.length >= 4) values.add(key.toLowerCase());
    if (typeof value === "string" && value.trim().length >= 4) values.add(value.trim().toLowerCase());
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k);
    }
  };
  for (const item of [...scenario.imported, ...scenario.revisionFeedback, ...scenario.holdout]) visit(item.record);
  return values;
}

/**
 * Scan the ENTIRE outbound application prompt (instructions + canonical
 * payload), not just the payload object. Approved vocabulary — destination
 * names and values, and category labels the user chose to disclose — is
 * excluded and counted, so a match means an unapproved private string.
 */
export function checkOutboundPrompt(prompt: string, payload: CloudDisclosurePayload, privateStrings: ReadonlySet<string>): PromptPrivacyCheck {
  const approved = new Set<string>();
  for (const field of payload.target?.fields ?? []) {
    approved.add(field.name.toLowerCase());
    for (const value of field.enumValues ?? []) approved.add(value.toLowerCase());
  }
  for (const field of payload.fields) for (const label of field.enumValues ?? []) approved.add(label.toLowerCase());
  // Blank out public text: the fixed instruction block (source code) and the
  // approved vocabulary, longest first. Whatever private string still matches
  // the residual came from somewhere it should not have.
  const marker = isRevisionSchemaVersion(payload.schemaVersion) ? "Approved revision payload:" : "Approved disclosure payload:";
  const split = prompt.indexOf(marker);
  let residual = (split >= 0 ? prompt.slice(split + marker.length) : prompt).toLowerCase();
  for (const term of [...approved].sort((a, b) => b.length - a.length)) {
    residual = residual.split(`"${term}"`).join('" "');
  }
  let privateMatches = 0;
  let excluded = 0;
  const lowered = prompt.toLowerCase();
  for (const value of privateStrings) {
    if (!lowered.includes(value)) continue;
    if (approved.has(value) || !residual.includes(value)) excluded += 1;
    else privateMatches += 1;
  }
  return {
    promptBytes: new TextEncoder().encode(prompt).byteLength,
    canaryPresent: prompt.includes(PRIVATE_DATA_CANARY),
    forbiddenKeys: findForbiddenCloudSubstrings(prompt),
    privateMatches,
    approvedVocabularyExcluded: excluded,
  };
}

function stage(result: AcceptProposalResult): StageResult {
  if (result.ok) return { accepted: true, aliasContract: result.value.converted.contract };
  return {
    accepted: false,
    rejectionStage: result.stage,
    rejectionCodes: [...new Set(result.issues.map((issue) => issue.code))],
  };
}

export async function runScenarioPipeline(input: {
  scenario: EvaluationScenario;
  config: BenchmarkConfig;
  seed: number;
  /** Reviewed on-device overrides (configs C, D). Keyed by local path. */
  semanticOverrides?: Record<string, TwinFieldOverride>;
  propose: Proposer;
  /** Only for config D. Receives the approved 1.2.0 / 1.3.0 revision payload. */
  revise?: Proposer;
  runId?: string;
  /**
   * Sprint 8 semantic verification. Off by default so Sprint 7 evidence
   * replays exactly. `authorizeConstraints` models the user approving the
   * disclosure of every trusted constraint behind a sendable finding.
   */
  semantic?: { authorizeConstraints: boolean };
}): Promise<ScenarioRun> {
  const { scenario } = input;
  const privateStrings = privateVocabulary(scenario);
  const overrides: Record<string, TwinFieldOverride> = { ...scenario.twinOverrides };
  for (const [path, override] of Object.entries(input.semanticOverrides ?? {})) {
    overrides[path] = { ...overrides[path], ...override };
  }
  const imported = scenario.imported.map((item) => item.record);
  const feedbackCases = scenario.revisionFeedback.map((item) => item.record);
  const expected = [...scenario.imported, ...scenario.revisionFeedback].map((item) => item.expected);

  const prepared = prepareTwin({ records: imported, datasetLabel: scenario.datasetLabel, seed: input.seed, overrides });
  if (!prepared.ok) throw new Error(`Scenario ${scenario.scenarioId}: twin failed at ${prepared.stage}`);
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destinationSchema });
  if (!draft.ok) throw new Error(`Scenario ${scenario.scenarioId}: disclosure failed: ${draft.issues.join("; ")}`);
  const base = draft.value.payload;
  const { canonicalJson, payloadHash } = await fingerprintCanonicalPayload(base);
  const initialPromptCheck = checkOutboundPrompt(buildCloudPromptText(canonicalJson, base.schemaVersion), base, privateStrings);
  const twin = prepared.value.twin;

  let modelCalls = 0;
  let approvals = 1;
  const reply = input.propose(base);
  modelCalls += input.config === "A-deterministic" ? 0 : 1;
  const run: ScenarioRun = {
    scenarioId: scenario.scenarioId,
    config: input.config,
    disclosureHash: payloadHash,
    initialPromptCheck,
    initial: { accepted: false },
    modelCalls,
    approvals,
    finalState: "BLOCKED",
    finalHoldout: null,
  };
  if (!reply) return run;

  const initialResult = acceptProposal({
    proposalText: reply.text,
    proposal: undefined,
    disclosure: base,
    twin,
    origin: reply.origin,
    mappingId: `${scenario.scenarioId}-initial`,
  });
  run.initial = stage(initialResult);
  if (!initialResult.ok) {
    run.finalState = "REVISION_FAILED";
    return run;
  }
  const evaluateFinal = (executable: MappingContract) =>
    evaluateMapping({
      executable,
      targetSchema: scenario.destinationSchema,
      bindings: twin.bindings,
      records: imported,
      reserved: feedbackCases,
      policy: scenario.policy,
      expected,
      now: () => 0,
    });
  const evaluateHoldout = (executable: MappingContract) =>
    evaluateMapping({
      executable,
      targetSchema: scenario.destinationSchema,
      bindings: twin.bindings,
      records: scenario.holdout.map((item) => item.record),
      policy: scenario.policy,
      expected: scenario.holdout.map((item) => item.expected),
      now: () => 0,
    });

  const initialExecutable = initialResult.value.resolved.executable;
  run.initial.evaluation = evaluateFinal(initialExecutable);
  run.finalState = run.initial.evaluation.state;

  // Semantic evidence: declared constraints + observations over imported and
  // revision-feedback records. Built once, before any holdout row exists here.
  const verificationRecords = [...imported, ...feedbackCases];
  const semanticContract = input.semantic
    ? buildSemanticContract({ contractId: `${scenario.scenarioId}-semantics`, declared: scenario.semanticSpec?.declared ?? [], profile: prepared.value.profile, records: verificationRecords })
    : undefined;
  const verify = (executable: MappingContract, evaluation: MappingEvaluation, records: readonly unknown[]) =>
    semanticContract
      ? verifySemantics({ contract: semanticContract, executable, report: evaluation.report, records, destinationSchema: scenario.destinationSchema })
      : undefined;
  if (semanticContract) {
    run.semanticContract = semanticContract;
    run.initial.semantic = verify(initialExecutable, run.initial.evaluation, verificationRecords);
    run.humanInterventions = {
      declaredConstraints: semanticContract.constraints.filter((item) => item.evidence.kind === "user-declared").length,
      constraintDisclosureApprovals: 0,
    };
  }

  let finalExecutable = initialExecutable;
  if (input.config === "D-nano-cloud-revision" && input.revise) {
    const contractHash = (await fingerprintCanonicalPayload(initialResult.value.converted.contract)).payloadHash;
    const projected = projectRevisionFeedback({
      runId: input.runId ?? "run-0000000000000000",
      baseDisclosureHash: payloadHash,
      baseDisclosure: base,
      aliasContract: initialResult.value.converted.contract,
      contractHash,
      origin: reply.origin,
      report: run.initial.evaluation.report,
      policy: scenario.policy,
      classified: run.initial.evaluation.rows,
      semantic:
        semanticContract && run.initial.semantic
          ? {
              report: run.initial.semantic,
              contract: semanticContract,
              aliasForPath: (path) => twin.bindings.aliasForPath(path),
              authorizedConstraintIds: input.semantic?.authorizeConstraints
                ? run.initial.semantic.results.flatMap((result) =>
                    result.constraintId && (result.status === "SEMANTIC_MISMATCH" || result.status === "SEMANTIC_POLICY_CONFLICT") ? [result.constraintId] : [],
                  )
                : [],
            }
          : undefined,
    });
    if (!projected.ok) {
      run.feedback = { ok: false, code: projected.code };
    } else {
      const built = buildRevisionPayload(base, projected.feedback);
      if (!built.ok) throw new Error(`Scenario ${scenario.scenarioId}: ${built.message}`);
      const schema = validateContract(built.payload);
      const leaks = findPrivateValueLeaks(built.payload, prepared.value.privateStrings);
      if (!schema.valid || leaks.length > 0) {
        throw new Error(`Scenario ${scenario.scenarioId}: revision payload failed the gate checks`);
      }
      const revisionFingerprint = await fingerprintCanonicalPayload(built.payload);
      run.feedback = { ok: true, findings: projected.feedback.findings.length + (projected.feedback.semanticFindings?.length ?? 0), hash: revisionFingerprint.payloadHash };
      run.feedbackVersion = projected.feedback.feedbackVersion;
      run.feedbackValue = projected.feedback;
      if (run.humanInterventions && (projected.feedback.approvedConstraints ?? []).length > 0) run.humanInterventions.constraintDisclosureApprovals = 1;
      run.revisionPromptCheck = checkOutboundPrompt(
        buildCloudPromptText(revisionFingerprint.canonicalJson, built.payload.schemaVersion),
        built.payload,
        privateStrings,
      );
      approvals += 1;
      const revisedReply = input.revise(built.payload);
      run.modelCalls += 1;
      if (revisedReply) {
        // The revision is validated against the ORIGINAL approved 1.1.0 disclosure.
        const revisedResult = acceptProposal({
          proposalText: revisedReply.text,
          proposal: undefined,
          disclosure: base,
          twin,
          origin: revisedReply.origin,
          mappingId: `${scenario.scenarioId}-revised`,
        });
        run.revised = stage(revisedResult);
        if (revisedResult.ok) {
          finalExecutable = revisedResult.value.resolved.executable;
          run.revised.evaluation = evaluateFinal(finalExecutable);
          run.comparison = compareEvaluations(run.initial.evaluation.rows, run.revised.evaluation.rows);
          run.operationChanges = diffContracts(initialResult.value.converted.contract, revisedResult.value.converted.contract);
          run.finalState = run.revised.evaluation.state;
          run.revised.semantic = verify(finalExecutable, run.revised.evaluation, verificationRecords);
        } else {
          run.finalState = "REVISION_FAILED";
        }
        if (semanticContract) {
          run.decision = decideRevision({
            revisedValid: revisedResult.ok,
            contractsEqual:
              revisedResult.ok && canonicalizeJson(revisedResult.value.converted.contract.operations) === canonicalizeJson(initialResult.value.converted.contract.operations),
            feedback: projected.feedback,
            initial: { evaluation: run.initial.evaluation, semantic: run.initial.semantic ?? null, executable: initialExecutable },
            revised:
              run.revised.evaluation && revisedResult.ok
                ? { evaluation: run.revised.evaluation, semantic: run.revised.semantic ?? null, executable: revisedResult.value.resolved.executable }
                : null,
          });
        }
      }
    }
  }
  run.approvals = approvals;

  // Holdout: only now that the final mapping is fixed. The semantic contract
  // was frozen above; applying it to holdout rows is scoring, not evidence.
  const holdoutRecords = scenario.holdout.map((item) => item.record);
  run.initial.holdout = evaluateHoldout(initialExecutable);
  run.initial.holdoutSemantic = verify(initialExecutable, run.initial.holdout, holdoutRecords);
  if (run.revised?.evaluation) {
    run.revised.holdout = evaluateHoldout(finalExecutable);
    run.revised.holdoutSemantic = verify(finalExecutable, run.revised.holdout, holdoutRecords);
    run.holdoutComparison = compareEvaluations(run.initial.holdout.rows, run.revised.holdout.rows);
    run.finalHoldout = run.revised.holdout.metrics;
  } else {
    run.finalHoldout = run.initial.holdout.metrics;
  }
  return run;
}
