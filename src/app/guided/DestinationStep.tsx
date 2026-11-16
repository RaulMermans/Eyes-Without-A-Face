import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { AlertIcon, ArrowRightIcon, LockIcon } from "../../components/icons.tsx";
import { Disclosure } from "../../components/spectral.tsx";
import { draftSchemaFromSample, EXAMPLE_DESTINATIONS, exampleFor, summarizeDestination } from "./destinations.ts";
import type { CategoryNeed } from "./recovery.ts";
import { describeRule, type CategoryMeaning, type FieldPlan } from "./field-plan.ts";
import { EnumQuestions, FieldMatches, type FieldQuestionHandlers, type SlashOrder } from "./FieldQuestions.tsx";

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
  plan = null,
  meanings = {},
  confirmations = {},
  dateExamples = () => [],
  onMatch = () => {},
  onMeaning = () => {},
  onDateOrder = () => {},
  onBuildLocal = () => {},
  buildBlocker,
  excludedCount = 0,
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
  /** Sprint 15: target-first field plan (field-plan.ts) and the user's decisions. */
  plan?: FieldPlan | null;
  meanings?: Readonly<Record<string, CategoryMeaning>>;
  confirmations?: Readonly<Record<string, SlashOrder>>;
  dateExamples?: (path: string) => string[];
  onMatch?: FieldQuestionHandlers["onMatch"];
  onMeaning?: FieldQuestionHandlers["onMeaning"];
  onDateOrder?: FieldQuestionHandlers["onDateOrder"];
  /** Sprint 15 (B3): build from the user's choices on this device; nothing is sent. */
  onBuildLocal?: () => void;
  /** The one reason Build cannot run yet, or null. */
  buildBlocker: string | null;
  /** Sprint 16B (D4): source fields that can't be used for mapping (listed on “Your data”). */
  excludedCount?: number;
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

  const [localProblem, setLocalProblem] = useState<string | null>(null);
  /**
   * Sprint 16B (D2): open "Field matches" when a non-category destination field needs the user's
   * decision, and keep it open (sticky) so it never snaps shut while the user is answering.
   */
  const needsDecision = Boolean(plan?.targets.some((item) => item.target.required && item.target.type !== "enum" && (item.need === "confirm" || item.need === "source")));
  const [matchesOpen, setMatchesOpen] = useState(needsDecision);
  if (needsDecision && !matchesOpen) setMatchesOpen(true);
  /** Prefer the on-device build when it is complete and a Gemini request could not fill a required field. */
  const preferLocal = Boolean(plan?.localReady && categoryNeed?.blocking);

  /** B3: build from the user's own choices on this device. Says why when it cannot. */
  function buildLocal(): void {
    if (custom && (customEmpty || unapplied)) {
      setLocalProblem("Apply your schema first (“Use this schema”).");
      return;
    }
    if (!plan?.localReady) {
      setLocalProblem(plan?.localBlocker ?? "Some destination fields have no match yet.");
      return;
    }
    setLocalProblem(null);
    onBuildLocal();
  }

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

      {showSummary && plan ? (
        <EnumQuestions plan={plan} meanings={meanings} blocking={Boolean(categoryNeed?.blocking)} handlers={{ onMatch, onMeaning, onShareCategories, onDateOrder }} />
      ) : null}

      {showSummary && plan ? (
        <Disclosure
          summary={
            <>
              Field matches: {plan.targets.filter((item) => item.rule).length} of {plan.targets.length} ready to build on this device
            </>
          }
          testId="field-matches-disclosure"
          className="rounded-[3px] border border-rule bg-panel p-4"
          defaultOpen={matchesOpen || undefined}
        >
          {excludedCount > 0 ? (
            <p className="mb-3 flex items-start gap-1.5 text-sm text-warn" data-testid="destination-excluded-note">
              <AlertIcon size={14} className="mt-0.5 shrink-0" />
              {excludedCount === 1 ? "1 of your fields can't be used for mapping and is not listed here" : `${excludedCount} of your fields can't be used for mapping and are not listed here`} — see
              “Your data” for why and how to fix it.
            </p>
          ) : null}
          <p className="mb-3 text-sm text-ink-text">
            To build on this device, choose or confirm the field that gives each destination field. EYES only suggests: a matching type, format or name is a hint, not proof of
            meaning, and nothing is used until you decide. Gemini proposes its own matches if you build with Gemini instead.
          </p>
          <FieldMatches plan={plan} confirmations={confirmations} dateExamples={dateExamples} handlers={{ onMatch, onMeaning, onShareCategories, onDateOrder }} />
        </Disclosure>
      ) : null}

      {showSummary && plan?.localReady ? (
        <div className="rounded-[3px] border border-ink/40 bg-panel p-4 text-sm" data-testid="local-summary">
          <p className="flex items-center gap-1.5 font-medium">
            <LockIcon size={14} className="shrink-0" /> Built on this device, this mapping would be:
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="Mapping built on this device">
            {plan.targets.flatMap((item) =>
              item.rule ? [
                <li key={item.target.name} className="flex flex-wrap items-baseline gap-x-2" data-testid={`local-summary-${item.target.name}`}>
                  <span className="font-mono text-ink">{item.target.name}</span>
                  <span className="text-xs text-mute">
                    ← <span className="font-mono">{item.chosen}</span>, {describeRule(item.rule)}
                  </span>
                </li>,
              ] : [],
            )}
          </ul>
          <p className="mt-2 text-xs text-mute">Not right? Change a row under “Field matches”. Nothing is built until you click.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack} data-testid="destination-back">
          Back to your data
        </Button>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {plan && showSummary ? (
              <Button
                variant={preferLocal ? "primary" : "ghost"}
                size={preferLocal ? "lg" : "md"}
                onClick={buildLocal}
                disabled={building}
                title={plan.localReady ? undefined : (plan.localBlocker ?? undefined)}
                data-testid="guided-build-local"
                data-ready={String(plan.localReady)}
              >
                Build on this device
              </Button>
            ) : null}
            <Button variant={preferLocal ? "outline" : "primary"} size="lg" onClick={build} disabled={building} data-testid="guided-build">
              {building ? "Preparing…" : preferLocal ? "Build with Gemini" : "Build integration"}
              <ArrowRightIcon />
            </Button>
          </div>
          <p className="text-xs text-mute sm:text-right" data-testid="guided-build-hint">
            {sourceLabel ? `${sourceLabel} → ${showSummary && summary.ok ? summary.title : custom ? "your schema" : "destination"}. ` : ""}
            {preferLocal ? "Your answers are enough to build here, with nothing sent. Gemini needs your approval first." : "Gemini designs the mapping after your approval; nothing is sent before."}
          </p>
          {localProblem ? (
            <p role="alert" className="text-xs text-warn sm:text-right" data-testid="guided-build-local-blocker">
              {localProblem}
            </p>
          ) : null}
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
