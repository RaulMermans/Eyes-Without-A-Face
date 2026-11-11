import { useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { runRealityCheck, type RealityCheckStatuses } from "../verification/reality-check.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { ORIGIN_LABELS } from "./result-kind.ts";
import type { WorkspaceState } from "./workspace-state.ts";

const STATUS_ROWS: ReadonlyArray<readonly [keyof RealityCheckStatuses, string]> = [
  ["mappingContract", "Mapping contract"],
  ["targetSchema", "Target schema"],
  ["execution", "Execution"],
  ["outputSchema", "Output schema"],
  ["hiddenCases", "Hidden cases"],
];

export function VerificationPanel({
  workspace,
  onChange,
  prepared,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
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

  return (
    <section aria-labelledby="verification-heading" className="border border-rule bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="verification-heading" className="text-base font-semibold">
          Local mapping execution
        </h3>
        <Badge className="border-local/50 text-local">Local only · deterministic engine</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-mute">
        Aliases are resolved to the private fields inside this page, then the Sprint 2 engine runs
        every record and validates it against the destination JSON Schema. Failures are reported,
        never auto-corrected, and never sent to Gemini.
      </p>

      <fieldset className="mt-4 space-y-1 text-sm" data-testid="mapping-choice">
        <legend className="font-medium">Mapping to run</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mapping-choice"
            checked={useProposal}
            disabled={!accepted}
            onChange={() => onChange({ ...workspace, mappingChoice: "proposal", report: null })}
          />
          Validated proposal{proposal ? ` (${ORIGIN_LABELS[proposal.origin]})` : " — none yet"}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mapping-choice"
            checked={!useProposal}
            onChange={() => onChange({ ...workspace, mappingChoice: "manual", report: null })}
          />
          Manual local contract (Sprint 2 baseline, not AI)
        </label>
      </fieldset>
      <p className="mt-2 text-xs text-mute" data-testid="active-mapping-origin">
        Active mapping: {useProposal && proposal ? `${ORIGIN_LABELS[proposal.origin]} · resolved locally` : "Manual local contract"}
      </p>

      {reserved ? (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeReserved}
            onChange={(event) => setIncludeReserved(event.target.checked)}
            data-testid="include-reserved"
          />
          Include {reserved.length} reserved hidden cases (never profiled, never disclosed)
        </label>
      ) : null}

      <div className="mt-4">
        <Button variant="primary" onClick={run} data-testid="run-mapping">
          Run Reality Check
        </Button>
      </div>
      {workspace.mappingRunError ? (
        <div className="mt-4" data-testid="mapping-run-error">
          <ErrorBanner title="Mapping did not run">{workspace.mappingRunError}</ErrorBanner>
        </div>
      ) : null}
      {report ? (
        <div className="mt-4 space-y-3 text-sm" data-testid="mapping-results">
          <p data-testid="mapping-summary" className="font-medium">
            {report.passed} passed · {report.failed} failed · {report.total} records ·{" "}
            {report.failed === 0 && report.total > 0 ? "batch ok" : "batch failed"}
          </p>
          <p
            className={`text-xs font-medium ${report.overall === "pass" ? "" : "text-danger"}`}
            data-testid="reality-overall"
            data-status={report.overall}
          >
            Reality Check verdict: {report.overall === "pass" ? "PASS" : "FAIL"}
          </p>
          <dl className="grid gap-1 text-xs sm:grid-cols-2" data-testid="reality-summary">
            {STATUS_ROWS.map(([key, label]) => (
              <div key={key}>
                <dt className="inline text-mute">{label}: </dt>
                <dd className="inline font-mono" data-testid={`status-${key}`} data-status={report.statuses[key]}>
                  {report.statuses[key]}
                </dd>
              </div>
            ))}
            <div>
              <dt className="inline text-mute">Reserved hidden cases: </dt>
              <dd className="inline" data-testid="reserved-summary">
                {report.reservedTotal === 0 ? "none run" : `${report.reservedFailed} of ${report.reservedTotal} failed`}
              </dd>
            </div>
            <div>
              <dt className="inline text-mute">Duration: </dt>
              <dd className="inline">{report.durationMs} ms</dd>
            </div>
          </dl>
          {report.failureCodes.length > 0 ? (
            <p className="text-xs" data-testid="failure-codes">
              Failure codes: {report.failureCodes.map((item) => `${item.code} ×${item.count}`).join(", ")}
            </p>
          ) : null}
          {report.blockingIssues.length > 0 ? (
            <div data-testid="mapping-batch-error">
              <ErrorBanner title="The mapping could not run as a whole">
                {report.blockingIssues.map((issue) => `${issue.code}: ${issue.explanation}`).join(" ")}
              </ErrorBanner>
            </div>
          ) : null}
          <ul className="space-y-2" data-testid="mapping-result-list">
            {report.rows.map((row) => (
              <li
                key={row.index}
                className={`border p-3 ${row.status === "pass" ? "border-rule" : "border-danger/40"}`}
                data-testid={`mapping-record-${row.index}`}
                data-status={row.status}
                data-set={row.set}
              >
                <p className="font-medium">
                  {row.set === "reserved" ? `Reserved hidden case ${row.setIndex}` : `Record ${row.setIndex}`} · {row.status}
                </p>
                {row.status === "pass" && row.output ? (
                  <pre className="mt-2 overflow-auto font-mono text-xs" data-testid={`mapping-output-${row.index}`}>
                    {JSON.stringify(row.output, null, 2)}
                  </pre>
                ) : (
                  <>
                    <ul className="mt-2 list-disc pl-5" data-testid={`safe-issues-${row.index}`}>
                      {row.safeIssues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}>
                          <span className="font-mono">{issue.code}</span>
                          {issue.op ? ` · ${issue.op}` : ""}
                          {typeof issue.operationIndex === "number" ? ` · op ${issue.operationIndex}` : ""}
                          {issue.alias ? ` · ${issue.alias}` : ""}: {issue.explanation}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 font-mono text-[11px] text-mute">
                      Reproduce: {row.set} set, record {row.setIndex}
                      {prepared ? `, twin seed ${prepared.twin.seed}` : ""}
                    </p>
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-mute">Local detail — may contain private values, stays in this browser</summary>
                      <ul className="mt-1 list-disc pl-5 text-mute" data-testid={`local-issues-${row.index}`}>
                        {row.localIssues.map((issue, index) => (
                          <li key={`${issue.code}-${index}`}>
                            {issue.code}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute">No results yet.</p>
      )}
    </section>
  );
}
