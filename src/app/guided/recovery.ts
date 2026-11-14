import type { CloudDisclosurePayload } from "../../domain/contracts/types.ts";
import type { ProposalIssue } from "../../proposal/convert.ts";
import type { ResolutionIssue } from "../../proposal/resolve.ts";
import type { AcceptProposalResult, PreparedTwin } from "../../workflow/pipeline.ts";
import { summarizeDestination } from "./destinations.ts";

/**
 * Sprint 14 (Workstreams A/B) — plain-language diagnosis of a rejected mapping
 * proposal, and the one input gap that makes a rejection certain.
 *
 * Pure readings of state that already exists (the canonical `acceptProposal`
 * result, the approved disclosure and the prepared twin). Nothing here changes
 * a proposal, repairs model output, approves or sends anything. The validator
 * stays the only judge; this module only explains its verdict and names the
 * safest next step.
 *
 * Text built here is shown in this browser only. It may name the user's own
 * field names (they are on the user's screen already) but never record values,
 * raw model text or engine messages.
 */

/** Diagnosis categories. Each maps to existing issue codes; no parallel taxonomy of causes. */
export type ProposalDiagnosisKind =
  /** INVALID_ENUM_MAPPING on a source field whose category names were withheld (Sprint 14 production incident). */
  | "withheld-categories"
  /** INVALID_ENUM_MAPPING with a key that is not one of the shared category names. */
  | "unknown-category"
  /** UNKNOWN_ALIAS / ALIAS_NOT_SHAREABLE: a source field that does not exist or was not shared. */
  | "unknown-source-field"
  /** UNKNOWN_TARGET_FIELD: a destination field that is not in the destination. */
  | "unknown-destination-field"
  /** DUPLICATE_DESTINATION: a destination field written twice. */
  | "duplicate-destination"
  /** UNKNOWN_OPERATION / EXECUTABLE_CONTENT: something that is not one of the eight allowed rules. */
  | "unsupported-operation"
  /** INVALID_PARAMS / INVALID_FIELD_REF / TOO_MANY_OPERATIONS: a rule with wrong settings. */
  | "invalid-parameters"
  /** MALFORMED_PROPOSAL / PROTOTYPE_POLLUTION / CONTRACT_INVALID / RESOLVED_CONTRACT_INVALID: not a readable mapping. */
  | "unreadable-answer"
  /** DISCLOSURE_MISSING_TARGET / PHANTOM_MISMATCH / BINDINGS_INVALID: the answer no longer matches this request. */
  | "request-mismatch";

export type RecoveryOption =
  /** Opt in to share the category names of the listed fields, then prepare a NEW request for approval. */
  | "share-categories"
  /** Prepare the same request again for a new approval (bounded: see `ASK_AGAIN_LIMIT`). */
  | "ask-again"
  | "change-destination"
  | "change-data"
  | "technical-details";

export interface CategoryField {
  alias: string;
  /** The user's own field name, shown locally only. */
  path: string;
  /** The user's own category names, shown locally only, before they decide to share them. */
  labels: string[];
  /** Labels used by very few records (could single out a record if shared). */
  rare: number;
  /** The user already chose to share these names with Gemini. */
  shared: boolean;
}

/** Kept for readability at call sites: a category field whose names are not shared. */
export type WithheldCategoryField = CategoryField;

export interface ProposalDiagnosis {
  kind: ProposalDiagnosisKind;
  /** Short headline, e.g. "One field couldn't be matched". */
  title: string;
  /** What happened, one or two plain sentences. */
  what: string;
  /** Plain-language issue lines (no values, no engine messages). At most six. */
  issues: string[];
  /** Ordered recovery options; the first is the recommended one. */
  options: RecoveryOption[];
  /** Fields whose category names could be shared (only for `withheld-categories`). */
  withheld: WithheldCategoryField[];
  /** Issue codes for technical details. */
  codes: string[];
  /**
   * True when sending the identical request again cannot be expected to give
   * a usable answer (the cause is in the inputs, not in the model's luck).
   */
  sameRequestWillFail: boolean;
}

/**
 * At most this many identical re-asks after a rejected answer, per identical
 * request content (payload hash). Each still needs its own approval; this only
 * stops the UI from inviting an unbounded series of paid, identical requests.
 */
export const ASK_AGAIN_LIMIT = 1;

type AnyIssue = ProposalIssue | ResolutionIssue;

