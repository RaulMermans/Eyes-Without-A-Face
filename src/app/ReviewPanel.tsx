import { useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { buildDisclosureDraft, type PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export function ReviewPanel({
  workspace,
  onChange,
  prepared,
  onContinue,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  onContinue: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const review = workspace.review;

  if (!prepared) {
    return (
      <section className="border border-rule bg-panel p-5" aria-labelledby="review-heading">
        <h3 id="review-heading" className="text-base font-semibold">
          Disclosure review
        </h3>
        <p className="mt-2 text-sm text-mute" data-testid="review-empty">
          Generate a Phantom Twin first. Only its allowlisted projection can be reviewed for disclosure.
        </p>
      </section>
    );
  }

  async function buildPreview(): Promise<void> {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      let targetSchema: unknown;
      try {
        targetSchema = JSON.parse(workspace.destinationText) as unknown;
      } catch {
        throw new Error("Destination schema is not valid JSON. Fix it on the Phantom Twin step.");
      }
      const draft = buildDisclosureDraft({ prepared, targetSchema });
      if (!draft.ok) {
        throw new Error(draft.issues.join("; "));
      }
      const preview = await createDisclosurePreview(draft.value.payload);
      setNotes(draft.value.targetNotes);
      onChange({ ...workspace, review: { preview, approval: null, status: "pending" }, proposal: null, cloudError: null, report: null });
      recordWorkflowEvent({ kind: "disclosure-preview", ok: true, durationMs: performance.now() - started, payloadHash: preview.payloadHash });
    } catch (caught) {
      const message =
        caught instanceof DisclosureRejectedError ? `${caught.reason}: ${caught.details.join("; ")}` : caught instanceof Error ? caught.message : String(caught);
      setError(message);
      recordWorkflowEvent({ kind: "disclosure-preview", ok: false, code: caught instanceof DisclosureRejectedError ? caught.reason : "DRAFT_INVALID" });
    } finally {
      setBusy(false);
    }
  }

  function approve(): void {
    if (!review) return;
    const approval = approveDisclosurePreview(review.preview);
    onChange({ ...workspace, review: { ...review, approval, status: "approved" } });
    recordWorkflowEvent({ kind: "disclosure-approve", ok: true, payloadHash: review.preview.payloadHash });
  }

  function reject(): void {
    if (!review) return;
    onChange({ ...workspace, review: { ...review, approval: null, status: "rejected" } });
    recordWorkflowEvent({ kind: "disclosure-reject", ok: true, payloadHash: review.preview.payloadHash });
  }

  const payload = review?.preview.payload;

  return (
    <section className="border border-rule bg-panel p-5" aria-labelledby="review-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="review-heading" className="text-base font-semibold">
          Disclosure review
        </h3>
        <Badge className="border-cloud/50 text-cloud">Nothing is sent from this step</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-mute">
        A synthetic twin is not automatically anonymous. Aliases, descriptors, category labels and
        destination field names can still reveal something about a private system. Read the exact
        application prompt below before approving it. The approval covers this one request only.
      </p>

      {!review ? (
        <Button className="mt-4" variant="primary" onClick={() => void buildPreview()} disabled={busy} data-testid="build-preview">
          Build exact outbound prompt
        </Button>
      ) : null}

      {error ? (
        <div className="mt-4" data-testid="review-error">
          <ErrorBanner title="The disclosure could not be prepared">{error}</ErrorBanner>
        </div>
      ) : null}

      {review && payload ? (
        <div className="mt-4 space-y-4 text-sm" data-testid="review-ready">
          <dl className="grid gap-2 sm:grid-cols-2" data-testid="review-destination">
            <div>
              <dt className="text-mute">Destination</dt>
              <dd>
                Firebase AI Logic · Gemini Developer API · model <span className="font-mono">{payload.destination.model}</span>
              </dd>
            </div>
            <div>
              <dt className="text-mute">Purpose / mode</dt>
              <dd className="font-mono">mapping-proposal · ONLY_IN_CLOUD</dd>
            </div>
            <div>
              <dt className="text-mute">Shared</dt>
              <dd>
                {payload.fields.length} aliases, {payload.syntheticExamples.length} synthetic examples,{" "}
                {payload.target?.fields.length ?? 0} destination fields
              </dd>
            </div>
            <div>
              <dt className="text-mute">Never shared</dt>
              <dd>Source records, field names, bindings, dataset name, reserved cases, error values</dd>
            </div>
          </dl>
          {notes.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-mute" data-testid="target-notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <div>
            <p className="font-medium">Exact outbound application prompt</p>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap border border-rule bg-paper p-3 font-mono text-xs [overflow-wrap:anywhere]" data-testid="review-prompt">
              {review.preview.outboundPrompt}
            </pre>
            <p className="mt-1 break-all font-mono text-[11px] text-mute" data-testid="review-hashes">
              request {review.preview.requestId} · payload sha256 {review.preview.payloadHash} · prompt sha256 {review.preview.outboundHash} · {review.preview.byteLength} bytes
            </p>
            <p className="mt-1 text-xs text-mute">
              Firebase SDK transport may add App Check tokens and HTTP metadata that this product cannot display.
            </p>
          </div>

          <p data-testid="review-status" className="font-medium">
            {review.status === "pending"
              ? "Awaiting your decision."
              : review.status === "approved"
                ? "Approved for one cloud request."
                : review.status === "rejected"
                  ? "Rejected. No cloud request will be made."
                  : "Approval used. Build a new prompt to request again."}
          </p>

          {review.status === "pending" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={approve} data-testid="approve-disclosure">
                Approve this exact prompt
              </Button>
              <Button onClick={reject} data-testid="reject-disclosure">
                Reject
              </Button>
            </div>
          ) : review.status === "approved" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onContinue} data-testid="continue-to-mapping">
                Continue to Cloud Mapping
              </Button>
              <Button onClick={reject} data-testid="revoke-disclosure">
                Revoke approval
              </Button>
            </div>
          ) : (
            <Button onClick={() => void buildPreview()} disabled={busy} data-testid="rebuild-preview">
              Build a new prompt
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
