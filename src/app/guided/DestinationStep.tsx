import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import { draftSchemaFromSample, EXAMPLE_DESTINATIONS, exampleFor, summarizeDestination } from "./destinations.ts";
import type { CategoryNeed } from "./recovery.ts";

/**
 * Guided step 2 — "Where should it go?" (Sprint 13, A3 / A4).
 *
 * A destination is the JSON Schema the output must satisfy. Choosing one
 * never connects to or writes to any system. "Build integration" validates
 * everything locally first and shows ONE actionable message if something is
 * missing.
 *
 * Sprint 14 (C2): the destination that Build uses is always the one on screen.
 * In "Your own" mode, an empty, unapplied or invalid editor blocks Build with a
 * reason instead of silently building against the previously active schema,
 * and the field summary is shown only for the schema actually in use.
 */
export function DestinationStep({
  destinationText,
  onDestination,
  sourceLabel,
  categoryNeed = null,
  onShareCategories = () => {},
  buildBlocker,
  building,
  onBuild,
  onBack,
}: {
  destinationText: string;
  onDestination: (text: string) => void;
  sourceLabel: string | null;
  /** Sprint 14: the destination takes values from a fixed list that come from the user's categories. */
  categoryNeed?: CategoryNeed | null;
  /** Sprint 14: the user's explicit choice to share (or stop sharing) a field's category names. */
  onShareCategories?: (paths: string[], share: boolean) => void;
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
  /** The editor shows something other than the schema in use (typed, not yet applied). */
  const unapplied = custom && draftText.trim() !== "" && draftText !== destinationText;
  /** "Your own" is selected but no schema of the user's is in use yet. */
  const customEmpty = custom && draftText.trim() === "";
  const showSummary = summary.ok && !unapplied && !customEmpty;

  /** Build only against the destination on screen (C2). */
  function build(): void {
    if (custom) {
      if (customEmpty) {
        setCustomProblem("Add your schema first: import a file, paste it, or draft one from a sample record.");
        return;
      }
      if (unapplied) {
        const result = summarizeDestination(draftText);
        if (!result.ok) {
          setCustomProblem(`Your schema can't be used yet: ${result.message} Fix it or choose an example destination; nothing was built.`);
          return;
        }
        setCustomProblem(null);
        onDestination(draftText);
      }
    }
    onBuild();
  }

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
            aria-invalid={customProblem ? true : undefined}
            aria-describedby={customProblem ? "destination-problem" : undefined}
            onChange={(event) => {
              setDraftText(event.target.value);
              setCustomProblem(null);
            }}
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
          {unapplied && !customProblem ? (
            <p className="text-xs text-warn" data-testid="destination-unapplied">
              These edits are not in use yet. “Build integration” will check and use them, or click “Use this schema”.
            </p>
          ) : null}
          {customProblem ? (
            <p role="alert" id="destination-problem" className="flex items-start gap-2 text-sm text-fail" data-testid="destination-problem">
              <AlertIcon size={15} className="mt-0.5 shrink-0" /> {customProblem}
            </p>
          ) : null}
        </div>
      ) : null}

      {showSummary && summary.ok ? (
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

      {showSummary && categoryNeed ? (
        <fieldset className="space-y-3 rounded-[3px] border border-warn/50 border-l-4 border-l-warn bg-panel p-5 text-sm" data-testid="destination-categories" data-blocking={String(categoryNeed.blocking)}>
          <legend className="sr-only">Category names</legend>
          <p className="font-medium">
            {categoryNeed.targets.map((target) => `“${target.name}”`).join(" and ")} must be one of a fixed list. Gemini can only fill {categoryNeed.targets.length === 1 ? "it" : "them"} if it sees
            the names of your categories.
          </p>
          <p className="text-ink-text">
            By default EYES hides these names and shows Gemini placeholders.
            {categoryNeed.blocking ? " Without them this integration can't be built." : ""} Your records are never sent either way. Decide per field:
          </p>
          <ul className="space-y-2">
            {categoryNeed.fields.map((field) => (
              <li key={field.path}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 accent-violet"
                    checked={field.shared}
                    onChange={(event) => onShareCategories([field.path], event.target.checked)}
                    data-testid={`share-categories-${field.path}`}
                  />
                  <span>
                    Share the {field.labels.length} category name{field.labels.length === 1 ? "" : "s"} of <span className="font-mono text-ink">{field.path}</span>:{" "}
                    <span className="font-mono text-xs">{field.labels.join(", ")}</span>
                    {field.rare > 0 ? (
                      <span className="block text-xs text-warn">
                        {field.rare === field.labels.length ? "All of these are" : `${field.rare} of these ${field.rare === 1 ? "is" : "are"}`} used by only a few records, so sharing could hint at which records they are.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="destination-back">
          Back to your data
        </Button>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Button variant="primary" size="lg" onClick={build} disabled={building} data-testid="guided-build">
            {building ? "Preparing…" : "Build integration"}
            <ArrowRightIcon />
          </Button>
          <p className="text-xs text-mute sm:text-right">{sourceLabel ? `${sourceLabel} → ${showSummary && summary.ok ? summary.title : custom ? "your schema" : "destination"}. ` : ""}Nothing is sent without your approval.</p>
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
