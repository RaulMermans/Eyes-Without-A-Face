/**
 * Display vocabulary for semantic verification (Sprint 8). Fixed strings
 * only: nothing here interpolates a record value.
 */
import type { Status } from "../components/spectral.tsx";
import type { SemanticConstraint } from "../semantics/contract.ts";
import type { SemanticStatus } from "../semantics/verify.ts";

export const SEMANTIC_LABEL: Readonly<Record<SemanticStatus, string>> = {
  SEMANTIC_PASS: "Meaning verified",
  SEMANTIC_MISMATCH: "Incorrect meaning",
  SEMANTIC_POLICY_CONFLICT: "Policy conflict",
  SEMANTIC_AMBIGUOUS: "Ambiguous · needs confirmation",
  SEMANTIC_EVIDENCE_MISSING: "Unknown · no trusted evidence",
  SEMANTIC_UNVERIFIED: "Structure only · meaning not checked",
};

export const SEMANTIC_TONE: Readonly<Record<SemanticStatus, Status>> = {
  SEMANTIC_PASS: "pass",
  SEMANTIC_MISMATCH: "fail",
  SEMANTIC_POLICY_CONFLICT: "fail",
  SEMANTIC_AMBIGUOUS: "warn",
  SEMANTIC_EVIDENCE_MISSING: "not_evaluated",
  SEMANTIC_UNVERIFIED: "not_evaluated",
};

export function evidenceLabel(constraint: SemanticConstraint | undefined): string {
  if (!constraint) return "None";
  const trust = constraint.trust === "trusted" ? "trusted" : constraint.trust === "ambiguous" ? "ambiguous" : "not trusted";
  const observation = constraint.evidence.observation;
  switch (constraint.evidence.kind) {
    case "user-declared":
      return `Your declaration · ${trust}`;
    case "source-contract":
      return `Source contract · ${trust}`;
    case "local-rule":
      return `Local rule · ${trust}`;
    case "model-suggestion":
      return `Model suggestion · ${trust}`;
    case "deterministic-observation":
      return `Local observation · ${observation ? `${observation.disambiguating} disambiguating of ${observation.checkedValues} values` : "no counts"} · ${trust}`;
  }
}

export function describeConstraint(constraint: SemanticConstraint | undefined): string {
  if (!constraint) return "No trusted constraint";
  switch (constraint.kind) {
    case "date-interpretation":
      return constraint.format ? `Dates are ${constraint.format}` : `Date order undecided (${(constraint.candidates ?? []).join(" or ")})`;
    case "ordered-categories":
      return `Rank kept: ${constraint.sourceOrder.join(" > ")} → ${constraint.targetOrder.join(" > ")}`;
    case "enum-meaning":
      return `Declared meaning of ${Object.keys(constraint.meaning).length} categories`;
    case "allowed-values":
      return `Allowed: ${constraint.values.join(", ")}`;
  }
}

