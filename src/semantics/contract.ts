/**
 * Semantic Verification Contract 1.0.0 (Sprint 8, Workstream A).
 *
 * LOCAL ONLY. Explicit, independently grounded expectations about what an
 * integration means. A constraint is usable for verification only when it is
 * `trusted`, and it can be trusted only when its evidence is one of:
 *
 *   user-declared              the owner stated it (e.g. "p1 is the most urgent")
 *   source-contract            a trusted source/destination specification says so
 *   local-rule                 an independently verified local rule
 *   deterministic-observation  a local observation that is SUFFICIENT to establish
 *                              the fact (e.g. a slash date whose first part is > 12)
 *
 * A `model-suggestion` (Gemini Nano, Gemini Cloud) can only ever be `proposed`.
 * Constraints are never derived from evaluation ground truth or holdout cases:
 * nothing in src/semantics imports fixtures or reads `expected`.
 *
 * Pure: no network, no React, no Firebase.
 */
import type { DateInputFormat } from "../domain/profile/profile.ts";
import { validateSemanticContractSchema } from "../domain/validation/validate-contract.ts";

export const SEMANTIC_CONTRACT_VERSION = "1.0.0";

export type EvidenceKind = "user-declared" | "source-contract" | "local-rule" | "deterministic-observation" | "model-suggestion";
export type ConstraintTrust = "trusted" | "proposed" | "ambiguous";

export interface ConstraintEvidence {
  kind: EvidenceKind;
  /** Deterministic observation counts (imported + revision-feedback records only). */
  observation?: { checkedValues: number; disambiguating: number; conflicting: number };
}

interface ConstraintBase {
  id: string;
  trust: ConstraintTrust;
  evidence: ConstraintEvidence;
}

/** How a source date field must be read. Source-scoped: applies to every parse of `source`. */
export interface DateInterpretationConstraint extends ConstraintBase {
  kind: "date-interpretation";
  source: string;
  /** null only when trust is "ambiguous". */
  format: DateInputFormat | null;
  /** The interpretations legitimate evidence could not decide between. */
  candidates?: DateInputFormat[];
}

/** Ordered categories: both lists run from highest to lowest rank. */
export interface OrderedCategoriesConstraint extends ConstraintBase {
  kind: "ordered-categories";
  source: string;
  target: string;
  sourceOrder: string[];
  targetOrder: string[];
  undeclared: "review" | "unconstrained";
}

/** Explicit business meaning of declared source categories. */
export interface EnumMeaningConstraint extends ConstraintBase {
  kind: "enum-meaning";
  source: string;
  target: string;
  meaning: Record<string, string>;
  undeclared: "review" | "unconstrained";
}

/** Destination invariant: the output value belongs to an authorized set. */
export interface AllowedValuesConstraint extends ConstraintBase {
  kind: "allowed-values";
  target: string;
  values: string[];
}

export type SemanticConstraint =
  | DateInterpretationConstraint
  | OrderedCategoriesConstraint
  | EnumMeaningConstraint
  | AllowedValuesConstraint;

export interface SemanticVerificationContract {
  contractKind: "semantic-verification";
  semanticContractVersion: typeof SEMANTIC_CONTRACT_VERSION;
  contractId: string;
  localOnly: true;
  constraints: SemanticConstraint[];
}

export type SemanticContractIssueCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_ID"
  | "MODEL_SUGGESTION_TRUSTED"
  | "TRUSTED_WITHOUT_FORMAT"
  | "AMBIGUOUS_WITH_FORMAT"
  | "OBSERVATION_INSUFFICIENT";

/** Constraint-level conflicts the verifier reports as SEMANTIC_POLICY_CONFLICT rather than rejecting the contract. */
export type SemanticConflictCode = "TARGET_NOT_IN_DESTINATION" | "VALUE_NOT_IN_DESTINATION" | "CONTRADICTS_OTHER_CONSTRAINT";

export interface SemanticContractValidation {
  valid: boolean;
  issues: Array<{ code: SemanticContractIssueCode; constraintId?: string; message: string }>;
  /** constraintId → conflict codes. */
  conflicts: Map<string, SemanticConflictCode[]>;
}

/** Destination enum values per top-level property (JSON Schema `enum`), if any. */
export function destinationEnums(destinationSchema: unknown): Map<string, string[] | null> {
  const out = new Map<string, string[] | null>();
  const properties = (destinationSchema as { properties?: Record<string, { enum?: unknown[] }> } | null)?.properties;
  if (!properties || typeof properties !== "object") return out;
  for (const [name, property] of Object.entries(properties)) {
    const values = Array.isArray(property?.enum) ? property.enum.filter((value): value is string => typeof value === "string") : null;
    out.set(name, values);
  }
  return out;
}

/**
 * Validate a candidate contract. Structural and trust violations make it
 * invalid (fail closed: nothing is verified). Disagreements with the
 * destination or between constraints are kept as per-constraint conflicts so
 * the verifier can report SEMANTIC_POLICY_CONFLICT instead of a pass.
 */
