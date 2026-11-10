import type { ChangeEvent } from "react";
import sourceRecords from "../examples/crm/source-records.json" with { type: "json" };
import edgeRecords from "../examples/crm/edge-records.json" with { type: "json" };
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { parseSourceDataset } from "./source-import.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export function SourcePanel({
  workspace,
  onChange,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
}) {
  function applyText(text: string, label: string): void {
    const parsed = parseSourceDataset(text, label);
    if (!parsed.ok) {
      onChange({ ...workspace, source: null, sourceError: parsed.message, batch: null });
      return;
    }
    onChange({ ...workspace, source: parsed.value, sourceError: null, batch: null });
  }

  function onFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => applyText(text, file.name));
    event.target.value = "";
  }

  return (
    <section aria-labelledby="source-import-heading" className="border border-rule bg-panel p-5">
      <h3 id="source-import-heading" className="text-base font-semibold">
        Import source JSON
      </h3>
      <p className="mt-2 text-sm leading-6 text-mute">
        Files stay in this browser session. Nothing is uploaded. Private fields are not sent to
        Gemini during local mapping.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => applyText(JSON.stringify(sourceRecords), "fictional-crm-accounts")}
          data-testid="load-crm-sample"
        >
          Load fictional CRM sample
        </Button>
        <Button
          onClick={() => applyText(JSON.stringify(edgeRecords), "fictional-crm-accounts-edge")}
          data-testid="load-edge-sample"
        >
          Load reserved edge cases
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center border border-rule bg-paper px-3 text-sm">
          Import JSON file
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json,.txt"
            data-testid="source-file-input"
            onChange={onFile}
          />
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium" htmlFor="source-json">
        Source JSON
      </label>
      <textarea
        id="source-json"
        data-testid="source-json-editor"
        className="mt-1 min-h-40 w-full border border-rule bg-paper p-3 font-mono text-xs"
        placeholder='{"records":[{ "customer_id": "CUST-001" }]}'
        onBlur={(event) => {
          if (event.target.value.trim()) {
            applyText(event.target.value, "pasted-source");
          }
        }}
      />
      {workspace.sourceError ? (
        <div className="mt-4" data-testid="source-import-error">
          <ErrorBanner title="Source JSON was rejected">{workspace.sourceError}</ErrorBanner>
        </div>
      ) : null}
      {workspace.source ? (
        <div className="mt-4 text-sm" data-testid="source-inspect">
          <p>
            Dataset <span className="font-mono">{workspace.source.label}</span> ·{" "}
            {workspace.source.records.length} records in memory
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium">Inspect first record</summary>
            <pre className="mt-2 max-h-56 overflow-auto border border-rule bg-paper p-3 font-mono text-xs" data-testid="source-first-record">
              {JSON.stringify(workspace.source.records[0], null, 2)}
            </pre>
          </details>
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute">No source dataset loaded.</p>
      )}
    </section>
  );
}