const CODE_KIND: Record<string, ProposalDiagnosisKind> = {
  INVALID_ENUM_MAPPING: "unknown-category",
  UNKNOWN_ALIAS: "unknown-source-field",
  ALIAS_NOT_SHAREABLE: "unknown-source-field",
  UNKNOWN_TARGET_FIELD: "unknown-destination-field",
  DUPLICATE_DESTINATION: "duplicate-destination",
  UNKNOWN_OPERATION: "unsupported-operation",
  EXECUTABLE_CONTENT: "unsupported-operation",
  INVALID_PARAMS: "invalid-parameters",
  INVALID_FIELD_REF: "invalid-parameters",
  TOO_MANY_OPERATIONS: "invalid-parameters",
  MALFORMED_PROPOSAL: "unreadable-answer",
  PROTOTYPE_POLLUTION: "unreadable-answer",
  CONTRACT_INVALID: "unreadable-answer",
  RESOLVED_CONTRACT_INVALID: "unreadable-answer",
  DISCLOSURE_MISSING_TARGET: "request-mismatch",
  PHANTOM_MISMATCH: "request-mismatch",
  BINDINGS_INVALID: "request-mismatch",
};

/** Order of precedence when several issues are present: the most actionable first. */
const PRECEDENCE: ProposalDiagnosisKind[] = [
  "withheld-categories",
  "request-mismatch",
  "unknown-category",
  "unknown-source-field",
  "unknown-destination-field",
  "duplicate-destination",
  "unsupported-operation",
  "invalid-parameters",
  "unreadable-answer",
];

/** Shareable category fields of the twin, with their labels (local only) and whether they are shared. */
export function categoryFields(prepared: PreparedTwin): CategoryField[] {
  const byPath = new Map(prepared.profile.fields.map((field) => [field.path, field]));
  return prepared.twin.fields
    .filter((view) => view.type === "enum" && view.shareable && view.categoryCount > 0)
    .map((view) => ({
      alias: view.alias,
      path: view.localPath,
      labels: (byPath.get(view.localPath)?.categories ?? []).map((item) => item.value),
      rare: view.rareCategoryCount,
      shared: view.categoriesDisclosed,
    }));
}

/** Category fields whose names are withheld. */
export function withheldCategoryFields(prepared: PreparedTwin): CategoryField[] {
  return categoryFields(prepared).filter((field) => !field.shared);
}

export interface CategoryNeed {
  /** Destination fields that take one of a fixed set of values. */
  targets: Array<{ name: string; values: string[]; required: boolean }>;
  /** Source category fields that could provide them. */
  fields: CategoryField[];
  /**
   * True when a destination field from a fixed list is REQUIRED and no source
   * category field is shared: Gemini cannot write a valid rule for it, so every
   * such request is refused locally (the Sprint 14 production incident).
   */
  blocking: boolean;
}

/**
 * Pre-send readiness (Sprint 14, A3/C2): does the destination need values from
 * a fixed list that only the user's category fields can provide? Null when the
 * destination has no such field or the source has no category field.
 */
export function categoryNeed(prepared: PreparedTwin | null, destinationText: string): CategoryNeed | null {
  if (!prepared) return null;
  const summary = summarizeDestination(destinationText);
  if (!summary.ok) return null;
  const targets = summary.fields
    .filter((field) => field.type === "enum" && (field.enumValues?.length ?? 0) > 0)
    .map((field) => ({ name: field.name, values: [...(field.enumValues ?? [])], required: field.required }));
  if (targets.length === 0) return null;
  const fields = categoryFields(prepared);
  if (fields.length === 0) return null;
  return { targets, fields, blocking: targets.some((target) => target.required) && !fields.some((field) => field.shared) };
}

