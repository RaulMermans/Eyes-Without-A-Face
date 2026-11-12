import { useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { LoadingState } from "../components/LoadingState.tsx";
import { liveInferenceLabel } from "../config/env.ts";
import { InferenceError } from "../inference/errors.ts";
import type { InferenceResult, InferenceServices } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import { DisclosureRejectedError } from "../twin/authorization.ts";
import { submitApprovedCloudInference } from "../twin/cloud-request-gate.ts";
import { acceptProposal, type PreparedTwin } from "../workflow/pipeline.ts";
import { MappingPanel } from "./MappingPanel.tsx";
import { ORIGIN_LABELS } from "./result-kind.ts";
import type { ProposalState, WorkspaceState } from "./workspace-state.ts";


function originFor(result: InferenceResult): ProposalOrigin {
  return result.provenance.resultKind === "real-cloud" && !result.provenance.simulated ? "gemini-cloud" : "test-adapter";
}

export function CloudMappingPanel({
  workspace,
  onChange,
  prepared,
  inference,
  onContinue,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  inference: InferenceServices;
  onContinue: () => void;
}) {
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
      const code = caught instanceof DisclosureRejectedError ? caught.reason : caught instanceof InferenceError ? caught.code : "CLOUD_FAILED";
      const message =
        caught instanceof DisclosureRejectedError
          ? `${caught.reason}: ${caught.details.join("; ")}`
          : caught instanceof InferenceError
            ? `${caught.code}: ${caught.message}`
            : caught instanceof Error
              ? caught.message
              : String(caught);
      recordWorkflowEvent({ kind: "cloud-proposal", ok: false, durationMs: performance.now() - started, payloadHash: preview.payloadHash, code });
      next = { ...next, cloudError: message };
    } finally {
      setBusy(false);
      onChange(next);
    }
  }

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

  return (
    <section className="space-y-4" aria-labelledby="cloud-mapping-heading">
      <div className="border border-rule bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="cloud-mapping-heading" className="text-base font-semibold">
            Cloud mapping proposal
          </h3>
          <Badge className="border-cloud/50 text-cloud">Cloud · ONLY_IN_CLOUD · approved payload only</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-mute">
          Gemini sees the approved twin and destination description, never the records. It returns
          declarative operations over aliases. Nothing it returns is executed directly: every
          proposal passes the canonical Mapping Contract validation and local alias resolution first.
        </p>
        <p className="mt-2 text-sm" data-testid="cloud-adapter-label">
          Cloud adapter:{" "}
          {harness ? "Test adapter active — results are simulated, not Gemini" : liveInferenceLabel(cloudStatus)}
        </p>

        {!review || review.status === "pending" || review.status === "rejected" ? (
          <p className="mt-3 text-sm" data-testid="cloud-needs-approval">
            {review?.status === "rejected"
              ? "The disclosure was rejected. No cloud request was made."
              : "Approve the exact prompt on the Disclosure Review step first. Without approval no request is sent."}
          </p>
        ) : null}

        {!cloudAvailable ? (
          <div className="mt-3 border border-rule p-3 text-sm" data-testid="cloud-unavailable">
            <p className="font-medium">Cloud Gemini is not available in this build ({liveInferenceLabel(cloudStatus).replace(/^Unavailable — /, "")}).</p>
            <p className="mt-1 text-mute">
              Your approval stays unused; nothing was sent. You can still finish the walkthrough: open
              <span className="font-medium"> “No cloud? Use a hand-written contract”</span> below, then run the
              Reality Check. That path is labeled as manual, never as Gemini output.
            </p>
          </div>
        ) : null}

        <Button className="mt-4" variant="primary" onClick={() => void send()} disabled={!canSend} data-testid="send-cloud-request">
          Send approved request to Gemini
        </Button>
        {busy ? (
          <div className="mt-3">
            <LoadingState label="Waiting for the cloud proposal (no automatic retry)" />
          </div>
        ) : null}
        {workspace.cloudError ? (
          <div className="mt-4" data-testid="cloud-error">
            <ErrorBanner title="No proposal was produced">
              {workspace.cloudError} The approval has been consumed; build and approve a new prompt to try again.
            </ErrorBanner>
          </div>
        ) : null}

        {proposal && result ? (
          <div className="mt-5 space-y-3 text-sm" data-testid="proposal">
            <p>
              <span className="font-medium">Origin: </span>
              <span
                data-testid="proposal-origin"
                className={`inline-block border px-2 py-0.5 font-mono text-xs ${
                  proposal.origin === "gemini-cloud" ? "border-cloud/60 bg-cloud/10 text-cloud" : "border-rule text-mute"
                }`}
              >
                {ORIGIN_LABELS[proposal.origin]}
              </span>
              {proposal.provenance ? (
                <span className="ml-2 font-mono text-xs text-mute" data-testid="proposal-provenance">
                  source={proposal.provenance.actualSource} mode={proposal.provenance.requestedMode} simulated=
                  {String(proposal.provenance.simulated)} {proposal.provenance.durationMs}ms
                </span>
              ) : null}
            </p>
            <p data-testid="proposal-status" className={result.ok ? "text-local" : "text-danger"}>
              {result.ok
                ? `Valid · ${result.value.converted.contract.operations.length} operations · aliases resolved locally`
                : `Rejected at ${result.stage} · ${result.issues.length} issue(s)`}
            </p>
            {!result.ok ? (
              <ul className="list-disc space-y-1 pl-5" data-testid="proposal-issues">
                {result.issues.map((issue, index) => (
                  <li key={index}>
                    <span className="font-mono">{issue.code}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.ok && result.value.converted.warnings.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-cloud" data-testid="proposal-warnings">
                {result.value.converted.warnings.map((warning, index) => (
                  <li key={index}>{warning.message}</li>
                ))}
              </ul>
            ) : null}
            {result.ok ? (
              <>
                <p className="text-mute">Rationale: {result.value.converted.rationale}</p>
                <ol className="list-decimal space-y-1 pl-5 font-mono text-xs" data-testid="proposal-operations">
                  {result.value.converted.contract.operations.map((operation, index) => (
                    <li key={index}>
                      {operation.op} {"from" in operation && operation.from !== undefined ? JSON.stringify(operation.from) : "—"} → {operation.to}
                      {"params" in operation ? ` ${JSON.stringify(operation.params)}` : ""}
                    </li>
                  ))}
                </ol>
                <details>
                  <summary className="cursor-pointer font-medium">Local alias resolution (this browser only)</summary>
                  <table className="mt-2 text-left font-mono text-xs" data-testid="alias-resolution">
                    <tbody>
                      {result.value.resolved.resolutions.map((item) => (
                        <tr key={item.alias}>
                          <td className="pr-3">{item.alias}</td>
                          <td className="pr-3">→</td>
                          <td>{item.localPath}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <Button variant="primary" onClick={onContinue} data-testid="continue-to-reality">
                  Continue to Reality Check
                </Button>
              </>
            ) : null}
            <details>
              <summary className="cursor-pointer font-medium">Edit the proposal locally</summary>
              <p className="mt-2 text-xs text-mute">
                Edits never go back to Gemini. An edited proposal is labeled as manual and passes the same canonical validation.
              </p>
              <textarea
                aria-label="Proposal JSON"
                data-testid="proposal-editor"
                className="mt-2 min-h-48 w-full border border-rule bg-paper p-3 font-mono text-xs"
                value={editText ?? proposal.text}
                onChange={(event) => setEditText(event.target.value)}
              />
              <Button className="mt-2" onClick={validateEdit} disabled={editText === null} data-testid="validate-edited-proposal">
                Validate edited proposal
              </Button>
            </details>
          </div>
        ) : null}
      </div>

      <details className="border border-rule bg-panel p-5" data-testid="manual-contract">
        <summary className="cursor-pointer text-sm font-medium">
          No cloud? Use a hand-written contract over local field names (not AI)
        </summary>
        <div className="mt-4">
          <MappingPanel workspace={workspace} onChange={onChange} />
        </div>
      </details>
    </section>
  );
}
