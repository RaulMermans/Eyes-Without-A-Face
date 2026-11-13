import { useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { CloudIcon, GaugeIcon, LockIcon, SealIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, FieldToken, Panel, PanelHeader, StatusMark, ZoneLabel } from "../components/spectral.tsx";
import type { BlindRevisionFeedback, CloudDisclosurePayload, MappingContract } from "../domain/contracts/types.ts";
import { compareEvaluations, diffContracts, evaluateMapping, type EvaluationComparison, type MappingEvaluation } from "../evaluation/evaluate.ts";
import { InferenceError } from "../inference/errors.ts";
import { guidanceForFailure } from "../inference/failure-guidance.ts";
import { Guidance } from "../components/Guidance.tsx";
import { PendingOperation } from "../components/PendingOperation.tsx";
import { CLOUD_TIMEOUT_MS } from "../inference/retry-policy.ts";
import type { InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { describeNewInformation, projectRevisionFeedback } from "../revision/feedback.ts";
import { buildRevisionPayload } from "../revision/revision-payload.ts";
import {
  newRunId,
  nextPhase,
  reserveRevisionBudget,
  revisionBudgetKey,
  revisionBudgetUsed,
  TERMINAL_PHASES,
  type RevisionBlockCode,
  type RevisionEvent,
} from "../revision/run.ts";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import { COMPLETION_CRITERIA, STRICT_POLICY, type CompletionState, type OutcomeMetrics } from "../verification/outcomes.ts";
import { acceptProposal, type AcceptedProposal, type PreparedTwin } from "../workflow/pipeline.ts";
import { ORIGIN_LABELS } from "./result-kind.ts";
import { computeWorkspaceSemantics, type WorkspaceSemantics } from "./semantic-context.ts";
import { describeConstraint, evidenceLabel, SEMANTIC_LABEL, SEMANTIC_TONE } from "./semantic-labels.ts";
import { describeSemanticInformation, projectSemanticFeedback } from "../revision/semantic-feedback.ts";
import { decideRevision, REVISION_VERDICT_TEXT, type RevisionDecision } from "../revision/decision.ts";
import { compareSemanticReports, verifySemantics, type SemanticReport } from "../semantics/verify.ts";
import type { SemanticConstraint } from "../semantics/contract.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import { opNumber } from "./view-model.ts";
import type { ProposalState, RevisionRunState, WorkspaceState } from "./workspace-state.ts";

const STATE_TONE: Record<CompletionState, "pass" | "warn" | "fail"> = {
  VERIFIED: "pass",
  VERIFIED_WITH_EXCEPTIONS: "warn",
  PARTIALLY_VERIFIED: "fail",
  REVISION_FAILED: "fail",
  BLOCKED: "fail",
};

const METRIC_ROWS: ReadonlyArray<readonly [keyof OutcomeMetrics, string, string]> = [
  ["transformedValid", "Transformed", "Engine output, schema-valid, no rule used"],
  ["handledByApprovedRule", "Handled by approved rule", "Used a fallback the local policy approved"],
  ["quarantined", "Quarantined", "Held for manual review under policy — not a success"],
  ["unresolved", "Unresolved", "Refused by the engine, no policy covers it"],
  ["rejectedByPolicy", "Rejected by policy", "Output relied on an invented, unapproved value"],
  ["incorrect", "Incorrect vs ground truth", "Schema-valid but wrong (fictional fixtures only)"],
  ["correctlyHandled", "Correctly handled", "Matches ground truth, incl. expected quarantine"],
];

function originFor(simulated: boolean, kind: string): ProposalOrigin {
  return kind === "real-cloud" && !simulated ? "gemini-cloud" : "test-adapter";
}

function advance(run: RevisionRunState, event: RevisionEvent, patch: Partial<RevisionRunState> = {}): RevisionRunState {
  const phase = nextPhase(run.phase, event);
  return { ...run, ...patch, phase, history: [...run.history, phase] };
}

function block(run: RevisionRunState, code: RevisionBlockCode, message: string): RevisionRunState {
  return advance(run, "blocked", { blocked: { code, message } });
}

function describeOperation(operation: MappingContract["operations"][number] | undefined): string {
  if (!operation) return "—";
  const from = "from" in operation && operation.from !== undefined ? (Array.isArray(operation.from) ? operation.from.join(" + ") : operation.from) : "constant";
  const params = "params" in operation && operation.params ? ` ${JSON.stringify(operation.params)}` : "";
  return `${operation.op} ${from} → ${operation.to}${params}`;
}

/**
 * Sprint 7 Workstream F: the blind revision journey inside the Reality Check.
 * Every count shown here comes from the deterministic evaluator; Gemini's
 * rationale is displayed as model text, never as a result.
 */
export function BlindRevisionPanel({
  workspace,
  onChange,
  prepared,
  inference,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  inference: InferenceServices;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [showExact, setShowExact] = useState(false);
  const proposal = workspace.proposal;
  const accepted = proposal?.result.ok ? proposal.result.value : null;
  const report = workspace.report;
  const review = workspace.review;
  const source = workspace.source;
  const policy = workspace.scenario?.policy ?? STRICT_POLICY;
  const harness = typeof window !== "undefined" && Boolean(window.__EYES_WITHOUT_A_FACE_TEST__);
  const cloudAvailable = harness || inference.cloud.status().state === "configured";

  const eligible =
    Boolean(accepted && proposal && report && prepared && source) &&
    workspace.mappingChoice === "proposal" &&
    review?.preview.payload.schemaVersion === "1.1.0" &&
    review.status === "sent";

  const reserved = report && report.reservedTotal > 0 ? (workspace.reservedRecords ?? []) : [];
  const expected = workspace.scenario ? workspace.scenario.expected.slice(0, (source?.records.length ?? 0) + reserved.length) : undefined;

  // Cheap (tens of records): re-classified on every render from the current report inputs.
  const initialEvaluation: MappingEvaluation | null =
    eligible && accepted && source && prepared
      ? evaluateMapping({
          executable: accepted.resolved.executable,
          targetSchema: JSON.parse(workspace.destinationText) as unknown,
          bindings: prepared.twin.bindings,
          records: source.records,
          reserved,
          policy,
          expected,
        })
      : null;

  const run0 = workspace.revision;
  const derived = useMemo(
    () =>
      prepared && accepted && initialEvaluation && review
        ? deriveRevisionSemantics({ workspace, prepared, accepted, initialEvaluation, previewPayload: review.preview.payload, active: run0 && run0.initialProposal === proposal ? run0 : null })
        : null,
    [workspace, prepared, accepted, initialEvaluation, review, run0, proposal],
  );

  if (!eligible || !initialEvaluation || !accepted || !proposal || !review || !prepared || !source) {
    return (
      <Panel tone="plain" aria-labelledby="blind-revision-heading" data-testid="blind-revision">
        <PanelHeader id="blind-revision-heading" title="Blind revision" eyebrow="Evaluator → optimizer · one bounded cycle" zone="approval">
          After a validated cloud proposal has been run through the Reality Check, you can send Gemini an allowlisted summary of what failed and
          approve exactly one revised mapping. It needs a Gemini (or labeled simulated) proposal run as the active mapping.
        </PanelHeader>
        <p className="mt-3 text-xs text-mute" data-testid="blind-revision-unavailable">
          Not available yet: run the Reality Check on the validated proposal first.
        </p>
      </Panel>
    );
  }

  const run = workspace.revision;
  const stale = Boolean(run && run.initialProposal !== proposal);
  const active = run && !stale ? run : null;
  const scenario = workspace.scenario;
  const finalized = Boolean(active && (TERMINAL_PHASES.has(active.phase) || active.notice === "NO_FINDINGS"));

  async function prepare(): Promise<void> {
    if (!accepted || !proposal || !review || !prepared || !initialEvaluation) return;
    setBusy("prepare");
    setReviewed(false);
    setShowExact(false);
    const started = performance.now();
    try {
      const contractHash = (await fingerprintCanonicalPayload(accepted.converted.contract)).payloadHash;
      let next: RevisionRunState = {
        runId: newRunId(),
        phase: "INITIAL_PROPOSAL_VALIDATED",
        history: ["INITIAL_PROPOSAL_VALIDATED"],
        initialProposal: proposal,
        initialContractHash: contractHash,
        basePayloadHash: review.preview.payloadHash,
        initialEvaluation,
        feedback: null,
        preview: null,
        revised: null,
        revisedEvaluation: null,
        holdout: null,
        blocked: null,
        notice: null,
        decision: null,
      };
      next = advance(next, "initial-evaluated");
      if (revisionBudgetUsed(revisionBudgetKey(next.basePayloadHash, contractHash))) {
        next = block(next, "BUDGET_EXHAUSTED", "This mapping was already revised once in this browser session. Maximum one cloud revision per run.");
        onChange({ ...workspace, revision: next });
        return;
      }
      // Recomputed at click time from the same workspace state (pure), so the projection never depends on a stale render.
      const semanticsNow = computeWorkspaceSemantics(workspace, prepared, accepted.resolved.executable, initialEvaluation.report);
      const projected = projectRevisionFeedback({
        runId: next.runId,
        baseDisclosureHash: review.preview.payloadHash,
        baseDisclosure: review.preview.payload,
        aliasContract: accepted.converted.contract,
        contractHash,
        origin: proposal.origin,
        report: initialEvaluation.report,
        policy,
        classified: initialEvaluation.rows,
        semantic: semanticsNow
          ? {
              report: semanticsNow.report,
              contract: semanticsNow.contract,
              aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path),
              authorizedConstraintIds: workspace.revisionConstraintIds,
            }
          : undefined,
      });
      if (!projected.ok) {
        if (projected.code === "NO_FINDINGS") {
          next = { ...next, notice: "NO_FINDINGS" };
        } else {
          next = block(next, "FEEDBACK_INVALID", `${projected.code}: ${projected.issues.join(" ")}`);
        }
        recordWorkflowEvent({ kind: "revision-feedback", ok: false, code: projected.code, durationMs: performance.now() - started });
        onChange({ ...workspace, revision: next });
        return;
      }
      next = advance(next, "feedback-prepared", {
        feedback: {
          value: projected.feedback,
          newInformation: describeNewInformation(projected.feedback),
          excluded: projected.excluded,
          semanticWithheld: projected.semanticWithheld,
        },
      });
      const built = buildRevisionPayload(review.preview.payload, projected.feedback);
      if (!built.ok) {
        next = block(next, "FEEDBACK_INVALID", built.message);
        onChange({ ...workspace, revision: next });
        return;
      }
      try {
        const preview = await createDisclosurePreview(built.payload);
        next = advance(next, "request-previewed", { preview });
        recordWorkflowEvent({
          kind: "revision-feedback",
          ok: true,
          durationMs: performance.now() - started,
          payloadHash: preview.payloadHash,
          counts: { findings: projected.feedback.findings.length, bytes: preview.byteLength },
        });
        recordWorkflowEvent({
          kind: "semantic-feedback",
          ok: true,
          code: `FEEDBACK_${projected.feedback.feedbackVersion.replace(/\./g, "_")}`,
          payloadHash: preview.payloadHash,
          counts: {
            semanticFindings: projected.feedback.semanticFindings?.length ?? 0,
            constraints: projected.feedback.approvedConstraints?.length ?? 0,
            withheld: projected.semanticWithheld.length,
          },
        });
      } catch (caught) {
        const reason = caught instanceof DisclosureRejectedError ? caught.reason : "GATE_ERROR";
        next = block(next, "DISCLOSURE_REJECTED", `${reason}: the revision request failed the disclosure gate and cannot be sent.`);
        recordWorkflowEvent({ kind: "revision-feedback", ok: false, code: reason });
      }
      onChange({ ...workspace, revision: next });
    } finally {
      setBusy(null);
    }
  }

  async function approveAndRequest(): Promise<void> {
    if (!active || active.phase !== "REVISION_REVIEW_REQUIRED" || !active.preview || !reviewed || !prepared || !review) return;
    setBusy("send");
    const started = performance.now();
    const preview = active.preview;
    const approval = approveDisclosurePreview(preview);
    recordWorkflowEvent({ kind: "disclosure-approve", ok: true, payloadHash: preview.payloadHash, code: "REVISION" });
    let next = advance(active, "approved");
    try {
      reserveRevisionBudget(revisionBudgetKey(active.basePayloadHash, active.initialContractHash));
    } catch {
      next = block(next, "BUDGET_EXHAUSTED", "Maximum one cloud revision per run.");
      onChange({ ...workspace, revision: next });
      setBusy(null);
      return;
    }
    next = advance(next, "sent");
    onChange({ ...workspace, revision: next });
    try {
      const result = await submitApprovedCloudInference(inference.cloud, preview, approval, {
        requestId: preview.requestId,
        destinationKey: preview.destinationKey,
        purpose: "mapping-proposal",
      });
      const origin = originFor(result.provenance.simulated, result.provenance.resultKind);
      const text = result.structured !== undefined ? JSON.stringify(result.structured, null, 2) : result.text;
      // Validated against the ORIGINAL approved 1.1.0 disclosure: same aliases, same destination.
      const revisedResult = acceptProposal({
        proposal: result.structured,
        proposalText: text,
        disclosure: review.preview.payload,
        twin: prepared.twin,
        origin,
        mappingId: `revision-${active.runId.slice(4, 12)}`,
      });
      const revised: ProposalState = { origin, text, provenance: result.provenance, requestId: preview.requestId, result: revisedResult };
      next = advance(next, revisedResult.ok ? "revision-valid" : "revision-invalid", { revised });
      recordWorkflowEvent({
        kind: "revision-request",
        ok: revisedResult.ok,
        durationMs: performance.now() - started,
        payloadHash: preview.payloadHash,
        inferenceSource: result.provenance.actualSource,
        code: revisedResult.ok ? undefined : revisedResult.issues[0]?.code,
      });
    } catch (caught) {
      const code = caught instanceof DisclosureRejectedError ? caught.reason : caught instanceof InferenceError ? caught.code : "CLOUD_FAILED";
      const failureCode = caught instanceof DisclosureRejectedError ? "DISCLOSURE_REJECTED" : code;
      const guidance = guidanceForFailure({ code: failureCode, stage: "cloud-revision" });
      // The default text is guidance; the raw provider message stays local and collapsed.
      const message = `${code}: ${guidance.what} The revision request has been used and will not be retried.`;
      const detail = caught instanceof Error ? caught.message : String(caught);
      next = block(next, caught instanceof InferenceError && caught.code === "MISSING_CONFIG" ? "INFERENCE_UNAVAILABLE" : "INFERENCE_FAILED", message);
      next = { ...next, blocked: next.blocked ? { ...next.blocked, failureCode, detail } : null };
      recordWorkflowEvent({ kind: "revision-request", ok: false, durationMs: performance.now() - started, payloadHash: preview.payloadHash, code });
    } finally {
      setBusy(null);
      onChange({ ...workspace, revision: next });
    }
  }

  function decline(): void {
    if (!active || TERMINAL_PHASES.has(active.phase)) return;
    onChange({ ...workspace, revision: block(active, "DECLINED", "You declined the revision request. Nothing was sent; the initial mapping is final.") });
  }

  function runRevised(): void {
    if (!active?.revised?.result.ok || !source || !prepared) return;
    const evaluation = evaluateMapping({
      executable: active.revised.result.value.resolved.executable,
      targetSchema: JSON.parse(workspace.destinationText) as unknown,
      bindings: prepared.twin.bindings,
      records: source.records,
      reserved,
      policy,
      expected,
    });
    recordWorkflowEvent({ kind: "revision-evaluate", ok: evaluation.state === "VERIFIED", durationMs: evaluation.report.durationMs, counts: { total: evaluation.metrics.total } });
    const revisedSemantics = computeWorkspaceSemantics(workspace, prepared, active.revised.result.value.resolved.executable, evaluation.report);
    const decision =
      active.feedback && accepted
        ? decideRevision({
            revisedValid: true,
            contractsEqual: canonicalizeJson(active.revised.result.value.converted.contract.operations) === canonicalizeJson(accepted.converted.contract.operations),
            feedback: active.feedback.value,
            initial: {
              evaluation: active.initialEvaluation,
              semantic: computeWorkspaceSemantics(workspace, prepared, accepted.resolved.executable, active.initialEvaluation.report)?.report ?? null,
              executable: accepted.resolved.executable,
            },
            revised: { evaluation, semantic: revisedSemantics?.report ?? null, executable: active.revised.result.value.resolved.executable },
          })
        : null;
    if (decision) {
      recordWorkflowEvent({
        kind: "revision-decision",
        ok: decision.verdict === "ACCEPTED",
        code: decision.verdict,
        counts: { improved: decision.improvedRows, regressed: decision.regressedRows, semanticResolved: decision.semantic?.resolved ?? 0, semanticIntroduced: decision.semantic?.introduced ?? 0 },
      });
    }
    onChange({ ...workspace, revision: advance(active, "revised-evaluated", { revisedEvaluation: evaluation, decision }) });
  }

  function runHoldout(): void {
    if (!active || !scenario || !prepared || !finalized || !accepted) return;
    const target = JSON.parse(workspace.destinationText) as unknown;
    const evaluate = (executable: MappingContract) =>
      evaluateMapping({
        executable,
        targetSchema: target,
        bindings: prepared.twin.bindings,
        records: scenario.holdout.map((item) => item.record),
        policy,
        expected: scenario.holdout.map((item) => item.expected),
      });
    const initial = evaluate(accepted.resolved.executable);
    const revised = active.revisedEvaluation && active.revised?.result.ok ? evaluate(active.revised.result.value.resolved.executable) : null;
    recordWorkflowEvent({ kind: "holdout-evaluate", ok: true, counts: { total: initial.metrics.total, revised: revised ? 1 : 0 } });
    onChange({ ...workspace, revision: { ...active, holdout: { initial, revised } } });
  }


  const { initialSemantics, constraintCandidates, semanticFindingCount, revisedSemantics, holdoutSemantics } = derived ?? {
    initialSemantics: null,
    constraintCandidates: [],
    semanticFindingCount: 0,
    revisedSemantics: null,
    holdoutSemantics: null,
  };

  const comparison = active?.revisedEvaluation ? compareEvaluations(active.initialEvaluation.rows, active.revisedEvaluation.rows) : null;
  const holdoutComparison = active?.holdout?.revised ? compareEvaluations(active.holdout.initial.rows, active.holdout.revised.rows) : null;
  const changes = active?.revised?.result.ok ? diffContracts(accepted.converted.contract, active.revised.result.value.converted.contract) : [];

  return (
    <section className="space-y-5" aria-labelledby="blind-revision-heading" data-testid="blind-revision">
      <Panel tone="plain">
        <PanelHeader id="blind-revision-heading" title="Blind revision" eyebrow="Evaluator → optimizer · one bounded cycle" zone="verified" zoneText="Evaluated locally">
          The local evaluator classified every record under the acceptance policy below. Gemini can be asked to revise the mapping once, using only
          an allowlisted summary of these findings. It never sees the records that failed.
        </PanelHeader>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <OutcomeSummary title="Initial mapping under policy" evaluation={initialEvaluation} testId="initial-outcomes" />
          <div className="space-y-2 text-xs">
            <p>
              <span className="text-mute">Acceptance policy:</span>{" "}
              <span className="font-mono" data-testid="policy-id">{policy.policyId}@{policy.policyVersion}</span>{" "}
              {workspace.scenario ? "(scenario fixture, local)" : "(strict default for your own data)"}
            </p>
            <p className="text-mute">{policy.description}</p>
            <p className="text-mute">
              Quarantine is never counted as a transformation. A fallback or default is accepted only if this policy lists it; otherwise the record is
              rejected by policy. Gemini does not set or see this policy beyond its approved fallbacks.
            </p>
            <p>
              <span className="text-mute">Revision budget:</span>{" "}
              <span data-testid="revision-budget">
                {active && active.history.includes("REVISION_SENT") ? "0 of 1 remaining (used)" : "1 of 1 remaining"}
              </span>
            </p>
          </div>
        </div>
        {semanticFindingCount > 0 ? (
          <fieldset className="mt-4 border border-rule bg-bone p-3 text-sm" data-testid="semantic-feedback-options">
            <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Semantic feedback</legend>
            <p className="text-xs text-mute">
              {semanticFindingCount} semantic finding{semanticFindingCount === 1 ? "" : "s"} will be included as fixed codes with operation numbers and coarse counts.
              A finding alone tells Gemini <em>that</em> the meaning is wrong, not what it should be. You may also disclose the trusted constraint
              behind a finding. Nothing below is selected unless you select it.
            </p>
            <ConstraintAuthorization
              candidates={constraintCandidates}
              selected={workspace.revisionConstraintIds}
              locked={Boolean(active?.history.includes("REVISION_SENT"))}
              onToggle={(id, checked) => onChange(withConstraintToggled(workspace, id, checked))}
            />
          </fieldset>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void prepare()}
            disabled={Boolean(busy) || Boolean(active && active.history.includes("REVISION_SENT")) || Boolean(active && TERMINAL_PHASES.has(active.phase))}
            data-testid="prepare-safe-revision"
          >
            <LockIcon size={14} /> Prepare Safe Revision
          </Button>
          <span className="text-xs text-mute">Builds the candidate feedback locally. No network request.</span>
        </div>
        {busy === "prepare" ? <LoadingState label="Projecting allowlisted feedback…" /> : null}
        {stale ? (
          <p className="mt-3 text-xs text-warn" data-testid="revision-stale">
            The mapping changed after the last revision run, so that run was discarded. Prepare a new one.
          </p>
        ) : null}
        {active?.notice === "NO_FINDINGS" ? (
          <p className="mt-3 text-sm" data-testid="revision-no-findings">
            No allowlisted finding to send. The initial mapping is final; nothing is disclosed.
          </p>
        ) : null}
        {active?.blocked ? (
          <div className="mt-3" data-testid="revision-blocked" data-code={active.blocked.code} data-failure={active.blocked.failureCode}>
            {active.blocked.failureCode ? (
              <RevisionFailure failureCode={active.blocked.failureCode} code={active.blocked.code} detail={active.blocked.detail ?? null} />
            ) : (
              <ErrorBanner title={`Blind revision stopped · ${active.blocked.code}`}>{active.blocked.message}</ErrorBanner>
            )}
          </div>
        ) : null}
        {active ? (
          <p className="mt-3 font-mono text-[11px] text-mute" data-testid="revision-phase" data-phase={active.phase}>
            {active.runId} · {active.history.join(" → ")}
          </p>
        ) : null}
      </Panel>

      {active?.feedback && active.preview && active.phase !== "INITIAL_EVALUATION_COMPLETE" ? (
        <Panel tone="cloud" aria-labelledby="revision-review-heading" data-testid="revision-review">
          <PanelHeader id="revision-review-heading" title="Review the revision request" eyebrow="Second disclosure · needs your approval" zone="cloud">
            This is everything Gemini would receive in addition to the twin it already saw. It is bound to its SHA-256, this run, the current
            mapping, and one request id. Any change upstream discards it.
          </PanelHeader>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <section aria-labelledby="revision-contains" className="min-w-0">
              <h4 id="revision-contains" className="flex items-center gap-1.5 font-semibold">
                <CloudIcon size={14} /> Newly disclosed
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm" data-testid="revision-new-information">
                {active.feedback.newInformation.map((line) => (
                  <li key={line} className="border-l-2 border-gold-ink/60 pl-2 [overflow-wrap:anywhere]">{line}</li>
                ))}
              </ul>
              <DisclosureLedger base={review.preview.payload} feedback={active.feedback.value} />
              <p className="mt-3 text-xs text-mute" data-testid="revision-cumulative">
                Cumulative: the approved twin (payload {review.preview.payloadHash.slice(0, 12)}…) is repeated byte-for-byte, with no new fields,
                examples, or destination details. This would be cloud request 2 of at most 2 for this mapping.
              </p>
            </section>
            <section aria-labelledby="revision-private" className="min-w-0">
              <h4 id="revision-private" className="flex items-center gap-1.5 font-semibold">
                <LockIcon size={14} /> Stays private
              </h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute" data-testid="revision-stays-private">
                <li>Every record value, including the {initialEvaluation.metrics.total - initialEvaluation.metrics.transformedValid} that did not transform cleanly</li>
                <li>Original field names and the alias bindings</li>
                <li>Engine messages and local diagnostics</li>
                <li>Exact failure counts above four (coarse buckets: 1, 2–4, 5+)</li>
                <li>Any on-device (Nano) rationale</li>
                <li>Semantic evidence: which records contradicted a constraint, and constraints you did not select</li>
                {active.feedback.excluded.length > 0 ? (
                  <li data-testid="revision-excluded">
                    Not allowlisted, withheld: {active.feedback.excluded.map((item) => `${item.code} ×${item.rows}`).join(", ")}
                  </li>
                ) : null}
              </ul>
              <p className="mt-3 text-xs text-mute" data-testid="revision-limitations">
                Limits: Gemini cannot see the failing values, so it cannot invent a missing category or repair malformed data. The engine stops at
                the first failing operation per record, so a second defect in the same record may only appear after the revision.
              </p>
            </section>
          </div>
          <div className="mt-4">
            <Button size="sm" variant="ghost" aria-expanded={showExact} onClick={() => setShowExact((value) => !value)} data-testid="revision-exact-toggle">
              {showExact ? "Hide" : "Show"} the exact revision request
            </Button>
            {showExact ? (
              <div className="mt-2 space-y-2 text-xs" data-testid="revision-exact">
                <p className="font-mono [overflow-wrap:anywhere]">
                  request {active.preview.requestId} · schema {active.preview.payload.schemaVersion} · {active.preview.byteLength} bytes · SHA-256{" "}
                  <span data-testid="revision-hash">{active.preview.payloadHash}</span>
                </p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap border border-rule bg-bone p-2 font-mono text-[11px]" data-testid="revision-prompt">
                  {active.preview.outboundPrompt}
                </pre>
              </div>
            ) : null}
          </div>
          {active.phase === "REVISION_REVIEW_REQUIRED" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-violet" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} data-testid="revision-reviewed" />
                I reviewed exactly what this request discloses
              </label>
              <Button variant="approve" onClick={() => void approveAndRequest()} disabled={!reviewed || Boolean(busy) || !cloudAvailable} data-testid="approve-request-revision">
                <SealIcon size={14} /> Approve &amp; Request Revision
              </Button>
              <Button variant="ghost" onClick={decline} disabled={Boolean(busy)} data-testid="decline-revision">
                Decline
              </Button>
              {!cloudAvailable ? <span className="text-xs text-mute">Cloud inference is not configured; nothing can be sent.</span> : null}
            </div>
          ) : (
            <p className="mt-4 border-t border-rule pt-3 text-xs text-mute" data-testid="revision-approval-state">
              {active.history.includes("REVISION_SENT") ? "Approved and used. This approval cannot authorize another request." : "Not sent."}
            </p>
          )}
          {busy === "send" ? (
            <div className="mt-3">
              <PendingOperation step="Waiting for the single revision response (no automatic retry)" where="cloud" limitSeconds={Math.round(CLOUD_TIMEOUT_MS / 1000)} testId="revision-pending" />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {active?.revised ? (
        <Panel tone="plain" aria-labelledby="revised-heading" data-testid="revised-mapping">
          <PanelHeader id="revised-heading" title="Revised mapping" eyebrow="Proposal 2 of 2" zone={active.revised.result.ok ? "verified" : "cloud"}>
            Validated by the same converter and alias resolver as the first proposal, against the original approved disclosure. Nothing was repaired.
          </PanelHeader>
          <p className="mt-3 text-sm">
            <span data-testid="revised-origin" className="font-medium">{ORIGIN_LABELS[active.revised.origin]}</span>
            {active.revised.provenance ? (
              <span className="font-mono text-xs text-mute" data-testid="revised-provenance">
                {" "}· source={active.revised.provenance.actualSource} mode={active.revised.provenance.requestedMode} simulated={String(active.revised.provenance.simulated)}{" "}
                {active.revised.provenance.durationMs}ms
              </span>
            ) : null}
          </p>
          <p className="mt-1" data-testid="revised-status" data-ok={String(active.revised.result.ok)}>
            {active.revised.result.ok ? (
              <StatusMark status="pass">Valid · {active.revised.result.value.converted.contract.operations.length} operations · aliases resolved locally</StatusMark>
            ) : (
              <StatusMark status="fail">Rejected at {active.revised.result.stage}: {active.revised.result.issues.map((issue) => issue.code).join(", ")} — not repaired, not executed</StatusMark>
            )}
          </p>
          {active.revised.result.ok ? (
            <>
              <ol className="mt-3 space-y-1.5 text-sm" data-testid="revised-operations">
                {changes.map((change) => {
                  const before = change.beforeNumber ? accepted.converted.contract.operations[change.beforeNumber - 1] : undefined;
                  const after = change.afterNumber && active.revised?.result.ok ? active.revised.result.value.converted.contract.operations[change.afterNumber - 1] : undefined;
                  return (
                    <li
                      key={change.to}
                      className={`border p-2 ${change.change === "unchanged" ? "border-rule bg-panel" : "border-gold-ink/60 border-l-4 border-l-gold-ink bg-gold/5"}`}
                      data-testid={`revised-op-${change.to}`}
                      data-change={change.change}
                    >
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-mute">{change.afterNumber ? opNumber(change.afterNumber - 1) : "—"}</span>
                        <FieldToken kind="destination">{change.to}</FieldToken>
                        <span className="font-mono text-[11px] uppercase">{change.change}</span>
                      </p>
                      {change.change === "unchanged" ? (
                        <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">{describeOperation(after)}</p>
                      ) : (
                        <div className="mt-1 grid gap-1 font-mono text-xs [overflow-wrap:anywhere]">
                          <p className="text-mute">before: {describeOperation(before)}</p>
                          <p>after: {describeOperation(after)}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <Disclosure summary="Revised proposal JSON (alias-level, as received)" className="mt-3 text-xs">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap border border-rule bg-bone p-2 font-mono text-[11px]" data-testid="revised-proposal-json">
                  {active.revised.text}
                </pre>
              </Disclosure>
              <Disclosure summary="Gemini's rationale (model text, not evidence)" className="mt-3 text-xs">
                <p className="text-mute [overflow-wrap:anywhere]" data-testid="revised-rationale">{active.revised.result.value.converted.rationale}</p>
              </Disclosure>
              {active.phase === "REVISION_VALIDATED" ? (
                <Button className="mt-4" variant="primary" onClick={runRevised} data-testid="run-revised-reality-check">
                  <GaugeIcon /> Run Revised Reality Check
                </Button>
              ) : null}
            </>
          ) : (
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap border border-rule bg-bone p-2 font-mono text-[11px]">{active.revised.text}</pre>
          )}
        </Panel>
      ) : null}

      {active && comparison && active.revisedEvaluation ? (
        <ComparisonPanel
          title="Before / after · revision-feedback evaluation"
          note="Imported records and revision-feedback cases. The feedback was built from these, so a gain here is expected but not independent."
          before={active.initialEvaluation}
          after={active.revisedEvaluation}
          comparison={comparison}
          testId="revision-comparison"
          semantic={semanticDelta(initialSemantics?.report, revisedSemantics?.report)}
        />
      ) : null}

      {active?.decision ? <DecisionCard decision={active.decision} before={initialSemantics?.report ?? null} after={revisedSemantics?.report ?? null} /> : null}

      {active && finalized && scenario ? (
        <Panel tone="private" aria-labelledby="holdout-heading" data-testid="holdout">
          <PanelHeader id="holdout-heading" title="Final holdout" eyebrow="Independent evaluation" zone="verified">
            {scenario.holdout.length} fictional holdout cases that were never profiled, disclosed, or used for feedback. They run only now, against
            both mapping versions, with the same engine and policy.
          </PanelHeader>
          {active.holdout ? null : (
            <Button className="mt-4" variant="primary" onClick={runHoldout} data-testid="run-holdout">
              <GaugeIcon /> Run final holdout evaluation
            </Button>
          )}
          {active.holdout && !active.holdout.revised ? (
            <div className="mt-4">
              <OutcomeSummary title="Initial mapping on holdout (no revised mapping)" evaluation={active.holdout.initial} testId="holdout-initial" />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {active?.holdout?.revised && holdoutComparison ? (
        <ComparisonPanel
          title="Before / after · holdout (inspected since Sprint 8)"
          note="Cases the revision never saw. This is the measure of whether the integration genuinely improved."
          before={active.holdout.initial}
          after={active.holdout.revised}
          comparison={holdoutComparison}
          testId="holdout-comparison"
          semantic={semanticDelta(holdoutSemantics?.before, holdoutSemantics?.after)}
        />
      ) : null}
    </section>
  );
}

function OutcomeSummary({ title, evaluation, testId }: { title: string; evaluation: MappingEvaluation; testId: string }) {
  const m = evaluation.metrics;
  return (
    <div className="border border-rule bg-bone p-3" data-testid={testId} data-state={evaluation.state}>
      <Eyebrow>{title}</Eyebrow>
      <p className="mt-1">
        <StatusMark status={STATE_TONE[evaluation.state]}>
          <span data-testid={`${testId}-state`}>{evaluation.state}</span>
        </StatusMark>
      </p>
      <p className="mt-1 text-xs text-mute">{COMPLETION_CRITERIA[evaluation.state]}</p>
      <p className="mt-2 font-mono text-xs" data-testid={`${testId}-counts`}>
        {m.transformedValid} transformed · {m.handledByApprovedRule} by approved rule · {m.quarantined} quarantined · {m.unresolved} unresolved ·{" "}
        {m.rejectedByPolicy} rejected by policy{m.groundTruth ? ` · ${m.incorrect} incorrect · ${m.correctlyHandled}/${m.total} correctly handled` : ` · of ${m.total}`}
      </p>
    </div>
  );
}

function ComparisonPanel({
  title,
  note,
  before,
  after,
  comparison,
  testId,
  semantic,
}: {
  title: string;
  note: string;
  before: MappingEvaluation;
  after: MappingEvaluation;
  comparison: EvaluationComparison;
  testId: string;
  semantic?: { before: number; after: number; resolved: number; introduced: number } | null;
}) {
  const rows = METRIC_ROWS.filter(([key]) => before.metrics.groundTruth || (key !== "incorrect" && key !== "correctlyHandled"));
  const verdict = comparison.strictImprovement ? "improved, no regressions" : comparison.improved > 0 ? "mixed: improvements and regressions" : comparison.regressed > 0 ? "regressed" : "no measurable change";
  return (
    <section className="on-ink border border-ink-3 bg-void p-5 text-ink" aria-label={title} data-testid={testId} data-verdict={verdict}>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-text">{title} · deterministic</p>
      <p className="mt-2 font-display text-3xl leading-tight" role="status" data-testid={`${testId}-verdict`}>
        {verdict}
      </p>
      <p className="mt-1 text-sm text-ink-text">{note}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-text">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">Outcome</th>
              <th scope="col" className="py-1 pr-3 font-normal">Initial</th>
              <th scope="col" className="py-1 pr-3 font-normal">Revised</th>
              <th scope="col" className="py-1 font-normal">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label, explanation]) => {
              const a = before.metrics[key] as number | null;
              const b = after.metrics[key] as number | null;
              const delta = a !== null && b !== null ? b - a : null;
              return (
                <tr key={key} className="border-t border-ink-3" data-testid={`${testId}-${key}`}>
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    {label}
                    <span className="block text-[11px] text-ink-text">{explanation}</span>
                  </th>
                  <td className="py-1.5 pr-3 font-mono" data-testid={`${testId}-${key}-before`}>{a ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono" data-testid={`${testId}-${key}-after`}>{b ?? "—"}</td>
                  <td className="py-1.5 font-mono">{delta === null ? "—" : delta > 0 ? `+${delta}` : String(delta)}</td>
                </tr>
              );
            })}
            {semantic ? (
              <tr className="border-t border-ink-3" data-testid={`${testId}-semantic`}>
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  Semantic violations
                  <span className="block text-[11px] text-ink-text">
                    Records contradicting a trusted constraint (local verifier) · {semantic.resolved} resolved · {semantic.introduced} new
                  </span>
                </th>
                <td className="py-1.5 pr-3 font-mono" data-testid={`${testId}-semantic-before`}>{semantic.before}</td>
                <td className="py-1.5 pr-3 font-mono" data-testid={`${testId}-semantic-after`}>{semantic.after}</td>
                <td className="py-1.5 font-mono">{semantic.after - semantic.before > 0 ? `+${semantic.after - semantic.before}` : String(semantic.after - semantic.before)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-xs text-ink-text" data-testid={`${testId}-cases`}>
        {comparison.improved} improved · {comparison.regressed} regressed · {comparison.unchanged} unchanged · state {before.state} → {after.state}
      </p>
      {comparison.cases.some((item) => item.change !== "unchanged") ? (
        <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          {comparison.cases
            .filter((item) => item.change !== "unchanged")
            .map((item) => (
              <li key={item.index} className={item.change === "improved" ? "text-cyan" : "text-fail"}>
                {item.set === "reserved" ? `Feedback case ${item.setIndex}` : `Case ${item.setIndex}`}: {item.before} → {item.after} ({item.change})
              </li>
            ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[11px] text-ink-text">
        <ZoneLabel zone="verified" className="border-ink-text text-ink-text">Counts from the local evaluator · not from the model</ZoneLabel>
      </p>
    </section>
  );
}

/** Request 1 vs request 2: what the cloud already holds and what this request adds. Counts only. */
function DisclosureLedger({ base, feedback }: { base: CloudDisclosurePayload; feedback: BlindRevisionFeedback }) {
  const labels = base.fields.reduce((sum, field) => sum + (field.enumValues?.length ?? 0), 0);
  const approved = new Set(base.fields.flatMap((field) => field.enumValues ?? []));
  const targetValues = new Set((base.target?.fields ?? []).flatMap((field) => field.enumValues ?? []));
  const constraints = feedback.approvedConstraints ?? [];
  // Every label a constraint repeats must already be approved; count any that is not (must be 0).
  const newLabels = constraints.flatMap((constraint) =>
    constraint.kind === "date-order"
      ? []
      : [
          ...(constraint.kind === "category-order" ? constraint.sourceOrder : Object.keys(constraint.map)).filter((label) => !approved.has(label)),
          ...(constraint.kind === "category-order" ? constraint.targetOrder : Object.values(constraint.map)).filter((value) => !targetValues.has(value)),
        ],
  ).length;
  return (
    <table className="mt-3 w-full text-left text-xs" data-testid="revision-ledger">
      <caption className="mb-1 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-mute">Cumulative disclosure</caption>
      <thead className="text-mute">
        <tr>
          <th scope="col" className="py-1 pr-2 font-normal">Item</th>
          <th scope="col" className="py-1 pr-2 font-normal">Request 1 (sent)</th>
          <th scope="col" className="py-1 font-normal">Request 2 adds</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Twin fields · approved labels</th><td>{base.fields.length} · {labels}</td><td data-testid="ledger-new-labels">0 · {newLabels}</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Synthetic examples</th><td>{base.syntheticExamples.length}</td><td>0</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Previous mapping</th><td>—</td><td>{feedback.previousMapping.operations.length} operations</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Engine / policy findings</th><td>—</td><td data-testid="ledger-findings">{feedback.findings.length}</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Semantic findings</th><td>—</td><td data-testid="ledger-semantic-findings">{feedback.semanticFindings?.length ?? 0}</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Semantic constraints (you selected)</th><td>—</td><td data-testid="ledger-constraints">{constraints.length}</td></tr>
        <tr className="border-t border-rule"><th scope="row" className="py-1 pr-2 font-normal">Feedback version</th><td>—</td><td data-testid="ledger-version">{feedback.feedbackVersion}</td></tr>
      </tbody>
    </table>
  );
}

/** A failed revision request, explained as what happened / why / what next (Sprint 9, C4). */
function RevisionFailure({ failureCode, code, detail }: { failureCode: string; code: string; detail: string | null }) {
  const guidance = guidanceForFailure({ code: failureCode, stage: "cloud-revision" });
  return (
    <Guidance
      code={`${code} · ${failureCode}`}
      title={`Blind revision stopped · ${guidance.title}`}
      what={guidance.what}
      why={guidance.why}
      next={guidance.next}
      detail={detail}
      testId="revision-failure"
    />
  );
}

/** Deterministic recommendation for the revised mapping. Never adopted automatically. */
function DecisionCard({ decision, before, after }: { decision: RevisionDecision; before: SemanticReport | null; after: SemanticReport | null }) {
  const tone = decision.verdict === "ACCEPTED" ? "pass" : decision.verdict === "HUMAN_REVIEW_REQUIRED" || decision.verdict === "UNCHANGED" || decision.verdict === "INSUFFICIENT_INFORMATION" || decision.verdict === "NO_IMPROVEMENT" ? "warn" : "fail";
  return (
    <Panel tone="plain" aria-labelledby="decision-heading" data-testid="revision-decision" data-verdict={decision.verdict}>
      <PanelHeader id="decision-heading" title="Local acceptance check" eyebrow="Deterministic · no ground truth · no model text" zone="verified">
        Computed from outcome classes and the semantic verifier only, exactly as it would be for your own data. The initial and revised mappings are
        both kept; nothing is promoted automatically.
      </PanelHeader>
      <p className="mt-3">
        <StatusMark status={tone}>
          <span data-testid="revision-decision-verdict">{decision.verdict}</span>
        </StatusMark>
      </p>
      <p className="mt-1 text-sm">{REVISION_VERDICT_TEXT[decision.verdict]}</p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-mute">Records improved / regressed</dt>
        <dd className="font-mono" data-testid="revision-decision-rows">{decision.improvedRows} / {decision.regressedRows}</dd>
        <dt className="text-mute">Previously valid operations broken</dt>
        <dd className="font-mono" data-testid="revision-decision-operation-regressions">{decision.operationRegressions}</dd>
        <dt className="text-mute">Clean transformations before → after</dt>
        <dd className="font-mono" data-testid="revision-decision-clean">{decision.cleanTransformations.before} → {decision.cleanTransformations.after}</dd>
        <dt className="text-mute">Semantic violations resolved / new</dt>
        <dd className="font-mono" data-testid="revision-decision-semantic">{decision.semantic ? `${decision.semantic.resolved} / ${decision.semantic.introduced}` : "—"}</dd>
        <dt className="text-mute">Meaning before → after</dt>
        <dd>
          {before ? <StatusMark status={SEMANTIC_TONE[before.overall]}>{SEMANTIC_LABEL[before.overall]}</StatusMark> : "—"} →{" "}
          {after ? <StatusMark status={SEMANTIC_TONE[after.overall]}>{SEMANTIC_LABEL[after.overall]}</StatusMark> : "—"}
        </dd>
      </dl>
    </Panel>
  );
}

function semanticDelta(before: SemanticReport | null | undefined, after: SemanticReport | null | undefined) {
  if (!before || !after) return null;
  const delta = compareSemanticReports(before, after);
  return { before: before.violatingRows.length, after: after.violatingRows.length, resolved: delta.resolved, introduced: delta.introduced };
}

/**
 * Authorizing or withdrawing a constraint changes the feedback projection, so
 * a prepared (unsent) request and its approval are discarded. A used run is kept.
 */
function withConstraintToggled(workspace: WorkspaceState, id: string, checked: boolean): WorkspaceState {
  const ids = new Set(workspace.revisionConstraintIds);
  if (checked) ids.add(id);
  else ids.delete(id);
  const run = workspace.revision;
  const keep = run && run.history.includes("REVISION_SENT") ? run : null;
  return { ...workspace, revisionConstraintIds: [...ids].sort(), revision: keep };
}

interface ConstraintCandidate {
  constraint: SemanticConstraint;
  line: string | null;
  withheld: string | null;
}

/** Explicit, per-constraint opt-in. Nothing is selected by default; a new Prepare is required after any change. */
function ConstraintAuthorization({
  candidates,
  selected,
  locked,
  onToggle,
}: {
  candidates: readonly ConstraintCandidate[];
  selected: readonly string[];
  locked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (candidates.length === 0) {
    return <p className="mt-2 text-xs" data-testid="semantic-no-constraint">No trusted constraint can be disclosed for these findings.</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {candidates.map(({ constraint, line, withheld }) => (
        <li key={constraint.id} className="flex items-start gap-2">
          <input
            id={`authorize-${constraint.id}`}
            type="checkbox"
            className="mt-1 size-4 accent-violet"
            checked={selected.includes(constraint.id)}
            disabled={Boolean(withheld) || locked}
            onChange={(event) => onToggle(constraint.id, event.target.checked)}
            data-testid={`authorize-constraint-${constraint.id}`}
          />
          <label htmlFor={`authorize-${constraint.id}`} className="min-w-0">
            <span className="font-medium">Also disclose:</span>{" "}
            <span className="font-mono text-xs [overflow-wrap:anywhere]" data-testid={`authorize-line-${constraint.id}`}>
              {line?.replace(/^Approved semantic constraint · /, "") ?? `${describeConstraint(constraint)} (cannot be expressed with approved vocabulary: ${withheld ?? "withheld"})`}
            </span>
            <span className="block text-[11px] text-mute">{evidenceLabel(constraint)} · uses only aliases, labels and destination values Gemini already received</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * All semantic views of the revision journey, derived from workspace state in
 * one pure call (never stored). Holdout semantics reuse the contract built
 * from imported + reserved records; holdout rows are scored, never evidence.
 */
function deriveRevisionSemantics(input: {
  workspace: WorkspaceState;
  prepared: PreparedTwin;
  accepted: AcceptedProposal;
  initialEvaluation: MappingEvaluation;
  previewPayload: CloudDisclosurePayload;
  active: RevisionRunState | null;
}): {
  initialSemantics: WorkspaceSemantics | null;
  constraintCandidates: ConstraintCandidate[];
  semanticFindingCount: number;
  revisedSemantics: WorkspaceSemantics | null;
  holdoutSemantics: { before: SemanticReport | null; after: SemanticReport | null } | null;
} {
  const { workspace, prepared, accepted, initialEvaluation, active } = input;
  const initialSemantics = computeWorkspaceSemantics(workspace, prepared, accepted.resolved.executable, initialEvaluation.report);
  const constraintCandidates: ConstraintCandidate[] = initialSemantics
    ? initialSemantics.contract.constraints.flatMap((constraint) => {
        if (constraint.trust !== "trusted") return [];
        const result = initialSemantics.report.results.find((item) => item.constraintId === constraint.id);
        if (!result || (result.status !== "SEMANTIC_MISMATCH" && result.status !== "SEMANTIC_POLICY_CONFLICT")) return [];
        const single = projectSemanticFeedback(
          {
            report: initialSemantics.report,
            contract: initialSemantics.contract,
            aliasForPath: (path) => prepared.twin.bindings.aliasForPath(path),
            authorizedConstraintIds: [constraint.id],
          },
          input.previewPayload,
          accepted.converted.contract,
        );
        const line = describeSemanticInformation([], single.constraints)[0] ?? null;
        const withheld = single.withheld.find((item) => item.constraintId === constraint.id)?.reason ?? null;
        return [{ constraint, line, withheld }];
      })
    : [];
  const semanticFindingCount = initialSemantics
    ? initialSemantics.report.results.filter((result) => result.status === "SEMANTIC_MISMATCH" || result.status === "SEMANTIC_POLICY_CONFLICT" || result.status === "SEMANTIC_AMBIGUOUS").length
    : 0;
  const revisedSemantics =
    active?.revisedEvaluation && active.revised?.result.ok
      ? computeWorkspaceSemantics(workspace, prepared, active.revised.result.value.resolved.executable, active.revisedEvaluation.report)
      : null;
  const scenario = workspace.scenario;
  const scoreHoldout = (executable: MappingContract, evaluation: MappingEvaluation): SemanticReport | null =>
    initialSemantics && scenario
      ? verifySemantics({
          contract: initialSemantics.contract,
          executable,
          report: evaluation.report,
          records: scenario.holdout.map((item) => item.record),
          destinationSchema: JSON.parse(workspace.destinationText) as unknown,
        })
      : null;
  const holdoutSemantics =
    active?.holdout && active.holdout.revised && active.revised?.result.ok
      ? {
          before: scoreHoldout(accepted.resolved.executable, active.holdout.initial),
          after: scoreHoldout(active.revised.result.value.resolved.executable, active.holdout.revised),
        }
      : null;
  return { initialSemantics, constraintCandidates, semanticFindingCount, revisedSemantics, holdoutSemantics };
}
