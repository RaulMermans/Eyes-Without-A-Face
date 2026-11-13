import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { GaugeIcon, SearchIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, FieldToken, Panel, PanelHeader, StatusMark, StatusIcon, type Status } from "../components/spectral.tsx";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { runRealityCheck, type RealityCheckReport, type RealityCheckRow, type RealityCheckStatuses } from "../verification/reality-check.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { ORIGIN_LABELS } from "./result-kind.ts";
import { opNumber } from "./view-model.ts";
import type { WorkspaceState } from "./workspace-state.ts";
import type { InferenceServices } from "../inference/types.ts";
import { BlindRevisionPanel } from "./BlindRevisionPanel.tsx";
import { ExportPanel } from "./ExportPanel.tsx";
import { SemanticPanel } from "./SemanticPanel.tsx";
import { SEMANTIC_LABEL } from "./semantic-labels.ts";
import { activeExecutable, computeWorkspaceSemantics } from "./semantic-context.ts";
import type { SemanticReport } from "../semantics/verify.ts";

const STATUS_ROWS: ReadonlyArray<readonly [keyof RealityCheckStatuses, string, string]> = [
  ["mappingContract", "Mapping contract", "Canonical schema, allowlisted operations, no executable content"],
  ["targetSchema", "Target schema", "Destination JSON Schema compiles"],
  ["execution", "Execution", "Every record produced an output"],
  ["outputSchema", "Output schema", "Every output satisfies the destination schema"],
  ["hiddenCases", "Hidden cases", "Every reserved hidden case passed"],
];

/** Plain-language next steps per failure code. Guidance only — nothing is changed automatically. */
const NEXT_STEP: Partial<Record<string, string>> = {
  UNMAPPED_ENUM: "Add the missing category to the operation's enum map, or switch unmapped to default with a reviewed default value.",
  TYPE_MISMATCH: "A hidden record carries a different type for this field. Decide whether the destination should reject it or the source needs cleaning.",
  NULL_VALUE: "A hidden record has null here. Consider default_if_missing or confirm that such records must be rejected.",
  MISSING_SOURCE_FIELD: "Some records omit this field. A default_if_missing operation can supply a reviewed constant.",
  INVALID_EMAIL: "The value is not a valid email after normalization. Check the source data or relax the destination format.",
  INVALID_DATE: "The value does not match the declared date format. Check the operation's inputFormat.",
  OUTPUT_SCHEMA_MISMATCH: "The produced record does not fit the destination schema. Check required fields and formats.",
  INVALID_MAPPING_CONTRACT: "The contract itself is invalid. Fix it before any record can run.",
  UNSUPPORTED_OPERATION: "Only the eight allowlisted operations can run.",
};

