import { useMemo, type ReactNode } from "react";
import { Button } from "../components/ui/button.tsx";
import { ArrowRightIcon, CloudIcon, LockIcon, PhantomIcon, SealIcon } from "../components/icons.tsx";
import { EmptyState, Eyebrow, FieldToken, Panel, PanelHeader, StatusMark, type Status } from "../components/spectral.tsx";
import { diffContracts } from "../evaluation/evaluate.ts";
import type { WorkflowEvent } from "../observability/workflow-log.ts";
import { REVISION_VERDICT_TEXT } from "../revision/decision.ts";
import { summarizeOutcomes, type CompletionState } from "../verification/outcomes.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { exportCandidates, type ExportCandidate } from "./export-context.ts";
import { ExportPanel } from "./ExportPanel.tsx";
import { ORIGIN_LABELS } from "./result-kind.ts";
import { bestCandidate } from "./runtime-model.ts";
import type { WorkspaceState } from "./workspace-state.ts";

/**
 * OUTCOME (Sprint 10). Everything shown is derived on render from workspace
 * state and the local evaluators — exportCandidates → exportEligibility,
 * summarizeOutcomes, decideRevision — never from model text and never from
 * ground truth. Schema validity and semantic correctness are shown apart;
 * unknown meaning is never presented as verified.
 */

const HEADLINE: Record<CompletionState, string> = {
  VERIFIED: "Verified locally.",
  VERIFIED_WITH_EXCEPTIONS: "Verified, with managed exceptions.",
  PARTIALLY_VERIFIED: "Partially verified. Draft only.",
  REVISION_FAILED: "The revision failed. Not exportable.",
  BLOCKED: "Blocked. Not exportable.",
};

const STATE_STATUS: Record<CompletionState, Status> = {
  VERIFIED: "pass",
  VERIFIED_WITH_EXCEPTIONS: "warn",
  PARTIALLY_VERIFIED: "warn",
  REVISION_FAILED: "fail",
  BLOCKED: "fail",
};

const SEMANTIC_TEXT: Record<string, [Status, string]> = {
  SEMANTIC_PASS: ["pass", "Meaning verified against trusted constraints"],
  SEMANTIC_MISMATCH: ["fail", "Meaning contradicts a trusted constraint"],
  SEMANTIC_POLICY_CONFLICT: ["fail", "Conflicts with the acceptance policy"],
  SEMANTIC_AMBIGUOUS: ["warn", "Ambiguous — not verified"],
  SEMANTIC_EVIDENCE_MISSING: ["warn", "Unknown — no trusted evidence"],
  SEMANTIC_UNVERIFIED: ["warn", "Unverified"],
};

function schemaTitle(text: string): string {
  try {
    const parsed = JSON.parse(text) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : "destination schema";
  } catch {
    return "destination schema (invalid JSON)";
  }
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid gap-1 border-t border-rule py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4" data-testid={testId}>
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">{label}</dt>
      <dd className="min-w-0 text-sm leading-6">{children}</dd>
    </div>
  );
}

function RecordCounts({ candidate }: { candidate: ExportCandidate }) {
  const metrics = summarizeOutcomes(candidate.rows);
  const items: Array<[string, number, string]> = [
    ["Transformed, valid", metrics.transformedValid, "transformed"],
    ["Handled by an approved rule", metrics.handledByApprovedRule, "approved-rule"],
    ["Quarantined for review", metrics.quarantined, "quarantined"],
    ["Unresolved", metrics.unresolved, "unresolved"],
    ["Rejected by policy", metrics.rejectedByPolicy, "rejected"],
  ];
  return (
    <ul className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-5" data-testid={`outcome-records-${candidate.id}`}>
      {items.map(([label, value, key]) => (
        <li key={key} className="bg-panel p-3" data-testid={`outcome-count-${key}`} data-value={value}>
          <span className="block font-mono text-2xl leading-none">{value}</span>
          <span className="mt-1 block text-xs text-mute">{label}</span>
        </li>
      ))}
    </ul>
  );
}

