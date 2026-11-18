import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { CheckIcon, DashIcon, LockIcon } from "../../components/icons.tsx";
import type { DateInputFormat } from "../../domain/profile/profile.ts";
import { describeRule, translationComplete, type CategoryMeaning, type FieldPlan, type SourceCandidate, type TargetPlan, type FieldCombination } from "./field-plan.ts";

/**
 * Sprint 15 (Workstreams A, B, C) — the guided questions.
 *
 * Target-first: each question names a DESTINATION field and offers only the
 * source fields that could fill it. Every answer is the user's explicit
 * choice; nothing is pre-translated from similar-looking names, nothing is
 * shared by default, and nothing here sends or approves anything.
 */

export type SlashOrder = Extract<DateInputFormat, "MM/DD/YYYY" | "DD/MM/YYYY">;

export interface FieldQuestionHandlers {
  /**
   * Sprint 16B (D1): `source` is a field path (chosen), `null` (the user chose
   * NO field — honoured, never refilled) or `undefined` (back to undecided).
   */
  onMatch: (target: string, source: string | null | undefined) => void;
  onMeaning: (target: string, meaning: CategoryMeaning | null) => void;
  onShareCategories: (paths: string[], share: boolean) => void;
  onDateOrder: (path: string, order: SlashOrder) => void;
  /** Sprint 18F: combine 2–4 fields into one text destination field (null = remove the combination). */
  onCombine?: (target: string, combination: FieldCombination | null) => void;
}

const SET_ASIDE = "__set_aside__";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function RareNote({ candidate }: { candidate: SourceCandidate }) {
  if (candidate.rare === 0) return null;
  return (
    <span className="block text-xs text-warn">
      {candidate.rare === candidate.labels.length ? "All of these are" : `${candidate.rare} of these ${candidate.rare === 1 ? "is" : "are"}`} used by only one record, so sharing could hint at which
      record it is.
    </span>
  );
}

/**
 * Local translation of one source field's categories into the allowed
 * destination values. Every label starts undecided: EYES never guesses what a
 * business state means. "Fill identical names" is an explicit click that only
 * copies labels spelled exactly like an allowed value.
 */
