/**
 * Failure classification and next actions (ADR 0018 §5). OWNER: Worker D.
 *
 * Every failure the plan path can meet is classified into exactly one
 * `FailureCategory`, and every category has exactly one meaningful next
 * action. The classification reads only application-owned codes (validator
 * issue codes, inference error codes, engine failure codes, verifier
 * statuses). It never reads model text, record values or engine messages.
 *
 * Category → next action (total; tested):
 *
 *   incorrect-correspondence  revise-with-model   Gemini matched the wrong source field; a new, approved plan request can fix it.
 *   missing-correspondence    revise-with-model   Gemini gave no usable match; a new, approved plan request can fix it.
 *   invalid-parameters        revise-with-model   The rule's settings are wrong (inconsistent entry, bad params); a new plan can fix it.
 *   missing-category-values   review-records      Records carry a category nobody translated; they are held for review.
 *   invented-values           ask-user            Gemini wrote category names or values that were never shared; only the user can translate them.
 *   semantic-disagreement     ask-user            The output contradicts local evidence or the user's declared meaning; the user confirms.
 *   unsupported-operation     map-manually        No allowed rule can express it; map this field yourself.
 *   invalid-source-data       fix-source-data     The records themselves are missing, empty or unreadable for this field.
 *   provider-failure          new-request         The provider (or the approval) failed; a NEW request the user approves again.
 *   privacy-blocker           map-manually        The privacy gate refused the request or the user declined; asking again cannot help.
 *   destination-incompatible  change-destination  The destination cannot accept what the source holds.
 *
 * `none` is never a category's action: a category without a meaningful next
 * step is not allowed (ADR 0018 §5).
 */
import type { MappingContract } from "../domain/contracts/types.ts";
import type { MappingFailureCode } from "../domain/mapping/codes.ts";
import type { SemanticReport } from "../semantics/verify.ts";
import type { ClassifiedRow } from "../verification/outcomes.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { ClassifiedFailure, CompiledField, FailureCategory, NextAction, PlanIssue, PlanIssueCode } from "./types.ts";

export const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "incorrect-correspondence",
  "missing-correspondence",
  "invalid-parameters",
  "missing-category-values",
  "invented-values",
  "semantic-disagreement",
  "unsupported-operation",
  "invalid-source-data",
  "provider-failure",
  "privacy-blocker",
  "destination-incompatible",
];

const NEXT_ACTION: Readonly<Record<FailureCategory, NextAction>> = {
  "incorrect-correspondence": "revise-with-model",
  "missing-correspondence": "revise-with-model",
  "invalid-parameters": "revise-with-model",
  "missing-category-values": "review-records",
  "invented-values": "ask-user",
  "semantic-disagreement": "ask-user",
  "unsupported-operation": "map-manually",
  "invalid-source-data": "fix-source-data",
  "provider-failure": "new-request",
  "privacy-blocker": "map-manually",
  "destination-incompatible": "change-destination",
};

export function nextActionFor(category: FailureCategory): NextAction {
  const next = NEXT_ACTION[category];
  if (!next) throw new Error(`nextActionFor: unknown failure category ${String(category)}`);
  return next;
}

function failure(category: FailureCategory, target: string | null, evidence: string[]): ClassifiedFailure {
  return { category, target, next: nextActionFor(category), evidence: [...new Set(evidence)].sort() };
}

/**
 * Plain-language copy for the UI (application-owned). No values and no field
 * names: the UI shows the destination field name next to it.
 */