export function validateSemanticContract(contract: unknown, destinationSchema?: unknown): SemanticContractValidation {
  const conflicts = new Map<string, SemanticConflictCode[]>();
  const schemaIssues = validateSemanticContractSchema(contract);
  if (schemaIssues.length > 0) {
    return {
      valid: false,
      issues: schemaIssues.map((issue) => ({ code: "SCHEMA_INVALID" as const, message: `${issue.path}: ${issue.message}` })),
      conflicts,
    };
  }
  const value = contract as SemanticVerificationContract;
  const issues: SemanticContractValidation["issues"] = [];
  const seen = new Set<string>();
  for (const constraint of value.constraints) {
    if (seen.has(constraint.id)) issues.push({ code: "DUPLICATE_ID", constraintId: constraint.id, message: "Constraint ids must be unique." });
    seen.add(constraint.id);
    if (constraint.evidence.kind === "model-suggestion" && constraint.trust === "trusted") {
      issues.push({
        code: "MODEL_SUGGESTION_TRUSTED",
        constraintId: constraint.id,
        message: "A model suggestion can only be proposed; the user or an authoritative local rule must establish it.",
      });
    }
    if (constraint.kind === "date-interpretation") {
      if (constraint.trust === "trusted" && constraint.format === null) {
        issues.push({ code: "TRUSTED_WITHOUT_FORMAT", constraintId: constraint.id, message: "A trusted date interpretation needs a format." });
      }
      if (constraint.trust === "ambiguous" && constraint.format !== null) {
        issues.push({ code: "AMBIGUOUS_WITH_FORMAT", constraintId: constraint.id, message: "An ambiguous date interpretation cannot claim a format." });
      }
      const observation = constraint.evidence.observation;
      if (
        constraint.trust === "trusted" &&
        constraint.evidence.kind === "deterministic-observation" &&
        (!observation || observation.disambiguating < 1 || observation.conflicting > 0)
      ) {
        issues.push({
          code: "OBSERVATION_INSUFFICIENT",
          constraintId: constraint.id,
          message: "An observation establishes a date order only with at least one disambiguating value and no conflicting value.",
        });
      }
    }
  }

  if (destinationSchema !== undefined) {
    const enums = destinationEnums(destinationSchema);
    const add = (id: string, code: SemanticConflictCode) => conflicts.set(id, [...new Set([...(conflicts.get(id) ?? []), code])]);
    for (const constraint of value.constraints) {
      if (constraint.kind === "date-interpretation") continue;
      if (!enums.has(constraint.target)) {
        add(constraint.id, "TARGET_NOT_IN_DESTINATION");
        continue;
      }
      const allowed = enums.get(constraint.target);
      const values =
        constraint.kind === "ordered-categories"
          ? constraint.targetOrder
          : constraint.kind === "enum-meaning"
            ? Object.values(constraint.meaning)
            : constraint.values;
      if (allowed && values.some((item) => !allowed.includes(item))) add(constraint.id, "VALUE_NOT_IN_DESTINATION");
    }
    // Two trusted date interpretations of the same source that disagree.
    const dates = value.constraints.filter((item): item is DateInterpretationConstraint => item.kind === "date-interpretation" && item.trust === "trusted");
    for (const a of dates) {
      for (const b of dates) {
        if (a !== b && a.source === b.source && a.format !== b.format) add(a.id, "CONTRADICTS_OTHER_CONSTRAINT");
      }
    }
    // A trusted declared meaning that inverts a trusted declared order of the same field.
    const meanings = value.constraints.filter((item): item is EnumMeaningConstraint => item.kind === "enum-meaning" && item.trust === "trusted");
    const orders = value.constraints.filter((item): item is OrderedCategoriesConstraint => item.kind === "ordered-categories" && item.trust === "trusted");
    for (const meaning of meanings) {
      for (const order of orders) {
        if (meaning.target !== order.target || meaning.source !== order.source) continue;
        const sourceRank = new Map(order.sourceOrder.map((label, rank) => [label, rank]));
        const targetRank = new Map(order.targetOrder.map((label, rank) => [label, rank]));
        const entries = Object.entries(meaning.meaning).filter(([label, to]) => sourceRank.has(label) && targetRank.has(to));
        const inverted = entries.some(([a, ta]) =>
          entries.some(([b, tb]) => (sourceRank.get(a) ?? 0) < (sourceRank.get(b) ?? 0) && (targetRank.get(ta) ?? 0) > (targetRank.get(tb) ?? 0)),
        );
        if (inverted) {
          add(meaning.id, "CONTRADICTS_OTHER_CONSTRAINT");
          add(order.id, "CONTRADICTS_OTHER_CONSTRAINT");
        }
      }
    }
  }
  return { valid: issues.length === 0, issues, conflicts };
}

export function emptySemanticContract(contractId: string): SemanticVerificationContract {
  return { contractKind: "semantic-verification", semanticContractVersion: SEMANTIC_CONTRACT_VERSION, contractId, localOnly: true, constraints: [] };
}
