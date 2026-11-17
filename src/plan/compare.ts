/**
 * Bounded plan repair: compare a revised plan with the accepted one (ADR 0018 §6). OWNER: Worker D.
 *
 * A revised plan never replaces a better one; equal is NOT_BETTER. The
 * comparison is ground-truth-blind: it reads only per-target executability and
 * the classified failures already on each compiled field (which include
 * verified outcomes when the caller merged them in). It never reads model
 * text or evaluation fixtures.
 */
import { nextActionFor } from "./failures.ts";
import { PLAN_REQUEST_LIMIT, type ClassifiedFailure, type CompiledField, type CompiledIntegration, type FailureCategory, type PlanComparison } from "./types.ts";

function failureKeys(field: CompiledField | undefined): Set<FailureCategory> {
  return new Set((field?.failures ?? []).map((failure) => failure.category));
}

/**
 * Verdict rules:
 *   regression  a target executable before and not after (or gone), or an
 *               executable target that gained a failure category it did not have
 *   gain        a target executable after and not before
 *   resolved    an executable-in-both target that lost a failure category
 *
 *   any regression                 → WORSE (never BETTER)
 *   no regression, gain or resolved → BETTER
 *   otherwise (equal)              → NOT_BETTER
 */
export function comparePlans(before: CompiledIntegration, after: CompiledIntegration): PlanComparison {
  const beforeBy = new Map(before.fields.map((field) => [field.target, field]));
  const afterBy = new Map(after.fields.map((field) => [field.target, field]));
  const targets = [...new Set([...before.fields.map((field) => field.target), ...after.fields.map((field) => field.target)])];

  const gains: string[] = [];
  const regressions: string[] = [];
  const resolved: string[] = [];
  const reasons: string[] = [];

  for (const target of targets) {
    const a = beforeBy.get(target);
    const b = afterBy.get(target);
    const execA = a?.operation != null;
    const execB = b?.operation != null;
    if (execA && !execB) {
      regressions.push(target);
      continue;
    }
    if (!execA && execB) {
      gains.push(target);
      continue;
    }
    const failsA = failureKeys(a);
    const failsB = failureKeys(b);
    const added = [...failsB].filter((category) => !failsA.has(category));
    const removed = [...failsA].filter((category) => !failsB.has(category));
    if (execA && execB) {
      if (added.length > 0) regressions.push(target);
      else if (removed.length > 0) resolved.push(target);
    }
  }

  if (regressions.length > 0) reasons.push(`${regressions.length} field(s) got worse.`);
  if (gains.length > 0) reasons.push(`${gains.length} field(s) became ready.`);
  if (resolved.length > 0) reasons.push(`${resolved.length} ready field(s) lost a problem.`);
  if (before.complete && !after.complete) reasons.push("The revised plan no longer fills every required field.");

  let verdict: PlanComparison["verdict"];
  if (regressions.length > 0 || (before.complete && !after.complete)) verdict = "WORSE";
  else if (gains.length > 0 || resolved.length > 0) verdict = "BETTER";
  else {
    verdict = "NOT_BETTER";
    reasons.push("No field improved.");
  }
  return { verdict, regressions, gains, reasons };
}

/**
 * Plan-request budget per (source, destination) content, including the first
 * request. Fails closed on an invalid count.
 */
export function planRequestBudget(sentForContent: number): { allowed: boolean; remaining: number } {
  if (!Number.isInteger(sentForContent) || sentForContent < 0) return { allowed: false, remaining: 0 };
  const remaining = Math.max(0, PLAN_REQUEST_LIMIT - sentForContent);
  return { allowed: remaining > 0, remaining };
}

export interface PlanRevisionOffer {
  /** True only when at least one unresolved item is something a new plan could fix, and budget remains. */
  offer: boolean;
  reason: "model-can-resolve" | "nothing-unresolved" | "identical-request-will-fail" | "budget-exhausted";
  /** Targets a new plan could fix (wrong/missing match, bad settings, field-meaning ambiguity). */
  revisable: string[];
  /** Targets only the user can resolve on this device (category meaning, date order, invented values). */
  askUser: string[];
  /** Targets whose records must be fixed or reviewed. */
  sourceData: string[];
  /** Targets no plan can fix (unsupported, destination, privacy, provider). */
  other: string[];
}

const REVISABLE: ReadonlySet<FailureCategory> = new Set(["incorrect-correspondence", "missing-correspondence", "invalid-parameters"]);

/**
 * Should EYES offer a NEW plan request? Only when some unresolved item is one
 * Gemini could fix: an incorrect or missing correspondence, invalid
 * parameters, an unaddressed field, or a field-meaning ambiguity among its own
 * candidates. Never when every unresolved item needs the user (category
 * meaning, date order) or is a source-data problem: the identical request
 * would fail again (`sameRequestWillFail`, Sprint 14). A field whose match the
 * user made is never revisable: the model cannot override the user.
 *
 * Pass `sentForContent` to apply `planRequestBudget` as well.
 */
export function shouldOfferPlanRevision(
  compiled: CompiledIntegration,
  failures: readonly ClassifiedFailure[],
  sentForContent?: number,
): PlanRevisionOffer {
  const revisable = new Set<string>();
  const askUser = new Set<string>();
  const sourceData = new Set<string>();
  const other = new Set<string>();
  const byTarget = new Map(compiled.fields.map((field) => [field.target, field]));
  const userMatched = (target: string | null) => target !== null && byTarget.get(target)?.correspondence?.by === "user";

  const place = (failure: ClassifiedFailure) => {
    const target = failure.target ?? "(integration)";
    if (REVISABLE.has(failure.category)) {
      if (userMatched(failure.target)) askUser.add(target);
      else revisable.add(target);
      return;
    }
    const next = nextActionFor(failure.category);
    if (next === "ask-user") askUser.add(target);
    else if (next === "fix-source-data" || next === "review-records") sourceData.add(target);
    else other.add(target);
  };

  for (const field of compiled.fields) {
    if (field.operation !== null && field.failures.length === 0) continue;
    for (const failure of field.failures) place({ ...failure, target: failure.target ?? field.target });
    if (field.operation !== null) continue;
    if (field.correspondence?.by === "user") {
      if (field.missing.length > 0) askUser.add(field.target);
      continue;
    }
    if (field.missing.includes("field-meaning")) revisable.add(field.target);
    else if (field.claimed === null && field.correspondence === null && field.readiness !== "no_source") revisable.add(field.target);
    else if (field.missing.includes("category-labels") || field.missing.includes("date-order") || field.missing.includes("business-rule")) askUser.add(field.target);
    const placed = [revisable, askUser, sourceData, other].some((set) => set.has(field.target));
    // A required field nothing fills is the user's question (choose a field or change the destination), never a default.
    if (!placed && field.required) (field.readiness === "unsupported" ? other : askUser).add(field.target);
  }
  for (const failure of failures) place(failure);

  const result = {
    revisable: [...revisable].sort(),
    askUser: [...askUser].sort(),
    sourceData: [...sourceData].sort(),
    other: [...other].sort(),
  };
  if (result.revisable.length === 0) {
    const unresolved = result.askUser.length + result.sourceData.length + result.other.length;
    return { offer: false, reason: unresolved === 0 ? "nothing-unresolved" : "identical-request-will-fail", ...result };
  }
  if (sentForContent !== undefined && !planRequestBudget(sentForContent).allowed) {
    return { offer: false, reason: "budget-exhausted", ...result };
  }
  return { offer: true, reason: "model-can-resolve", ...result };
}
