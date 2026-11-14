import { useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon, ChipIcon, LockIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import type { ProfileIssue } from "../../domain/profile/profile.ts";
import { FILE_ADAPTER, REST_ADAPTER, toImportedSource } from "../../sources/adapter.ts";
import { ACCEPTED_FILE_TYPES } from "../../sources/files.ts";
import { validateEndpoint } from "../../sources/rest.ts";
import type { NormalizedSource } from "../../sources/types.ts";
import { normalizeSheet, type WorkbookHandle } from "../../sources/xlsx.ts";
import type { ImportedSource } from "../source-import.ts";
import type { OnDeviceMode } from "../use-on-device.ts";
import crmCsvUrl from "../../examples/crm/source-records.csv?url";
import crmXlsxUrl from "../../examples/crm/source-records.xlsx?url";
import crmJsonUrl from "../../examples/crm/source-records.json?url";

/**
 * Guided step 1 — "Where is your data?" (Sprint 13, A2 / B / C).
 *
 * Every path goes through the Source Adapter Layer and produces the same
 * engine input. Parsing happens in this tab; the REST connector performs one
 * read-only GET only after the user clicks Connect. The bearer token lives in
 * this component's memory for the duration of that request and is then
 * dropped — never stored, logged or exported.
 */
type Tab = "file" | "api";

const FORMAT_TEXT: Record<NormalizedSource["format"], string> = { json: "JSON file", csv: "CSV file", xlsx: "Excel workbook", "rest-json": "Connected API · read-only" };

const DEMOS = [
  { id: "csv", label: "CSV", url: crmCsvUrl, name: "fictional-crm.csv" },
  { id: "xlsx", label: "Excel", url: crmXlsxUrl, name: "fictional-crm.xlsx" },
  { id: "json", label: "JSON", url: crmJsonUrl, name: "fictional-crm.json" },
] as const;

export interface LoadedSource {
  normalized: NormalizedSource;
  workbook: WorkbookHandle | null;
  demo: boolean;
}

export function DataStep({
  source,
  loaded,
  onLoaded,
  onClear,
  profileIssues,
  ready,
  onDevice,
  understanding,
  understandingBusy = false,
  onContinue,
}: {
  source: ImportedSource | null;
  loaded: LoadedSource | null;
  /** A new source: the caller replaces the workspace source (which clears everything downstream). */
  onLoaded: (next: LoadedSource, imported: ImportedSource) => void;
  onClear: () => void;
  profileIssues: ProfileIssue[];
  /** The source was profiled and a twin could be built. */
  ready: boolean;
  onDevice: OnDeviceMode;
  understanding: ReactNode;
  /** Sprint 14: on-device analysis is still running. */
  understandingBusy?: boolean;
  onContinue: () => void;
}) {
  const [tab, setTab] = useState<Tab>("file");
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function readFile(file: File, demo = false): Promise<void> {
    setProblem(null);
    setReading(true);
    try {
      const result = await FILE_ADAPTER.read(file);
      if (!result.ok) {
        setProblem(result.problem.message);
        return;
      }
      const next: LoadedSource = { normalized: result.value, workbook: result.workbook ?? null, demo };
      onLoaded(next, toImportedSource(result.value));
    } catch {
      setProblem("The file could not be read.");
    } finally {
      setReading(false);
    }
  }

  async function loadDemo(demo: (typeof DEMOS)[number]): Promise<void> {
    setProblem(null);
    setReading(true);
    try {
      const response = await fetch(demo.url);
      const blob = await response.blob();
      setReading(false);
      await readFile(new File([blob], demo.name), true);
    } catch {
      setReading(false);
      setProblem("The demo file could not be loaded.");
    }
  }

  function chooseSheet(name: string): void {
    if (!loaded?.workbook) return;
    const result = normalizeSheet(loaded.workbook, name);
    if (!result.ok) {
      setProblem(result.problem.message);
      return;
    }
    setProblem(null);
    onLoaded({ ...loaded, normalized: result.value }, toImportedSource(result.value));
  }

  function chooseTypes(column: string, on: boolean): void {
    if (!loaded || !source) return;
    const current = new Set(source.origin?.typeChoices ?? []);
    if (on) current.add(column);
    else current.delete(column);
    onLoaded(loaded, toImportedSource(loaded.normalized, current));
  }

  return (
    <section aria-labelledby="data-heading" className="space-y-6" data-testid="guided-data">
      <header className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold">Step 1 of 3</p>
        <h2 id="data-heading" tabIndex={-1} className="focus:outline-none mt-2 font-display text-4xl leading-[1.05] tracking-[-0.01em] sm:text-5xl">
          Where is your data?
        </h2>
        <p className="mt-3 text-base leading-7 text-ink-text">Your records are read in this browser. Nothing is uploaded.</p>
        <p className="mt-1 text-xs text-mute" data-testid="guided-session-note">Nothing is saved: reloading or closing this tab clears your work.</p>
      </header>

      {!source ? (
        <>
          <div role="tablist" aria-label="Data source" className="inline-flex gap-1 rounded-full border border-ink-3 p-1" data-testid="data-tabs">
            {(
              [
                ["file", "Upload a file"],
                ["api", "Connect an API"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`data-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`data-panel-${id}`}
                onClick={() => setTab(id)}
                className={`min-h-10 rounded-full px-4 text-sm font-medium transition-colors ${tab === id ? "bg-ink text-obsidian" : "text-ink-text hover:text-ink"}`}
                data-testid={`data-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "file" ? (
            <div id="data-panel-file" role="tabpanel" aria-labelledby="data-tab-file">
              <label
                htmlFor="source-file"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file);
                }}
                className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-[3px] border border-dashed px-6 py-10 text-center transition-colors focus-within:border-violet-soft ${dragOver ? "border-violet-soft bg-violet/10" : "border-ink-3 bg-panel hover:border-violet-soft/60"}`}
                data-testid="drop-zone"
              >
                <span className="text-lg font-medium">Drop a file here, or choose one</span>
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-mute">JSON · CSV · Excel (.xlsx)</span>
                <span className="inline-flex min-h-10 items-center rounded-[3px] border border-violet bg-violet px-4 text-sm font-medium text-white">Choose file</span>
                <input
                  ref={fileInput}
                  id="source-file"
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  className="sr-only"
                  aria-describedby="source-file-hint"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.target.value = "";
                  }}
                  data-testid="source-file-input"
                />
              </label>
              <p id="source-file-hint" className="mt-2 text-xs text-mute">
                Up to 250 records and 64 columns. CSV must be comma-separated UTF-8. Excel formulas are never run.
              </p>
            </div>
          ) : (
            <ApiConnect onLoaded={(normalized) => onLoaded({ normalized, workbook: null, demo: false }, toImportedSource(normalized))} />
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="demo-picker">
            <span className="text-mute">No data at hand? Try fictional CRM data:</span>
            {DEMOS.map((demo) => (
              <Button key={demo.id} size="sm" variant="outline" onClick={() => void loadDemo(demo)} disabled={reading} data-testid={`demo-${demo.id}`}>
                {demo.label}
              </Button>
            ))}
          </div>

          {reading ? (
            <p role="status" className="text-sm text-ink-text" data-testid="reading-status">
              Reading your data…
            </p>
          ) : null}
          {problem ? <ProblemLine message={problem} /> : null}
        </>
      ) : (
        <LoadedSummary
          source={source}
          loaded={loaded}
          profileIssues={profileIssues}
          ready={ready}
          problem={problem}
          onSheet={chooseSheet}
          onType={chooseTypes}
          onClear={() => {
            setProblem(null);
            onClear();
          }}
          onDevice={onDevice}
          understanding={understanding}
          understandingBusy={understandingBusy}
          onContinue={onContinue}
        />
      )}
    </section>
  );
}

function ProblemLine({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 border border-fail/40 border-l-4 border-l-fail bg-panel p-3 text-sm" data-testid="source-problem">
      <AlertIcon size={16} className="mt-0.5 shrink-0 text-fail" />
      <span>{message}</span>
    </p>
  );
}

function ApiConnect({ onLoaded }: { onLoaded: (normalized: NormalizedSource) => void }) {
  const [url, setUrl] = useState("");
  // The token exists only here, only until the read finishes. Never stored.
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const check = url.trim() ? validateEndpoint(url) : null;

  async function connect(): Promise<void> {
    setProblem(null);
    const valid = REST_ADAPTER.validate({ url });
    if (!valid.ok) {
      setProblem(valid.message);
      return;
    }
    setConnecting(true);
    abort.current = new AbortController();
    const result = await REST_ADAPTER.read({ url, token: token || undefined }, abort.current.signal);
    abort.current = null;
    setConnecting(false);
    setToken("");
    if (!result.ok) {
      setProblem(result.problem.message);
      return;
    }
    onLoaded(result.value);
  }

  return (
    <div id="data-panel-api" role="tabpanel" aria-labelledby="data-tab-api" className="max-w-2xl space-y-4 rounded-[3px] border border-rule bg-panel p-5" data-testid="api-connect">
      <div>
        <label htmlFor="api-url" className="text-sm font-medium">
          API address
        </label>
        <input
          id="api-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://api.example.com/customers"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-describedby="api-url-hint"
          className="mt-1 block min-h-11 w-full rounded-[3px] border border-ink-3 bg-void px-3 font-mono text-sm text-ink placeholder:text-mute/70 focus:border-violet-soft focus:outline-none"
          data-testid="api-url"
        />
        <p id="api-url-hint" className="mt-1 text-xs text-mute" data-testid="api-target">
          {check?.ok ? (
            <>
              Will read once from <span className="font-mono text-ink">{check.host}</span>. Read-only: one GET request, nothing is written. This is a snapshot, not a live sync: later changes in the API are not picked up.
            </>
          ) : check && !check.ok ? (
            check.problem.message
          ) : (
            "A public HTTPS endpoint that returns a JSON list and allows requests from this site (CORS)."
          )}
        </p>
      </div>
      <div>
        <label htmlFor="api-token" className="text-sm font-medium">
          Bearer token <span className="font-normal text-mute">(optional)</span>
        </label>
        <input
          id="api-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          aria-describedby="api-token-hint"
          className="mt-1 block min-h-11 w-full rounded-[3px] border border-ink-3 bg-void px-3 font-mono text-sm text-ink focus:border-violet-soft focus:outline-none"
          data-testid="api-token"
        />
        <p id="api-token-hint" className="mt-1 text-xs text-mute">
          Use a read-only token. It is sent only to this host, for this one request, and then forgotten. It is never saved, exported or sent to Gemini.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void connect()} disabled={connecting || !check?.ok} data-testid="api-connect-button">
          {connecting ? "Connecting…" : "Connect and read"}
        </Button>
        {connecting ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()} data-testid="api-cancel">
            Cancel
          </Button>
        ) : null}
      </div>
      {connecting ? (
        <p role="status" className="text-sm text-ink-text">
          Reading from {check?.ok ? check.host : "the API"}…
        </p>
      ) : null}
      {problem ? <ProblemLine message={problem} /> : null}
    </div>
  );
}

function LoadedSummary({
  source,
  loaded,
  profileIssues,
  ready,
  problem,
  onSheet,
  onType,
  onClear,
  onDevice,
  understanding,
  understandingBusy,
  onContinue,
}: {
  source: ImportedSource;
  loaded: LoadedSource | null;
  profileIssues: ProfileIssue[];
  ready: boolean;
  problem: string | null;
  onSheet: (name: string) => void;
  onType: (column: string, on: boolean) => void;
  onClear: () => void;
  onDevice: OnDeviceMode;
  understanding: ReactNode;
  understandingBusy: boolean;
  onContinue: () => void;
}) {
  const origin = source.origin;
  const fields = origin?.fields.map((field) => field.name) ?? [...new Set(source.records.flatMap((record) => Object.keys(record)))];
  const preview = source.records.slice(0, 5);
  const shown = fields.slice(0, 6);
  const connector = origin?.provenance.kind === "connector" ? origin.provenance : null;
  const sheetNames = loaded?.workbook?.sheetNames ?? [];
  const sheet = origin?.provenance.kind === "file" ? origin.provenance.sheet : undefined;
  const attention = origin?.warnings.filter((warning) => warning.severity === "attention") ?? [];
  const info = origin?.warnings.filter((warning) => warning.severity === "info") ?? [];
  const candidates = origin?.typeCandidates ?? [];

  return (
    <div className="space-y-5" data-testid="source-summary">
      <div className="rounded-[3px] border border-rule bg-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute" data-testid="source-format">
              {origin ? FORMAT_TEXT[origin.format] : "JSON"}
              {loaded?.demo ? " · fictional demo" : ""}
            </p>
            <h3 className="mt-1 truncate text-xl font-semibold" data-testid="source-name">
              {source.label}
            </h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear} data-testid="source-clear">
            {connector ? "Disconnect" : "Use different data"}
          </Button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-3">
          <div className="bg-panel p-3">
            <dt className="text-xs text-mute">Records</dt>
            <dd className="font-mono text-2xl" data-testid="source-record-count">{source.records.length}</dd>
          </div>
          <div className="bg-panel p-3">
            <dt className="text-xs text-mute">Fields</dt>
            <dd className="font-mono text-2xl" data-testid="source-field-count">{fields.length}</dd>
          </div>
          <div className="col-span-2 bg-panel p-3 sm:col-span-1">
            <dt className="text-xs text-mute">Where</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-sm" data-testid="source-locality">
              <LockIcon size={13} className="shrink-0" />
              {connector ? <>Read from {new URL(connector.origin).host} · a one-time snapshot, kept in this browser</> : "In this browser only"}
            </dd>
          </div>
        </dl>

        {sheetNames.length > 1 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="sheet-select" className="text-mute">
              Sheet
            </label>
            <select
              id="sheet-select"
              value={sheet}
              onChange={(event) => onSheet(event.target.value)}
              className="min-h-10 rounded-[3px] border border-ink-3 bg-void px-2 text-ink"
              data-testid="sheet-select"
            >
              {sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto" data-testid="source-preview">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <caption className="sr-only">First {preview.length} records, first {shown.length} fields</caption>
            <thead>
              <tr className="border-b border-rule">
                {shown.map((name) => (
                  <th key={name} scope="col" className="py-1.5 pr-3 font-mono font-normal text-mute">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((record, index) => (
                <tr key={index} className="border-b border-rule/50">
                  {shown.map((name) => (
                    <td key={name} className="max-w-[14rem] truncate py-1.5 pr-3 font-mono">
                      {cellText(record[name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {fields.length > shown.length || source.records.length > preview.length ? (
            <p className="mt-1 text-xs text-mute">
              Showing {preview.length} of {source.records.length} records and {shown.length} of {fields.length} fields.
            </p>
          ) : null}
        </div>
      </div>

      {problem ? <ProblemLine message={problem} /> : null}
      {profileIssues.length > 0 ? (
        <div role="alert" className="border border-fail/40 border-l-4 border-l-fail bg-panel p-4 text-sm" data-testid="source-profile-issues">
          <p className="font-medium">This data can't be used yet.</p>
          <ul className="mt-1 list-disc pl-5 text-ink-text">
            {profileIssues.slice(0, 4).map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {attention.length > 0 ? (
        <ul className="space-y-2" data-testid="source-attention">
          {attention.map((warning) => (
            <li key={warning.code} className="flex items-start gap-2 border border-warn/40 border-l-4 border-l-warn bg-panel p-3 text-sm">
              <AlertIcon size={15} className="mt-0.5 shrink-0 text-warn" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {candidates.length > 0 ? (
        <fieldset className="rounded-[3px] border border-rule p-4 text-sm" data-testid="type-review">
          <legend className="px-1 text-sm font-medium">Kept as text — change if you need numbers</legend>
          <p className="text-xs text-mute">These columns look like numbers or true/false. They stay text unless you choose otherwise; converting never changes a value.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {candidates.map((candidate) => {
              const on = origin?.typeChoices.includes(candidate.column) ?? false;
              return (
                <label key={candidate.column} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-[3px] border px-3 ${on ? "border-violet-soft bg-violet/10" : "border-rule"}`}>
                  <input type="checkbox" className="accent-violet" checked={on} onChange={(event) => onType(candidate.column, event.target.checked)} data-testid={`type-choice-${candidate.column}`} />
                  <span>
                    Read <span className="font-mono">{candidate.column}</span> as {candidate.as === "number" ? "a number" : "true/false"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {ready ? (
        <div className="space-y-3" data-testid="data-on-device">
          {onDevice.kind === "available" ? (
            <Disclosure summary={<span className="inline-flex items-center gap-1.5"><ChipIcon size={14} /> On-device AI is available · optional: let Gemini Nano improve field understanding</span>} testId="guided-understanding">
              <p className="mb-3 text-sm text-ink-text">Gemini Nano reads field names and a few samples on this device. Nothing is sent. Skip it and EYES uses its own analysis.</p>
              {understanding}
            </Disclosure>
          ) : onDevice.kind === "blocked" ? (
            <p className="flex items-center gap-1.5 text-xs text-mute" data-testid="guided-on-device-unavailable">
              <ChipIcon size={13} /> On-device AI isn't available in this browser. EYES uses its deterministic analysis; nothing is simulated.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-mute" data-testid="guided-on-device-checking">
              <ChipIcon size={13} /> Checking whether on-device AI is available in this browser…
            </p>
          )}
        </div>
      ) : null}

      {info.length > 0 || origin ? (
        <Disclosure summary="How the data was read" testId="source-details">
          <ul className="space-y-1 text-sm text-ink-text">
            {info.map((warning) => (
              <li key={warning.code} data-testid={`source-note-${warning.code}`}>
                {warning.message}
              </li>
            ))}
            {origin ? (
              <li className="font-mono text-xs text-mute">
                adapter {origin.adapter.id} {origin.adapter.version} · {origin.fields.length} fields ·{" "}
                {origin.fields.filter((field) => field.kinds.length > 1).length} with mixed types
              </li>
            ) : null}
          </ul>
        </Disclosure>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onContinue} disabled={!ready || understandingBusy} data-testid="data-continue">
          Next: choose the destination
          <ArrowRightIcon />
        </Button>
        {understandingBusy ? (
          <p className="text-xs text-mute" role="status" data-testid="data-continue-wait">
            On-device AI is still reading your fields. Next is available when it finishes.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function cellText(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
