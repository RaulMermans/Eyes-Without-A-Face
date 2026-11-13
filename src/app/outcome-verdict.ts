import type { ExportEligibility } from "../export/eligibility.ts";
import type { SemanticReport } from "../semantics/verify.ts";
import { summarizeOutcomes, type ClassifiedRow } from "../verification/outcomes.ts";

/**
 * The one primary verdict of OUTCOME (Sprint 11, Workstream E1). A pure
 * reading of `exportEligibility`, the semantic report and the classified rows;
 * it never changes a state, it only words it.
 *
 * Rules:
 *   - "Verified locally." only when structure, policy AND meaning of every
 *     destination field were verified. A VERIFIED state whose meaning is
 *     partly unknown or unchecked says so in the headline.
 *   - Quarantined records are never described as transformed.
 *   - Export is a download, never a deployment.
 */
export interface OutcomeVerdict {
  headline: string;
  /** What the verdict means, in one or two sentences. */
  detail: string;
  /** What the user can do next. */
  next: string;
  /** Meaning was verified for every destination field. */
  meaningComplete: boolean;
}

export function meaningSentence(semantic: SemanticReport | null): { complete: boolean; text: string } {
  if (!semantic) return { complete: false, text: "Meaning was not checked for this mapping: it is unknown, not verified." };
  const { verified, fields, unknown } = semantic.coverage;
  if (semantic.overall === "SEMANTIC_PASS" && unknown === 0) return { complete: true, text: `Meaning was verified for all ${fields} destination fields.` };
  if (semantic.overall === "SEMANTIC_MISMATCH") return { complete: false, text: "Some outputs contradict a trusted meaning constraint: structurally valid, but wrong." };
  if (semantic.overall === "SEMANTIC_POLICY_CONFLICT") return { complete: false, text: "The outputs conflict with the local acceptance policy." };
  return { complete: false, text: `Meaning was verified for ${verified} of ${fields} destination fields; the rest is unknown, not verified.` };
}

export function outcomeVerdict(eligibility: ExportEligibility, semantic: SemanticReport | null, rows: readonly ClassifiedRow[]): OutcomeVerdict {
  const meaning = meaningSentence(semantic);
  const metrics = summarizeOutcomes(rows);
  const quarantine = metrics.quarantined > 0 ? ` ${metrics.quarantined} record${metrics.quarantined === 1 ? " is" : "s are"} quarantined for manual review and not counted as transformed.` : "";
  const exportNext = "Export it below: you download a ZIP that runs with Node 22. Nothing is deployed.";
  switch (eligibility.state) {
    case "VERIFIED":
      return meaning.complete
        ? { headline: "Verified locally.", detail: `Structure, policy and meaning passed local checks. ${meaning.text}`, next: exportNext, meaningComplete: true }
        : { headline: "Verified for structure and policy. Meaning partly unknown.", detail: `Every record passed the schema and the acceptance policy. ${meaning.text}`, next: exportNext, meaningComplete: false };
    case "VERIFIED_WITH_EXCEPTIONS":
      return {
        headline: "Verified, with managed exceptions.",
        detail: `The mapping passed local checks under the acceptance policy.${quarantine} ${meaning.text}`.trim(),
        next: exportNext,
        meaningComplete: meaning.complete,
      };
    case "PARTIALLY_VERIFIED":
      return {
        headline: "Partially verified. Draft only.",
        detail: `${eligibility.reasons[0] ?? "Some checks did not pass."} ${meaning.text}`,
        next: "Fix the findings in Observe (for example with one approved blind revision), or export it as a labeled DRAFT after confirming.",
        meaningComplete: meaning.complete,
      };
    case "REVISION_FAILED":
      return {
        headline: "The revision failed. Not exportable.",
        detail: eligibility.reasons[0] ?? "The revised mapping never ran.",
        next: "Select the initial mapping in Export below; it keeps its own status.",
        meaningComplete: false,
      };
    case "BLOCKED":
      return {
        headline: "Blocked. Not exportable.",
        detail: eligibility.reasons[0] ?? "There is no verified mapping.",
        next: "Go back to Observe and fix the mapping, then run the Reality Check again.",
        meaningComplete: false,
      };
  }
}
