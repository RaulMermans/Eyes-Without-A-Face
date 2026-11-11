import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import type { TwinIssue } from "../phantom/generate.ts";
import { ROLE_LABELS } from "../phantom/roles.ts";
import type { InferenceServices, OnDeviceCapability } from "../inference/types.ts";
import { InferenceError } from "../inference/errors.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";

type OnDeviceMode =
  | { kind: "checking" }
  | { kind: "blocked"; reason: string }
  | { kind: "available"; availability: string };

interface Suggestion {
  alias: string;
  role: string;
  simulated: boolean;
}

export function PhantomPanel({
  workspace,
  onChange,
  prepared,
  twinIssues,
  inference,
  onContinue,
}: {
  workspace: WorkspaceState;
  onChange: (next: WorkspaceState) => void;
  prepared: PreparedTwin | null;
  twinIssues: TwinIssue[];
  inference: InferenceServices;
  onContinue: () => void;
}) {
  const [showLocalNames, setShowLocalNames] = useState(false);
  const [seedText, setSeedText] = useState(String(workspace.seed));
  const [onDevice, setOnDevice] = useState<OnDeviceMode>({ kind: "checking" });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const status = inference.onDevice.status();
    void inference.onDevice
      .probeCapability()
      .then((capability: OnDeviceCapability) => {
        if (cancelled) return;
        const availability = capability.languageModelAvailability ?? "unknown";
        const usable = capability.promptApi === "available" && (availability === "available" || availability === "downloadable");
        const next: OnDeviceMode =
          status.state !== "configured"
            ? { kind: "blocked", reason: status.state === "disabled" ? "feature flag off" : "Firebase config missing" }
            : usable
              ? { kind: "available", availability }
              : { kind: "blocked", reason: `Prompt API ${capability.promptApi}, model ${availability}` };
        setOnDevice(next);
        recordWorkflowEvent({ kind: "on-device-probe", ok: next.kind === "available", code: next.kind === "available" ? "ON_DEVICE_AVAILABLE" : "ON_DEVICE_BLOCKED" });
      })
      .catch(() => {
        if (!cancelled) setOnDevice({ kind: "blocked", reason: "capability probe failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [inference]);

  if (!workspace.source) {
    return (
      <section className="border border-rule bg-panel p-5" aria-labelledby="twin-heading">
        <h3 id="twin-heading" className="text-base font-semibold">
          Phantom Twin
        </h3>
        <p className="mt-2 text-sm text-mute" data-testid="twin-empty">
          Import a source dataset first. The twin is generated from its local profile.
        </p>
      </section>
    );
  }

  function setOverride(path: string, patch: Record<string, unknown>): void {
    const current = workspace.overrides[path] ?? {};
    onChange(invalidateDownstream({ ...workspace, overrides: { ...workspace.overrides, [path]: { ...current, ...patch } } }));
  }

  function applySeed(): void {
    const seed = Number.parseInt(seedText, 10);
    if (!Number.isFinite(seed) || seed < 0 || seed > 2 ** 32 - 1) {
      setSeedText(String(workspace.seed));
      return;
    }
    onChange(invalidateDownstream({ ...workspace, seed }));
  }

  async function suggestOnDevice(): Promise<void> {
    if (!prepared) return;
    setSuggestError(null);
    const next: Suggestion[] = [];
    try {
      for (const field of prepared.twin.fields.filter((item) => item.shareable)) {
        const samples = prepared.twin.phantom.syntheticExamples
          .map((row) => row[field.alias])
          .filter((value) => value !== undefined && value !== null)
          .slice(0, 3)
          .map(String);
        // Only fictional synthetic samples and the generated descriptor go to the local model.
        const result = await inference.onDevice.generate({
          purpose: "schema-interpretation",
          input: { fieldAlias: field.alias, sampleValues: samples, hint: field.descriptor },
        });
        const role = (result.structured as { semanticRole?: string } | undefined)?.semanticRole ?? "other";
        next.push({ alias: field.alias, role, simulated: result.provenance.simulated });
      }
      setSuggestions(next);
    } catch (error) {
      const message = error instanceof InferenceError ? `${error.code}: ${error.message}` : "On-device suggestion failed.";
      setSuggestError(message);
      setOnDevice({ kind: "blocked", reason: error instanceof InferenceError ? error.code : "failed" });
    }
  }

  const twin = prepared?.twin ?? null;

  return (
    <section className="space-y-4" aria-labelledby="twin-heading">
      <div className="border border-rule bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="twin-heading" className="text-base font-semibold">
            Phantom Twin
          </h3>
          <Badge className="border-local/50 text-local">Generated locally · deterministic</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-mute">
          Each private field gets a meaningless alias such as <span className="font-mono">f_02</span>.
          Synthetic examples come from fixed fictional vocabularies and are checked against the
          private values so none are reproduced. The alias-to-field bindings never leave this
          browser.
        </p>

        <div className="mt-4 border border-rule p-3 text-sm" data-testid="on-device-mode">
          {onDevice.kind === "checking" ? (
            <p className="text-mute">Checking on-device AI…</p>
          ) : onDevice.kind === "blocked" ? (
            <>
              <p className="font-medium" data-testid="on-device-mode-label">
                On-device AI unavailable — manual/deterministic mode
              </p>
              <p className="mt-1 text-mute">
                <span className="font-mono">ON_DEVICE_BLOCKED</span> · {onDevice.reason}. Field roles
                come from the deterministic profile; edit descriptors below to add meaning. Nothing
                falls back to the cloud.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium" data-testid="on-device-mode-label">
                On-device AI available ({onDevice.availability}) — suggestions only
              </p>
              <p className="mt-1 text-mute">
                Runs <span className="font-mono">ONLY_ON_DEVICE</span> on synthetic samples.
                Suggestions never change shareability or contracts automatically.
              </p>
              <Button className="mt-2" onClick={() => void suggestOnDevice()} data-testid="suggest-on-device">
                Suggest field roles on-device
              </Button>
            </>
          )}
          {suggestError ? <p className="mt-2 text-danger">{suggestError}</p> : null}
          {suggestions.length > 0 ? (
            <ul className="mt-2 font-mono text-xs" data-testid="on-device-suggestions">
              {suggestions.map((item) => (
                <li key={item.alias}>
                  {item.alias}: {item.role} {item.simulated ? "(simulated test adapter)" : "(real on-device)"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm" htmlFor="twin-seed">
            Synthetic seed
            <input
              id="twin-seed"
              data-testid="twin-seed"
              inputMode="numeric"
              className="mt-1 block w-36 border border-rule bg-paper px-2 py-1.5 font-mono text-sm"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySeed();
              }}
            />
          </label>
          <Button onClick={applySeed} data-testid="apply-seed">
            Regenerate with seed
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showLocalNames}
              onChange={(event) => setShowLocalNames(event.target.checked)}
              data-testid="show-local-names"
            />
            Show local field names (this browser only)
          </label>
        </div>

        {twinIssues.length > 0 ? (
          <div className="mt-4" data-testid="twin-error">
            <ErrorBanner title="Phantom Twin was not generated">
              <ul className="list-disc pl-5">
                {twinIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.code}: {issue.message}
                  </li>
                ))}
              </ul>
            </ErrorBanner>
          </div>
        ) : null}

        {twin ? (
          <div className="mt-4 space-y-4" data-testid="twin-summary">
            <p className="font-mono text-xs text-mute" data-testid="twin-id">
              {twin.phantom.phantomId} · seed {twin.seed} · {twin.fields.length} aliases ·{" "}
              {twin.phantom.syntheticExamples.length} synthetic examples
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-xs" data-testid="twin-fields">
                <thead>
                  <tr className="border-b border-rule text-mute">
                    <th className="py-1 pr-3 font-medium">Alias</th>
                    <th className="py-1 pr-3 font-medium">Role · type</th>
                    <th className="py-1 pr-3 font-medium">Descriptor Gemini will read</th>
                    <th className="py-1 pr-3 font-medium">Disclose</th>
                  </tr>
                </thead>
                <tbody>
                  {twin.fields.map((field) => {
                    const override = workspace.overrides[field.localPath] ?? {};
                    const draft = drafts[field.localPath] ?? override.descriptor ?? "";
                    return (
                      <tr key={field.alias} className="border-b border-rule/60 align-top" data-testid={`twin-field-${field.alias}`}>
                        <td className="py-2 pr-3 font-mono">
                          {field.alias}
                          {showLocalNames ? (
                            <span className="block text-[11px] text-mute" data-testid="local-name">
                              {field.localPath}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">
                          {ROLE_LABELS[field.role]} · {field.type}
                        </td>
                        <td className="py-2 pr-3">
                          <p data-testid={`descriptor-${field.alias}`}>{field.descriptor}</p>
                          <label className="mt-1 block text-[11px] text-mute" htmlFor={`desc-${field.alias}`}>
                            Replace with a reviewed descriptor (optional)
                          </label>
                          <input
                            id={`desc-${field.alias}`}
                            className="mt-0.5 w-full border border-rule bg-paper px-2 py-1 text-xs"
                            value={draft}
                            maxLength={200}
                            placeholder="e.g. Organization display name"
                            onChange={(event) => setDrafts({ ...drafts, [field.localPath]: event.target.value })}
                            onBlur={() => {
                              if ((override.descriptor ?? "") !== draft) setOverride(field.localPath, { descriptor: draft });
                            }}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={field.shareable}
                              onChange={(event) => setOverride(field.localPath, { shareable: event.target.checked })}
                              data-testid={`share-${field.alias}`}
                            />
                            Describe to Gemini
                          </label>
                          {field.type === "enum" ? (
                            <div className="mt-1">
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={field.categoriesDisclosed}
                                  disabled={!field.shareable}
                                  onChange={(event) => setOverride(field.localPath, { discloseCategories: event.target.checked })}
                                  data-testid={`disclose-categories-${field.alias}`}
                                />
                                Disclose {field.categoryCount} category labels
                              </label>
                              {field.rareCategoryCount > 0 ? (
                                <p className="text-[11px] text-cloud">
                                  {field.rareCategoryCount} label(s) are rare in this dataset and could identify records.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="text-sm font-medium">Synthetic examples (fictional)</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-left font-mono text-[11px]" data-testid="twin-examples">
                  <thead>
                    <tr className="border-b border-rule text-mute">
                      {twin.fields.map((field) => (
                        <th key={field.alias} className="py-1 pr-3 font-medium">
                          {field.alias}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {twin.phantom.syntheticExamples.map((row, index) => (
                      <tr key={index} className="border-b border-rule/60">
                        {twin.fields.map((field) => (
                          <td key={field.alias} className="whitespace-pre py-1 pr-3">
                            {field.alias in row ? JSON.stringify(row[field.alias]) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-mute">"—" marks a field deliberately omitted to represent an optional value.</p>
            </div>

            {twin.limitations.length > 0 || twin.excluded.length > 0 ? (
              <div className="text-sm" data-testid="twin-limitations">
                <h4 className="font-medium">Limitations</h4>
                <ul className="mt-1 list-disc pl-5 text-mute">
                  {twin.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Phantom Contract JSON (local)</summary>
              <pre className="mt-2 max-h-72 overflow-auto border border-rule bg-paper p-3 font-mono text-xs" data-testid="phantom-contract-json">
                {JSON.stringify(twin.phantom, null, 2)}
              </pre>
            </details>

            <Button variant="primary" onClick={onContinue} data-testid="continue-to-review">
              Continue to disclosure review
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
