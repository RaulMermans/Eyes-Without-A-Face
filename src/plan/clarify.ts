/**
 * Targeted clarification (ADR 0018). OWNER: Worker D.
 *
 * Builds the minimal, prioritised question list from compiled fields. Asks
 * only what a correct integration needs; never asks about a field that is
 * already executable, optional fields only after required ones, and never
 * offers a default value as an answer.
 */
import type { Clarification, ClarificationKind, CompiledField } from "./types.ts";

/** Plain-language question copy (application-owned, no values, no field names beyond the destination name). */
export const CLARIFICATION_COPY: Record<ClarificationKind, { title: (target: string) => string; help: string }> = {
  "translate-categories": { title: (target) => `What does each value mean for “${target}”?`, help: "" },
  "confirm-date-order": { title: (target) => `Are the dates for “${target}” day/month or month/day?`, help: "" },
  "choose-field": { title: (target) => `Which of your fields gives “${target}”?`, help: "" },
  "missing-required-source": { title: (target) => `None of your fields gives “${target}”.`, help: "" },
};

export function buildClarifications(fields: readonly CompiledField[], localPathFor: (alias: string) => string | null): Clarification[] {
  void fields;
  void localPathFor;
  throw new Error("buildClarifications: not implemented (Worker D)");
}
