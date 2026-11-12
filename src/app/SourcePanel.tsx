import type { ChangeEvent, ReactNode } from "react";
import edgeRecords from "../examples/crm/edge-records.json" with { type: "json" };
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { ArrowRightIcon, LockIcon } from "../components/icons.tsx";
import { Disclosure, Eyebrow, Panel, PanelHeader } from "../components/spectral.tsx";
import type { ProfileIssue, SourceProfile } from "../domain/profile/profile.ts";
import { withCrmDemo, withScenario } from "./demo.ts";
import { EVALUATION_SCENARIOS } from "../evaluation/scenarios.ts";
import { parseSourceDataset } from "./source-import.ts";
import { firstPresent, formatSample } from "./view-model.ts";
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
      onChange({ ...base, source: null, reservedRecords: null, sourceError: parsed.message, scenario: null });
      return;
    }
    onChange({ ...base, source: parsed.value, reservedRecords: reserved, sourceError: null, scenario: null });
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
  const source = workspace.source;

  return (
    <Panel tone="private" aria-labelledby="source-import-heading">
      <PanelHeader id="source-import-heading" title="Import source JSON" eyebrow="Private source" zone="private" zoneText="Local only · no network">
        Records stay in this browser tab. Profiling reads the values to infer types, but nothing here is uploaded or stored.
      </PanelHeader>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant={source ? "outline" : "primary"} onClick={() => onChange(withCrmDemo(workspace))} data-testid="load-crm-sample">
          Load fictional CRM sample
        </Button>
        <label className="inline-flex min-h-10 cursor-pointer items-center rounded-[3px] border border-rule bg-panel px-4 text-sm font-medium hover:border-ink/40 hover:bg-bone focus-within:outline-2 focus-within:outline-signal">
          Import JSON file
          <input className="sr-only" type="file" accept="application/json,.json,.txt" data-testid="source-file-input" onChange={onFile} />
        </label>
        <Button variant="ghost" onClick={() => applyText(JSON.stringify(edgeRecords), "fictional-crm-accounts-edge", null)} data-testid="load-edge-sample">
          Load reserved edge cases as source
        </Button>
      </div>
      <Disclosure summary="Blind revision scenarios — fictional, with an independent holdout" className="mt-4" testId="scenario-picker">
        <p className="text-xs text-mute">
          Each scenario loads imported records (profiled), revision-feedback cases (reserved hidden cases) and a holdout set that stays out of
          profiling, disclosure and feedback until the mapping is final. Its acceptance policy is local and versioned. All data is fictional.
        </p>
        <ul className="mt-3 grid gap-2 md:grid-cols-3">
          {EVALUATION_SCENARIOS.map((scenario) => (
            <li key={scenario.scenarioId} className="flex flex-col justify-between gap-2 border border-rule bg-bone p-3">
              <div>
                <p className="font-medium">{scenario.title}</p>
                <p className="mt-1 text-xs text-mute">{scenario.summary}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onChange(withScenario(workspace, scenario))} data-testid={`load-scenario-${scenario.scenarioId}`}>
                Load scenario
              </Button>
            </li>
          ))}
        </ul>
      </Disclosure>
      {workspace.scenario ? (
        <p className="mt-3 border-l-4 border-l-ink bg-bone px-3 py-2 text-xs" data-testid="scenario-active">
          Scenario <span className="font-medium">{workspace.scenario.title}</span> · policy{" "}
          <span className="font-mono">{workspace.scenario.policy.policyId}@{workspace.scenario.policy.policyVersion}</span> ·{" "}
          {workspace.scenario.holdout.length} holdout cases held back until the mapping is final
        </p>
      ) : null}
      <Disclosure summary="Paste JSON instead" className="mt-4">
        <label className="block text-sm" htmlFor="source-json">
          Source JSON (applied when the field loses focus)
        </label>
        <textarea
          id="source-json"
          data-testid="source-json-editor"
          className="mt-1 min-h-32 w-full rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs"
          placeholder='{"records":[{ "customer_id": "CUST-001" }]}'
          onBlur={(event) => {
            if (event.target.value.trim()) {
              applyText(event.target.value, "pasted-source", null);
            }
          }}
        />
      </Disclosure>

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

      {source ? (
        <div className="mt-6 space-y-5 text-sm" data-testid="source-inspect">
          <dl className="grid grid-cols-2 gap-px border border-ink/15 bg-ink/15 sm:grid-cols-4">
            <Stat label="Dataset" value={<span className="font-mono text-sm [overflow-wrap:anywhere]">{source.label}</span>} />
            <Stat label="Records in memory" value={`${source.records.length} records`} />
            <Stat label="Fields profiled" value={profile ? String(profile.fields.length) : "—"} />
            <Stat
              label="Held back"
              value={
                workspace.reservedRecords ? (
                  <span data-testid="reserved-count">
                    {workspace.reservedRecords.length} reserved hidden cases held back for the Reality Check
                  </span>
                ) : (
                  "none"
                )
              }
              small
            />
          </dl>

          {profile ? (
            <div data-testid="source-profile">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="font-semibold">Local structure profile</h4>
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-mute">
                  <LockIcon size={12} /> values shown here never leave this browser
                </p>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-ink/30 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
                      <th className="py-2 pr-3 font-medium">Field (local)</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Presence</th>
                      <th className="py-2 pr-3 font-medium">Local value</th>
                      <th className="py-2 pr-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.fields.map((field) => (
                      <tr key={field.path} className="border-b border-rule align-top" data-testid={`profile-field-${field.path}`}>
                        <td className="py-2 pr-3 font-mono font-medium [overflow-wrap:anywhere]">{field.path}</td>
                        <td className="py-2 pr-3">
                          {field.supported ? field.type : "unsupported"}
                          {field.format ? ` (${field.format})` : ""}
                          {field.dateFormat ? ` (${field.dateFormat})` : ""}
                        </td>
                        <td className="py-2 pr-3">
                          {field.required ? "required" : `optional (${field.missingCount} missing)`}
                          {field.nullable ? `, ${field.nullCount} null` : ""}
                        </td>
                        <td className="max-w-[16rem] py-2 pr-3 font-mono whitespace-pre-wrap text-ink/80 [overflow-wrap:anywhere]">
                          {formatSample(firstPresent(source.records, field.path), 34)}
                        </td>
                        <td className="py-2 pr-3 text-mute">
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
                    <li key={`${issue.code}-${index}`} className="text-mute">
                      <span className="font-mono text-ink">{issue.severity.toUpperCase()}</span> {issue.code}
                      {issue.path ? ` · ${issue.path}` : ""}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <Disclosure summary="Inspect first record">
            <pre className="max-h-56 overflow-auto rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs" data-testid="source-first-record">
              {JSON.stringify(source.records[0], null, 2)}
            </pre>
          </Disclosure>
          {profile ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
              <Button variant="primary" onClick={onContinue} data-testid="continue-to-twin">
                Continue to Phantom Twin
                <ArrowRightIcon />
              </Button>
              <p className="text-xs text-mute">Next: replace every field with an alias and fictional values. Still local.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 border border-dashed border-rule p-5 text-sm text-mute">
          <Eyebrow>No source loaded</Eyebrow>
          <p className="mt-1">Load the fictional CRM sample or import a JSON file (an array of records or {"{ \"records\": [...] }"}).</p>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="bg-panel p-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">{label}</dt>
      <dd className={small ? "mt-1 text-xs leading-5" : "mt-1 text-base font-medium"}>{value}</dd>
    </div>
  );
}
