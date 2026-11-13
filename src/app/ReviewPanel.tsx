import { useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { ArrowRightIcon, CloudIcon, LockIcon, SealIcon } from "../components/icons.tsx";
import { EmptyState, Eyebrow, FieldToken, Panel, PanelHeader, StatusMark, ZoneLabel } from "../components/spectral.tsx";
import { approveDisclosurePreview, createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { buildDisclosureDraft, type PreparedTwin } from "../workflow/pipeline.ts";
import { TrustLedger } from "./TrustLedger.tsx";
import type { WorkspaceState } from "./workspace-state.ts";

/**
 * Disclosure review. The gate is unchanged: one preview → one exact prompt,
 * SHA-256 bound; approval is single-use and invalidated by any upstream change
 * (invalidateDownstream clears `review`). Sprint 6 adds progressive
 * disclosure: a plain-language summary by default, and the exact serialized
 * request, hashes, and payload in the advanced view.
 */
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
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const review = workspace.review;

  if (!prepared) {
    return (
      <EmptyState headingId="review-heading" title="Disclosure review" testId="review-empty">
        Generate a Phantom Twin first. Only its allowlisted projection can be reviewed for disclosure.
      </EmptyState>
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
  const twin = prepared.twin;
  const withheld = twin.fields.filter((field) => !field.shareable);
  const withCategories = payload ? payload.fields.filter((field) => (field.enumValues?.length ?? 0) > 0) : [];

  return (
    <section className="space-y-5" aria-labelledby="review-heading">
      <TrustLedger workspace={workspace} prepared={prepared} />
      <Panel tone="cloud">
        <PanelHeader id="review-heading" title="Disclosure review" eyebrow="Controlled disclosure" zone="approval" zoneText="Nothing is sent from this step">
          A synthetic twin is not automatically anonymous. Aliases, descriptors, category labels and destination field names can still reveal
          something about a private system. Review what would be sent before approving it. The approval covers this one request only.
        </PanelHeader>

        {!review ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void buildPreview()} disabled={busy} data-testid="build-preview">
              Build exact outbound prompt
            </Button>
            <p className="text-xs text-mute">Builds the allowlisted request locally and hashes it. Nothing is sent.</p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4" data-testid="review-error">
            <ErrorBanner title="The disclosure could not be prepared">{error}</ErrorBanner>
          </div>
        ) : null}

        {review && payload ? (
          <div className="mt-5 space-y-5 text-sm" data-testid="review-ready">
            <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3" data-testid="review-destination">
              <div className="bg-panel p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Destination model</dt>
                <dd className="mt-1">
                  Firebase AI Logic · Gemini Developer API · model <span className="font-mono">{payload.destination.model}</span>
                </dd>
              </div>
              <div className="bg-panel p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Purpose / mode</dt>
                <dd className="mt-1 font-mono">mapping-proposal · ONLY_IN_CLOUD</dd>
              </div>
              <div className="bg-panel p-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Shared</dt>
                <dd className="mt-1">
                  {payload.fields.length} aliases, {payload.syntheticExamples.length} synthetic examples, {payload.target?.fields.length ?? 0} destination fields
                </dd>
              </div>
            </dl>

            <div className="grid gap-4 lg:grid-cols-2" data-testid="disclosure-summary">
              <div className="frame-cloud bg-gold/5 p-4">
                <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-gold-ink">
                  <CloudIcon size={12} /> Gemini will receive
                </p>
                <ul className="mt-3 space-y-3">
                  <li>
                    <p className="font-medium">{payload.fields.length} aliases with type and descriptor</p>
                    <ul className="mt-1.5 space-y-1" aria-label="Disclosed aliases">
                      {payload.fields.map((field) => (
                        <li key={field.alias} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <FieldToken kind="alias">{field.alias}</FieldToken>
                          <span className="font-mono text-mute">{field.type}</span>
                          <span className="text-ink/80">{field.semanticDescriptor}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li>
                    <p className="font-medium">{payload.syntheticExamples.length} fictional example rows</p>
                    <p className="text-xs text-mute">Generated locally and checked against every private value.</p>
                  </li>
                  <li>
                    <p className="font-medium">Category labels</p>
                    <p className="text-xs text-mute" data-testid="review-categories">
                      {withCategories.length === 0
                        ? "None included. Gemini must not assume your category values."
                        : withCategories.map((field) => `${field.alias}: ${field.enumValues?.length ?? 0} labels`).join(" · ")}
                    </p>
                  </li>
                  <li>
                    <p className="font-medium">{payload.target?.fields.length ?? 0} destination fields</p>
                    <p className="text-xs text-mute">{(payload.target?.fields ?? []).map((field) => field.name).join(", ")} — names, types, required flags, formats, enum values.</p>
                  </li>
                  <li>
                    <p className="font-medium">Fixed instructions</p>
                    <p className="text-xs text-mute">The eight allowed operations and the response format. No free text from you is appended.</p>
                  </li>
                </ul>
              </div>
              <div className="frame-private bg-panel p-4">
                <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                  <LockIcon size={12} /> Gemini will not receive
                </p>
                <dl className="mt-3 space-y-2" data-testid="review-never-shared">
                  <div>
                    <dt className="font-medium">Never shared</dt>
                    <dd className="text-xs text-mute">Source records, field names, bindings, dataset name, reserved cases, error values</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Withheld aliases</dt>
                    <dd className="text-xs text-mute">
                      {withheld.length === 0 ? "None — every alias is offered." : `${withheld.map((field) => field.alias).join(", ")} stay local (not described).`}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Transport metadata</dt>
                    <dd className="text-xs text-mute">The Firebase SDK may add App Check tokens and HTTP metadata that this product cannot display.</dd>
                  </div>
                </dl>
              </div>
            </div>

            {notes.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-mute" data-testid="target-notes">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            <div className="border border-rule">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-bone"
                aria-expanded={advanced}
                aria-controls="review-advanced"
                onClick={() => setAdvanced((value) => !value)}
                data-testid="review-advanced-toggle"
              >
                <span>
                  Inspect the exact request
                  <span className="ml-2 font-normal text-mute">prompt · SHA-256 · schema version · request id · full payload</span>
                </span>
                <span aria-hidden="true" className={`font-mono text-mute transition-transform ${advanced ? "rotate-90" : ""}`}>
                  ›
                </span>
              </button>
              <div id="review-advanced" hidden={!advanced} className="space-y-4 border-t border-rule p-4" data-testid="review-advanced">
                <dl className="grid gap-2 font-mono text-[11px] sm:grid-cols-2">
                  <div>
                    <dt className="text-mute">Request id</dt>
                    <dd className="break-all" data-testid="review-request-id">{review.preview.requestId}</dd>
                  </div>
                  <div>
                    <dt className="text-mute">Schema version</dt>
                    <dd>
                      {payload.contractKind} {payload.schemaVersion}
                    </dd>
                  </div>
                </dl>
                <div>
                  <p className="font-medium">Exact outbound application prompt</p>
                  <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs [overflow-wrap:anywhere]" data-testid="review-prompt">
                    {review.preview.outboundPrompt}
                  </pre>
                  <p className="mt-1 break-all font-mono text-[11px] text-mute" data-testid="review-hashes">
                    request {review.preview.requestId} · payload sha256 {review.preview.payloadHash} · prompt sha256 {review.preview.outboundHash} · {review.preview.byteLength} bytes
                  </p>
                </div>
                <div>
                  <p className="font-medium">Phantom Twin → cloud disclosure</p>
                  <p className="text-xs text-mute">The internal Phantom Contract is never sent; the request is an allowlisted projection of it.</p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[28rem] border-collapse text-left text-xs" data-testid="review-compare">
                      <thead>
                        <tr className="border-b border-rule font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                          <th className="py-1.5 pr-3 font-medium">Alias</th>
                          <th className="py-1.5 pr-3 font-medium">In twin</th>
                          <th className="py-1.5 pr-3 font-medium">In request</th>
                          <th className="py-1.5 pr-3 font-medium">Category labels</th>
                        </tr>
                      </thead>
                      <tbody>
                        {twin.fields.map((field) => {
                          const sent = payload.fields.find((item) => item.alias === field.alias);
                          return (
                            <tr key={field.alias} className="border-b border-rule/60">
                              <td className="py-1.5 pr-3 font-mono">{field.alias}</td>
                              <td className="py-1.5 pr-3">yes</td>
                              <td className="py-1.5 pr-3">{sent ? <StatusMark status="warn">described</StatusMark> : <StatusMark status="pass">withheld</StatusMark>}</td>
                              <td className="py-1.5 pr-3">{sent?.enumValues?.length ? `${sent.enumValues.length} sent` : field.type === "enum" ? "withheld" : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="font-medium">Full allowlisted disclosure payload</p>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs" data-testid="review-payload">
                    {review.preview.canonicalJson}
                  </pre>
                </div>
              </div>
            </div>

            <div className={`flex flex-col gap-3 border-l-4 p-4 sm:flex-row sm:items-center sm:justify-between ${review.status === "approved" ? "border-gold-ink bg-gold/10" : review.status === "pending" ? "border-ink bg-bone" : "border-rule bg-bone"}`}>
              <div className="flex items-start gap-2">
                <SealIcon size={18} className="mt-0.5 shrink-0 text-gold-ink" />
                <div>
                  <Eyebrow>Decision · bound to prompt sha256 {review.preview.outboundHash.slice(0, 12)}…</Eyebrow>
                  <p data-testid="review-status" className="mt-0.5 font-medium" role="status">
                    {review.status === "pending"
                      ? "Awaiting your decision."
                      : review.status === "approved"
                        ? "Approved for one cloud request."
                        : review.status === "rejected"
                          ? "Rejected. No cloud request will be made."
                          : "Approval used. Build a new prompt to request again."}
                  </p>
                </div>
              </div>
              {review.status === "pending" ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="approve" onClick={approve} data-testid="approve-disclosure">
                    <SealIcon size={14} /> Approve this exact prompt
                  </Button>
                  <Button onClick={reject} data-testid="reject-disclosure">
                    Reject
                  </Button>
                </div>
              ) : review.status === "approved" ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={onContinue} data-testid="continue-to-mapping">
                    Continue to Cloud Mapping
                    <ArrowRightIcon />
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
            <p className="text-xs text-mute">
              Any change to the source, seed, field decisions, or destination schema clears this approval. <ZoneLabel zone="approval">single-use</ZoneLabel>
            </p>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