export function VerificationPanel({
  workspace,
  onChange,
  prepared,
  onInspectOperation,
  inference,
  buildSha = null,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  onInspectOperation: (index: number) => void;
  inference: InferenceServices;
  buildSha?: string | null;
}) {
  const [includeReserved, setIncludeReserved] = useState(true);
  const proposal = workspace.proposal;
  const accepted = proposal?.result.ok ? proposal.result.value : null;
  const useProposal = Boolean(accepted) && workspace.mappingChoice === "proposal";
  const reserved = workspace.reservedRecords;

  function run(): void {
    if (!workspace.source) {
      onChange({ ...workspace, mappingRunError: "Import a source dataset before running the local mapping engine.", report: null });
      return;
    }
    let mapping: unknown;
    let targetSchema: unknown;
    if (useProposal && accepted) {
      mapping = accepted.resolved.executable;
    } else {
      try {
        mapping = JSON.parse(workspace.mappingText) as unknown;
      } catch {
        onChange({ ...workspace, mappingRunError: "Mapping contract is not valid JSON.", report: null });
        return;
      }
    }
    try {
      targetSchema = JSON.parse(workspace.destinationText) as unknown;
    } catch {
      onChange({ ...workspace, mappingRunError: "Destination schema is not valid JSON.", report: null });
      return;
    }
    const report = runRealityCheck({
      records: workspace.source.records,
      reservedRecords: includeReserved && reserved ? reserved : [],
      mappingContract: mapping,
      targetSchema,
      bindings: useProposal ? (prepared?.twin.bindings ?? null) : null,
    });
    recordWorkflowEvent({
      kind: "reality-check",
      ok: report.overall === "pass",
      durationMs: report.durationMs,
      code: report.failureCodes[0]?.code,
      counts: { total: report.total, passed: report.passed, failed: report.failed, reserved: report.reservedTotal },
    });
    onChange({ ...workspace, report, mappingRunError: null });
  }


  const report = workspace.report;
  const canInspect = Boolean(report) && useProposal;
  const executable = activeExecutable(workspace);
  // Derived from workspace state on every render (tens of records): never stored.
  const semantics = report && executable ? computeWorkspaceSemantics(workspace, prepared, executable, report) : null;
  const semanticReport = semantics?.report ?? null;
  useEffect(() => {
    if (report && semanticReport && semanticReport.results.length > 0) recordSemanticEventOnce(report, semanticReport);
  }, [report, semanticReport]);

  return (
    <section className="space-y-5" aria-labelledby="verification-heading">
      <Panel tone="private">
        <PanelHeader id="verification-heading" title="Local mapping execution" eyebrow="Reality Check" zone="verified" zoneText="Local only · deterministic engine">
          Aliases are resolved to the private fields inside this page. The deterministic mapping engine then runs every record, plus reserved hidden
          cases that were never profiled or disclosed, and validates each output against the destination JSON Schema. Failures are reported, never
          auto-corrected, and never sent to Gemini.
        </PanelHeader>

        <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <fieldset className="space-y-2 text-sm" data-testid="mapping-choice">
            <legend className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Mapping to run</legend>
            <label className={`flex min-h-10 items-center gap-2 border px-3 ${useProposal ? "border-ink bg-bone" : "border-rule"} ${accepted ? "" : "opacity-60"}`}>
              <input
                type="radio"
                name="mapping-choice"
                className="accent-ink"
                checked={useProposal}
                disabled={!accepted}
                onChange={() => onChange({ ...workspace, mappingChoice: "proposal", report: null })}
              />
              Validated proposal{proposal ? ` (${ORIGIN_LABELS[proposal.origin]})` : " — none yet"}
            </label>
            <label className={`flex min-h-10 items-center gap-2 border px-3 ${!useProposal ? "border-ink bg-bone" : "border-rule"}`}>
              <input
                type="radio"
                name="mapping-choice"
                className="accent-ink"
                checked={!useProposal}
                onChange={() => onChange({ ...workspace, mappingChoice: "manual", report: null })}
              />
              Hand-written local contract (not AI)
            </label>
            <p className="text-xs text-mute" data-testid="active-mapping-origin">
              Active mapping: {useProposal && proposal ? `${ORIGIN_LABELS[proposal.origin]} · resolved locally` : "Hand-written local contract (not AI)"}
            </p>
          </fieldset>
          <div className="flex flex-col justify-between gap-3">
            {reserved ? (
              <label className="flex min-h-10 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-ink"
                  checked={includeReserved}
                  onChange={(event) => setIncludeReserved(event.target.checked)}
                  data-testid="include-reserved"
                />
                <span>
                  Include {reserved.length} reserved hidden cases (never profiled, never disclosed)
                  <span className="block text-xs text-mute">Cases the model never saw. This is where real limitations surface.</span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-mute">No reserved hidden cases for this dataset; only imported records will run.</p>
            )}
            <div>
              <Button variant="primary" size="lg" onClick={run} data-testid="run-mapping">
                <GaugeIcon /> Run Reality Check
              </Button>
            </div>
          </div>
        </div>
        {workspace.mappingRunError ? (
          <div className="mt-4" data-testid="mapping-run-error">
            <ErrorBanner title="Mapping did not run">{workspace.mappingRunError}</ErrorBanner>
          </div>
        ) : null}
      </Panel>

      {report ? (
        <div className="space-y-5 text-sm" data-testid="mapping-results">
          <VerdictCard report={report} semantic={semantics?.report ?? null} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <section aria-labelledby="validation-heading" className="border border-rule bg-panel p-4">
              <Eyebrow>Validation</Eyebrow>
              <h4 id="validation-heading" className="mt-1 font-semibold">
                Five independent checks
              </h4>
              <dl className="mt-3 divide-y divide-rule" data-testid="reality-summary">
                {STATUS_ROWS.map(([key, label, explanation]) => (
                  <div key={key} className="flex items-start gap-3 py-2">
                    <span className="mt-0.5"><StatusIcon status={report.statuses[key] as Status} size={16} /></span>
                    <dt className="min-w-0 flex-1 font-medium">
                      {label}
                      <span className="block text-xs font-normal text-mute">{explanation}</span>
                    </dt>
                    <dd
                      className={`font-mono text-xs ${report.statuses[key] === "pass" ? "text-pass" : report.statuses[key] === "fail" ? "text-fail" : "text-mute"}`}
                      data-testid={`status-${key}`}
                      data-status={report.statuses[key]}
                    >
                      {report.statuses[key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section aria-label="Run details" className="space-y-3 border border-rule bg-panel p-4">
              <Eyebrow>Run</Eyebrow>
              <p data-testid="mapping-summary" className="font-medium">
                {report.passed} passed · {report.failed} failed · {report.total} records · {report.failed === 0 && report.total > 0 ? "batch ok" : "batch failed"}
              </p>
              <p className={`text-xs font-medium ${report.overall === "pass" ? "text-pass" : "text-fail"}`} data-testid="reality-overall" data-status={report.overall}>
                Reality Check verdict: {report.overall === "pass" ? "PASS" : "FAIL"}
              </p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-mute">Reserved hidden cases</dt>
                <dd data-testid="reserved-summary">{report.reservedTotal === 0 ? "none run" : `${report.reservedFailed} of ${report.reservedTotal} failed`}</dd>
                <dt className="text-mute">Duration</dt>
                <dd>{report.durationMs} ms</dd>
                <dt className="text-mute">Mapping</dt>
                <dd>{useProposal && proposal ? ORIGIN_LABELS[proposal.origin] : "Hand-written local contract"}</dd>
              </dl>
              {report.failureCodes.length > 0 ? (
                <p className="text-xs" data-testid="failure-codes">
                  <span className="text-mute">Failure codes: </span>
                  <span className="font-mono">{report.failureCodes.map((item) => `${item.code} ×${item.count}`).join(", ")}</span>
                </p>
              ) : null}
            </section>
          </div>

          {report.blockingIssues.length > 0 ? (
            <div data-testid="mapping-batch-error">
              <ErrorBanner title="The mapping could not run as a whole">
                {report.blockingIssues.map((issue) => `${issue.code}: ${issue.explanation}`).join(" ")}
              </ErrorBanner>
            </div>
          ) : null}

          {semantics && executable ? (
            <SemanticPanel
              semantics={semantics}
              realityReport={report}
              executable={executable}
              onInspectOperation={canInspect ? onInspectOperation : null}
              onConfirmDate={(source, format) =>
                onChange({
                  ...workspace,
                  semanticConfirmations: { ...workspace.semanticConfirmations, [source]: format },
                  // The feedback projection depends on the semantic contract: any prepared request is void.
                  revision: null,
                  revisionConstraintIds: [],
                })
              }
            />
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2" data-testid="mapping-result-list">
            <RowGroup
              title="Imported records"
              note="Profiled locally; represented to the model only through the twin."
              rows={report.rows.filter((row) => row.set !== "reserved")}
              seed={prepared?.twin.seed ?? null}
              onInspect={canInspect ? onInspectOperation : null}
            />
            <RowGroup
              title="Hidden cases"
              note={report.reservedTotal === 0 ? "Not run." : "Never profiled, never disclosed. Failures here are findings, not crashes."}
              rows={report.rows.filter((row) => row.set === "reserved")}
              seed={prepared?.twin.seed ?? null}
              onInspect={canInspect ? onInspectOperation : null}
            />
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-ink/30 bg-panel/60 p-6 text-sm text-mute">
          <Eyebrow>No results yet</Eyebrow>
          <p className="mt-1">Run the Reality Check to execute the active mapping locally against the records and hidden cases.</p>
        </div>
      )}
      <BlindRevisionPanel workspace={workspace} onChange={onChange} prepared={prepared} inference={inference} />
      <ExportPanel workspace={workspace} prepared={prepared} buildSha={buildSha} />
    </section>
  );
}

function RowGroup({
  title,
  note,
  rows,
  seed,
  onInspect,
}: {
  title: string;
  note: string;
  rows: RealityCheckRow[];
  seed: number | null;
  onInspect: ((index: number) => void) | null;
}) {
  const passed = rows.filter((row) => row.status === "pass").length;
  return (
    <section className="min-w-0" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/30 pb-2">
        <h4 className="font-semibold">{title}</h4>
        <span className="font-mono text-xs text-mute">
          {rows.length === 0 ? "none" : `${passed} / ${rows.length} pass`}
        </span>
      </div>
      <p className="mt-1 text-xs text-mute">{note}</p>
      <ul className="mt-3 space-y-2">
        {rows.map((row, position) => (
          <li
            key={row.index}
            className={`animate-reveal border p-3 ${row.status === "pass" ? "border-rule bg-panel" : "border-warn/50 border-l-4 border-l-warn bg-warn/5"}`}
            style={{ "--i": position } as CSSProperties}
            data-testid={`mapping-record-${row.index}`}
            data-status={row.status}
            data-set={row.set}
          >
            <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
              <span>
                {row.set === "reserved" ? `Reserved hidden case ${row.setIndex}` : `Record ${row.setIndex}`} · {row.status}
              </span>
              {row.status === "pass" ? <StatusMark status="pass">transformed</StatusMark> : <StatusMark status="warn">finding</StatusMark>}
            </p>
            {row.status === "pass" && row.output ? (
              <pre className="mt-2 overflow-auto rounded-[3px] bg-bone p-2 font-mono text-xs" data-testid={`mapping-output-${row.index}`}>
                {JSON.stringify(row.output, null, 2)}
              </pre>
            ) : (
              <>
                <ul className="mt-2 space-y-2" data-testid={`safe-issues-${row.index}`}>
                  {row.safeIssues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`} className="text-sm">
                      <p className="[overflow-wrap:anywhere]">
                        <span className="font-mono font-medium text-fail">{issue.code}</span>
                        {issue.op ? ` · ${issue.op}` : ""}
                        {typeof issue.operationIndex === "number" ? ` · operation ${opNumber(issue.operationIndex)}` : ""}
                        {issue.alias ? ` · ${issue.alias}` : ""}: {issue.explanation}
                      </p>
                      {NEXT_STEP[issue.code] ? <p className="mt-0.5 text-xs text-mute">Next step: {NEXT_STEP[issue.code]}</p> : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {issue.alias ? <FieldToken kind="alias">{issue.alias}</FieldToken> : null}
                        {typeof issue.operationIndex === "number" && onInspect ? (
                          <Button size="sm" variant="outline" onClick={() => onInspect(issue.operationIndex as number)} data-testid={`inspect-op-${row.index}-${index}`}>
                            <SearchIcon size={12} /> Inspect operation {opNumber(issue.operationIndex)} in the studio
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-mono text-[11px] text-mute">
                  Reproduce: {row.set} set, record {row.setIndex}
                  {seed !== null ? `, twin seed ${seed}` : ""}
                </p>
                <Disclosure summary="Local detail — may contain private values, stays in this browser" className="mt-1 text-xs">
                  <ul className="list-disc pl-5 text-mute [overflow-wrap:anywhere]" data-testid={`local-issues-${row.index}`}>
                    {row.localIssues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        {issue.code}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Headline verdict. Separates "the imported records transformed" from "the
 * reserved hidden cases are covered" so a partial result never reads as full
 * success. The overall verdict is still the strict report.overall.
 */
const recordedSemanticRuns = new WeakSet<RealityCheckReport>();

/** One safe telemetry event per Reality Check report: codes and counts only. */
function recordSemanticEventOnce(report: RealityCheckReport, semantic: SemanticReport): void {
  if (recordedSemanticRuns.has(report)) return;
  recordedSemanticRuns.add(report);
  recordWorkflowEvent({
    kind: "semantic-verify",
    ok: semantic.overall === "SEMANTIC_PASS",
    code: semantic.overall,
    counts: {
      constraints: semantic.results.length,
      mismatched: semantic.coverage.mismatched,
      verified: semantic.coverage.verified,
      unknown: semantic.coverage.unknown,
    },
  });
}

function VerdictCard({ report, semantic }: { report: RealityCheckReport; semantic: SemanticReport | null }) {
  const imported = report.rows.filter((row) => row.set !== "reserved");
  const importedPassed = imported.filter((row) => row.status === "pass").length;
  const reservedPassed = report.reservedTotal - report.reservedFailed;
  const ran = report.blockingIssues.length === 0 && report.total > 0;
  let headline: string;
  let detail: string;
  const meaningFails = semantic?.overall === "SEMANTIC_MISMATCH" || semantic?.overall === "SEMANTIC_POLICY_CONFLICT";
  if (report.overall === "pass" && meaningFails) {
    headline = "Structurally valid · meaning is wrong";
    detail = "Every record produced schema-valid output, but the semantic verifier found outputs that contradict trusted evidence. See Semantic verification below.";
  } else if (report.overall === "pass") {
    headline = semantic?.overall === "SEMANTIC_PASS" ? "PASS · structure and checked meaning hold" : "PASS · structure holds";
    detail =
      report.reservedTotal > 0
        ? "Every imported record and every reserved hidden case produced valid destination output."
        : "Every imported record produced valid destination output. No reserved hidden cases were run.";
  } else if (!ran) {
    headline = "FAIL · the mapping could not run";
    detail = "The contract or destination schema was refused before any record was processed.";
  } else if (importedPassed === imported.length && report.reservedFailed > 0) {
    headline = "FAIL · gaps found in cases the model never saw";
    detail = `The mapping transforms all ${imported.length} imported records, but ${report.reservedFailed} of ${report.reservedTotal} reserved hidden cases break it. These records were never profiled or disclosed, so no model could have planned for them. Each failure is a real limitation of this mapping, found locally before production.`;
  } else {
    headline = "FAIL · imported records failed";
    detail = `${imported.length - importedPassed} of ${imported.length} imported records did not produce valid destination output.`;
  }
  const importedOk = importedPassed === imported.length && ran;
  const reservedTone = report.reservedTotal === 0 ? "text-mute" : report.reservedFailed === 0 ? "text-pass" : "text-fail";
  return (
    <section
      className={`on-ink animate-reveal overflow-hidden border bg-ink text-bone ${report.overall === "pass" ? "border-pass" : "border-ink"}`}
      data-testid="reality-verdict"
      data-status={report.overall}
      aria-label="Reality Check verdict"
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className={`border-l-[6px] p-5 sm:p-6 ${report.overall === "pass" ? "border-l-pass" : "border-l-fail"}`}>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-text">Reality Check · deterministic · this browser</p>
          <p className="mt-2 font-display text-3xl leading-tight sm:text-4xl" role="status">
            {headline}
          </p>
          <p className="mt-3 max-w-[60ch] leading-6 text-ink-text">{detail}</p>
          {semantic ? (
            <p className="mt-2 font-mono text-xs text-ink-text" data-testid="verdict-semantic" data-status={semantic.overall}>
              Meaning: {SEMANTIC_LABEL[semantic.overall]} · {semantic.coverage.verified}/{semantic.coverage.fields} fields verified
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 border-t border-ink-3 lg:border-l lg:border-t-0">
          <div className="border-r border-ink-3 p-5">
            <dt className="text-xs text-ink-text">Imported records transformed</dt>
            <dd className={`mt-2 font-mono text-4xl ${importedOk ? "text-cyan" : "text-[#e48a8a]"}`} data-testid="verdict-imported">
              {importedPassed} / {imported.length}
            </dd>
            <p className="mt-1 text-[11px] text-ink-text">{importedOk ? "all transformed" : "some failed"}</p>
          </div>
          <div className="p-5">
            <dt className="text-xs text-ink-text">Reserved hidden cases covered</dt>
            <dd
              className={`mt-2 font-mono text-4xl ${reservedTone === "text-mute" ? "text-ink-text" : reservedTone === "text-pass" ? "text-cyan" : "text-[#e48a8a]"}`}
              data-testid="verdict-reserved"
            >
              {report.reservedTotal === 0 ? "not run" : `${reservedPassed} / ${report.reservedTotal}`}
            </dd>
            <p className="mt-1 text-[11px] text-ink-text">
              {report.reservedTotal === 0 ? "include them to test the unseen" : report.reservedFailed === 0 ? "all covered" : `${report.reservedFailed} finding${report.reservedFailed === 1 ? "" : "s"} to inspect below`}
            </p>
          </div>
        </dl>
      </div>
    </section>
  );
}
