import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import { draftSchemaFromSample, EXAMPLE_DESTINATIONS, exampleFor, summarizeDestination } from "./destinations.ts";

/**
 * Guided step 2 — "Where should it go?" (Sprint 13, A3 / A4).
 *
 * A destination is the JSON Schema the output must satisfy. Choosing one
 * never connects to or writes to any system. "Build integration" validates
 * everything locally first and shows ONE actionable message if something is
 * missing.
 */
export function DestinationStep({
  destinationText,
  onDestination,
  sourceLabel,
  buildBlocker,
  building,
  onBuild,
  onBack,
}: {
  destinationText: string;
  onDestination: (text: string) => void;
  sourceLabel: string | null;
  /** The one reason Build cannot run yet, or null. */
  buildBlocker: string | null;
  building: boolean;
  onBuild: () => void;
  onBack: () => void;
}) {
  const example = exampleFor(destinationText);
  const [custom, setCustom] = useState(example === null);
  const [draftText, setDraftText] = useState(example ? "" : destinationText);
  const [sampleText, setSampleText] = useState("");
  const [customProblem, setCustomProblem] = useState<string | null>(null);
  const summary = useMemo(() => summarizeDestination(destinationText), [destinationText]);

  function applyCustomText(text: string): void {
    setDraftText(text);
    const result = summarizeDestination(text);
    if (!result.ok) {
      setCustomProblem(result.message);
      return;
    }
    setCustomProblem(null);
    onDestination(text);
  }

  async function readSchemaFile(file: File): Promise<void> {
    if (file.size > 64 * 1024) {
      setCustomProblem("The schema file is larger than 64 KiB.");
      return;
    }
    applyCustomText(await file.text());
  }

  function draftFromSample(): void {
    const draft = draftSchemaFromSample(sampleText);
    if (!draft.ok) {
      setCustomProblem(draft.message);
      return;
    }
    applyCustomText(draft.text);
  }

  return (
    <section aria-labelledby="destination-step-heading" className="space-y-6" data-testid="guided-destination">
      <header className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold">Step 2 of 3</p>
        <h2 id="destination-step-heading" tabIndex={-1} className="focus:outline-none mt-2 font-display text-4xl leading-[1.05] tracking-[-0.01em] sm:text-5xl">
          Where should it go?
        </h2>
        <p className="mt-3 text-base leading-7 text-ink-text">Pick the shape your data must take. EYES builds a transformation you download; it does not connect to the destination.</p>
      </header>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="destination-choices">
        <legend className="sr-only">Destination</legend>
        {EXAMPLE_DESTINATIONS.map((item) => {
          const selected = !custom && example?.id === item.id;
          return (
            <label
              key={item.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-[3px] border p-4 transition-colors focus-within:border-violet-soft ${selected ? "border-violet-soft bg-violet/10" : "border-rule bg-panel hover:border-violet-soft/50"}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="guided-destination"
                  className="accent-violet"
                  checked={selected}
                  onChange={() => {
                    setCustom(false);
                    setCustomProblem(null);
                    onDestination(item.text);
                  }}
                  data-testid={`destination-${item.id}`}
                />
                <span className="font-medium">{item.name}</span>
              </span>
              <span className="text-xs leading-5 text-mute">{item.blurb}</span>
              <span className="mt-auto pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mute">fictional example</span>
            </label>
          );
        })}
        <label className={`flex cursor-pointer flex-col gap-1 rounded-[3px] border p-4 transition-colors focus-within:border-violet-soft ${custom ? "border-violet-soft bg-violet/10" : "border-rule bg-panel hover:border-violet-soft/50"}`}>
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="guided-destination"
              className="accent-violet"
              checked={custom}
              onChange={() => {
                setCustom(true);
                if (draftText) applyCustomText(draftText);
              }}
              data-testid="destination-custom"
            />
            <span className="font-medium">Your own</span>
          </span>
          <span className="text-xs leading-5 text-mute">Import or paste a JSON Schema, or draft one from a sample record.</span>
        </label>
      </fieldset>

      {custom ? (
        <div className="space-y-3 rounded-[3px] border border-rule bg-panel p-5" data-testid="destination-custom-editor">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-[3px] border border-ink-3 px-3 text-sm hover:border-violet-soft/60 focus-within:border-violet-soft">
              Import schema (.json)
              <input
                type="file"
                accept=".json,application/json,application/schema+json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readSchemaFile(file);
                  event.target.value = "";
                }}
                data-testid="destination-file"
              />
            </label>
            <span className="text-xs text-mute">JSON Schema 2020-12 with an object of fields.</span>
          </div>
          <label htmlFor="destination-text" className="block text-sm font-medium">
            Or paste it
          </label>
          <textarea
            id="destination-text"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onBlur={() => draftText.trim() && applyCustomText(draftText)}
            rows={8}
            spellCheck={false}
            className="block w-full rounded-[3px] border border-ink-3 bg-void p-3 font-mono text-xs text-ink focus:border-violet-soft focus:outline-none"
            data-testid="destination-text"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => applyCustomText(draftText)} data-testid="destination-apply">
              Use this schema
            </Button>
          </div>
          <Disclosure summary="Draft a schema from one example output record" testId="destination-sample">
            <p className="text-xs text-mute">Every field becomes required, typed from its example value. No formats or allowed values are guessed. Review the draft before building.</p>
            <textarea
              aria-label="Example output record"
              value={sampleText}
              onChange={(event) => setSampleText(event.target.value)}
              rows={4}
              spellCheck={false}
              placeholder='{"id": "A-1", "email": "a@example.com", "active": true}'
              className="mt-2 block w-full rounded-[3px] border border-ink-3 bg-void p-3 font-mono text-xs text-ink focus:border-violet-soft focus:outline-none"
              data-testid="destination-sample-text"
            />
            <Button size="sm" className="mt-2" onClick={draftFromSample} data-testid="destination-draft">
              Draft schema
            </Button>
          </Disclosure>
          {customProblem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-fail" data-testid="destination-problem">
              <AlertIcon size={15} className="mt-0.5 shrink-0" /> {customProblem}
            </p>
          ) : null}
        </div>
      ) : null}

      {summary.ok ? (
        <div className="rounded-[3px] border border-rule bg-panel p-5" data-testid="destination-summary">
          <h3 className="text-sm font-medium">
            Each record becomes a <span className="text-ink">{summary.title}</span> with {summary.fields.length} field{summary.fields.length === 1 ? "" : "s"}
          </h3>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" aria-label="Destination fields" data-testid="destination-summary-fields">
            {summary.fields.map((field) => (
              <li key={field.name} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-ink">{field.name}</span>
                <span className="text-xs text-mute">
                  {field.type === "enum" ? `one of ${field.enumValues?.join(", ")}` : field.format ? `${field.type}, ${field.format}` : field.type}
                  {field.required ? "" : " · optional"}
                </span>
              </li>
            ))}
          </ul>
          <Disclosure summary="View the schema" className="mt-3" testId="destination-schema-view">
            <pre className="max-h-64 overflow-auto rounded-[3px] border border-rule bg-void p-3 font-mono text-[11px] text-ink">{destinationText}</pre>
          </Disclosure>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="destination-back">
          Back to your data
        </Button>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Button variant="primary" size="lg" onClick={onBuild} disabled={building} data-testid="guided-build">
            {building ? "Preparing…" : "Build integration"}
            <ArrowRightIcon />
          </Button>
          <p className="text-xs text-mute sm:text-right">{sourceLabel ? `${sourceLabel} → ${summary.ok ? summary.title : "destination"}. ` : ""}Nothing is sent without your approval.</p>
        </div>
      </div>
      {buildBlocker ? (
        <p role="alert" className="flex items-start gap-2 border border-fail/40 border-l-4 border-l-fail bg-panel p-3 text-sm" data-testid="guided-build-error">
          <AlertIcon size={16} className="mt-0.5 shrink-0 text-fail" />
          <span>{buildBlocker}</span>
        </p>
      ) : null}
    </section>
  );
}
