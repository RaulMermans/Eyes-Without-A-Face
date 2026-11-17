/**
 * Integration Intent Plan 1.0.0 — shared contract types (ADR 0018).
 *
 * FROZEN for Sprint 18B Phase 2. Workers implement against these types; a
 * change needs the lead architect and an ADR amendment.
 *
 * The plan separates two claims Gemini makes about every destination field:
 *
 *   correspondence   "this destination field comes from these source aliases"
 *   transformation   "and this is exactly how to turn them into its value"
 *
 * A correct correspondence is never discarded because its transformation is
 * unresolved (Sprint 18A.5 finding: prompt v4 traded 66 % → 21 % correct
 * mappings for zero invented values). Readiness is judged per field, by
 * deterministic code, never by the model's own claim.
 *
 * Layering:
 *   model text ──parse──▶ IntentPlan (schema-valid, alias-level, untrusted)
 *              ──validate (src/plan/validate.ts)──▶ ValidatedIntentPlan
 *                 (per-entry verdicts; nothing repaired, nothing invented)
 *              ──compile (src/plan/compile.ts)──▶ CompiledIntegration
 *                 Gemini-authored operations pass the UNCHANGED convertProposal
 *                 gate; user-declared operations come only from the user's
 *                 explicit answers (categoryMeanings / semanticConfirmations /
 *                 fieldMatches), then resolveAliases → canonical engine.
 *
 * Privacy: every type below that crosses into a cloud payload is alias-level.
 * `localPath`, labels from the private source and anything marked "local
 * only" never leave the browser and are never logged.
 */
