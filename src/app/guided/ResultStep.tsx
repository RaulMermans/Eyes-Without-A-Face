import { useMemo } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon, CheckIcon, CloudIcon, CrossIcon, DashIcon, LockIcon, SealIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import type { MappingOperation } from "../../domain/contracts/types.ts";
import { guidanceForFailure } from "../../inference/failure-guidance.ts";
import type { InferenceServices } from "../../inference/types.ts";
import { summarizeOutcomes } from "../../verification/outcomes.ts";
import type { PreparedTwin } from "../../workflow/pipeline.ts";
import { BlindRevisionPanel } from "../BlindRevisionPanel.tsx";
import { ExportPanel } from "../ExportPanel.tsx";
import type { ExportCandidate } from "../export-context.ts";
import { meaningSentence } from "../outcome-verdict.ts";
import { ORIGIN_LABELS } from "../result-kind.ts";
import { bestCandidate } from "../runtime-model.ts";
import type { WorkspaceState } from "../workspace-state.ts";
import type { GuidedStatus } from "./guided-status.ts";
import { transformedCsv, transformedJson, transformedRecords } from "./transformed-output.ts";

/**
 * Guided step 3 — the run and its result (Sprint 13, A5 / A6 / D / E).
 *
 * Everything shown is read from workspace state and the local evaluators.
 * The approval card is the existing single-use gate in plain words: the
 * button approves THIS preview and sends it, once. A blind revision keeps its
 * own, separate approval (BlindRevisionPanel).
 */
export function ResultStep({
  workspace,
  prepared,
  candidates,
  status,
  cloudAvailable,
  inference,
  buildSha,
  sending,
  onApproveAndSend,
  onReject,
  onStopWaiting,
  onPrepareFresh,
  onChange,
  onTechnical,
  onEditData,
  onEditDestination,
}: {
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  candidates: readonly ExportCandidate[];
  status: GuidedStatus;
  cloudAvailable: boolean;
  inference: InferenceServices;
  buildSha: string | null;
  sending: boolean;
  onApproveAndSend: () => void;
  onReject: () => void;
  onStopWaiting: () => void;
  onPrepareFresh: () => void;
  onChange: (next: WorkspaceState) => void;
  onTechnical: () => void;
  onEditData: () => void;
  onEditDestination: () => void;
}) {
  const review = workspace.review;
  const best = bestCandidate(candidates.map((candidate) => ({ id: candidate.id, label: candidate.label, eligibility: candidate.eligibility })));
  const candidate = candidates.find((item) => item.id === best?.id) ?? null;
  const showOutcome = Boolean(workspace.report && candidate);

  if (!workspace.source) {
    return (
      <section aria-labelledby="result-heading" className="space-y-4" data-testid="guided-result">
        <h2 id="result-heading" tabIndex={-1} className="focus:outline-none font-display text-4xl">No integration yet</h2>
        <p className="text-ink-text">Add your data and choose a destination first.</p>
        <Button variant="primary" onClick={onEditData} data-testid="result-to-data">
          Add your data <ArrowRightIcon />
        </Button>
      </section>
    );
  }

  const failure = workspace.cloudError ? guidanceForFailure({ code: workspace.cloudError.code, stage: "cloud-mapping" }) : null;
  const proposalRejected = workspace.proposal && !workspace.proposal.result.ok;

  return (
    <section aria-labelledby="result-heading" className="space-y-6" data-testid="guided-result">
      <header className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold">Step 3 of 3</p>
        <StatusHeadline status={status} />
      </header>

      {status.id === "approval" && review && (review.status === "pending" || review.status === "approved") ? (
        <ApprovalCard workspace={workspace} cloudAvailable={cloudAvailable} sending={sending} onApproveAndSend={onApproveAndSend} onReject={onReject} onTechnical={onTechnical} />
      ) : null}

      {status.id === "generating" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="guided-waiting">
          <span className="text-ink-text">Only the approved request was sent. Your records stay here.</span>
          <Button size="sm" variant="ghost" onClick={onStopWaiting} data-testid="guided-stop">
            Stop waiting
          </Button>
        </div>
      ) : null}

      {status.id === "rejected" ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={onPrepareFresh} data-testid="guided-prepare-again">
            Review the request again
          </Button>
          <Button variant="ghost" onClick={onEditDestination}>Change the destination</Button>
        </div>
      ) : null}

      {failure && !showOutcome ? (
        <div className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-cloud-failure" data-code={workspace.cloudError?.code}>
          <p className="font-medium">{failure.title}</p>
          <p className="text-ink-text">{failure.what}</p>
          <p className="text-xs text-mute">The approval was used and is not reused. Trying again prepares a new request for you to approve.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={onPrepareFresh} data-testid="guided-fresh-request">
              Prepare a new request
            </Button>
            <Button variant="ghost" size="sm" onClick={onTechnical}>
              View technical details
            </Button>
          </div>
        </div>
      ) : null}

      {proposalRejected && !showOutcome ? (
        <div className="space-y-3 border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="guided-proposal-rejected">
          <p className="font-medium">Gemini's answer was not a usable mapping.</p>
          <p className="text-ink-text">EYES checked it locally and refused it. Nothing was run on your records.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={onPrepareFresh} data-testid="guided-retry-proposal">
              Prepare a new request
            </Button>
            <Button variant="ghost" size="sm" onClick={onTechnical}>
              See why in technical details
            </Button>
          </div>
        </div>
      ) : null}

      {showOutcome && candidate ? (
        <Outcome
          workspace={workspace}
          prepared={prepared}
          candidate={candidate}
          inference={inference}
          buildSha={buildSha}
          onChange={onChange}
        />
      ) : null}

      <nav aria-label="Change inputs" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-rule pt-4 text-sm">
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onEditData}>
          Change data
        </button>
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onEditDestination}>
          Change destination
        </button>
        <button type="button" className="text-ink-text underline-offset-4 hover:text-ink hover:underline" onClick={onTechnical} data-testid="result-technical">
          View technical details
        </button>
      </nav>
    </section>
  );
}