export const FAILURE_COPY: Readonly<Record<FailureCategory, { title: string; next: string }>> = {
  "incorrect-correspondence": {
    title: "Gemini matched this to the wrong field",
    next: "Ask Gemini again with a new request you approve, or pick the right field yourself.",
  },
  "missing-correspondence": {
    title: "Gemini didn't find a field for this",
    next: "Ask Gemini again with a new request you approve, or pick the field yourself.",
  },
  "invalid-parameters": {
    title: "The rule for this field isn't set up correctly",
    next: "Ask Gemini again with a new request you approve, or set up this field yourself.",
  },
  "missing-category-values": {
    title: "Some records have a value nobody translated",
    next: "Those records are held for you to review, and the rest carry on.",
  },
  "invented-values": {
    title: "Gemini used values your data doesn't have",
    next: "Say yourself what each of your values means here; nothing is guessed for you.",
  },
  "semantic-disagreement": {
    title: "The result doesn't match what your data means",
    next: "Confirm what your data means so the result follows your answer.",
  },
  "unsupported-operation": {
    title: "This can't be done with the available steps",
    next: "Set up this field yourself in the advanced view.",
  },
  "invalid-source-data": {
    title: "Some of your records can't be used for this",
    next: "Fix those records in your data, then load it again.",
  },
  "provider-failure": {
    title: "Gemini didn't give a usable answer",
    next: "Start a new request; you review and approve it again before anything is sent.",
  },
  "privacy-blocker": {
    title: "This request can't be sent safely",
    next: "Set up this field yourself on this device; nothing more is sent.",
  },
  "destination-incompatible": {
    title: "The destination can't accept this data",
    next: "Choose or adjust the destination so it fits your data.",
  },
};

/* ------------------------------------------------------------------ */
/* Plan validator issues                                               */
/* ------------------------------------------------------------------ */

const ISSUE_CATEGORY: Readonly<Record<PlanIssueCode, FailureCategory>> = {
  // The model's answer is unreadable as a plan: a fresh request is the only remedy.
  MALFORMED_PLAN: "provider-failure",
  // The approved disclosure has no destination: nothing can be planned until one is chosen.
  DISCLOSURE_MISSING_TARGET: "destination-incompatible",
  UNKNOWN_TARGET_FIELD: "incorrect-correspondence",
  // Contradicting claims for one field: all are rejected, the field has no match left.
  DUPLICATE_TARGET: "incorrect-correspondence",
  // A hallucinated source reference.
  UNKNOWN_ALIAS: "incorrect-correspondence",
  INCONSISTENT_ENTRY: "invalid-parameters",
  // The translation is rejected; the correspondence is kept and the user translates.
  INVENTED_CATEGORY_LABEL: "invented-values",
  INVALID_ENUM_VALUE: "invented-values",
};

export function classifyPlanIssue(issue: PlanIssue): ClassifiedFailure {
  const category = ISSUE_CATEGORY[issue.code];
  if (!category) throw new Error(`classifyPlanIssue: unknown issue code ${String(issue.code)}`);
  return failure(category, issue.target ?? null, [issue.code]);
}

/* ------------------------------------------------------------------ */
/* Provider / request failures                                         */
/* ------------------------------------------------------------------ */

/**
 * Codes for which re-sending cannot help: the privacy gate refused the
 * payload, or the user declined to share. Everything else that reaches the
 * request path is a provider or approval-lifecycle failure → a NEW request the
 * user approves again (never an automatic retry).
 */
const PRIVACY_CODES: ReadonlySet<string> = new Set(["DISCLOSURE_REJECTED", "USER_REJECTED"]);

/**
 * Classify an `InferenceError` code or a `workspace.cloudError.code`
 * (`DISCLOSURE_REJECTED`, `NOT_APPROVED`, `CLOUD_FAILED`, …). Total: an
 * unknown code is a provider failure, never a success.
 */
export function classifyProviderFailure(code: string): ClassifiedFailure {
  if (PRIVACY_CODES.has(code)) return failure("privacy-blocker", null, [code]);
  if (code === "DISCLOSURE_MISSING_TARGET") return failure("destination-incompatible", null, [code]);
  return failure("provider-failure", null, [code]);
}

/* ------------------------------------------------------------------ */
/* Reality Check, acceptance policy and semantic verifier              */
/* ------------------------------------------------------------------ */

