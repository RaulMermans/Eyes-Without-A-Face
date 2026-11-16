/**
 * Targeted clarification (ADR 0018 §4). OWNER: Worker D.
 *
 * Builds the minimal, prioritised question list from compiled fields. Asks
 * only what a correct integration needs; never asks about a field that is
 * already executable, optional fields only after required ones, and never
 * offers a default value as an answer. Question words come only from
 * `CLARIFICATION_COPY`; model text never reaches a question.
 *
 * Which question a non-executable field gets (first rule that applies):
 *
 *   1. missing "field-meaning"                         → choose-field (reason field-meaning; candidates = correspondence aliases)
 *   2. no correspondence, readiness no_source / missing no-matching-source / destination-value
 *        required                                      → missing-required-source (never a default)
 *        optional                                      → nothing (leaving it empty is a valid answer)
 *   3. no correspondence, plan did not address it      → choose-field (reason unaddressed; no candidates: the UI offers every field)
 *   4. no correspondence, its plan entry was rejected  → choose-field (reason rejected-entry; no candidates)
 *   5. otherwise, for a kept correspondence:
 *        missing "category-labels" (or "business-rule" on a fixed-list field)
 *                                                       → translate-categories (aliases = the correspondence)
 *        missing "date-order"                           → confirm-date-order (localPaths = the source path;
 *                                                         reason semantic-disagreement when local evidence contradicted the order)
 *   "unsupported-transform" asks nothing: its failure's next action is map-manually.
 *
 * A field that needs choose-field gets no translate/date question yet: those
 * depend on which field the user picks, and are asked after recompilation.
 *
 * Priority (lower is asked first):
 *   tier       required = 0, optional = 1          (× 10 000)
 *   kind       choose-field 0, missing-required-source 1,
 *              translate-categories 2, confirm-date-order 3   (× 1 000)
 *   position   destination order of the field
 * Blocking kinds come first: without a source field nothing else about the
 * field can be asked or executed.
 */
import type { Clarification, ClarificationKind, CompiledField, MissingCode, PlanIssueCode } from "./types.ts";

/** Plain-language question copy (application-owned, no values, no field names beyond the destination name). */
export const CLARIFICATION_COPY: Record<ClarificationKind, { title: (target: string) => string; help: string }> = {
  "translate-categories": {
    title: (target) => `What does each value mean for “${target}”?`,
    help: "Pick the destination value each of your values stands for, or set one aside so those records are held for you to review.",
  },
  "confirm-date-order": {
    title: (target) => `Are the dates for “${target}” day/month or month/day?`,
    help: "Look at a few of your dates and tell us whether the first number is the day or the month.",
  },
  "choose-field": {
    title: (target) => `Which of your fields gives “${target}”?`,
    help: "Pick the field in your data that holds this information, or say that none of them does.",
  },
  "missing-required-source": {
    title: (target) => `None of your fields gives “${target}”.`,
    help: "The destination needs this filled, so pick one of your fields that holds it or change the destination.",
  },
};

const KIND_RANK: Readonly<Record<ClarificationKind, number>> = {
  "choose-field": 0,
  "missing-required-source": 1,
  "translate-categories": 2,
  "confirm-date-order": 3,
};

/** Validator codes that reject a whole entry (its correspondence is not kept). */
const REJECTING_CODES: ReadonlySet<PlanIssueCode> = new Set(["UNKNOWN_TARGET_FIELD", "DUPLICATE_TARGET", "UNKNOWN_ALIAS", "INCONSISTENT_ENTRY"]);

function priorityOf(required: boolean, kind: ClarificationKind, position: number): number {
  return (required ? 0 : 1) * 10_000 + KIND_RANK[kind] * 1_000 + Math.min(position, 999);
}

function entryRejected(field: CompiledField): boolean {
  return field.failures.some((failure) => failure.evidence.some((code) => REJECTING_CODES.has(code as PlanIssueCode)));
}

export function buildClarifications(fields: readonly CompiledField[], localPathFor: (alias: string) => string | null): Clarification[] {
  const out: Clarification[] = [];
  const seen = new Set<string>();

  fields.forEach((field, position) => {
    if (field.operation !== null) return;
    const aliases = field.correspondence?.aliases ?? [];
    const localPaths = aliases.map((alias) => localPathFor(alias)).filter((path): path is string => typeof path === "string" && path.length > 0);
    const push = (kind: ClarificationKind, reason: Clarification["reason"], withSource: boolean) => {
      const id = `${kind}:${field.target}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        kind,
        target: field.target,
        required: field.required,
        priority: priorityOf(field.required, kind, position),
        aliases: withSource ? [...aliases] : [],
        localPaths: withSource ? [...localPaths] : [],
        reason,
      });
    };
    const missing = new Set<MissingCode>(field.missing);

    if (missing.has("field-meaning")) {
      push("choose-field", "field-meaning", true);
      return;
    }
    if (field.correspondence === null) {
      // Deterministic no_source (the plan's claim, or the user's "no field" answer) wins over "unaddressed".
      if (field.readiness === "no_source" || missing.has("no-matching-source") || missing.has("destination-value")) {
        if (field.required) push("missing-required-source", missing.has("destination-value") ? "destination-value" : "no-matching-source", false);
        return;
      }
      if (field.claimed === null) {
        push("choose-field", "unaddressed", false);
        return;
      }
      if (entryRejected(field)) {
        push("choose-field", "rejected-entry", false);
        return;
      }
    }
    if (field.correspondence !== null) {
      if (missing.has("category-labels")) push("translate-categories", "category-labels", true);
      else if (missing.has("business-rule") && field.targetType === "enum") push("translate-categories", "business-rule", true);
      if (missing.has("date-order")) {
        const disagreement = field.failures.some((failure) => failure.category === "semantic-disagreement");
        push("confirm-date-order", disagreement ? "semantic-disagreement" : "date-order", true);
      }
    }
  });

  return out.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/**
 * Counts for a progress line. Answered questions disappear from the list on
 * recompilation, so only what is still open is derivable here.
 */
export function clarificationProgress(clarifications: readonly Clarification[]): { required: number; optional: number } {
  const required = clarifications.filter((item) => item.required).length;
  return { required, optional: clarifications.length - required };
}
