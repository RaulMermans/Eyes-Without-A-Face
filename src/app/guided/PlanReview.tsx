import { useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { CLARIFICATION_COPY } from "../../plan/clarify.ts";
import type { Clarification, CompiledField } from "../../plan/types.ts";
import type { PreparedTwin } from "../../workflow/pipeline.ts";
import type { ProposalState } from "../workspace-state.ts";
import { COMBINE_SEPARATORS, describeRule, type CategoryMeaning, type FieldPlan } from "./field-plan.ts";
import { CategoryTranslation, DateOrderQuestion, NO_FIELD, type FieldQuestionHandlers, type SlashOrder } from "./FieldQuestions.tsx";

/**
 * Sprint 18B (ADR 0018 §4, §9) — Verify: what the planner matched per
 * destination field, and the few questions only the user can answer. A pure
 * reading of `proposal.plan.compiled`; every answer goes through the existing
 * decision handlers (applyFieldDecision → recompilePlan in App).
 */
const STATUS: Record<CompiledField["readiness"], string> = {
  ready: "ready",
  needs_clarification: "needs your answer",
  unsupported: "not possible",
  no_source: "no matching field",
};

export function PlanReview({
  proposal,
  prepared,
  plan,
  meanings,
  confirmations,
  dateExamples,
  handlers,
  onMapManually,
  onEditDestination,
}: {
  proposal: ProposalState;
  prepared: PreparedTwin;
  plan: FieldPlan | null;
  meanings: Readonly<Record<string, CategoryMeaning>>;
  confirmations: Readonly<Record<string, SlashOrder>>;
  dateExamples: (path: string) => string[];
  handlers: FieldQuestionHandlers;
  onMapManually: () => void;
  onEditDestination: () => void;
}) {
  const compiled = proposal.plan!.compiled;
  // Never call simulated output Gemini (AGENTS.md).
  const model = proposal.origin === "gemini-cloud" ? "Gemini" : "Simulated planner (not Gemini)";
  const local = (aliases: readonly string[]) => aliases.map((alias) => prepared.twin.bindings.resolve(alias) ?? alias).join(" + ");
  const who = (field: CompiledField) =>
    !field.correspondence ? "—" : field.correspondence.by === "user" ? "you" : field.operationOrigin === "gemini+user" ? `${model}, with your answer` : model;

  return (
    <section aria-labelledby="plan-heading" className="space-y-5" data-testid="plan-review" data-complete={String(compiled.complete)}>
      <div className="rounded-[3px] border border-rule bg-panel p-4">
        <h3 id="plan-heading" className="text-base font-semibold">
          Field matches
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm" data-testid="plan-fields">
            <thead>
              <tr className="border-b border-rule text-xs text-mute">
                <th scope="col" className="py-1.5 pr-3 font-normal">Destination</th>
                <th scope="col" className="py-1.5 pr-3 font-normal">From your data</th>
                <th scope="col" className="py-1.5 pr-3 font-normal">Matched by</th>
                <th scope="col" className="py-1.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {compiled.fields.map((field) => (
                <tr
                  key={field.target}
                  className="border-b border-rule/50 align-top"
                  data-testid={`plan-field-${field.target}`}
                  data-status={field.readiness}
                  data-by={field.correspondence?.by ?? "none"}
                >
                  <th scope="row" className="py-2 pr-3 font-mono text-xs font-normal text-ink">
                    {field.target}
                    {field.required ? null : <span className="block font-sans text-[11px] text-mute">optional</span>}
                  </th>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {field.correspondence ? local(field.correspondence.aliases) : "—"}
                    {field.operation ? <span className="block font-sans text-[11px] text-mute">{describeRule(field.operation)}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">{who(field)}</td>
                  <td className={`py-2 text-xs ${field.operation ? "text-pass" : field.required ? "text-warn" : "text-mute"}`}>{STATUS[field.readiness]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-mute">
          Your field names are shown only here. {model} saw placeholders. A match is not proof of meaning: check the preview once it has run.
        </p>
        <details className="mt-2 text-xs text-mute">
          <summary className="cursor-pointer">The planner's own note (model text, not evidence)</summary>
          <p className="mt-1 whitespace-pre-wrap">{proposal.plan!.validated.plan.summary}</p>
        </details>
      </div>

      {compiled.clarifications.length > 0 ? (
        <div className="space-y-4" data-testid="plan-questions">
          {compiled.clarifications.map((question) => (
            <Question
              key={question.id}
              prepared={prepared}
              question={question}
              plan={plan}
              meanings={meanings}
              confirmations={confirmations}
              dateExamples={dateExamples}
              handlers={handlers}
              onMapManually={onMapManually}
              onEditDestination={onEditDestination}
            />
          ))}
        </div>
      ) : null}

      {compiled.counts.executable === 0 ? (
        <p className="text-sm text-ink-text" data-testid="plan-not-integration">
          Nothing can run yet, so there is no integration. Answer the questions above, map the fields yourself, or change the destination.
        </p>
      ) : null}
      {compiled.fields.some((field) => field.readiness === "unsupported" && field.required) ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-text" data-testid="plan-unsupported">
          No allowed step can build {compiled.fields.filter((field) => field.readiness === "unsupported" && field.required).map((field) => `“${field.target}”`).join(", ")}.
          <Button size="sm" variant="outline" onClick={onMapManually}>
            Map fields yourself
          </Button>
        </p>
      ) : null}
    </section>
  );
}

function Question({
  prepared,
  question,
  plan,
  meanings,
  confirmations,
  dateExamples,
  handlers,
  onMapManually,
  onEditDestination,
}: {
  prepared: PreparedTwin;
  question: Clarification;
  plan: FieldPlan | null;
  meanings: Readonly<Record<string, CategoryMeaning>>;
  confirmations: Readonly<Record<string, SlashOrder>>;
  dateExamples: (path: string) => string[];
  handlers: FieldQuestionHandlers;
  onMapManually: () => void;
  onEditDestination: () => void;
}) {
  const copy = CLARIFICATION_COPY[question.kind];
  const target = plan?.targets.find((item) => item.target.name === question.target) ?? null;
  const path = question.localPaths[0] ?? null;
  const candidate = target && path ? (target.candidates.find((item) => item.path === path) ?? null) : null;
  // Gemini's candidates first (Sprint 18D: its ranked alternatives and local matcher candidates, ≤ 3), then any other compatible field.
  const options = [...new Set([...(question.rankedPaths ?? []), ...question.localPaths, ...(target?.candidates.map((item) => item.path) ?? [])])];
  // "Choose another field" (Sprint 15 rule): every other usable field, so the user is never limited to EYES's ranking.
  const others = prepared.profile.fields.filter((field) => field.type !== "unsupported" && !options.includes(field.path)).map((field) => field.path);

  let body;
  if (question.kind === "translate-categories") {
    body =
      target && candidate ? (
        <CategoryTranslation plan={target} candidate={candidate} meaning={meanings[question.target]} onMeaning={handlers.onMeaning} />
      ) : (
        <MapInstead text="This field's values can't be listed here." onMapManually={onMapManually} />
      );
  } else if (question.kind === "confirm-date-order") {
    body = path ? (
      <DateOrderQuestion path={path} target={question.target} examples={dateExamples(path)} current={confirmations[path] ?? null} onDateOrder={handlers.onDateOrder} />
    ) : (
      <MapInstead text="EYES can't show these dates here." onMapManually={onMapManually} />
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-text">Field:</span>
          <select
            aria-label={`Source of ${question.target}`}
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (value) handlers.onMatch(question.target, value === NO_FIELD ? null : value);
            }}
            className="min-h-9 rounded-[3px] border border-ink-3 bg-void px-2 text-sm text-ink focus:border-violet-soft focus:outline-none"
            data-testid={`clarify-pick-${question.target}`}
          >
            <option value="">Choose…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {others.length > 0 ? (
              <optgroup label="Choose another field">
                {others.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {question.kind === "choose-field" ? <option value={NO_FIELD}>{question.required ? "None of them (required: can't build)" : "None of them — leave it empty"}</option> : null}
          </select>
        </label>
        {question.kind === "missing-required-source" ? (
          <Button size="sm" variant="ghost" onClick={onEditDestination} data-testid={`clarify-destination-${question.target}`}>
            Change the destination
          </Button>
        ) : null}
        {handlers.onCombine && target?.target.type === "string" && !target.target.format ? (
          <CombineFields target={question.target} fields={[...options, ...others]} onCombine={handlers.onCombine} />
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="space-y-2 rounded-[3px] border border-warn/50 border-l-4 border-l-warn bg-panel p-4 text-sm"
      data-testid={`clarify-${question.kind}-${question.target}`}
      aria-label={copy.title(question.target)}
    >
      <p className="font-medium">
        {copy.title(question.target)}
        {question.required ? null : <span className="ml-2 text-xs font-normal text-mute">optional</span>}
      </p>
      <p className="text-xs text-mute">{copy.help}</p>
      {body}
      {(question.kind === "translate-categories" || question.kind === "confirm-date-order") && path ? (
        // Sprint 18F: a question about the wrong field must be answerable — the user can name the right one.
        <label className="flex flex-wrap items-center gap-2 text-xs text-mute">
          <span>Not the right field for “{question.target}”? Use another:</span>
          <select
            aria-label={`Another source for ${question.target}`}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) handlers.onMatch(question.target, event.target.value);
            }}
            className="min-h-8 rounded-[3px] border border-ink-3 bg-void px-2 text-xs text-ink focus:border-violet-soft focus:outline-none"
            data-testid={`clarify-other-field-${question.target}`}
          >
            <option value="">Choose…</option>
            {[...options, ...others].filter((option) => option !== path).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}

function MapInstead({ text, onMapManually }: { text: string; onMapManually: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-mute">
      {text}
      <Button size="sm" variant="outline" onClick={onMapManually}>
        Map fields yourself
      </Button>
    </p>
  );
}

/**
 * Sprint 18F: "Combine several fields" — 2–4 source fields in order plus a fixed separator, applied
 * only on the user's click. Compiled as the existing concat operation; nothing is pre-selected.
 */
function CombineFields({ target, fields, onCombine }: { target: string; fields: readonly string[]; onCombine: NonNullable<FieldQuestionHandlers["onCombine"]> }) {
  const [paths, setPaths] = useState<string[]>(["", ""]);
  const [separator, setSeparator] = useState<(typeof COMBINE_SEPARATORS)[number] | "">("");
  const chosen = paths.filter(Boolean);
  const valid = chosen.length >= 2 && new Set(chosen).size === chosen.length && separator !== "";
  const label = (value: string) => (value === " " ? "space" : JSON.stringify(value));
  return (
    <details className="w-full text-xs" data-testid={`clarify-combine-${target}`}>
      <summary className="cursor-pointer text-mute">Combine several fields…</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {paths.map((value, index) => (
          <select
            key={index}
            aria-label={`Part ${index + 1} of ${target}`}
            value={value}
            onChange={(event) => setPaths(paths.map((item, at) => (at === index ? event.target.value : item)))}
            className="min-h-8 rounded-[3px] border border-ink-3 bg-void px-2 text-xs text-ink"
            data-testid={`clarify-combine-${target}-part-${index + 1}`}
          >
            <option value="">Part {index + 1}…</option>
            {fields.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        ))}
        {paths.length < 4 ? (
          <Button size="sm" variant="ghost" onClick={() => setPaths([...paths, ""])}>
            Add a part
          </Button>
        ) : null}
        <select
          aria-label={`Separator for ${target}`}
          value={separator}
          onChange={(event) => setSeparator(event.target.value as (typeof COMBINE_SEPARATORS)[number] | "")}
          className="min-h-8 rounded-[3px] border border-ink-3 bg-void px-2 text-xs text-ink"
          data-testid={`clarify-combine-${target}-separator`}
        >
          <option value="">Separator…</option>
          {COMBINE_SEPARATORS.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={!valid} onClick={() => valid && onCombine(target, { paths: chosen, separator: separator as (typeof COMBINE_SEPARATORS)[number] })} data-testid={`clarify-combine-${target}-apply`}>
          Combine
        </Button>
      </div>
    </details>
  );
}