import type { CloudDisclosureTargetField, MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import type { DateInputFormat } from "../domain/profile/profile.ts";

export const INTENT_PLAN_VERSION = "1.0.0";
/** Response-schema id sent with the intent-plan prompt (src/inference/intent-prompt.ts). */
export const INTENT_PLAN_RESPONSE_SCHEMA_ID = "integration-intent-plan-1";
/** Prefix of every mapping id compiled from a plan. */
export const PLAN_MAPPING_PREFIX = "gemini-plan-";

/* ------------------------------------------------------------------ */
/* Model output (integration-intent-plan.v1.schema.json)               */
/* ------------------------------------------------------------------ */

export type Readiness = "ready" | "needs_clarification" | "unsupported" | "no_source";
export type PlanTransform = "copy" | "trim" | "normalize_email" | "parse_date" | "map_enum" | "concat" | "none";
export type PlanConfidence = "high" | "medium" | "low";
export type EvidenceCode = "meaning" | "type" | "format" | "examples" | "category-labels" | "name-pattern";
export type MissingCode =
  /** The source field's category names were not shared, so no label → value translation can be written. */
  | "category-labels"
  /** Slash dates whose day/month order is not established. */
  | "date-order"
  /** Several aliases could carry this meaning; `from` lists the candidates. */
  | "field-meaning"
  /** A business decision only the data owner can make (e.g. what a status means). */
  | "business-rule"
  /** The destination requires a value that no source provides (never invented). */
  | "destination-value"
  | "no-matching-source"
  | "unsupported-transform";

/** One planner entry, exactly as the model wrote it (after JSON-Schema validation). */
export interface IntentPlanEntry {
  target: string;
  status: Readiness;
  /**
   * ready / unsupported: the aliases the value is built from.
   * needs_clarification + "field-meaning": the candidate aliases (1–4).
   * needs_clarification otherwise: the proposed source alias(es).
   * no_source: empty.
   */
  from: string[];
  transform: PlanTransform;
  inputFormat?: Extract<DateInputFormat, "ISO-8601" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY">;
  separator?: string;
  /** Disclosed source label → destination enum value. Only meaningful when the alias's labels were disclosed. */
  valueMap?: Record<string, string>;
  confidence: PlanConfidence;
  evidence: EvidenceCode[];
  missing: MissingCode[];
}

export interface IntentPlan {
  fields: IntentPlanEntry[];
  /** ≤ 280 characters. Shown only as collapsed model text; never used as evidence. */
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Validation (src/plan/validate.ts)                                   */
/* ------------------------------------------------------------------ */

export type PlanIssueCode =
  /** Not JSON, not schema-valid, executable content, prototype keys. Whole plan rejected. */
  | "MALFORMED_PLAN"
  /** Plan validated against a disclosure without a 1.1.0 target. Whole plan rejected. */
  | "DISCLOSURE_MISSING_TARGET"
  /** Entry names a destination field that is not in the approved target. Entry rejected. */
  | "UNKNOWN_TARGET_FIELD"
  /** Two or more entries for one destination field. All of them rejected. */
  | "DUPLICATE_TARGET"
  /** Entry names an alias that was not disclosed (hallucinated reference). Entry rejected. */
  | "UNKNOWN_ALIAS"
  /** status/from/transform/params are inconsistent (e.g. ready with no source). Entry rejected. */
  | "INCONSISTENT_ENTRY"
  /**
   * valueMap keys that are not disclosed labels of the alias, or values outside
   * the destination enum. The TRANSLATION is rejected; the correspondence is kept
   * and the field becomes needs_clarification("category-labels").
   */
  | "INVENTED_CATEGORY_LABEL"
  | "INVALID_ENUM_VALUE";

export interface PlanIssue {
  code: PlanIssueCode;
  /** 0-based index into plan.fields, when entry-level. */
  entryIndex?: number;
  /** Destination field name (from the approved target), when known. */
  target?: string;
  /** Application-owned text. Never quotes a model value beyond 32 characters. */
  message: string;
}

/** Per-entry verdict of the validator. */
export interface ValidatedEntry {
  entryIndex: number;
  entry: IntentPlanEntry;
  /** accepted: usable as written. correspondence-only: the transformation part was rejected, the field match kept. rejected: unusable. */
  verdict: "accepted" | "correspondence-only" | "rejected";
  issues: PlanIssue[];
}

export interface ValidatedIntentPlan {
  planVersion: typeof INTENT_PLAN_VERSION;
  /** The plan as received (schema-valid). */
  plan: IntentPlan;
  entries: ValidatedEntry[];
  /** Approved-target fields the plan did not address at all. Treated as unresolved, never as no_source. */
  unaddressed: string[];
  /** Plan-level issues (all entry issues are also on their entry). */
  issues: PlanIssue[];
}

export type PlanValidation = { ok: true; value: ValidatedIntentPlan } | { ok: false; issues: PlanIssue[] };

/* ------------------------------------------------------------------ */
/* Clarification contract (src/plan/clarify.ts)                        */
/* ------------------------------------------------------------------ */

export type ClarificationKind =
  /** Say what each category of a source field means in the destination's fixed list. Answer → categoryMeanings[target]. */
  | "translate-categories"
  /** Day/month or month/day for a slash-date source. Answer → semanticConfirmations[localPath]. */
  | "confirm-date-order"
  /** Pick which of 1–4 candidate fields gives the destination field (or none). Answer → fieldMatches[target]. */
  | "choose-field"
  /** A required destination field nothing can fill. Answer: choose a field, or change the destination. Never a default. */
  | "missing-required-source";

export interface Clarification {
  /** Stable: `${kind}:${target}`. */
  id: string;
  kind: ClarificationKind;
  target: string;
  required: boolean;
  /** Lower is asked first: required before optional; blocking kinds first. */
  priority: number;
  /** Candidate or proposed aliases (cloud-safe). */
  aliases: string[];
  /** LOCAL ONLY: resolved source paths for the aliases, for the question UI. Never serialized into a request. */
  localPaths: string[];
  /** Why this is asked, as a closed code (UI words come from the clarification copy table). */
  reason: MissingCode | "semantic-disagreement" | "rejected-entry" | "unaddressed";
}

/* ------------------------------------------------------------------ */
/* Failure classification (src/plan/failures.ts)                       */
/* ------------------------------------------------------------------ */

export type FailureCategory =
  | "incorrect-correspondence"
  | "missing-correspondence"
  | "invalid-parameters"
  | "missing-category-values"
  | "invented-values"
  | "semantic-disagreement"
  | "unsupported-operation"
  | "invalid-source-data"
  | "provider-failure"
  | "privacy-blocker"
  | "destination-incompatible";

export type NextAction =
  /** A clarification question the user can answer on this device. */
  | "ask-user"
  /** A model revision could fix it (offered only through a NEW approved request, within budget). */
  | "revise-with-model"
  /** Records are held for review under the acceptance policy; nothing to fix in the mapping. */
  | "review-records"
  | "change-destination"
  | "fix-source-data"
  /** Provider failure: a NEW request the user approves again (never an automatic retry). */
  | "new-request"
  /** Advanced recovery: map this field yourself. */
  | "map-manually"
  | "none";

export interface ClassifiedFailure {
  category: FailureCategory;
  target: string | null;
  next: NextAction;
  /** Application-owned code(s) the classification came from (issue codes, verifier statuses). */
  evidence: string[];
}

/* ------------------------------------------------------------------ */
/* Compilation (src/plan/compile.ts)                                   */
/* ------------------------------------------------------------------ */

/** Who authored the executable operation of a field. */
export type OperationOrigin = "gemini" | "user" | "gemini+user";

export interface CompiledField {
  target: string;
  required: boolean;
  targetType: CloudDisclosureTargetField["type"];
  /** The model's claim, or null when the plan did not address the field. */
  claimed: Readiness | null;
  /** Deterministic readiness after validation, local evidence and the user's answers. */
  readiness: Readiness;
  /** The field match in force (aliases), and who made it. Kept even when the transformation is unresolved. */
  correspondence: { aliases: string[]; by: "gemini" | "user" } | null;
  /** Alias-level operation, or null when not executable yet. */
  operation: MappingOperation | null;
  operationOrigin: OperationOrigin | null;
  /** What still blocks this field. Empty when `operation` is set. */
  missing: MissingCode[];
  failures: ClassifiedFailure[];
}

export interface CompiledIntegration {
  /** `${PLAN_MAPPING_PREFIX}${requestId8}`. */
  mappingId: string;
  fields: CompiledField[];
  /**
   * Alias-level Mapping Contract 1.0.0 of every executable field (Gemini
   * operations already accepted by convertProposal, plus user-declared ones),
   * or null when no field is executable. A plan with zero executable fields is
   * a planning artifact, never an integration.
   */
  aliasContract: MappingContract | null;
  /** Every required destination field has an executable operation. */
  complete: boolean;
  /** Required destination fields without an operation, in destination order. */
  unwrittenRequired: string[];
  clarifications: Clarification[];
  /** Counts for the UI and evaluation. */
  counts: { fields: number; executable: number; byGemini: number; byUser: number; needsClarification: number; unsupported: number; noSource: number };
}

/* ------------------------------------------------------------------ */
/* Workspace receipt (stored on ProposalState.plan)                    */
/* ------------------------------------------------------------------ */

export interface PlanReceipt {
  planVersion: typeof INTENT_PLAN_VERSION;
  /** Validator output for the received plan. Immutable after receipt. */
  validated: ValidatedIntentPlan;
  /** Derived from `validated` + the user's answers; recomputed by `recompilePlan` whenever an answer changes. */
  compiled: CompiledIntegration;
}

/* ------------------------------------------------------------------ */
/* Plan comparison (src/plan/compare.ts) — bounded repair              */
/* ------------------------------------------------------------------ */

export type PlanComparisonVerdict = "BETTER" | "NOT_BETTER" | "WORSE";

export interface PlanComparison {
  verdict: PlanComparisonVerdict;
  /** Targets executable before and not after, or whose verified outcome got worse. */
  regressions: string[];
  /** Targets executable after and not before. */
  gains: string[];
  /** Short application-owned reasons. */
  reasons: string[];
}

/** At most this many plan requests per (source, destination) content, including the first. */
export const PLAN_REQUEST_LIMIT = 2;

/* ------------------------------------------------------------------ */
/* The user's answers (structurally identical to WorkspaceState parts) */
/* ------------------------------------------------------------------ */

/**
 * LOCAL ONLY. The same three decision maps the guided flow already keeps in
 * `WorkspaceState` (`fieldMatches`, `categoryMeanings`,
 * `semanticConfirmations`). Answers to clarifications are written there via
 * `applyFieldDecision`; no new answer store exists.
 */
export interface PlanAnswers {
  /** destination field → local source path, or null = the user chose no field. Overrides the plan's correspondence. */
  fieldMatches: Readonly<Record<string, string | null>>;
  /** destination enum field → the user's translation of one source field's labels (null = set aside for review). */
  categoryMeanings: Readonly<Record<string, { source: string; values: Record<string, string | null> }>>;
  /** local source path → the confirmed slash-date order. */
  semanticConfirmations: Readonly<Record<string, Extract<DateInputFormat, "MM/DD/YYYY" | "DD/MM/YYYY">>>;
}
