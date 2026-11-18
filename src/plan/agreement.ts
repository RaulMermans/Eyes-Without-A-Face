/**
 * Gemini / local-matcher agreement classes (Sprint 18E). Pure and deterministic.
 *
 * Thresholds come from the recorded-answer diagnosis (docs/evaluation/sprint-18e-disagreement.md,
 * exploratory, 863 picks): Gemini was wrong on 8 % of agreements, but on 92 % of picks where the
 * local matcher was clear about another field, 100 % of picks it did not list at all and 100 % of
 * picks it contradicted; when it was unsure and still listed Gemini's pick, Gemini was right 62 %.
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
  /** Local evidence contradicts the pick, is clear about another field, or does not list the pick. Ask. */
  | "significant-disagreement"
  /** Local evidence is unsure, or absent. The existing rules decide. */
  | "insufficient-evidence";

/** Class of Gemini's single-source pick (`path`) against the local candidates for the same destination field. */
export function classifyAgreement(path: string, set: LocalCandidateSet | undefined): AgreementClass {
  if (!set || set.candidates.length === 0) return set?.contradicted?.includes(path) ? "significant-disagreement" : "insufficient-evidence";
  if (set.contradicted?.includes(path)) return "significant-disagreement";
  const top = set.candidates[0]!;
  if (top.path === path) return "supported-agreement";
  if (set.uncertainty === "clear") return "significant-disagreement";
  return set.candidates.some((candidate) => candidate.path === path) ? "insufficient-evidence" : "significant-disagreement";
}

/** Gemini said "no source": ask only when the local matcher is clear about a candidate (class 4 otherwise stands). */
export function noSourceNeedsQuestion(set: LocalCandidateSet | undefined): boolean {
  return set?.uncertainty === "clear";
}