const TONE: Record<GuidedStatus["tone"], string> = {
  neutral: "text-ink",
  busy: "text-violet-soft",
  approval: "text-gold",
  pass: "text-pass",
  warn: "text-warn",
  fail: "text-fail",
};

function StatusHeadline({ status }: { status: GuidedStatus }) {
  const Icon = status.tone === "pass" ? CheckIcon : status.tone === "fail" ? CrossIcon : status.tone === "approval" ? SealIcon : status.tone === "warn" ? AlertIcon : DashIcon;
  return (
    <div role="status" aria-live="polite" data-testid="guided-status" data-status={status.id}>
      <h2 id="result-heading" className={`mt-2 flex items-center gap-3 font-display text-4xl leading-[1.05] tracking-[-0.01em] sm:text-5xl ${TONE[status.tone]}`}>
        <Icon size={28} className={status.tone === "busy" ? "status-pulse shrink-0" : "shrink-0"} />
        <span data-testid="guided-status-label">{status.label}</span>
      </h2>
      <p className="mt-3 text-base leading-7 text-ink-text" data-testid="guided-status-detail">
        {status.detail}
      </p>
    </div>
  );
}

function ApprovalCard({
  workspace,
  cloudAvailable,
  sending,
  onApproveAndSend,
  onReject,
  onTechnical,
}: {
  workspace: WorkspaceState;
  cloudAvailable: boolean;
  sending: boolean;
  onApproveAndSend: () => void;
  onReject: () => void;
  onTechnical: () => void;
}) {
  const review = workspace.review!;
  const payload = review.preview.payload;
  const targetCount = payload.target?.fields.length ?? 0;
  const records = workspace.source?.records.length ?? 0;
  const approved = review.status === "approved";
  return (
    <div className="frame-cloud rounded-[3px] bg-panel p-5 sm:p-6" data-testid="approval-card" data-payload-hash={review.preview.payloadHash}>
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <SealIcon size={18} className="text-gold" /> Approve one request to Gemini
      </h3>
      <p className="mt-1 text-sm text-ink-text">Gemini designs the mapping from a fictional stand-in for your data. EYES then runs and checks it here.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="border border-dashed border-gold/60 p-4" data-testid="approval-sent">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-gold">
            <CloudIcon size={13} /> Sent to Gemini
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>{payload.fields.length} field placeholders (like f_01) and their types</li>
            <li>{payload.syntheticExamples.length} invented example rows — not your values</li>
            <li>The {targetCount} destination field names and types</li>
          </ul>
        </div>
        <div className="border border-ink/50 p-4" data-testid="approval-kept">
          <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
            <LockIcon size={13} /> Stays on this device
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>Your {records} record{records === 1 ? "" : "s"}</li>
            <li>Your real field names</li>
            <li>Which placeholder is which field</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-mute">
        This approval covers this exact request once. If you change the data or destination, it is cleared and you will be asked again. A placeholder structure can still hint at
        what your data looks like, so read the request if in doubt.
      </p>
      <Disclosure summary="See exactly what will be sent" className="mt-3" testId="approval-exact">
        <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px] text-mute">
          <dt>sha256</dt>
          <dd className="[overflow-wrap:anywhere]" data-testid="approval-hash">{review.preview.outboundHash}</dd>
          <dt>request</dt>
          <dd>{review.preview.requestId}</dd>
          <dt>model</dt>
          <dd>{review.preview.destinationKey}</dd>
          <dt>size</dt>
          <dd>{review.preview.byteLength} bytes</dd>
        </dl>
        <pre className="max-h-80 overflow-auto rounded-[3px] border border-rule bg-void p-3 font-mono text-[11px] leading-5 text-ink whitespace-pre-wrap" data-testid="approval-prompt">
          {review.preview.outboundPrompt}
        </pre>
      </Disclosure>
      {!cloudAvailable ? (
        <p role="alert" className="mt-4 border border-warn/40 border-l-4 border-l-warn p-3 text-sm" data-testid="approval-cloud-unavailable">
          Gemini Cloud is not configured in this build, so this request cannot be sent. Nothing was sent. You can still write a mapping by hand in{" "}
          <button type="button" className="underline" onClick={onTechnical}>
            technical details
          </button>
          .
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="approve" size="lg" onClick={onApproveAndSend} disabled={!cloudAvailable || sending} data-testid="guided-approve">
          <SealIcon size={15} /> {approved ? "Send the approved request" : "Approve and send"}
        </Button>
        {!approved ? (
          <Button variant="ghost" onClick={onReject} disabled={sending} data-testid="guided-reject">
            Don't send
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describeOperation(operation: MappingOperation): string {
  switch (operation.op) {
    case "copy":
    case "rename":
      return `copied from ${operation.from}`;
    case "trim":
      return `${operation.from}, trimmed`;
    case "normalize_email":
      return `${operation.from}, as a normalized email`;
    case "parse_date":
      return `${operation.from}, read as a ${operation.params.inputFormat} date`;
    case "map_enum":
      return `${operation.from}, translated (${Object.entries(operation.params.map)
        .map(([from, to]) => `${from} → ${to}`)
        .join(", ")})${operation.params.unmapped === "default" ? `, otherwise ${String(operation.params.default)}` : ""}`;
    case "default_if_missing":
      return operation.from ? `${operation.from}, or ${JSON.stringify(operation.params.value)} when missing` : `always ${JSON.stringify(operation.params.value)}`;
    case "concat":
      return `${operation.from.join(" + ")} joined`;
  }
}

function download(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Outcome({
  workspace,
  prepared,
  candidate,
  inference,
  buildSha,
  onChange,
}: {
  workspace: WorkspaceState;
  prepared: PreparedTwin | null;
  candidate: ExportCandidate;
  inference: InferenceServices;
  buildSha: string | null;
  onChange: (next: WorkspaceState) => void;
}) {
  const report = workspace.report!;
  const imported = candidate.rows.filter((row) => row.set === "imported");
  const metrics = summarizeOutcomes(imported);
  const reservedRows = candidate.rows.filter((row) => row.set === "reserved");
  const reservedPassed = reservedRows.filter((row) => row.outcome === "TRANSFORMED_VALID" || row.outcome === "HANDLED_BY_APPROVED_RULE").length;
  const meaning = meaningSentence(candidate.semantic);
  const output = useMemo(() => transformedRecords(report), [report]);
  const needsReview = metrics.unresolved + metrics.rejectedByPolicy + metrics.incorrect;
  const transformed = metrics.transformedValid + metrics.handledByApprovedRule;
  // Structure is judged on YOUR records here; the reserved test cases have their own line below.
  const importedRows = report.rows.filter((row) => row.set === "imported");
  const importedValid = importedRows.filter((row) => row.status === "pass").length;
  const structureOk = importedRows.length > 0 && importedValid === importedRows.length;
  const issues = report.rows.filter((row) => row.status === "fail").flatMap((row) => row.safeIssues.map((issue) => ({ set: row.set, setIndex: row.setIndex, issue })));
  const verified = candidate.eligibility.state === "VERIFIED" || candidate.eligibility.state === "VERIFIED_WITH_EXCEPTIONS";
  const sourceLabel = workspace.source?.label ?? "source";
  const operations = candidate.executable?.operations ?? [];

  return (
    <div className="space-y-6" data-testid="guided-outcome" data-state={candidate.eligibility.state}>
      <p className="text-sm text-ink-text" data-testid="guided-route">
        <span className="font-mono text-ink">{sourceLabel}</span> → <span className="font-mono text-ink">{summaryTitle(workspace.destinationText)}</span>
        {candidate.provenance || workspace.proposal ? (
          <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute" data-testid="guided-origin">
            · mapping: {workspace.proposal ? ORIGIN_LABELS[workspace.proposal.origin] : "hand-written"}
          </span>
        ) : null}
      </p>

      <dl className="grid grid-cols-3 gap-px border border-rule bg-rule" data-testid="guided-counts">
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Transformed</dt>
          <dd className="font-mono text-3xl text-pass" data-testid="guided-count-transformed">{transformed}</dd>
        </div>
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Set aside for review</dt>
          <dd className="font-mono text-3xl" data-testid="guided-count-quarantined">{metrics.quarantined}</dd>
        </div>
        <div className="bg-panel p-4">
          <dt className="text-xs text-mute">Need attention</dt>
          <dd className={`font-mono text-3xl ${needsReview > 0 ? "text-fail" : ""}`} data-testid="guided-count-attention">{needsReview}</dd>
        </div>
      </dl>
      <p className="-mt-3 text-xs text-mute">Of your {imported.length} record{imported.length === 1 ? "" : "s"}. Records set aside are not counted as transformed.</p>

      <ul className="space-y-2 text-sm" data-testid="guided-checks">
        <CheckRow
          ok={structureOk}
          label="Structure"
          detail={structureOk ? "Every one of your records produced a valid destination record." : `${importedValid} of ${importedRows.length} of your records produced a valid destination record.`}
          testId="check-structure"
        />
        <CheckRow ok={meaning.complete ? true : candidate.semantic?.overall === "SEMANTIC_MISMATCH" ? false : null} label="Meaning" detail={meaning.text} testId="check-meaning" />
        {reservedRows.length > 0 ? (
          <CheckRow
            ok={reservedPassed === reservedRows.length ? true : report.statuses.hiddenCases === "fail" ? false : null}
            label="Test cases"
            detail={`${reservedPassed} of ${reservedRows.length} reserved test cases handled. Gemini never saw them.`}
            testId="check-hidden"
          />
        ) : null}
      </ul>
      {candidate.eligibility.reasons.length > 0 && !verified ? (
        <div className="text-sm text-ink-text" data-testid="guided-reason">
          <p className="font-medium text-ink">Why it is not ready</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {candidate.eligibility.reasons.slice(0, 3).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ExportPanel workspace={workspace} prepared={prepared} buildSha={buildSha} compact />

      <div className="space-y-3 border-t border-rule pt-4">
        <Disclosure summary={`Preview transformed data (${output.records.length})`} testId="guided-preview">
          {output.records.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-xs" data-testid="guided-preview-table">
                  <thead>
                    <tr className="border-b border-rule">
                      {Object.keys(output.records[0]!).map((key) => (
                        <th key={key} scope="col" className="py-1.5 pr-3 font-mono font-normal text-mute">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {output.records.slice(0, 10).map((record, index) => (
                      <tr key={index} className="border-b border-rule/50">
                        {Object.keys(output.records[0]!).map((key) => (
                          <td key={key} className="max-w-[14rem] truncate py-1.5 pr-3 font-mono">{String(record[key] ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => download(transformedJson(output), "transformed-records.json", "application/json")} data-testid="download-transformed-json">
                  Download JSON
                </Button>
                <Button size="sm" onClick={() => download(transformedCsv(output), "transformed-records.csv", "text/csv")} data-testid="download-transformed-csv">
                  Download CSV
                </Button>
              </div>
              <p className="mt-2 text-xs text-mute">These files contain your real records after the mapping. They are saved to your computer only and are never part of the integration package.{output.excluded > 0 ? ` ${output.excluded} record(s) that did not pass are left out.` : ""}</p>
            </>
          ) : (
            <p className="text-sm text-mute">No record passed, so there is nothing to preview.</p>
          )}
        </Disclosure>

        {issues.length > 0 ? (
          <Disclosure summary={`Review issues (${issues.length})`} testId="guided-issues">
            <ul className="space-y-1.5 text-sm">
              {issues.slice(0, 20).map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-mute">{item.set === "imported" ? `record ${item.setIndex + 1}` : `test case ${item.setIndex + 1}`}</span>
                  <span>{item.issue.explanation}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}

        {operations.length > 0 ? (
          <Disclosure summary={`View mapping (${operations.length} rules)`} testId="guided-mapping">
            <ol className="space-y-1 text-sm">
              {operations.map((operation, index) => (
                <li key={index} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-ink">{operation.to}</span>
                  <span className="text-ink-text">← {describeOperation(operation)}</span>
                </li>
              ))}
            </ol>
          </Disclosure>
        ) : null}

        {!verified && workspace.proposal?.result.ok ? (
          <Disclosure summary="Ask Gemini for one revision (needs a separate approval)" testId="guided-revision">
            <BlindRevisionPanel workspace={workspace} onChange={onChange} prepared={prepared} inference={inference} />
          </Disclosure>
        ) : null}

      </div>
    </div>
  );
}

function CheckRow({ ok, label, detail, testId }: { ok: boolean | null; label: string; detail: string; testId: string }) {
  const Icon = ok === true ? CheckIcon : ok === false ? CrossIcon : DashIcon;
  return (
    <li className="flex items-start gap-2" data-testid={testId} data-ok={ok === null ? "unknown" : String(ok)}>
      <Icon size={15} className={`mt-1 shrink-0 ${ok === true ? "text-pass" : ok === false ? "text-fail" : "text-warn"}`} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="text-mute"> · {ok === null ? "not verified" : ok ? "passed" : "failed"}</span>
        <span className="block text-ink-text">{detail}</span>
      </span>
    </li>
  );
}

function summaryTitle(text: string): string {
  try {
    const title = (JSON.parse(text) as { title?: unknown }).title;
    return typeof title === "string" ? title.replace(/ destination$/i, "") : "destination";
  } catch {
    return "destination";
  }
}
