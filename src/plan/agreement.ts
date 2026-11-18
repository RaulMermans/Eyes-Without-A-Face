/**
 * Gemini / local-matcher agreement classes (Sprint 18E). Pure and deterministic.
 *
 * Thresholds come from the recorded-answer diagnosis (docs/evaluation/sprint-18e-disagreement.md,
 * exploratory, 863 picks): Gemini was wrong on 8 % of agreements, but on 92 % of picks where the
 * local matcher was clear about another field, 100 % of picks it did not list at all and 100 % of
 * picks it contradicted; when it was unsure and still listed Gemini's pick, Gemini was wrong 38 % —
 * still worth one confirmation (Sprint 18F replay), so every disagreement is asked.
 *
 * A class decides only whether to ASK. Nothing here selects or executes a field: a significant
 * disagreement becomes one choose-field question (Gemini's pick and the local candidates), and
 * agreement never upgrades a match the existing rules would ask about. Model confidence is not
 * used here at all.
 */
import type { LocalCandidateSet } from "../matching/types.ts";

export type AgreementClass =
  /** The local top candidate is Gemini's pick. The existing rules decide. */
  | "supported-agreement"
  /** Local evidence contradicts the pick, or its top candidate is another field. Ask. */
  | "significant-disagreement"
  /** No local candidate at all. The existing rules decide. */
  | "insufficient-evidence";

/** Class of Gemini's single-source pick (`path`) against the local candidates for the same destination field. */
export function classifyAgreement(path: string, set: LocalCandidateSet | undefined): AgreementClass {
  if (!set || set.candidates.length === 0) return set?.contradicted?.includes(path) ? "significant-disagreement" : "insufficient-evidence";
  if (set.contradicted?.includes(path)) return "significant-disagreement";
  const top = set.candidates[0]!;
  if (top.path === path) return "supported-agreement";
  // Sprint 18F (replay over 125 recorded answers): asking on EVERY disagreement with the local top-1, not only
  // clear ones, raised complete integrations 45 → 49 / 95 and cut false completes 2 → 1, for +0.44 answers per
  // scenario. Gemini was wrong on 38 % of the "local unsure" disagreements; a confirmation lists its pick first.
  return "significant-disagreement";
}

/**
 * Gemini said "no source": ask when the local matcher offers any candidate (class 4 otherwise stands).
 * Sprint 18F replay: asking also on "ambiguous" local candidates raised complete integrations 49 → 55 / 95;
 * 65 of 81 such questions were about a field that really has a source, 16 are answered "none".
 */
export function noSourceNeedsQuestion(set: LocalCandidateSet | undefined): boolean {
  return set?.uncertainty === "clear" || set?.uncertainty === "ambiguous";
}