const ENGINE_CATEGORY: Readonly<Record<MappingFailureCode, FailureCategory>> = {
  INVALID_MAPPING_CONTRACT: "invalid-parameters",
  UNSAFE_MAPPING: "unsupported-operation",
  UNSUPPORTED_OPERATION: "unsupported-operation",
  UNSUPPORTED_SCHEMA_VERSION: "invalid-parameters",
  INVALID_FIELD_REF: "invalid-parameters",
  FORBIDDEN_KEY: "unsupported-operation",
  PROTOTYPE_POLLUTION: "unsupported-operation",
  MISSING_SOURCE_FIELD: "invalid-source-data",
  NULL_VALUE: "invalid-source-data",
  TYPE_MISMATCH: "invalid-source-data",
  EMPTY_VALUE: "invalid-source-data",
  INVALID_EMAIL: "invalid-source-data",
  INVALID_DATE: "invalid-source-data",
  UNMAPPED_ENUM: "missing-category-values",
  DEFAULT_UNMAPPED_MISSING: "invalid-parameters",
  CONFLICTING_DESTINATION: "invalid-parameters",
  UNSUPPORTED_NESTED_STRUCTURE: "invalid-source-data",
  MALFORMED_JSON: "invalid-source-data",
  INPUT_TOO_LARGE: "invalid-source-data",
  BATCH_LIMIT_EXCEEDED: "invalid-source-data",
  INVALID_TARGET_SCHEMA: "destination-incompatible",
  OUTPUT_SCHEMA_MISMATCH: "destination-incompatible",
  INVALID_OPERATION_PARAMS: "invalid-parameters",
  NON_JSON_VALUE: "invalid-source-data",
  CIRCULAR_REFERENCE: "invalid-source-data",
};

/** Category of one engine failure code (total over `MappingFailureCode`). */
export function classifyEngineCode(code: MappingFailureCode): FailureCategory {
  return ENGINE_CATEGORY[code] ?? "invalid-source-data";
}

export interface OutcomeInput {
  fields: readonly CompiledField[];
  /** Acceptance-policy rows (`classifyReport`). Ground-truth-only outcomes are read blind. */
  rows: readonly ClassifiedRow[];
  semantic: SemanticReport | null;
  /**
   * Optional: the Reality Check report the rows came from, and the contract it
   * executed (operation order must match). With both, engine failures are
   * attributed to the destination field they concern; without them, they are
   * reported for the whole integration (`target: null`).
   */
  report?: Pick<RealityCheckReport, "rows"> | null;
  contract?: MappingContract | null;
}

function issueTarget(issue: { code: MappingFailureCode; operationIndex?: number; path?: string }, contract: MappingContract | null | undefined): string | null {
  if (contract && typeof issue.operationIndex === "number") return contract.operations[issue.operationIndex]?.to ?? null;
  if (issue.code === "OUTPUT_SCHEMA_MISMATCH" && issue.path && issue.path.startsWith("/") && issue.path.length > 1) {
    return issue.path.slice(1).split("/").join(".");
  }
  return null;
}

/**
 * Classify a run's outcome per destination field.
 *
 * - QUARANTINED rows: an unknown category (`UNMAPPED_ENUM`) is
 *   `missing-category-values` (records held for review); any other held code
 *   keeps its engine category.
 * - UNRESOLVED rows: each engine code by `classifyEngineCode`
 *   (`OUTPUT_SCHEMA_MISMATCH` → `destination-incompatible`).
 * - REJECTED_BY_POLICY rows: an unapproved fallback or default produced the
 *   value → `invented-values` on the operation's destination.
 * - INCORRECT_TRANSFORMATION exists only with evaluation ground truth; the
 *   classification is ground-truth-blind and reads it as a transformation.
 * - Semantic statuses per field:
 *     SEMANTIC_MISMATCH with a date-order code       → semantic-disagreement
 *     SEMANTIC_MISMATCH on a Gemini-authored rule    → semantic-disagreement
 *     SEMANTIC_MISMATCH on a user-authored rule whose
 *       field match Gemini made                       → incorrect-correspondence
 *       (the user's own translation holds, so the matched field is wrong)
 *     SEMANTIC_MISMATCH otherwise                    → semantic-disagreement
 *     SEMANTIC_POLICY_CONFLICT                       → missing-category-values
 *     SEMANTIC_AMBIGUOUS                             → semantic-disagreement
 *   EVIDENCE_MISSING and UNVERIFIED are unknown: not a failure, never a pass.
 *
 * One failure per (category, target); evidence codes are merged.
 */