function aliasOf(issue: AnyIssue): string | null {
  if ("alias" in issue && typeof issue.alias === "string") return issue.alias;
  const match = /alias "?(f_\d+)"?/.exec(issue.message);
  return match?.[1] ?? null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Explain a rejected proposal. `result` must be a failed `acceptProposal`
 * result; `disclosure` is the approved request it answered.
 */
export function diagnoseRejectedProposal(
  result: Extract<AcceptProposalResult, { ok: false }>,
  disclosure: CloudDisclosurePayload,
  prepared: PreparedTwin | null,
): ProposalDiagnosis {
  const issues = result.issues as AnyIssue[];
  const codes = [...new Set(issues.map((issue) => issue.code))];
  const withheldAll = prepared ? withheldCategoryFields(prepared) : [];
  const withheldAliases = new Set(withheldAll.map((field) => field.alias));
  const localName = (alias: string | null) => (alias ? (prepared?.twin.fields.find((view) => view.alias === alias)?.localPath ?? alias) : "a field");

  const kinds = new Set<ProposalDiagnosisKind>();
  const withheldHit = new Set<string>();
  for (const issue of issues) {
    const alias = aliasOf(issue);
    if (issue.code === "INVALID_ENUM_MAPPING" && alias && withheldAliases.has(alias)) {
      kinds.add("withheld-categories");
      withheldHit.add(alias);
    } else {
      kinds.add(CODE_KIND[issue.code] ?? "unreadable-answer");
    }
  }
  const kind = PRECEDENCE.find((item) => kinds.has(item)) ?? "unreadable-answer";
  const targetName = (index: number | undefined): string | null => {
    if (index === undefined || result.stage === "parse") return null;
    const raw = (result as { converted?: { contract: { operations: Array<{ to: string }> } } }).converted?.contract.operations[index]?.to;
    return raw ?? null;
  };

  const lines: string[] = [];
  for (const issue of issues) {
    const alias = aliasOf(issue);
    const opIndex = "operationIndex" in issue ? issue.operationIndex : undefined;
    const rule = opIndex === undefined ? "" : `Rule ${opIndex + 1}: `;
    switch (issue.code) {
      case "INVALID_ENUM_MAPPING":
        lines.push(
          alias && withheldAliases.has(alias)
            ? `${rule}it translates the categories of "${localName(alias)}", but their names were not shared, so Gemini guessed placeholder names.`
            : `${rule}it translates a category that "${localName(alias)}" does not have.`,
        );
        break;
      case "UNKNOWN_ALIAS":
      case "ALIAS_NOT_SHAREABLE":
        lines.push(`${rule}it reads a source field that does not exist in this request.`);
        break;
      case "UNKNOWN_TARGET_FIELD":
        lines.push(`${rule}it writes a field your destination does not have.`);
        break;
      case "DUPLICATE_DESTINATION":
        lines.push(`${rule}it writes ${targetName(opIndex) ? `"${targetName(opIndex)}"` : "a destination field"} a second time.`);
        break;
      case "UNKNOWN_OPERATION":
      case "EXECUTABLE_CONTENT":
        lines.push(`${rule}it uses a kind of rule EYES does not run.`);
        break;
      case "INVALID_PARAMS":
      case "INVALID_FIELD_REF":
        lines.push(`${rule}one of its settings is missing or not allowed.`);
        break;
      case "TOO_MANY_OPERATIONS":
        lines.push("The answer has more rules than EYES accepts.");
        break;
      default:
        lines.push("The answer is not a mapping EYES can read.");
    }
  }
  const unique = [...new Set(lines)];
  const shown = unique.slice(0, 6);
  if (unique.length > shown.length) shown.push(`…and ${plural(unique.length - shown.length, "more issue")}.`);

  const withheld = withheldAll.filter((field) => withheldHit.has(field.alias));
  const targetEnums = (disclosure.target?.fields ?? []).filter((field) => field.type === "enum").map((field) => field.name);

  switch (kind) {
    case "withheld-categories":
      return {
        kind,
        title: "One field couldn't be matched",
        what: `Your destination needs ${targetEnums.length > 0 ? targetEnums.map((name) => `"${name}"`).join(", ") : "a value from a fixed list"}, which comes from the categories in ${withheld
          .map((field) => `"${field.path}"`)
          .join(", ")}. Their names were not shared with Gemini, so it guessed placeholder names. EYES stopped before applying the mapping.`,
        issues: shown,
        options: ["share-categories", "change-destination", "technical-details"],
        withheld,
        codes,
        sameRequestWillFail: true,
      };
    case "request-mismatch":
      return {
        kind,
        title: "We couldn't build this integration",
        what: "The answer belongs to a request that no longer matches your data or destination. EYES stopped before applying it.",
        issues: shown,
        options: ["ask-again", "change-data", "technical-details"],
        withheld: [],
        codes,
        sameRequestWillFail: false,
      };
    case "unknown-source-field":
    case "unknown-category":
      return {
        kind,
        title: "One field couldn't be matched",
        what: "Gemini's mapping refers to source data that isn't in your request. EYES stopped before applying it.",
        issues: shown,
        options: ["ask-again", "change-destination", "technical-details"],
        withheld: [],
        codes,
        sameRequestWillFail: false,
      };
    case "unknown-destination-field":
    case "duplicate-destination":
      return {
        kind,
        title: "We couldn't build this integration",
        what: "Gemini returned a mapping that doesn't match your destination. EYES stopped before applying it.",
        issues: shown,
        options: ["ask-again", "change-destination", "technical-details"],
        withheld: [],
        codes,
        sameRequestWillFail: false,
      };
    default:
      return {
        kind,
        title: "We couldn't build this integration",
        what: "Gemini's answer was not a mapping EYES can safely run. EYES stopped before applying it.",
        issues: shown,
        options: ["ask-again", "change-destination", "technical-details"],
        withheld: [],
        codes,
        sameRequestWillFail: false,
      };
  }
}
