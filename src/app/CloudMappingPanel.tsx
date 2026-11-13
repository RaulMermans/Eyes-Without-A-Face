import { useRef, useState } from "react";
import { Guidance } from "../components/Guidance.tsx";
import { PendingOperation } from "../components/PendingOperation.tsx";
import { guidanceForFailure } from "../inference/failure-guidance.ts";
import { CLOUD_TIMEOUT_MS } from "../inference/retry-policy.ts";
import { createDisclosurePreview } from "../twin/authorization.ts";
import { buildDisclosureDraft } from "../workflow/pipeline.ts";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, CloudIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, Panel, PanelHeader, StatusMark } from "../components/spectral.tsx";
import { liveInferenceLabel } from "../config/env.ts";
import { InferenceError } from "../inference/errors.ts";
import type { InferenceResult, InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { DisclosureRejectedError } from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import { acceptProposal, type PreparedTwin } from "../workflow/pipeline.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { IntegrationStudio, ProposalPipeline } from "./IntegrationStudio.tsx";
import { buildConnections } from "./mapping-connections.ts";
import { MappingPanel } from "./MappingPanel.tsx";
import { ORIGIN_LABELS } from "./result-kind.ts";
import { TrustLedger } from "./TrustLedger.tsx";
import type { ProposalState, WorkspaceState } from "./workspace-state.ts";

function originFor(result: InferenceResult): ProposalOrigin {
  return result.provenance.resultKind === "real-cloud" && !result.provenance.simulated ? "gemini-cloud" : "test-adapter";
}

export function CloudMappingPanel({
  workspace,
  onChange,
  prepared,
  inference,
  focusOperation,
  onFocusOperation,
  onContinue,
  onReviewFresh,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  inference: InferenceServices;
  focusOperation: number | null;
  onFocusOperation: (index: number) => void;
  onContinue: () => void;
  /** Navigate to Disclosure Review after a fresh request was prepared. */
  onReviewFresh?: () => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  /** Identifies the request the UI is waiting for; a stopped or superseded request's answer is discarded. */
  const waitToken = useRef(0);
  const editorRef = useRef<HTMLDetailsElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);
  const review = workspace.review;
  const proposal = workspace.proposal;
  const harness = typeof window !== "undefined" && Boolean(window.__EYES_WITHOUT_A_FACE_TEST__);
  const cloudStatus = inference.cloud.status();
  // Never spend an approval on a request that cannot be dispatched. The gate
  // and adapter still refuse independently (defense in depth).
  const cloudAvailable = harness || cloudStatus.state === "configured";
  const canSend = cloudAvailable && Boolean(review && review.status === "approved" && review.approval && prepared) && !busy;

  function evaluate(input: { structured: unknown; text: string; origin: ProposalOrigin; requestId: string; provenance: ProposalState["provenance"] }): ProposalState | null {
    if (!prepared || !review) return null;
    const started = performance.now();
    const result = acceptProposal({
      proposal: input.structured,
      proposalText: input.text,
      disclosure: review.preview.payload,
      twin: prepared.twin,
      origin: input.origin,
      mappingId: `proposal-${input.requestId.slice(0, 8)}`,
    });
    recordWorkflowEvent({
      kind: "proposal-validate",
      ok: result.ok || result.stage === "resolve",
      durationMs: performance.now() - started,
      code: result.ok ? undefined : result.issues[0]?.code,
    });
    if (result.ok || result.stage === "resolve") {
      recordWorkflowEvent({ kind: "alias-resolve", ok: result.ok, code: result.ok ? undefined : result.issues[0]?.code });
    }
    return { origin: input.origin, text: input.text, provenance: input.provenance, requestId: input.requestId, result };
  }

  async function send(): Promise<void> {
    if (!review || !review.approval || !prepared) return;
    setBusy(true);
    const token = ++waitToken.current;
    const started = performance.now();
    const preview = review.preview;
    const approval = review.approval;
    // The approval is single-use: mark it spent before the request resolves.
    let next: WorkspaceState = { ...workspace, review: { ...review, approval: null, status: "sent" }, cloudError: null, proposal: null, report: null };
    onChange(next);
    try {
      const result = await submitApprovedCloudInference(inference.cloud, preview, approval, {
        requestId: preview.requestId,
        destinationKey: preview.destinationKey,
        purpose: "mapping-proposal",
      });
      if (token !== waitToken.current) return;
      recordWorkflowEvent({
        kind: "cloud-proposal",
        ok: true,
        durationMs: performance.now() - started,
        payloadHash: preview.payloadHash,
        inferenceSource: result.provenance.actualSource,
      });
      const evaluated = evaluate({
        structured: result.structured,
        text: result.structured !== undefined ? JSON.stringify(result.structured, null, 2) : result.text,
        origin: originFor(result),
        requestId: preview.requestId,
        provenance: result.provenance,
      });
      next = { ...next, proposal: evaluated, mappingChoice: "proposal" };
      setEditText(null);
    } catch (caught) {
      if (token !== waitToken.current) return;
      const code = caught instanceof DisclosureRejectedError ? "DISCLOSURE_REJECTED" : caught instanceof InferenceError ? caught.code : "CLOUD_FAILED";
      // Raw provider text stays local and collapsed; the default view shows guidance only.
      const detail =
        caught instanceof DisclosureRejectedError
          ? `${caught.reason}: ${caught.details.join("; ")}`
          : caught instanceof Error
            ? caught.message
            : String(caught);
      recordWorkflowEvent({ kind: "cloud-proposal", ok: false, durationMs: performance.now() - started, payloadHash: preview.payloadHash, code: caught instanceof DisclosureRejectedError ? caught.reason : code });
      next = { ...next, cloudError: { code, detail } };
    } finally {
      if (token === waitToken.current) {
        setBusy(false);
        onChange(next);
      }
    }
  }

  /** Stop waiting: the approval stays consumed; a late answer is discarded (B5). */
  function stopWaiting(): void {
    if (!review) return;
    waitToken.current += 1;
    setBusy(false);
    recordWorkflowEvent({ kind: "cloud-proposal", ok: false, payloadHash: review.preview.payloadHash, code: "CANCELLED" });
    onChange({
      ...workspace,
      review: { ...review, approval: null, status: "sent" },
      proposal: null,
      report: null,
      cloudError: { code: "CANCELLED", detail: "Stopped by the user while waiting for the provider." },
    });
  }

  /**
   * Explicit recovery (B3): rebuild the same reviewed disclosure as a NEW
   * preview with a new request id. It must be approved again on the review
   * step. The consumed approval is never reused; nothing is sent here.
   */
  async function prepareFreshRequest(): Promise<void> {
    if (!prepared) return;
    setRecoveryError(null);
    try {
      const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(workspace.destinationText) as unknown });
      if (!draft.ok) throw new Error(draft.issues.join("; "));
      const preview = await createDisclosurePreview(draft.value.payload);
      recordWorkflowEvent({ kind: "cloud-recovery", ok: true, payloadHash: preview.payloadHash, code: "FRESH_REQUEST" });
      onChange({ ...workspace, review: { preview, approval: null, status: "pending" }, proposal: null, cloudError: null, report: null, revision: null });
      onReviewFresh?.();
    } catch (caught) {
      recordWorkflowEvent({ kind: "cloud-recovery", ok: false, code: "FRESH_REQUEST_FAILED" });
      setRecoveryError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function openManual(): void {
    setManualOpen(true);
    requestAnimationFrame(() => document.querySelector('[data-testid="manual-contract"]')?.scrollIntoView({ block: "start", behavior: "instant" }));
  }

  const failure = workspace.cloudError ? guidanceForFailure({ code: workspace.cloudError.code, stage: "cloud-mapping" }) : null;

  function validateEdit(): void {
    if (!proposal || editText === null) return;
    const origin: ProposalOrigin = editText === proposal.text ? proposal.origin : "manual-edit";
    const evaluated = evaluate({
      structured: undefined,
      text: editText,
      origin,
      requestId: proposal.requestId,
      provenance: origin === "manual-edit" ? null : proposal.provenance,
    });
    onChange({ ...workspace, proposal: evaluated, report: null });
  }

  const result = proposal?.result;
  const reportForProposal = result?.ok && workspace.mappingChoice === "proposal" ? workspace.report : null;
  const connections = proposal && result ? buildConnections({ result, text: proposal.text, report: reportForProposal }) : null;
  const payload = review?.preview.payload ?? null;

  function openEditor(): void {
    setEditorOpen(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "center", behavior: "instant" }));
  }

  return (
    <section className="space-y-5" aria-labelledby="cloud-mapping-heading">
      <TrustLedger workspace={workspace} prepared={prepared} />

      <Panel tone="cloud">
        <PanelHeader id="cloud-mapping-heading" title="Cloud mapping proposal" eyebrow="Integration Studio" zone="cloud" zoneText="ONLY_IN_CLOUD · approved payload only">
          Gemini sees the approved twin and destination description, never the records. It returns declarative operations over aliases. Nothing it
          returns is executed directly: every proposal passes the canonical Mapping Contract validation and local alias resolution first.
        </PanelHeader>

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-2" data-testid="cloud-adapter-label">
              <CloudIcon size={14} className="text-gold-ink" />
              <span className="text-mute">Cloud adapter:</span>{" "}
              {harness ? "Test adapter active — results are simulated, not Gemini" : liveInferenceLabel(cloudStatus)}
            </p>
            {!review || review.status === "pending" || review.status === "rejected" ? (
              <p className="text-sm" data-testid="cloud-needs-approval">
                {review?.status === "rejected"
                  ? "The disclosure was rejected. No cloud request was made."
                  : "Approve the exact prompt on the Disclosure Review step first. Without approval no request is sent."}
              </p>
            ) : review.status === "approved" ? (
              <p className="text-xs text-mute">Approved request {review.preview.requestId.slice(0, 8)}… is ready. It can be sent once.</p>
            ) : (
              <p className="text-xs text-mute">The approval for request {review.preview.requestId.slice(0, 8)}… has been used.</p>
            )}
          </div>
          <Button variant="approve" onClick={() => void send()} disabled={!canSend} data-testid="send-cloud-request">
            <CloudIcon size={14} /> Send approved request to Gemini
          </Button>
        </div>

        {!cloudAvailable ? (
          <div className="mt-4 border-l-4 border-warn bg-warn/5 p-4 text-sm" data-testid="cloud-unavailable">
            <p className="font-medium">Cloud Gemini is not available in this build ({liveInferenceLabel(cloudStatus).replace(/^Unavailable — /, "")}).</p>
            <p className="mt-1 text-mute">
              Your approval stays unused; nothing was sent. You can still finish the walkthrough: open
              <span className="font-medium"> “No cloud? Use a hand-written contract”</span> below, then run the Reality Check. That path is labeled as
              manual, never as Gemini output.
            </p>
          </div>
        ) : null}

        {busy ? (
          <div className="mt-4">
            <PendingOperation
              step="Waiting for Gemini's mapping proposal (one request, no automatic retry)"
              where="cloud"
              limitSeconds={Math.round(CLOUD_TIMEOUT_MS / 1000)}
              onStop={stopWaiting}
              testId="cloud-pending"
            />
          </div>
        ) : null}
        {failure && workspace.cloudError ? (
          <div className="mt-4">
            <Guidance
              testId="cloud-error"
              code={failure.code}
              tone={failure.category === "CANCELLED" ? "warn" : "fail"}
              title={`No proposal was produced · ${failure.title}`}
              what={failure.what}
              why={failure.why}
              next={failure.next}
              detail={workspace.cloudError.detail}
              actions={
                <>
                  {failure.actions.includes("FRESH_CLOUD_REQUEST") ? (
                    <Button variant="approve" size="sm" onClick={() => void prepareFreshRequest()} disabled={!prepared} data-testid="prepare-fresh-request">
                      Prepare a fresh request
                    </Button>
                  ) : null}
                  {failure.actions.includes("MANUAL_CONTRACT") ? (
                    <Button size="sm" variant="outline" onClick={openManual} data-testid="use-manual-contract">
                      Use a hand-written contract
                    </Button>
                  ) : null}
                </>
              }
            />
            {recoveryError ? (
              <div className="mt-2">
                <ErrorBanner title="The fresh request could not be prepared">{recoveryError}</ErrorBanner>
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {proposal && result ? (
        <div className="space-y-5 text-sm" data-testid="proposal">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <Eyebrow>Proposal origin</Eyebrow>
              <p className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="proposal-origin"
                  className={`inline-block border px-2 py-0.5 font-mono text-xs ${
                    proposal.origin === "gemini-cloud" ? "border-[3px] border-double border-gold-ink bg-gold/10 text-gold-ink" : "border-dashed border-ink/50 text-ink"
                  }`}
                >
                  {ORIGIN_LABELS[proposal.origin]}
                </span>
                {proposal.provenance ? (
                  <span className="font-mono text-[11px] text-mute" data-testid="proposal-provenance">
                    source={proposal.provenance.actualSource} mode={proposal.provenance.requestedMode} simulated={String(proposal.provenance.simulated)}{" "}
                    {proposal.provenance.durationMs}ms
                  </span>
                ) : null}
              </p>
              <p data-testid="proposal-status" className={`font-medium ${result.ok ? "text-pass" : "text-fail"}`} role="status">
                {result.ok
                  ? `Valid · ${result.value.converted.contract.operations.length} operations · aliases resolved locally`
                  : `Rejected at ${result.stage} · ${result.issues.length} issue(s)`}
              </p>
            </div>
            <div className="min-w-0 lg:w-[34rem]">
              <ProposalPipeline result={result} executed={reportForProposal ? reportForProposal.overall : null} />
            </div>
          </div>

          {!result.ok ? (
            <div className="border-l-4 border-fail bg-fail/5 p-4">
              <p className="font-medium">The proposal was refused before anything ran. Each issue below names the rule it broke.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="proposal-issues">
                {result.issues.map((issue, index) => (
                  <li key={index} className="[overflow-wrap:anywhere]">
                    <span className="font-mono">{issue.code}</span>
                    {typeof issue.operationIndex === "number" ? <span className="text-mute"> · operation #{issue.operationIndex + 1}</span> : null}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.ok && result.value.converted.warnings.length > 0 ? (
            <ul className="space-y-1" data-testid="proposal-warnings">
              {result.value.converted.warnings.map((warning, index) => (
                <li key={index}>
                  <StatusMark status="warn">{warning.message}</StatusMark>
                </li>
              ))}
            </ul>
          ) : null}

          {connections && payload && connections.length > 0 ? (
            <IntegrationStudio
              connections={connections}
              payload={payload}
              operations={result.ok ? result.value.converted.contract.operations : null}
              selected={focusOperation ?? connections[0]?.index ?? 0}
              onSelect={onFocusOperation}
              resolutions={result.ok ? result.value.resolved.resolutions : null}
              onOpenEditor={openEditor}
              reportRan={Boolean(reportForProposal)}
            />
          ) : (
            <p className="border border-dashed border-rule p-4 text-mute" data-testid="studio-unrenderable">
              The response could not be read as a list of operations, so there is nothing to visualize. It was not repaired.
            </p>
          )}

          {result.ok ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0 space-y-2">
                <p className="text-mute">
                  <span className="font-medium text-ink">Rationale:</span> {result.value.converted.rationale}
                </p>
                <Disclosure summary="Local alias resolution (this browser only)">
                  <table className="text-left font-mono text-xs" data-testid="alias-resolution">
                    <tbody>
                      {result.value.resolved.resolutions.map((item) => (
                        <tr key={item.alias}>
                          <td className="pr-3 text-cyan-ink">{item.alias}</td>
                          <td className="pr-3">→</td>
                          <td>{item.localPath}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Disclosure>
              </div>
              <Button variant="primary" size="lg" onClick={onContinue} data-testid="continue-to-reality">
                Continue to Reality Check
                <ArrowRightIcon />
              </Button>
            </div>
          ) : null}

          <details
            ref={editorRef}
            open={editorOpen}
            onToggle={(event) => setEditorOpen((event.currentTarget as HTMLDetailsElement).open)}
            className="group border border-rule bg-panel p-4"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block w-3 font-mono text-mute transition-transform group-open:rotate-90">›</span>
              <span>Edit the proposal locally</span>
            </summary>
            <p className="mt-2 text-xs text-mute">
              Edits never go back to Gemini. An edited proposal is labeled as manual and passes the same canonical validation.
            </p>
            <textarea
              aria-label="Proposal JSON"
              data-testid="proposal-editor"
              className="mt-2 min-h-48 w-full rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs"
              value={editText ?? proposal.text}
              onChange={(event) => setEditText(event.target.value)}
            />
            <Button className="mt-2" onClick={validateEdit} disabled={editText === null} data-testid="validate-edited-proposal">
              Validate edited proposal
            </Button>
          </details>
        </div>
      ) : null}

      <details
        className="group border border-dashed border-ink/30 bg-panel/60 p-5"
        data-testid="manual-contract"
        open={manualOpen}
        onToggle={(event) => setManualOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="inline-block w-3 font-mono text-mute transition-transform group-open:rotate-90">›</span>
          No cloud? Use a hand-written contract over local field names (not AI)
        </summary>
        <div className="mt-4">
          <MappingPanel workspace={workspace} onChange={onChange} />
        </div>
      </details>
    </section>
  );
}