export function classifyOutcome(input: OutcomeInput): ClassifiedFailure[] {
  const out = new Map<string, { category: FailureCategory; target: string | null; evidence: Set<string> }>();
  const add = (category: FailureCategory, target: string | null, evidence: string) => {
    const key = `${category}\u0000${target ?? ""}`;
    const entry = out.get(key) ?? { category, target, evidence: new Set<string>() };
    entry.evidence.add(evidence);
    out.set(key, entry);
  };

  const byIndex = new Map(input.rows.map((row) => [row.index, row]));
  const reportRows = input.report?.rows ?? [];
  const attributed = new Set<number>();

  // Engine failures, attributed to a destination when the report and contract are known.
  for (const reportRow of reportRows) {
    const row = byIndex.get(reportRow.index);
    if (!row || (row.outcome !== "QUARANTINED" && row.outcome !== "UNRESOLVED")) continue;
    attributed.add(row.index);
    for (const issue of reportRow.localIssues) {
      add(classifyEngineCode(issue.code), issueTarget(issue, input.contract), `${row.outcome}:${issue.code}`);
    }
  }

  for (const row of input.rows) {
    if ((row.outcome === "QUARANTINED" || row.outcome === "UNRESOLVED") && !attributed.has(row.index)) {
      for (const code of row.codes) add(classifyEngineCode(code), null, `${row.outcome}:${code}`);
    }
    if (row.outcome === "REJECTED_BY_POLICY") {
      const rules = row.unapprovedRules.length > 0 ? row.unapprovedRules : [0];
      for (const rule of rules) {
        const target = rule > 0 ? (input.contract?.operations[rule - 1]?.to ?? null) : null;
        add("invented-values", target, "REJECTED_BY_POLICY");
      }
    }
  }

  const semantic = input.semantic;
  if (semantic && semantic.contractValid) {
    const fieldByTarget = new Map(input.fields.map((field) => [field.target, field]));
    for (const status of semantic.fields) {
      const codes = semantic.results
        .filter((result) => result.target === status.target && result.status === status.status)
        .map((result) => result.code)
        .filter((code): code is NonNullable<typeof code> => code !== undefined);
      const evidence = [status.status, ...codes];
      const field = fieldByTarget.get(status.target);
      let category: FailureCategory | null = null;
      if (status.status === "SEMANTIC_MISMATCH") {
        if (codes.includes("SEMANTIC_DATE_ORDER_CONFLICT")) category = "semantic-disagreement";
        else if (field?.operationOrigin === "gemini") category = "semantic-disagreement";
        else if (field && field.operationOrigin !== null && field.correspondence?.by === "gemini") category = "incorrect-correspondence";
        else category = "semantic-disagreement";
      } else if (status.status === "SEMANTIC_POLICY_CONFLICT") {
        category = "missing-category-values";
      } else if (status.status === "SEMANTIC_AMBIGUOUS") {
        category = "semantic-disagreement";
      }
      if (category) for (const code of evidence) add(category, status.target, code);
    }
  }

  return [...out.values()]
    .map((entry) => failure(entry.category, entry.target, [...entry.evidence]))
    .sort((a, b) => (a.target ?? "").localeCompare(b.target ?? "") || a.category.localeCompare(b.category));
}