export function OutcomeView({
  workspace,
  prepared,
  buildSha,
  events,
  onObserve,
  onConnect,
}: {
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  buildSha: string | null;
  /** Safe events of this run (for counts of model calls and export results only). */
  events: readonly WorkflowEvent[];
  onObserve: () => void;
  onConnect: () => void;
}) {
  const candidates = useMemo(() => exportCandidates(workspace, prepared), [workspace, prepared]);
  const best = bestCandidate(candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })));
  const bestFull = candidates.find((candidate) => candidate.id === best?.id) ?? null;
  const report = workspace.report;

  if (!workspace.source || !prepared) {
    return (
      <section aria-labelledby="outcome-heading" data-testid="outcome" className="space-y-6">
        <EmptyState headingId="outcome-heading" title="No integration yet" testId="outcome-empty">
          Connect a source and a destination, then build the integration. The outcome appears here once the mapping has run locally.
        </EmptyState>
        <Button variant="primary" onClick={onConnect} data-testid="outcome-to-connect">
          Go to Connect
          <ArrowRightIcon />
        </Button>
      </section>
    );
  }

  const route = `${workspace.source.label} → ${schemaTitle(workspace.destinationText)}`;
  const revision = workspace.revision && workspace.revision.initialProposal === workspace.proposal ? workspace.revision : null;
  const review = workspace.review;
  const payload = review?.preview.payload ?? null;
  const categoryLabels = payload ? payload.fields.reduce((sum, field) => sum + (field.enumValues?.length ?? 0), 0) : 0;
  const cloudAuthorized = (review && (review.status === "approved" || review.status === "sent") ? 1 : 0) + (revision?.history.includes("REVISION_APPROVED") ? 1 : 0);
  const cloudSent = (review?.status === "sent" ? 1 : 0) + (revision?.history.includes("REVISION_SENT") ? 1 : 0);
  const modelCalls: string[] = [];
  if (workspace.proposal && workspace.proposal.origin !== "manual-edit") {
    const provenance = workspace.proposal.provenance;
    modelCalls.push(`Mapping proposal · ${ORIGIN_LABELS[workspace.proposal.origin]}${provenance ? ` · ${provenance.model}` : ""}`);
  } else if (workspace.cloudError) {
    modelCalls.push(`Mapping proposal · no result (${workspace.cloudError.code})`);
  }
  if (revision?.revised) {
    const provenance = revision.revised.provenance;
    modelCalls.push(`Revision · ${ORIGIN_LABELS[revision.revised.origin]}${provenance ? ` · ${provenance.model}` : ""}`);
  } else if (revision?.history.includes("REVISION_SENT")) {
    modelCalls.push(`Revision · no valid result (${revision.blocked?.failureCode ?? revision.phase})`);
  }
  const nanoRuns = events.filter((event) => event.kind === "on-device-probe" && event.ok && ["ON_DEVICE_SUGGESTED", "ON_DEVICE_RETRY_RECOVERED", "PRIVATE_SEMANTICS"].includes(event.code ?? "")).length;
  const lastExport = [...events].reverse().find((event) => event.kind === "export-package") ?? null;

  const active = candidates.find((candidate) => candidate.id === "active") ?? null;
  const revised = candidates.find((candidate) => candidate.id === "revised") ?? null;
  const initialContract = revision?.initialProposal.result.ok ? revision.initialProposal.result.value.converted.contract : null;
  const revisedContract = revision?.revised?.result.ok ? revision.revised.result.value.converted.contract : null;
  const changes = initialContract && revisedContract ? diffContracts(initialContract, revisedContract) : [];
  const decision = revision?.decision ?? null;

  return (
    <section aria-labelledby="outcome-heading" data-testid="outcome" className="space-y-6">
      <header className="grid gap-4 border-b border-rule pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <Eyebrow className="[overflow-wrap:anywhere]">Outcome · {route}</Eyebrow>
          <h2 id="outcome-heading" className="mt-2 font-display text-4xl leading-[1.02] tracking-[-0.01em] sm:text-5xl" data-testid="outcome-headline" data-state={bestFull && report ? bestFull.eligibility.state : "NONE"}>
            {bestFull && report ? HEADLINE[bestFull.eligibility.state] : "No verified evidence yet."}
          </h2>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-ink-text">
            {report
              ? `${candidates.length > 1 && bestFull ? `Strongest candidate: ${bestFull.label}. ` : ""}Structure, meaning and record outcomes are judged separately by local, deterministic checks. Nothing here claims production readiness.`
              : "The mapping has not run against your records yet. Open Observe to approve the request, receive a mapping and run the Reality Check."}
          </p>
        </div>
        <Button variant="outline" onClick={onObserve} data-testid="outcome-to-observe">
          Back to Observe
        </Button>
      </header>

      {!report || !bestFull ? null : (
        <Panel tone="plain" aria-labelledby="outcome-overview-heading" data-testid="outcome-overview">
          <PanelHeader id="outcome-overview-heading" title="What was built" eyebrow="Overview" zone="verified" zoneText="Computed locally" />
          <dl className="mt-4">
            <Row label="Integration">{route}</Row>
            <Row label="Mapping" testId="outcome-mapping">
              {bestFull.label}
              {bestFull.aliasContract ? (
                <span className="ml-2 font-mono text-xs text-mute">
                  {bestFull.aliasContract.mappingId} · {bestFull.aliasContract.operations.length} operations
                </span>
              ) : null}
              {candidates.length > 1 ? <span className="mt-1 block text-xs text-mute">Showing the strongest of {candidates.length} candidates. Nothing is promoted automatically; you choose what to export below.</span> : null}
            </Row>
            <Row label="Contract" testId="outcome-contract">
              <StatusMark status={bestFull.report?.statuses.mappingContract === "pass" ? "pass" : "fail"}>
                {bestFull.report?.statuses.mappingContract === "pass" ? "Valid Mapping Contract · eight allowlisted operations only" : "Contract refused"}
              </StatusMark>
            </Row>
            <Row label="Structure" testId="outcome-structure">
              <StatusMark status={bestFull.report?.overall === "pass" ? "pass" : "warn"}>
                {bestFull.report ? `${bestFull.report.passed} of ${bestFull.report.total} records produced a schema-valid output` : "not run"}
              </StatusMark>
              <span className="block text-xs text-mute">Schema validity is structure, not correctness.</span>
            </Row>
            <Row label="Meaning" testId="outcome-meaning">
              {bestFull.semantic ? (
                <>
                  {bestFull.semantic.overall === "SEMANTIC_PASS" && bestFull.semantic.coverage.unknown > 0 ? (
                    <StatusMark status="warn">No conflict in the checked fields · the rest is unknown, not verified</StatusMark>
                  ) : (
                    <StatusMark status={SEMANTIC_TEXT[bestFull.semantic.overall]?.[0] ?? "warn"}>{SEMANTIC_TEXT[bestFull.semantic.overall]?.[1] ?? bestFull.semantic.overall}</StatusMark>
                  )}
                  <span className="block font-mono text-xs text-mute">
                    {bestFull.semantic.coverage.verified} of {bestFull.semantic.coverage.fields} destination fields verified · {bestFull.semantic.coverage.unknown} unknown · {bestFull.semantic.coverage.mismatched} conflicting
                  </span>
                </>
              ) : (
                <StatusMark status="not_evaluated">Not evaluated for this mapping — unknown, not verified</StatusMark>
              )}
            </Row>
            <Row label="Records" testId="outcome-records">
              <RecordCounts candidate={bestFull} />
              <span className="mt-2 block text-xs text-mute">Counts from the local evaluator under policy {(workspace.scenario?.policy.policyId ?? "strict")}. Quarantine is never counted as a successful transformation.</span>
            </Row>
            <Row label="Export" testId="outcome-eligibility">
              <StatusMark status={STATE_STATUS[bestFull.eligibility.state]}>
                {bestFull.eligibility.decision === "EXPORTABLE" ? "Exportable" : bestFull.eligibility.decision === "DRAFT_ONLY" ? "Draft export only, after confirmation" : "Not exportable"}
              </StatusMark>
              {bestFull.eligibility.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-mute">
                  {bestFull.eligibility.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Row>
          </dl>
        </Panel>
      )}

      {revision && active && (revised || revision.phase === "REVISION_REJECTED" || revision.phase === "REVISION_BLOCKED") ? (
        <Panel tone="plain" aria-labelledby="outcome-compare-heading" data-testid="outcome-before-after">
          <PanelHeader id="outcome-compare-heading" title="Initial mapping vs. revised mapping" eyebrow="Before / after" zone="verified" zoneText="Local evaluator · not the model">
            Both mappings ran through the same local checks. The recommendation is computed without ground truth and is never applied automatically.
          </PanelHeader>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[active, revised].map((candidate, index) => (
              <div key={index === 0 ? "initial" : "revised"} className={index === 0 ? "border border-rule p-4" : "border border-dashed border-violet-soft/60 p-4"} data-testid={index === 0 ? "outcome-initial" : "outcome-revised"}>
                <Eyebrow>{index === 0 ? "Initial mapping" : "Revised mapping"}</Eyebrow>
                {candidate ? (
                  <>
                    <p className="mt-1 text-sm font-medium">{candidate.label}</p>
                    <p className="mt-2">
                      <StatusMark status={STATE_STATUS[candidate.eligibility.state]}>{candidate.eligibility.state.replace(/_/g, " ").toLowerCase()}</StatusMark>
                    </p>
                    <div className="mt-3">
                      <RecordCounts candidate={candidate} />
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-mute">{revision.phase === "REVISION_REJECTED" ? "Rejected by contract validation and never ran. It was not repaired." : "No revised mapping was received."}</p>
                )}
              </div>
            ))}
          </div>
          {decision ? (
            <div className="mt-4 border-l-2 border-violet-soft pl-4" data-testid="outcome-decision" data-verdict={decision.verdict}>
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-violet-soft">Recommendation · {decision.verdict}</p>
              <p className="mt-1 text-sm">{REVISION_VERDICT_TEXT[decision.verdict]}</p>
              <p className="mt-1 font-mono text-xs text-mute">
                clean transformations {decision.cleanTransformations.before} → {decision.cleanTransformations.after} · improved records {decision.improvedRows} · regressed records {decision.regressedRows} · operation regressions {decision.operationRegressions}
              </p>
            </div>
          ) : null}
          {changes.length > 0 ? (
            <ul className="mt-4 grid gap-1 text-sm" data-testid="outcome-changes">
              {changes.map((change) => (
                <li key={change.to} className="flex flex-wrap items-center gap-2">
                  <FieldToken kind="destination">{change.to}</FieldToken>
                  <span className={change.change === "unchanged" ? "font-mono text-xs text-mute" : "font-mono text-xs text-violet-soft"}>
                    {change.change}
                    {change.beforeNumber ? ` · was #${change.beforeNumber}` : ""}
                    {change.afterNumber ? ` · now #${change.afterNumber}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      <Panel tone="plain" aria-labelledby="outcome-privacy-heading" data-testid="outcome-privacy">
        <PanelHeader id="outcome-privacy-heading" title="What stayed private, and what crossed" eyebrow="Privacy outcome" zone="approval" zoneText="From this session's state">
          A Phantom Twin reduces what is disclosed; it is not anonymization. Approved aliases, category labels and destination field names can still reveal
          structure.
        </PanelHeader>
        <dl className="mt-4 grid gap-px border border-rule bg-rule sm:grid-cols-2">
          <div className="border-l-4 border-l-ink bg-panel p-3" data-testid="privacy-local">
            <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mute"><LockIcon size={12} /> Stayed in this browser</dt>
            <dd className="mt-1 text-sm">
              {workspace.source.records.length} records{workspace.reservedRecords ? ` and ${workspace.reservedRecords.length} hidden cases` : ""}, source field names, alias bindings, on-device prompts and findings. None of
              them is part of any cloud request this app made.
            </dd>
          </div>
          <div className="border-l-4 border-l-cyan-ink bg-panel p-3" data-testid="privacy-disclosed">
            <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mute"><PhantomIcon size={12} /> Approved for disclosure</dt>
            <dd className="mt-1 text-sm">
              {payload
                ? `${payload.fields.length} aliases · ${payload.syntheticExamples.length} fictional rows · ${categoryLabels} category labels · ${payload.target?.fields.length ?? 0} destination field names`
                : "Nothing has been approved."}
              {revision?.feedback && revision.history.includes("REVISION_APPROVED") ? ` · plus one revision request with ${revision.feedback.value.findings.length} findings (no values)` : ""}
            </dd>
          </div>
          <div className="border-l-4 border-l-gold-ink bg-panel p-3" data-testid="privacy-requests">
            <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mute"><SealIcon size={12} /> Cloud requests</dt>
            <dd className="mt-1 text-sm">
              {cloudAuthorized} authorized by you · {cloudSent} sent. Each approval was single-use and bound to one prompt hash.
            </dd>
          </div>
          <div className="border-l-4 border-l-gold-ink bg-panel p-3" data-testid="privacy-models">
            <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mute"><CloudIcon size={12} /> Model calls</dt>
            <dd className="mt-1 text-sm">
              {modelCalls.length === 0 && nanoRuns === 0 ? "No model was called." : null}
              {modelCalls.length > 0 ? (
                <ul className="space-y-0.5">
                  {modelCalls.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {nanoRuns > 0 ? <span className="block">On-device interpretation · {nanoRuns} run{nanoRuns === 1 ? "" : "s"} · nothing left the device</span> : null}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-mute" data-testid="privacy-checks">
          Local privacy checks: {payload ? "the disclosure passed the private-value leak screen before you could approve it" : "no disclosure was prepared"}
          {lastExport ? `; the last export ${lastExport.ok ? "passed" : "was blocked by"} the package privacy scan${lastExport.ok ? "" : ` (${lastExport.code ?? "FAILED"})`}` : "; no package has been built yet"}.
        </p>
      </Panel>

      <div id="export" className="scroll-mt-24 space-y-3">
        <ExportPanel workspace={workspace} prepared={prepared} buildSha={buildSha} />
        <p className="text-xs leading-5 text-mute" data-testid="export-not-deploy">
          Exporting downloads a ZIP; it does not deploy anything. To run it on real data, create a bindings file in your own environment
          (<span className="font-mono">node run.mjs bindings-template</span>), map each alias to your real field names there, and run it with Node 22. The bindings never
          come from this app.
        </p>
      </div>
    </section>
  );
}