export function CategoryTranslation({
  plan,
  candidate,
  meaning,
  onMeaning,
}: {
  plan: TargetPlan;
  candidate: SourceCandidate;
  meaning: CategoryMeaning | undefined;
  onMeaning: FieldQuestionHandlers["onMeaning"];
}) {
  const target = plan.target;
  const allowed = target.enumValues ?? [];
  const values = meaning && meaning.source === candidate.path ? meaning.values : {};
  const decided = candidate.labels.filter((label) => Object.hasOwn(values, label)).length;
  const complete = translationComplete(meaning, candidate, target);
  const identical = candidate.labels.filter((label) => allowed.includes(label) && !Object.hasOwn(values, label));
  const set = (label: string, choice: string) => {
    const next = { ...values };
    if (choice === "") delete next[label];
    else next[label] = choice === SET_ASIDE ? null : choice;
    onMeaning(target.name, Object.keys(next).length > 0 ? { source: candidate.path, values: next } : null);
  };
  return (
    <div className="space-y-2" data-testid={`translation-${target.name}`} data-complete={String(complete)}>
      <p className="text-xs leading-5 text-ink-text">
        <LockIcon size={12} className="mr-1.5 inline align-[-1px]" />Stays on this device. Choose what each value of <span className="font-mono text-ink">{candidate.path}</span> means for{" "}
        <span className="font-mono text-ink">{target.name}</span>.
      </p>
      <table className="w-full max-w-xl text-left text-sm">
        <thead>
          <tr className="border-b border-rule text-xs text-mute">
            <th scope="col" className="py-1 pr-3 font-normal">Your value</th>
            <th scope="col" className="py-1 font-normal">Becomes</th>
          </tr>
        </thead>
        <tbody>
          {candidate.labels.map((label) => {
            const current = Object.hasOwn(values, label) ? (values[label] === null ? SET_ASIDE : values[label]!) : "";
            return (
              <tr key={label} className="border-b border-rule/50">
                <th scope="row" className="py-1.5 pr-3 font-mono text-xs font-normal text-ink">{label}</th>
                <td className="py-1.5">
                  <select
                    aria-label={`${label} becomes`}
                    value={current}
                    onChange={(event) => set(label, event.target.value)}
                    className="min-h-9 w-full rounded-[3px] border border-ink-3 bg-void px-2 text-sm text-ink focus:border-violet-soft focus:outline-none"
                    data-testid={`translate-${target.name}-${label}`}
                  >
                    <option value="">Choose…</option>
                    {allowed.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                    <option value={SET_ASIDE}>Set aside for review</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={complete ? "text-pass" : "text-mute"} data-testid={`translation-progress-${target.name}`}>
          {complete ? "Every value has a meaning." : `${decided} of ${candidate.labels.length} decided.`}
        </span>
        {identical.length > 0 ? (
          <button
            type="button"
            className="underline"
            onClick={() => onMeaning(target.name, { source: candidate.path, values: { ...values, ...Object.fromEntries(identical.map((label) => [label, label])) } })}
            data-testid={`translate-identical-${target.name}`}
          >
            Use the {plural(identical.length, "value")} spelled exactly like an allowed value
          </button>
        ) : null}
      </div>
      <p className="text-xs text-mute">Records whose value is set aside, or a value not in this list, are held for review — never counted as transformed.</p>
    </div>
  );
}

/** One destination field from a fixed list: which source field gives it, and how its values become the allowed ones. */
function EnumQuestion({
  plan,
  meaning,
  handlers,
}: {
  plan: TargetPlan;
  meaning: CategoryMeaning | undefined;
  handlers: FieldQuestionHandlers;
}) {
  const target = plan.target;
  const top = plan.candidates.slice(0, 3);
  const others = plan.candidates.slice(3);
  const chosen = plan.candidates.find((candidate) => candidate.path === plan.chosen) ?? null;
  const [translate, setTranslate] = useState(Boolean(meaning && chosen && meaning.source === chosen.path));
  const showTranslation = Boolean(chosen && (translate || (meaning && meaning.source === chosen.path)));
  const readyText =
    plan.rule && chosen?.shared
      ? "Ready: translated here, and Gemini can see the names."
      : plan.rule
        ? "Ready to build on this device. Nothing about these values is sent."
        : chosen?.shared
          ? "Ready: Gemini will see these names and write the translation."
          : null;

  return (
    <fieldset className="space-y-3 border-t border-rule pt-3 first:border-t-0 first:pt-0" data-testid={`question-${target.name}`} data-ready={String(Boolean(readyText))}>
      <legend className="sr-only">Source of {target.name}</legend>
      <p className="font-medium">
        Which field in your data gives <span className="font-mono text-ink">{target.name}</span>?
        <span className="ml-2 text-xs font-normal text-mute">
          one of {target.enumValues?.join(", ")}
          {target.required ? "" : " · optional"}
        </span>
      </p>

      {plan.candidates.length === 0 ? (
        <p className="text-ink-text" data-testid={`question-no-candidate-${target.name}`}>
          None of your fields has a short list of values that could become {target.name}. Change the destination, or check your data.
        </p>
      ) : plan.chosenBy === "only-candidate" ? (
        <p className="text-ink-text" data-testid={`question-only-${target.name}`}>
          <span className="font-mono text-ink">{plan.chosen}</span> — the only field in your data with a short list of values. If that is wrong, change the destination or your data.
        </p>
      ) : (
        <div className="space-y-1.5">
          {top.map((candidate) => (
            <label key={candidate.path} className="flex items-start gap-2">
              <input
                type="radio"
                name={`match-${target.name}`}
                className="mt-1 accent-violet"
                checked={plan.chosen === candidate.path && plan.chosenBy === "user"}
                onChange={() => handlers.onMatch(target.name, candidate.path)}
                data-testid={`match-${target.name}-${candidate.path}`}
              />
              <span>
                <span className="font-mono text-ink">{candidate.path}</span>
                <span className="text-xs text-mute"> · {candidate.reasons.slice(0, 2).join("; ")}</span>
                <span className="block font-mono text-[11px] text-mute">{candidate.labels.slice(0, 6).join(", ")}{candidate.labels.length > 6 ? ", …" : ""}</span>
              </span>
            </label>
          ))}
          {others.length > 0 ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-text">Choose another field:</span>
              <select
                value={others.some((candidate) => candidate.path === plan.chosen) ? plan.chosen! : ""}
                onChange={(event) => handlers.onMatch(target.name, event.target.value || undefined)}
                className="min-h-9 rounded-[3px] border border-ink-3 bg-void px-2 text-sm text-ink focus:border-violet-soft focus:outline-none"
                data-testid={`match-other-${target.name}`}
              >
                <option value="">—</option>
                {others.map((candidate) => (
                  <option key={candidate.path} value={candidate.path}>
                    {candidate.path}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-xs text-mute">These are fields that could fit, not a verified match. Pick the one that means {target.name} in your system.</p>
        </div>
      )}

      {chosen ? (
        <div className="space-y-2 pl-0 sm:pl-4">
          <p className="text-ink-text">
            How should its {plural(chosen.labels.length, "value")} become {target.name}?
          </p>
          {chosen.shareable ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-violet"
                checked={chosen.shared}
                onChange={(event) => handlers.onShareCategories([chosen.path], event.target.checked)}
                data-testid={`share-categories-${chosen.path}`}
              />
              <span>
                Let Gemini translate them: share the {plural(chosen.labels.length, "category name")} of <span className="font-mono text-ink">{chosen.path}</span>:{" "}
                <span className="font-mono text-xs">{chosen.labels.join(", ")}</span>
                <span className="block text-xs text-mute">These names leave this device in the request you review. Your records do not. Off by default.</span>
                <RareNote candidate={chosen} />
              </span>
            </label>
          ) : (
            <p className="text-xs text-mute">These values are free text, so they can't be shared with Gemini as categories. Translate them here.</p>
          )}
          {showTranslation ? (
            <CategoryTranslation plan={plan} candidate={chosen} meaning={meaning} onMeaning={handlers.onMeaning} />
          ) : (
            <Button size="sm" variant="outline" onClick={() => setTranslate(true)} data-testid={`translate-open-${target.name}`}>
              Translate them here instead — nothing is sent
            </Button>
          )}
        </div>
      ) : null}

      {readyText ? (
        <p className="flex items-center gap-1.5 text-xs text-pass" data-testid={`question-ready-${target.name}`}>
          <CheckIcon size={13} /> {readyText}
        </p>
      ) : null}
    </fieldset>
  );
}

export function EnumQuestions({
  plan,
  meanings,
  blocking,
  handlers,
}: {
  plan: FieldPlan;
  meanings: Readonly<Record<string, CategoryMeaning>>;
  blocking: boolean;
  handlers: FieldQuestionHandlers;
}) {
  if (plan.questions.length === 0) return null;
  const open = plan.questions.filter((item) => !item.rule && item.cloud !== "ok").length;
  return (
    <section
      className={`space-y-3 rounded-[3px] border bg-panel p-5 text-sm ${blocking && open > 0 ? "border-warn/50 border-l-4 border-l-warn" : "border-rule"}`}
      data-testid="destination-categories"
      data-blocking={String(blocking)}
      aria-labelledby="questions-heading"
    >
      <h3 id="questions-heading" className="font-medium">
        {open === 0 ? "Your answers" : open === 1 ? "One question before building" : `${open} questions before building`}
      </h3>
      <p className="text-ink-text">
        {plan.questions.map((item) => `“${item.target.name}”`).join(" and ")} must be one of a fixed list, so EYES needs to know which of your values means what. By default
        nothing about your values is shared.
        {blocking ? " Without them this integration can't be built by Gemini. You can translate them here instead — nothing is sent." : ""}
      </p>
      {plan.questions.map((item) => (
        <EnumQuestion key={item.target.name} plan={item} meaning={meanings[item.target.name]} handlers={handlers} />
      ))}
    </section>
  );
}

/** Example slash dates of a field, shown locally to help the user answer. */
export function DateOrderQuestion({
  path,
  target,
  examples,
  current,
  onDateOrder,
}: {
  path: string;
  target: string;
  examples: string[];
  current: SlashOrder | null;
  onDateOrder: FieldQuestionHandlers["onDateOrder"];
}) {
  return (
    <fieldset className="space-y-1.5 text-sm" data-testid={`date-order-${path}`}>
      <legend className="text-ink-text">
        Are the dates in <span className="font-mono text-ink">{path}</span> written day/month/year or month/day/year?
        {examples.length > 0 ? <span className="block font-mono text-[11px] text-mute">for example {examples.slice(0, 3).join(", ")} (shown only here)</span> : null}
      </legend>
      <div className="flex flex-wrap gap-4">
        {(["DD/MM/YYYY", "MM/DD/YYYY"] as const).map((order) => (
          <label key={order} className="flex items-center gap-2">
            <input type="radio" name={`date-order-${path}`} className="accent-violet" checked={current === order} onChange={() => onDateOrder(path, order)} data-testid={`date-order-${path}-${order === "DD/MM/YYYY" ? "dmy" : "mdy"}`} />
            {order === "DD/MM/YYYY" ? "Day/month/year" : "Month/day/year"}
          </label>
        ))}
      </div>
      <p className="text-xs text-mute">Your answer decides how “{target}” is read and is used to check the result. It stays on this device.</p>
    </fieldset>
  );
}

/** Select value for an explicit "no field" decision (Sprint 16B, D1). Never a field path: paths are identifiers. */
export const NO_FIELD = "__no_field__";

/**
 * B1 — the field correspondence. Every row shows the user's decision. Sprint
 * 16B (D1, D2): a ranked suggestion is shown beside an undecided row with a
 * "Use …" button; it never becomes part of a mapping until the user confirms
 * it, and an explicit "No field" is honoured. Historical note: a
 * suggestion becomes part of a mapping only when the user builds on this
 * device with these matches.
 */
export function FieldMatches({
  plan,
  confirmations,
  dateExamples,
  handlers,
}: {
  plan: FieldPlan;
  confirmations: Readonly<Record<string, SlashOrder>>;
  dateExamples: (path: string) => string[];
  handlers: FieldQuestionHandlers;
}) {
  return (
    <div className="space-y-3" data-testid="field-matches">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead>
            <tr className="border-b border-rule text-xs text-mute">
              <th scope="col" className="py-1.5 pr-3 font-normal">Destination</th>
              <th scope="col" className="py-1.5 pr-3 font-normal">From your data</th>
              <th scope="col" className="py-1.5 font-normal">On this device</th>
            </tr>
          </thead>
          <tbody>
            {plan.targets.map((item) => (
              <tr key={item.target.name} className="border-b border-rule/50 align-top" data-testid={`field-match-row-${item.target.name}`} data-need={item.need ?? "none"}>
                <th scope="row" className="py-2 pr-3 font-mono text-xs font-normal text-ink">
                  {item.target.name}
                  {item.target.required ? "" : <span className="block font-sans text-[11px] text-mute">optional</span>}
                </th>
                <td className="py-2 pr-3">
                  <select
                    aria-label={`Source of ${item.target.name}`}
                    value={item.decision === "none" ? NO_FIELD : item.decision === "source" ? (item.chosen ?? "") : ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      handlers.onMatch(item.target.name, value === "" ? undefined : value === NO_FIELD ? null : value);
                    }}
                    className="min-h-9 w-full rounded-[3px] border border-ink-3 bg-void px-2 text-sm text-ink focus:border-violet-soft focus:outline-none"
                    data-testid={`field-match-${item.target.name}`}
                  >
                    <option value="">{item.target.type === "enum" && item.chosenBy === "only-candidate" ? `${item.chosen} (asked above)` : "Not decided"}</option>
                    <option value={NO_FIELD}>{item.target.required ? "No field (required: blocks the build)" : "No field — leave it out"}</option>
                    {item.candidates.map((candidate) => (
                      <option key={candidate.path} value={candidate.path}>
                        {candidate.path}
                      </option>
                    ))}
                  </select>
                  {item.suggested ? (
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mute" data-testid={`field-match-suggestion-${item.target.name}`}>
                      <span>
                        Suggested: <span className="font-mono text-ink">{item.suggested}</span> — {item.candidates[0]?.reasons[0] ?? "compatible"}. A suggestion, not proof of meaning.
                      </span>
                      <Button size="sm" variant="outline" onClick={() => handlers.onMatch(item.target.name, item.suggested)} data-testid={`field-match-use-${item.target.name}`}>
                        Use {item.suggested}
                      </Button>
                    </span>
                  ) : null}
                  {item.chosenBy === "only-candidate" ? <span className="mt-0.5 block text-[11px] text-mute">the only compatible field — used once you translate its values</span> : null}
                </td>
                <td className="py-2 text-xs">
                  {item.rule ? (
                    <span className="flex items-center gap-1 text-ink-text">
                      <CheckIcon size={12} className="shrink-0 text-pass" /> {describeRule(item.rule)}
                    </span>
                  ) : item.need === "date-order" && item.chosen ? (
                    <DateOrderQuestion path={item.chosen} target={item.target.name} examples={dateExamples(item.chosen)} current={confirmations[item.chosen] ?? null} onDateOrder={handlers.onDateOrder} />
                  ) : item.need ? (
                    <span className="flex items-center gap-1 text-warn">
                      <DashIcon size={12} className="shrink-0" />
                      {item.need === "translation"
                        ? "needs a translation (above)"
                        : item.need === "confirm"
                          ? "confirm a field — nothing is used until you do"
                          : item.need === "source"
                            ? item.decision === "none"
                              ? "required — choose a field"
                              : "choose a field"
                            : "Gemini can build this; EYES can't on this device"}
                    </span>
                  ) : (
                    <span className="text-mute">{item.decision === "none" ? "left out by you" : "left out (not decided)"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-mute">
        Suggestions come from the shape of your data (types, formats, unique values). A similar name is only a hint. Building on this device uses exactly these rows.
      </p>
    </div>
  );
}
