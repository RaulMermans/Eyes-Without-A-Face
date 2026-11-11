import type { ChangeEvent } from "react";
import edgeRecords from "../examples/crm/edge-records.json" with { type: "json" };
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import type { ProfileIssue, SourceProfile } from "../domain/profile/profile.ts";
import { withCrmDemo } from "./demo.ts";
import { parseSourceDataset } from "./source-import.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";

export function SourcePanel({
  workspace,
  onChange,
  profile,
  profileIssues,
  onContinue,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  profile: SourceProfile | null;
  profileIssues: ProfileIssue[];
  onContinue: () => void;
}) {
  function applyText(text: string, label: string, reserved: Record<string, unknown>[] | null): void {
    const parsed = parseSourceDataset(text, label);
    const base = invalidateDownstream({ ...workspace, overrides: {} });
    if (!parsed.ok) {
      onChange({ ...base, source: null, reservedRecords: null, sourceError: parsed.message });
      return;
    }
    onChange({ ...base, source: parsed.value, reservedRecords: reserved, sourceError: null });
  }

  function onFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => applyText(text, file.name, null));
    event.target.value = "";
  }

  const blocking = profileIssues.filter((issue) => issue.severity === "error");
  const notes = profile?.issues ?? [];

  return (
    <section aria-labelledby="source-import-heading" className="border border-rule bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="source-import-heading" className="text-base font-semibold">
          Import source JSON
        </h3>
        <Badge className="border-local/50 text-local">Local only · no network</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-mute">
        Records stay in this browser tab. Profiling reads the values to infer types, but nothing
        here is uploaded or stored.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => onChange(withCrmDemo(workspace))}
          data-testid="load-crm-sample"
        >
          Load fictional CRM sample
        </Button>
        <Button
          onClick={() => applyText(JSON.stringify(edgeRecords), "fictional-crm-accounts-edge", null)}
          data-testid="load-edge-sample"
        >
          Load reserved edge cases as source
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center border border-rule bg-paper px-3 text-sm focus-within:outline-2 focus-within:outline-signal">
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
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">Paste JSON instead</summary>
        <label className="mt-2 block text-sm" htmlFor="source-json">
          Source JSON (applied when the field loses focus)
        </label>
        <textarea
          id="source-json"
          data-testid="source-json-editor"
          className="mt-1 min-h-32 w-full border border-rule bg-paper p-3 font-mono text-xs"
          placeholder='{"records":[{ "customer_id": "CUST-001" }]}'
          onBlur={(event) => {
            if (event.target.value.trim()) {
              applyText(event.target.value, "pasted-source", null);
            }
          }}
        />
      </details>
      {workspace.sourceError ? (
        <div className="mt-4" data-testid="source-import-error">
          <ErrorBanner title="Source JSON was rejected">{workspace.sourceError}</ErrorBanner>
        </div>
      ) : null}
      {blocking.length > 0 ? (
        <div className="mt-4" data-testid="profile-error">
          <ErrorBanner title="Source could not be profiled">
            <ul className="list-disc pl-5">
              {blocking.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  {issue.code}: {issue.message}
                </li>
              ))}
            </ul>
          </ErrorBanner>
        </div>
      ) : null}
      {workspace.source ? (
        <div className="mt-4 space-y-3 text-sm" data-testid="source-inspect">
          <p>
            Dataset <span className="font-mono">{workspace.source.label}</span> ·{" "}
            {workspace.source.records.length} records in memory
            {workspace.reservedRecords ? (
              <span data-testid="reserved-count">
                {" "}
                · {workspace.reservedRecords.length} reserved hidden cases held back for the Reality Check
              </span>
            ) : null}
          </p>
          {profile ? (
            <div data-testid="source-profile">
              <h4 className="font-medium">Local structure profile</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-rule text-mute">
                      <th className="py-1 pr-3 font-medium">Field (local)</th>
                      <th className="py-1 pr-3 font-medium">Type</th>
                      <th className="py-1 pr-3 font-medium">Presence</th>
                      <th className="py-1 pr-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.fields.map((field) => (
                      <tr key={field.path} className="border-b border-rule/60" data-testid={`profile-field-${field.path}`}>
                        <td className="py-1 pr-3 font-mono">{field.path}</td>
                        <td className="py-1 pr-3">
                          {field.supported ? field.type : "unsupported"}
                          {field.format ? ` (${field.format})` : ""}
                          {field.dateFormat ? ` (${field.dateFormat})` : ""}
                        </td>
                        <td className="py-1 pr-3">
                          {field.required ? "required" : `optional (${field.missingCount} missing)`}
                          {field.nullable ? `, ${field.nullCount} null` : ""}
                        </td>
                        <td className="py-1 pr-3 text-mute">
                          {[
                            field.type === "enum" ? `${field.categories?.length ?? 0} categories` : null,
                            field.hasPaddedWhitespace ? "surrounding whitespace" : null,
                            field.hasMixedCase ? "mixed case" : null,
                            field.allValuesUnique && field.presentCount > 1 ? "unique" : null,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {notes.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs" data-testid="profile-issues">
                  {notes.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      <span className="font-mono">{issue.severity.toUpperCase()}</span> {issue.code}
                      {issue.path ? ` · ${issue.path}` : ""}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer font-medium">Inspect first record</summary>
            <pre
              className="mt-2 max-h-56 overflow-auto border border-rule bg-paper p-3 font-mono text-xs"
              data-testid="source-first-record"
            >
              {JSON.stringify(workspace.source.records[0], null, 2)}
            </pre>
          </details>
          {profile ? (
            <Button variant="primary" onClick={onContinue} data-testid="continue-to-twin">
              Continue to Phantom Twin
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute">No source dataset loaded.</p>
      )}
    </section>
  );
}
