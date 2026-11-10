import { executeMappingBatch } from "../domain/mapping/batch.ts";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import type { WorkspaceState } from "./workspace-state.ts";

export function VerificationPanel({
  workspace,
  onChange,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
}) {
  function run(): void {
    if (!workspace.source) {
      onChange({
        ...workspace,
        mappingRunError: "Import a source dataset before running the local mapping engine.",
        batch: null,
      });
      return;
    }
    let mapping: unknown;
    let targetSchema: unknown;
    try {
      mapping = JSON.parse(workspace.mappingText) as unknown;
    } catch {
      onChange({ ...workspace, mappingRunError: "Mapping contract is not valid JSON.", batch: null });
      return;
    }
    try {
      targetSchema = JSON.parse(workspace.destinationText) as unknown;
    } catch {
      onChange({ ...workspace, mappingRunError: "Destination schema is not valid JSON.", batch: null });
      return;
    }
    const batch = executeMappingBatch({
      sourceRecords: workspace.source.records,
      mappingContract: mapping,
      targetSchema,
    });
    onChange({ ...workspace, batch, mappingRunError: null });
  }

  const batch = workspace.batch;

  return (
    <section aria-labelledby="verification-heading" className="border border-rule bg-panel p-5">
      <h3 id="verification-heading" className="text-base font-semibold">
        Local mapping execution
      </h3>
      <p className="mt-2 text-sm leading-6 text-mute">
        The engine runs in this page. It does not call Firebase, Gemini, or any network service.
        Failed records are listed; there is no silent partial success.
      </p>
      <div className="mt-4">
        <Button variant="primary" onClick={run} data-testid="run-mapping">
          Run local mapping
        </Button>
      </div>
      {workspace.mappingRunError ? (
        <div className="mt-4" data-testid="mapping-run-error">
          <ErrorBanner title="Mapping did not run">{workspace.mappingRunError}</ErrorBanner>
        </div>
      ) : null}
      {batch ? (
        <div className="mt-4 space-y-3 text-sm" data-testid="mapping-results">
          <p data-testid="mapping-summary">
            {batch.passed} passed · {batch.failed} failed · {batch.results.length} records ·{" "}
            {batch.ok ? "batch ok" : "batch failed"}
          </p>
          <ul className="space-y-2" data-testid="mapping-result-list">
            {batch.results.map((result) => (
              <li
                key={result.index}
                className="border border-rule p-3"
                data-testid={`mapping-record-${result.index}`}
                data-status={result.status}
              >
                <p className="font-medium">
                  Record {result.index} · {result.status}
                </p>
                {result.status === "pass" && result.output ? (
                  <pre className="mt-2 overflow-auto font-mono text-xs" data-testid={`mapping-output-${result.index}`}>
                    {JSON.stringify(result.output, null, 2)}
                  </pre>
                ) : (
                  <ul className="mt-2 list-disc pl-5 text-mute">
                    {result.issues.map((issue, issueIndex) => (
                      <li key={`${issue.code}-${issueIndex}`}>
                        {issue.code}
                        {issue.op ? ` · ${issue.op}` : ""}
                        {typeof issue.operationIndex === "number" ? ` · op ${issue.operationIndex}` : ""}
                        : {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {batch.issues.length > 0 ? (
            <div data-testid="mapping-batch-error">
              <ErrorBanner title="Batch did not fully succeed">
                {batch.issues.map((issue) => issue.message).join("; ")}
              </ErrorBanner>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute">No mapping results yet.</p>
      )}
    </section>
  );
}
