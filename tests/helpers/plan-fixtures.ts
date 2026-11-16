/**
 * Sprint 18B (ADR 0018) — builders for compiler tests. Plans are written here
 * as the validator would return them (ValidatedIntentPlan); the validator
 * itself is tested separately. Data is the fictional CRM demo or small inline
 * fictional records; no holdout is ever read.
 */
import { vi } from "vitest";
import type { CloudDisclosurePayload } from "../../src/domain/contracts/types.ts";
import type { CompileInput } from "../../src/plan/compile.ts";
import {
  INTENT_PLAN_VERSION,
  type ClassifiedFailure,
  type IntentPlanEntry,
  type PlanAnswers,
  type PlanIssue,
  type ValidatedEntry,
  type ValidatedIntentPlan,
} from "../../src/plan/types.ts";
import { buildDisclosureDraft, type PreparedTwin } from "../../src/workflow/pipeline.ts";
import type { WorkspaceState } from "../../src/app/workspace-state.ts";
import { prepare } from "./export-workspace.ts";

/**
 * Worker D's clarify.ts / failures.ts may still be stubs in this tree. Use the
 * real implementation when it exists; otherwise a minimal stand-in that only
 * keeps the compiler testable. Tests never assert the stand-in's choices.
 */
export async function realOr<T extends object>(load: () => Promise<T>, fallbacks: Partial<T>): Promise<T> {
  const real = await load();
  const out: Record<string, unknown> = { ...(real as Record<string, unknown>) };
  for (const [name, fallback] of Object.entries(fallbacks)) {
    const original = (real as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
    out[name] = (...args: unknown[]) => {
      try {
        return original(...args);
      } catch (caught) {
        if (caught instanceof Error && /not implemented/.test(caught.message)) return (fallback as (...a: unknown[]) => unknown)(...args);
        throw caught;
      }
    };
  }
  return out as T;
}

export const clarifyFallback = { buildClarifications: vi.fn(() => []) };
export const failuresFallback = {
  nextActionFor: () => "ask-user" as const,
  classifyPlanIssue: (issue: PlanIssue): ClassifiedFailure => ({ category: "incorrect-correspondence", target: issue.target ?? null, next: "ask-user", evidence: [issue.code] }),
};

export const NO_ANSWERS: PlanAnswers = { fieldMatches: {}, categoryMeanings: {}, semanticConfirmations: {} };

export function entry(partial: Partial<IntentPlanEntry> & Pick<IntentPlanEntry, "target" | "status">): IntentPlanEntry {
  return { from: [], transform: "none", confidence: "high", evidence: ["meaning"], missing: [], ...partial };
}

export function validatedPlan(items: Array<IntentPlanEntry | { entry: IntentPlanEntry; verdict: ValidatedEntry["verdict"]; issues?: PlanIssue[] }>, unaddressed: string[] = []): ValidatedIntentPlan {
  const entries: ValidatedEntry[] = items.map((item, entryIndex) =>
    "entry" in item && "verdict" in item
      ? { entryIndex, entry: item.entry, verdict: item.verdict, issues: (item.issues ?? []).map((issue) => ({ ...issue, entryIndex })) }
      : { entryIndex, entry: item as IntentPlanEntry, verdict: "accepted", issues: [] },
  );
  return {
    planVersion: INTENT_PLAN_VERSION,
    plan: { fields: entries.map((item) => item.entry), summary: "Fictional plan for a compiler test." },
    entries,
    unaddressed,
    issues: entries.flatMap((item) => item.issues),
  };
}

export interface PlanSetup {
  start: WorkspaceState;
  prepared: PreparedTwin;
  disclosure: CloudDisclosurePayload;
  alias: (path: string) => string;
  input: (validated: ValidatedIntentPlan, answers?: Partial<PlanAnswers>) => CompileInput;
}

export function planSetup(start: WorkspaceState): PlanSetup {
  const prepared = prepare(start);
  const draft = buildDisclosureDraft({ prepared, targetSchema: JSON.parse(start.destinationText) as unknown });
  if (!draft.ok) throw new Error(draft.issues.join("; "));
  const disclosure = draft.value.payload;
  const alias = (path: string) => {
    const found = prepared.twin.bindings.aliasForPath(path);
    if (!found) throw new Error(`no alias for ${path}`);
    return found;
  };
  return {
    start,
    prepared,
    disclosure,
    alias,
    input: (validated, answers = {}) => ({
      validated,
      disclosure,
      prepared,
      records: start.source?.records ?? [],
      answers: { ...NO_ANSWERS, ...answers },
      requestId: "abcdef0123456789",
    }),
  };
}

/** Fictional records with slash dates: `signed` is ambiguous (every part ≤ 12); `renewed` proves day/month (25/…). */
export const SLASH_RECORDS: Record<string, unknown>[] = [
  { ref: "R-1001", signed: "03/04/2026", renewed: "25/04/2026", contact: "una@example.com" },
  { ref: "R-1002", signed: "05/06/2026", renewed: "13/06/2026", contact: "vik@example.com" },
  { ref: "R-1003", signed: "07/08/2026", renewed: "02/08/2026", contact: "wen@example.org" },
  { ref: "R-1004", signed: "09/10/2026", renewed: "30/10/2026", contact: "xan@example.net" },
];

export const SLASH_DESTINATION = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fictional renewal destination",
  type: "object",
  additionalProperties: false,
  required: ["ref", "signedOn", "renewedOn"],
  properties: {
    ref: { type: "string", minLength: 1 },
    signedOn: { type: "string", format: "date" },
    renewedOn: { type: "string", format: "date" },
    email: { type: "string", format: "email" },
  },
});
