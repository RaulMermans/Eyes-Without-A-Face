import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon, ChipIcon, LockIcon } from "../components/icons.tsx";
import { Disclosure, EmptyState, FieldToken, Panel, PanelHeader, StatusMark, ZoneLabel } from "../components/spectral.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import type { TwinIssue } from "../phantom/generate.ts";
import { ROLE_LABELS } from "../phantom/roles.ts";
import type { InferenceServices, OnDeviceCapability } from "../inference/types.ts";
import { InferenceError } from "../inference/errors.ts";
import { isRecoverableOnDeviceFailure, ON_DEVICE_USER_RETRY_LIMIT } from "../inference/retry-policy.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import { TrustLedger } from "./TrustLedger.tsx";
import { firstPresent, formatSample } from "./view-model.ts";
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
  const [suggestError, setSuggestError] = useState<{ message: string; recoverable: boolean } | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number; alias: string } | null>(null);
  const [retriesUsed, setRetriesUsed] = useState(0);
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
      <EmptyState headingId="twin-heading" title="No twin yet" testId="twin-empty">
        Import a source dataset first. The twin is generated from its local profile.
      </EmptyState>
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

  /**
   * Classify each shareable twin field on-device. A retry (resume=true) only
   * runs the fields that are not classified yet, so successful calls are
   * never repeated. Never falls back to the cloud.
   */
  async function suggestOnDevice(resume: boolean): Promise<void> {
    if (!prepared || busy) return;
    const fields = prepared.twin.fields.filter((item) => item.shareable);
    const next: Suggestion[] = resume ? suggestions.filter((item) => fields.some((field) => field.alias === item.alias)) : [];
    if (!resume) setRetriesUsed(0);
    else setRetriesUsed((count) => count + 1);
    setSuggestError(null);
    setSuggestions(next);
    const pending = fields.filter((field) => !next.some((item) => item.alias === field.alias));
    try {
      for (const field of pending) {
        setBusy({ done: next.length, total: fields.length, alias: field.alias });
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
        setSuggestions([...next]);
      }
      recordWorkflowEvent({ kind: "on-device-probe", ok: true, code: resume ? "ON_DEVICE_RETRY_RECOVERED" : "ON_DEVICE_SUGGESTED", counts: { fields: next.length } });
    } catch (error) {
      const code = error instanceof InferenceError ? error.code : "FAILED";
      const recoverable =
        error instanceof InferenceError && isRecoverableOnDeviceFailure(error.code) && (resume ? retriesUsed + 1 : 0) < ON_DEVICE_USER_RETRY_LIMIT;
      const explanation =
        code === "ON_DEVICE_RUNTIME_ERROR"
          ? "Chrome's on-device model service stopped unexpectedly. This is a browser runtime failure, not a problem with the twin."
          : error instanceof InferenceError
            ? error.message
            : "On-device suggestion failed.";
      setSuggestError({
        message: `${code}: ${explanation} ${next.length} of ${fields.length} fields were classified before it stopped. Nothing was sent to the cloud.`,
        recoverable,
      });
      recordWorkflowEvent({ kind: "on-device-probe", ok: false, code });
      if (!recoverable) {
        setOnDevice({ kind: "blocked", reason: `${code}${resume ? " after one retry; restart Chrome to reset its on-device model service" : ""}` });
      }
    } finally {
      setBusy(null);
    }
  }

  const twin = prepared?.twin ?? null;
  const suggestionFor = new Map(suggestions.map((item) => [item.alias, item]));
  const withheld = twin ? twin.fields.filter((field) => !field.shareable) : [];
  const withheldCategories = twin ? twin.fields.filter((field) => field.type === "enum" && field.shareable && !field.categoriesDisclosed) : [];
  const records = workspace.source.records;

  return (
    <section className="space-y-5" aria-labelledby="twin-heading">
      <TrustLedger workspace={workspace} prepared={prepared} />

      <Panel aria-label="Phantom Twin transformation">
        <PanelHeader id="twin-heading" title="Phantom Twin" eyebrow="Signature transformation" zone="synthetic" zoneText="Generated locally · deterministic">
          Each private field gets a meaningless alias such as <span className="font-mono text-cyan-ink">f_02</span>. Synthetic examples come
          from fixed fictional vocabularies and are checked against the private values so none are reproduced. The alias-to-field
          bindings never leave this browser.
        </PanelHeader>

        <InferencePanel
          onDevice={onDevice}
          busy={busy}
          suggestError={suggestError}
          suggestions={suggestions}
          onSuggest={() => void suggestOnDevice(false)}
          onRetry={() => void suggestOnDevice(true)}
        />

        <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3 border-y border-rule py-4">
          <label className="text-sm" htmlFor="twin-seed">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">Synthetic seed</span>
            <input
              id="twin-seed"
              data-testid="twin-seed"
              inputMode="numeric"
              className="mt-1 block w-36 rounded-[3px] border border-rule bg-bone px-2 py-1.5 font-mono text-sm"
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
          <label className="flex min-h-10 items-center gap-2 rounded-[3px] border border-ink/30 bg-panel px-3 text-sm sm:ml-auto">
            <input
              type="checkbox"
              className="size-4 accent-ink"
              checked={showLocalNames}
              onChange={(event) => setShowLocalNames(event.target.checked)}
              data-testid="show-local-names"
            />
            <LockIcon size={14} />
            Reveal private source (this browser only)
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
          <div className="mt-5 space-y-6" data-testid="twin-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs text-mute" data-testid="twin-id">
                {twin.phantom.phantomId} · seed {twin.seed} · {twin.fields.length} aliases · {twin.phantom.syntheticExamples.length} synthetic examples
              </p>
              <p className="text-xs text-mute" data-testid="twin-withheld" aria-live="polite">
                <span className="font-medium text-ink">Withheld from Gemini:</span>{" "}
                {withheld.length === 0 ? "no fields" : `${withheld.length} field${withheld.length === 1 ? "" : "s"} (${withheld.map((field) => field.alias).join(", ")})`}
                {withheldCategories.length > 0 ? ` · category labels of ${withheldCategories.map((field) => field.alias).join(", ")}` : ""}
                {" · "}all values, field names, and bindings
              </p>
            </div>

            <div className="transform-grid" key={`${twin.phantom.phantomId}-${twin.seed}`}>
              <div className="cell-head-private pb-1">
                <ZoneLabel zone="private">Private source · never sent</ZoneLabel>
              </div>
              <div className="cell-head-link" aria-hidden="true" />
              <div className="cell-head-twin pb-1">
                <ZoneLabel zone="synthetic">Phantom Twin · what AI may reason over</ZoneLabel>
              </div>

              <div role="list" aria-label="Private source fields" className="contents" data-testid="private-fields">
                {twin.fields.map((field, index) => (
                  <div
                    key={field.localPath}
                    role="listitem"
                    className="cell-private frame-private self-start bg-panel p-3"
                    style={rowStyle(index)}
                    data-testid={`private-field-${field.alias}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {showLocalNames ? (
                        <FieldToken kind="local">{field.localPath}</FieldToken>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-mute">
                          <span className="inline-block h-3 w-20 bg-ink/85" aria-hidden="true" />
                          <span>private field · hidden</span>
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-mute">{field.type}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-mute">{profileNote(prepared, field.localPath)}</p>
                    <p className="mt-1.5 font-mono text-xs">
                      <span className="text-mute">value </span>
                      {showLocalNames ? (
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{formatSample(firstPresent(records, field.localPath), 36)}</span>
                      ) : (
                        <span className="inline-block h-2.5 w-28 translate-y-0.5 bg-ink/20" aria-label="hidden value" role="img" />
                      )}
                    </p>
                  </div>
                ))}
              </div>

              {twin.fields.map((field, index) => (
                <div key={`link-${field.alias}`} className="cell-link items-start justify-center pt-5" style={rowStyle(index)} aria-hidden="true">
                  <span className={`relative flex w-full items-center ${field.shareable ? "text-cyan-ink" : "text-mute"}`}>
                    <span className={`h-px flex-1 animate-draw ${field.shareable ? "bg-cyan-ink" : "border-t border-dashed border-mute bg-transparent"}`} style={{ "--i": index } as CSSProperties} />
                    <ArrowRightIcon size={14} />
                  </span>
                </div>
              ))}

              <div role="list" aria-label="Phantom Twin fields" className="contents" data-testid="twin-fields">
                {twin.fields.map((field, index) => {
                  const override = workspace.overrides[field.localPath] ?? {};
                  const draft = drafts[field.localPath] ?? override.descriptor ?? "";
                  const examples = twin.phantom.syntheticExamples
                    .map((row) => row[field.alias])
                    .filter((value) => value !== undefined)
                    .slice(0, 2);
                  const suggestion = suggestionFor.get(field.alias);
                  return (
                    <div
                      key={field.alias}
                      role="listitem"
                      className={`cell-twin animate-materialize p-3 ${field.shareable ? "frame-synthetic bg-panel" : "border border-dashed border-rule bg-bone-2/60"}`}
                      style={{ ...rowStyle(index), "--i": index } as CSSProperties}
                      data-testid={`twin-field-${field.alias}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <FieldToken kind="alias" className="text-sm font-medium">{field.alias}</FieldToken>
                          <span className="text-xs font-medium">{ROLE_LABELS[field.role]}</span>
                          <span className="font-mono text-[11px] text-mute">{field.type}</span>
                        </div>
                        {field.shareable ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-ink">offered for review</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                            <LockIcon size={11} /> withheld · stays local
                          </span>
                        )}
                      </div>
                      {showLocalNames ? (
                        <p className="mt-1 text-[11px] text-mute">
                          bound to <span className="font-mono text-ink" data-testid="local-name">{field.localPath}</span> (local binding, never serialized)
                        </p>
                      ) : null}
                      <p className="mt-2 font-mono text-xs">
                        <span className="text-mute">example </span>
                        <span className="whitespace-pre-wrap text-cyan-ink [overflow-wrap:anywhere]">
                          {examples.length > 0 ? examples.map((value) => formatSample(value, 30)).join("  ") : "— (omitted to model an optional value)"}
                        </span>
                      </p>
                      <p className="mt-2 text-xs leading-5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">Descriptor Gemini will read · </span>
                        <span data-testid={`descriptor-${field.alias}`}>{field.descriptor}</span>
                        {field.descriptorSource === "user" ? <span className="ml-1 font-mono text-[10px] text-gold-ink">(your wording)</span> : null}
                      </p>
                      {suggestion ? (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]" data-testid={`nano-suggestion-${field.alias}`}>
                          <ChipIcon size={12} className="text-cyan-ink" />
                          <span className="text-mute">{suggestion.simulated ? "Simulated suggestion" : "Gemini Nano suggests"}:</span>
                          <span className="font-mono">{suggestion.role}</span>
                          {suggestion.role === field.role ? (
                            <StatusMark status="pass" className="text-[11px]">agrees with profile</StatusMark>
                          ) : (
                            <StatusMark status="warn" className="text-[11px]">differs from profile ({field.role})</StatusMark>
                          )}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <label className="flex min-h-8 items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="size-4 accent-cyan-ink"
                            checked={field.shareable}
                            onChange={(event) => setOverride(field.localPath, { shareable: event.target.checked })}
                            data-testid={`share-${field.alias}`}
                          />
                          Describe to Gemini
                        </label>
                        {field.type === "enum" ? (
                          <label className="flex min-h-8 items-center gap-1.5">
                            <input
                              type="checkbox"
                              className="size-4 accent-gold-ink"
                              checked={field.categoriesDisclosed}
                              disabled={!field.shareable}
                              onChange={(event) => setOverride(field.localPath, { discloseCategories: event.target.checked })}
                              data-testid={`disclose-categories-${field.alias}`}
                            />
                            Disclose {field.categoryCount} category labels
                          </label>
                        ) : null}
                      </div>
                      {field.type === "enum" && field.rareCategoryCount > 0 ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-warn">
                          <AlertIcon size={12} className="mt-0.5 shrink-0" />
                          {field.rareCategoryCount} label(s) are rare in this dataset and could identify records.
                        </p>
                      ) : null}
                      <Disclosure summary="Edit descriptor" className="mt-2 text-xs">
                        <label className="block text-[11px] text-mute" htmlFor={`desc-${field.alias}`}>
                          Replace with a reviewed descriptor (optional, checked for private values)
                        </label>
                        <input
                          id={`desc-${field.alias}`}
                          className="mt-1 w-full rounded-[3px] border border-rule bg-bone px-2 py-1.5 text-xs"
                          value={draft}
                          maxLength={200}
                          placeholder="e.g. Organization display name"
                          onChange={(event) => setDrafts({ ...drafts, [field.localPath]: event.target.value })}
                          onBlur={() => {
                            if ((override.descriptor ?? "") !== draft) setOverride(field.localPath, { descriptor: draft });
                          }}
                        />
                      </Disclosure>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">Synthetic examples (fictional)</h4>
                <ZoneLabel zone="synthetic">Fictional · checked against private values</ZoneLabel>
              </div>
              <div className="mt-2 overflow-x-auto border border-rule bg-panel">
                <table className="w-full border-collapse text-left font-mono text-[11px]" data-testid="twin-examples">
                  <thead>
                    <tr className="border-b border-rule text-cyan-ink">
                      {twin.fields.map((field) => (
                        <th key={field.alias} className="px-2 py-1.5 font-medium">
                          {field.alias}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {twin.phantom.syntheticExamples.map((row, index) => (
                      <tr key={index} className="border-b border-rule/60 last:border-0">
                        {twin.fields.map((field) => (
                          <td key={field.alias} className="whitespace-pre px-2 py-1">
                            {field.alias in row ? JSON.stringify(row[field.alias]) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-mute">"—" marks a field deliberately omitted to represent an optional value. Scroll sideways inside the table for more columns.</p>
            </div>

            {twin.limitations.length > 0 || twin.excluded.length > 0 ? (
              <div className="border-l-4 border-warn bg-warn/5 p-3 text-sm" data-testid="twin-limitations">
                <h4 className="font-semibold">Limitations</h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-mute">
                  {twin.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Disclosure summary="Phantom Contract JSON (local)">
              <p className="mb-2 text-xs text-mute">
                The internal Phantom Contract. It is never sent as-is: the cloud request is a separate allowlisted projection you review on the next step.
              </p>
              <pre className="max-h-72 overflow-auto rounded-[3px] border border-rule bg-bone p-3 font-mono text-xs" data-testid="phantom-contract-json">
                {JSON.stringify(twin.phantom, null, 2)}
              </pre>
            </Disclosure>

            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
              <Button variant="primary" onClick={onContinue} data-testid="continue-to-review">
                Continue to disclosure review
                <ArrowRightIcon />
              </Button>
              <p className="text-xs text-mute">Nothing is sent from here. Next you will see exactly what Gemini would receive.</p>
            </div>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}

/** Presence and shape facts from the local profile (no values). */
function profileNote(prepared: PreparedTwin | null, path: string): string {
  const field = prepared?.profile.fields.find((item) => item.path === path);
  if (!field) return "";
  return [
    field.required ? "required" : `optional · ${field.missingCount} missing`,
    field.nullable ? `${field.nullCount} null` : null,
    field.type === "enum" ? `${field.categories?.length ?? 0} categories` : null,
    field.hasPaddedWhitespace ? "padded whitespace" : null,
    field.hasMixedCase ? "mixed case" : null,
    field.allValuesUnique && field.presentCount > 1 ? "unique" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function rowStyle(index: number): CSSProperties {
  return {
    "--row-d": String(index + 2),
    "--row-m-private": String(index * 2 + 1),
    "--row-m-twin": String(index * 2 + 2),
  } as CSSProperties;
}

function InferencePanel({
  onDevice,
  busy,
  suggestError,
  suggestions,
  onSuggest,
  onRetry,
}: {
  onDevice: OnDeviceMode;
  busy: { done: number; total: number; alias: string } | null;
  suggestError: { message: string; recoverable: boolean } | null;
  suggestions: Suggestion[];
  onSuggest: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mt-5 grid gap-4 border border-cyan-ink/40 bg-cyan/5 p-4 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="on-device-mode">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan-ink">
          <ChipIcon size={12} /> On-device intelligence · Gemini Nano · ONLY_ON_DEVICE
        </p>
        {onDevice.kind === "checking" ? (
          <p className="mt-2 text-mute">Checking on-device AI…</p>
        ) : onDevice.kind === "blocked" ? (
          <>
            <p className="mt-2 font-medium" data-testid="on-device-mode-label">
              On-device AI unavailable — manual/deterministic mode
            </p>
            <p className="mt-1 text-mute">
              <span className="font-mono">ON_DEVICE_BLOCKED</span> · {onDevice.reason}. Field roles come from the deterministic profile; edit
              descriptors below to add meaning. Nothing falls back to the cloud.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 font-medium" data-testid="on-device-mode-label">
              On-device AI available ({onDevice.availability}) — suggestions only
            </p>
            <p className="mt-1 text-mute">
              Runs <span className="font-mono">ONLY_ON_DEVICE</span> on synthetic samples. Suggestions are advisory: they never change
              shareability, descriptors, or contracts automatically.
            </p>
            <Button className="mt-3" onClick={onSuggest} disabled={Boolean(busy)} data-testid="suggest-on-device">
              <ChipIcon size={14} /> Suggest field roles on-device
            </Button>
          </>
        )}
        {busy ? (
          <div className="mt-3" role="status" data-testid="on-device-progress">
            <p className="text-mute">
              Gemini Nano is classifying <span className="font-mono text-cyan-ink">{busy.alias}</span> on this device ({busy.done} of {busy.total} done)…
            </p>
            <div className="mt-1.5 h-1 w-full bg-cyan-ink/15" aria-hidden="true">
              <div className="h-1 bg-cyan-ink transition-[width] duration-300" style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} />
            </div>
          </div>
        ) : null}
        {suggestError ? (
          <div className="mt-3 border-l-4 border-fail bg-fail/5 p-3">
            <p className="text-fail" data-testid="on-device-error">
              {suggestError.message}
            </p>
            {suggestError.recoverable && onDevice.kind === "available" ? (
              <Button className="mt-2" onClick={onRetry} disabled={Boolean(busy)} data-testid="retry-on-device">
                Retry once on-device (continues with the remaining fields)
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 md:border-l md:border-cyan-ink/25 md:pl-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">What runs where</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-mute">
          <li>
            <span className="font-medium text-ink">Deterministic code</span> profiles types, assigns aliases, generates fictional values, and
            rejects any example that matches a private value.
          </li>
          <li>
            <span className="font-medium text-ink">Gemini Nano</span> (optional) reads only synthetic samples and suggests a semantic role per
            alias. Results appear on each twin card.
          </li>
        </ul>
        {suggestions.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-1 font-mono text-xs sm:grid-cols-2" data-testid="on-device-suggestions" aria-label="On-device suggestions">
            {suggestions.map((item) => (
              <li key={item.alias} className="animate-reveal border border-cyan-ink/30 bg-panel px-2 py-1">
                {item.alias}: {item.role} {item.simulated ? "(simulated test adapter)" : "(real on-device)"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
