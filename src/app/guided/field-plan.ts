import type { CloudDisclosureTargetField, MappingContract, MappingOperation } from "../../domain/contracts/types.ts";
import { parseFieldRef, readPath } from "../../domain/mapping/paths.ts";
import type { DateInputFormat, FieldProfile } from "../../domain/profile/profile.ts";
import type { EnumMeaningConstraint } from "../../semantics/contract.ts";
import { STRICT_POLICY, type AcceptancePolicy } from "../../verification/outcomes.ts";
import { GUIDED_SET_ASIDE_DESCRIPTION } from "../../verification/policy-text.ts";
import type { PreparedTwin } from "../../workflow/pipeline.ts";
import { summarizeDestination } from "./destinations.ts";

/**
 * Sprint 15 (Workstreams A, B, C) — target-first field planning for the
 * guided flow.
 *
 * Pure readings of state that already exists: the local source profile, the
 * imported records, the destination on screen and the user's explicit
 * choices. Nothing here sends, approves, executes or repairs anything.
 *
 *   rankCandidates   which source fields COULD fill a destination field, and
 *                    why (deterministic evidence; a similar name is only ever
 *                    a tie-breaking hint, never proof of meaning)
 *   planFields       per destination field: the chosen source, the local rule
 *                    EYES can derive from it, and what is still missing for the
 *                    on-device path and for the Gemini path
 *   localContract    a complete Mapping Contract 1.0.0 built ONLY from the
 *                    user's choices, for the existing hand-written route
 *                    (`mappingChoice: "manual"`, canonical engine, origin
 *                    "hand-written" — never "Gemini")
 *   meaningConstraints  the user's category translations as trusted
 *                    `user-declared` enum-meaning constraints (Semantic
 *                    Verification Contract 1.0.0), so the existing verifier
 *                    checks ANY mapping against them
 *
 * Text built here is shown in this browser only. It may contain the user's
 * own field names and category labels; it never leaves the device.
 */

/** The user's declared translation of one source field's categories into one destination enum field. */
export interface CategoryMeaning {
  /** Local source path. */
  source: string;
  /** label → destination value, or null to set records with that label aside for review. */
  values: Record<string, string | null>;
}

/**
 * One destination field's source decision (Sprint 16B, D1): a local source
 * path the user chose, or `null` when the user explicitly chose NO field.
 * A destination field without an entry is undecided. The three states are
 * distinct: an explicit "no field" survives replanning and is never refilled
 * from a suggestion.
 */
export type FieldMatch = string | null;

/**
 * Sprint 18F: the user's explicit "combine these fields" answer for one text destination field
 * (e.g. a full name from first and last name). Local only. Compiled as the existing `concat`
 * operation through the unchanged gate; never inferred, never pre-filled.
 */
export interface FieldCombination {
  /** 2–4 local source paths, in output order. */
  paths: string[];
  separator: (typeof COMBINE_SEPARATORS)[number];
}

/** The separators the combine question offers (fixed; the user picks one). */
export const COMBINE_SEPARATORS = [" ", ", ", " - ", " / "] as const;

/** Guided field decisions held in `WorkspaceState`. Local only; never serialized into a request. */
export interface GuidedFieldDecisions {
  /** destination field → local source path (or `null` = explicitly none), set only by an explicit user choice. */
  fieldMatches: Record<string, FieldMatch>;
  /** destination enum field → declared category translation. */
  categoryMeanings: Record<string, CategoryMeaning>;
}

export interface SourceCandidate {
  path: string;
  /** Higher is better. Deterministic. */
  score: number;
  /** Plain-language evidence, strongest first. */
  reasons: string[];
  /** Distinct values of this field (enum targets only). Local only. */
  labels: string[];
  /** Labels used by very few records. */
  rare: number;
  /** A profiled category field whose names may be shared with Gemini (after the user's explicit choice). */
  shareable: boolean;
  /** The user already chose to share its category names. */
  shared: boolean;
  /**
   * Sprint 16B (D2/D4): specific structural evidence for this destination field
   * (email share, date type, unique codes for an id, numeric/boolean type, or a
   * similar name). Without it a compatible field is still listed, but never
   * offered as the suggestion.
   */
  specific: boolean;
}

export type TargetNeed =
  /** No source field has been chosen and none is unambiguous. */
  | "source"
  /** An enum destination: the chosen field's categories have no complete translation yet. */
  | "translation"
  /** A slash date whose day/month order is not proven. */
  | "date-order"
  /** No local rule can produce this field from the chosen source (Gemini may still). */
  | "unsupported"
  /**
   * Sprint 16B (D2): EYES has a ranked suggestion but the user has not
   * confirmed it. A suggestion is evidence, never a decision; it builds nothing.
   */
  | "confirm";

export interface TargetPlan {
  target: CloudDisclosureTargetField;
  /** Ranked compatible source fields. */
  candidates: SourceCandidate[];
  /**
   * The source in use for this target, and why. Non-enum fields: only the
   * user's explicit choice (Sprint 16B). Enum fields: the user's choice, or the
   * only category-like field — which still builds nothing until the user has
   * translated every one of its values (an explicit per-field decision).
   */
  chosen: string | null;
  chosenBy: "user" | "only-candidate" | null;
  /**
   * Sprint 16B (D2): the top-ranked candidate offered for confirmation when
   * the user has not decided. Assistance, not authority: it is never part of
   * a rule, and it is null once the user decided (including "no field").
   */
  suggested: string | null;
  /** Sprint 16B (D1): the user's decision for this destination field. */
  decision: "undecided" | "source" | "none";
  /** The local rule EYES can derive, or null with `need` explaining why not. */
  rule: MappingOperation | null;
  need: TargetNeed | null;
  /** Gemini path for this field: fine, or what blocks it. */
  cloud: "ok" | "names-withheld" | "names-not-shareable" | "no-source";
}

export interface FieldPlan {
  targets: TargetPlan[];
  /** Destination enum fields: the questions the user may have to answer. */
  questions: TargetPlan[];
  /** Every required destination field has a local rule. */
  localReady: boolean;
  /** Why the on-device path cannot build yet (one sentence), or null. */
  localBlocker: string | null;
  /** Why a Gemini request cannot produce a usable integration yet (one sentence), or null. */
  cloudBlocker: string | null;
}

/** Highest number of distinct values a plain-text field may have to be offered as a category source. */
export const MAX_LOCAL_LABELS = 24;
/** A label used by at most this many records is "rare" (could single a record out). */
const RARE_COUNT = 1;

function readLocal(record: unknown, path: string): unknown {
  const parsed = parseFieldRef(path, "from");
  if (!parsed.ok) return undefined;
  const read = readPath(record, parsed.path);
  if ("code" in read || read.kind === "missing") return undefined;
  return read.value;
}

/** Distinct string values of a field with their counts, or null when the field is not category-like. Local only. */
export function distinctLabels(records: readonly unknown[], field: FieldProfile): Array<{ value: string; count: number }> | null {
  if (field.categories && field.categories.length > 0) return field.categories.map((item) => ({ value: item.value, count: item.count }));
  if (field.type !== "string") return null;
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = readLocal(record, field.path);
    if (typeof value !== "string" || value.trim() === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if (counts.size > MAX_LOCAL_LABELS) return null;
  }
  // A field whose values are all different is an identifier, not a category.
  if (counts.size < 2 || counts.size === records.length) return null;
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** At least this share of a field's present values must look like emails to count as evidence. */
const EMAIL_SHARE = 0.8;

/** How many present values of a field look like email addresses. Local only. */
function emailShare(records: readonly unknown[], path: string): { emails: number; total: number } {
  let emails = 0;
  let total = 0;
  for (const record of records) {
    const value = readLocal(record, path);
    if (value === undefined || value === null) continue;
    total += 1;
    if (typeof value === "string" && EMAIL_SHAPE.test(value.trim())) emails += 1;
  }
  return { emails, total };
}

const tokens = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

/** Shared name tokens. A hint only: never sufficient on its own and never evidence of meaning. */
function nameHint(source: string, target: string): boolean {
  const leaf = source.split(".").at(-1) ?? source;
  const a = tokens(leaf);
  // Same word, or a shared stem of at least four letters ("state" / "status").
  return tokens(target).some((token) => a.some((other) => other === token || (token.length >= 4 && other.length >= 4 && token.slice(0, 4) === other.slice(0, 4))));
}

function isTextual(field: FieldProfile): boolean {
  return field.type === "string" || field.type === "enum" || field.type === "date" || field.type === "datetime";
}

/**
 * Compatible source fields for one destination field, best first.
 * Compatibility is a hard gate (type and format); the score orders the
 * survivors by structural evidence. Name similarity only breaks ties.
 */
export function rankCandidates(prepared: PreparedTwin, records: readonly unknown[], target: CloudDisclosureTargetField): SourceCandidate[] {
  const twinByPath = new Map(prepared.twin.fields.map((view) => [view.localPath, view]));
  const out: SourceCandidate[] = [];
  for (const field of prepared.profile.fields) {
    if (!field.supported) continue;
    const reasons: string[] = [];
    let score = 0;
    let specific = false;
    let labels: string[] = [];
    let rare = 0;
    const view = twinByPath.get(field.path);
    const shareable = Boolean(view && view.type === "enum" && view.shareable && view.categoryCount > 0);
    if (target.type === "enum") {
      const distinct = distinctLabels(records, field);
      if (!distinct) continue;
      labels = distinct.map((item) => item.value);
      rare = distinct.filter((item) => item.count <= RARE_COUNT).length;
      score += 4;
      reasons.push(`has ${labels.length} different value${labels.length === 1 ? "" : "s"}, like a list of categories`);
      const allowed = new Set((target.enumValues ?? []).map((value) => value.toLowerCase()));
      const equal = labels.filter((label) => allowed.has(label.trim().toLowerCase())).length;
      if (equal > 0) {
        score += 2;
        reasons.push(`${equal} of its values ${equal === 1 ? "is" : "are"} spelled like an allowed value`);
      }
      // Shape evidence: about as many different values as the destination allows.
      const allowedCount = target.enumValues?.length ?? 0;
      if (Math.abs(labels.length - allowedCount) <= 1) {
        score += 1;
        reasons.push(`about as many values as “${target.name}” allows`);
      }
    } else if (target.format === "email") {
      if (field.format === "email") {
        score += 6;
        specific = true;
        reasons.push("every value looks like an email address");
      } else if (field.type === "string") {
        // Real data has a few malformed emails; the profile then drops the format. Count locally (PF-2).
        const share = emailShare(records, field.path);
        if (share.total >= 2 && share.emails / share.total >= EMAIL_SHARE) {
          score += 5;
          specific = true;
          reasons.push(`${share.emails} of ${share.total} values look like email addresses`);
        } else score += 1;
      } else continue;
    } else if (target.format === "date" || target.format === "date-time") {
      if (field.type === "date" || field.type === "datetime") {
        score += field.type === (target.format === "date" ? "date" : "datetime") ? 6 : 3;
        specific = true;
        reasons.push(`every value is a ${field.type === "date" ? "date" : "date and time"}`);
      } else continue;
    } else if (target.type === "string") {
      if (!isTextual(field)) continue;
      score += field.type === "string" ? 2 : 1;
      const codeLike = field.type === "string" && field.allValuesUnique && !field.containsSpaces;
      if (target.name.toLowerCase() === "id" || /(^|_)id$|Id$/.test(target.name)) {
        if (codeLike) {
          score += 3;
          // Sprint 16B (D2): an email column is unique, but it is not evidence for an identifier (S16A X17).
          specific = field.format !== "email";
          reasons.push("every value is a different code, like an identifier");
        }
      } else if (codeLike && field.format !== "email") {
        score -= 1;
      } else if (field.containsSpaces) {
        reasons.push("its values are words, not codes");
      }
      if (field.format === "email") score -= 2;
    } else if (target.type === "integer" || target.type === "number") {
      if (!(field.type === "integer" || (target.type === "number" && field.type === "number"))) continue;
      score += 4;
      specific = true;
      reasons.push("its values are numbers");
    } else if (target.type === "boolean") {
      if (field.type !== "boolean") continue;
      score += 4;
      specific = true;
      reasons.push("its values are true/false");
    } else continue;
    if (target.required && field.missingCount === 0 && field.nullCount === 0) {
      score += 1;
      reasons.push("present in every record");
    }
    if (nameHint(field.path, target.name)) {
      score += 1;
      specific = true;
      reasons.push("similar name (a hint, not proof)");
    }
    out.push({ path: field.path, score, reasons, labels, rare, shareable, shared: Boolean(view?.categoriesDisclosed), specific });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function profileFor(prepared: PreparedTwin, path: string): FieldProfile | undefined {
  return prepared.profile.fields.find((field) => field.path === path);
}

/** A translation is complete when every observed label has a decision (a value or "set aside"). */
export function translationComplete(meaning: CategoryMeaning | undefined, candidate: SourceCandidate | undefined, target: CloudDisclosureTargetField): boolean {
  if (!meaning || !candidate || meaning.source !== candidate.path) return false;
  const allowed = new Set(target.enumValues ?? []);
  return candidate.labels.every((label) => Object.hasOwn(meaning.values, label) && (meaning.values[label] === null || allowed.has(meaning.values[label]!)));
}

function slashOrder(field: FieldProfile, confirmations: Readonly<Record<string, DateInputFormat>>): DateInputFormat | null {
  const confirmed = confirmations[field.path];
  if (confirmed) return confirmed;
  if (field.dateFormat === "MM/DD/YYYY" || field.dateFormat === "DD/MM/YYYY") return field.dateFormatAmbiguous ? null : field.dateFormat;
  return null;
}

/** The deterministic local rule for one destination field from one source field, or what is missing. */
export function deriveRule(
  prepared: PreparedTwin,
  target: CloudDisclosureTargetField,
  source: string,
  candidate: SourceCandidate | undefined,
  meaning: CategoryMeaning | undefined,
  confirmations: Readonly<Record<string, DateInputFormat>>,
): { rule: MappingOperation | null; need: TargetNeed | null } {
  const field = profileFor(prepared, source);
  if (!field || !candidate) return { rule: null, need: "unsupported" };
  if (target.type === "enum") {
    if (!translationComplete(meaning, candidate, target)) return { rule: null, need: "translation" };
    const map: Record<string, string> = {};
    for (const label of candidate.labels) {
      const value = meaning!.values[label];
      if (value) map[label] = value;
    }
    if (Object.keys(map).length === 0) return { rule: null, need: "translation" };
    return { rule: { op: "map_enum", from: source, to: target.name, params: { map, unmapped: "fail" } }, need: null };
  }
  if (target.format === "email") {
    return field.type === "string" ? { rule: { op: "normalize_email", from: source, to: target.name }, need: null } : { rule: null, need: "unsupported" };
  }
  if (target.format === "date") {
    if (field.type !== "date") return { rule: null, need: "unsupported" };
    if (field.dateFormat === "YYYY-MM-DD") return { rule: { op: "parse_date", from: source, to: target.name, params: { inputFormat: "YYYY-MM-DD" } }, need: null };
    const order = slashOrder(field, confirmations);
    if (!order) return { rule: null, need: "date-order" };
    return { rule: { op: "parse_date", from: source, to: target.name, params: { inputFormat: order } }, need: null };
  }
  if (target.format === "date-time") {
    if (field.type === "datetime" && field.dateFormat === "ISO-8601") return { rule: { op: "parse_date", from: source, to: target.name, params: { inputFormat: "ISO-8601" } }, need: null };
    return { rule: null, need: "unsupported" };
  }
  if (target.format === "uri" || target.format === "uuid") return { rule: null, need: "unsupported" };
  if (target.type === "string") {
    if (!isTextual(field)) return { rule: null, need: "unsupported" };
    // Sprint 18F: a padded category-like text field (repeated names) is text too — trim it as a string field.
    return { rule: (field.type === "string" || field.type === "enum") && field.hasPaddedWhitespace ? { op: "trim", from: source, to: target.name } : { op: "copy", from: source, to: target.name }, need: null };
  }
  return { rule: { op: "copy", from: source, to: target.name }, need: null };
}

const NEED_TEXT: Record<TargetNeed, (target: string) => string> = {
  source: (target) => `Choose which of your fields gives “${target}”.`,
  confirm: (target) => `Confirm which of your fields gives “${target}”: EYES only suggested one.`,
  translation: (target) => `Say what each value means for “${target}”.`,
  "date-order": (target) => `Say whether the dates for “${target}” are day/month or month/day.`,
  unsupported: (target) => `EYES can't build “${target}” on this device from the chosen field.`,
};

/**
 * Plan every destination field. `choices` are the user's explicit decisions.
 * Sprint 16B (D1, D2): only an explicit decision puts a non-enum source field
 * into a rule. The best-ranked candidate is offered as `suggested` (need
 * "confirm") and builds nothing; an explicit "no field" (`null`) is honoured
 * and hides the suggestion. Enum fields keep their Sprint 15 rule: the only
 * category-like field is the subject of the translation question and builds
 * nothing until the user has translated every one of its values.
 */
export function planFields(
  prepared: PreparedTwin | null,
  records: readonly unknown[],
  destinationText: string,
  choices: GuidedFieldDecisions,
  confirmations: Readonly<Record<string, DateInputFormat>> = {},
): FieldPlan | null {
  if (!prepared) return null;
  const summary = summarizeDestination(destinationText);
  if (!summary.ok) return null;
  const targets: TargetPlan[] = summary.fields.map((target) => {
    const candidates = rankCandidates(prepared, records, target);
    const all = new Set(prepared.profile.fields.map((field) => field.path));
    const has = Object.hasOwn(choices.fieldMatches, target.name);
    const picked = has ? choices.fieldMatches[target.name] : undefined;
    // Sprint 16B (D1): explicit "no field" (null), a chosen field, or undecided.
    // A pick that is not a field of this data (stale decision) counts as undecided.
    const decision: TargetPlan["decision"] = picked === null ? "none" : typeof picked === "string" && all.has(picked) ? "source" : "undecided";
    let chosen: string | null = null;
    let chosenBy: TargetPlan["chosenBy"] = null;
    let suggested: string | null = null;
    if (decision === "source") {
      chosen = picked as string;
      chosenBy = "user";
    } else if (decision === "undecided") {
      if (target.type === "enum") {
        // Unchanged since Sprint 15: the only category-like field is the subject of the
        // translation question; it builds nothing until every value is translated.
        if (candidates.length === 1) {
          chosen = candidates[0]!.path;
          chosenBy = "only-candidate";
        }
      } else if (candidates.length > 0 && candidates[0]!.specific && (candidates.length === 1 || candidates[0]!.score > candidates[1]!.score)) {
        // Sprint 16B (D2): a ranked suggestion with specific evidence is shown for confirmation, never applied.
        suggested = candidates[0]!.path;
      }
    }
    const candidate = chosen ? (candidates.find((item) => item.path === chosen) ?? null) : null;
    let rule: MappingOperation | null = null;
    let need: TargetNeed | null = null;
    if (!chosen) need = decision === "none" ? (target.required ? "source" : null) : suggested ? (target.required ? "confirm" : null) : target.required ? "source" : null;
    else ({ rule, need } = deriveRule(prepared, target, chosen, candidate ?? undefined, choices.categoryMeanings[target.name], confirmations));
    let cloud: TargetPlan["cloud"] = "ok";
    if (target.type === "enum" && target.required) {
      if (!chosen) cloud = "no-source";
      else if (!candidate?.shareable) cloud = "names-not-shareable";
      else if (!candidate.shared) cloud = "names-withheld";
    }
    return { target, candidates, chosen, chosenBy, suggested, decision, rule, need, cloud };
  });
  const missing = targets.filter((plan) => plan.target.required && !plan.rule);
  const localReady = missing.length === 0 && targets.some((plan) => plan.rule);
  const firstMissing = missing[0];
  const cloudBlocked = targets.find((plan) => plan.cloud !== "ok");
  return {
    targets,
    questions: targets.filter((plan) => plan.target.type === "enum" && (plan.candidates.length > 0 || plan.target.required)),
    localReady,
    localBlocker: firstMissing ? NEED_TEXT[firstMissing.need ?? "source"](firstMissing.target.name) : localReady ? null : "Choose at least one field to build.",
    cloudBlocker: cloudBlocked
      ? cloudBlocked.cloud === "no-source"
        ? `Choose which of your fields gives “${cloudBlocked.target.name}” first.`
        : cloudBlocked.cloud === "names-not-shareable"
          ? `Gemini can't fill “${cloudBlocked.target.name}” from “${cloudBlocked.chosen}”: its values can't be shared. Translate them here instead.`
          : `Gemini can only fill “${cloudBlocked.target.name}” if it sees the names in “${cloudBlocked.chosen}”. Share them, or translate them here instead.`
      : null,
  };
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "destination";

/** Prefix of every contract built by `localContract`; lets the UI label the active mapping honestly. */
export const LOCAL_MAPPING_PREFIX = "guided-local-";

/**
 * A complete Mapping Contract built ONLY from the plan's local rules, or null
 * when any required destination field has no rule. Runs through the existing
 * hand-written route; nothing here executes it.
 */
export function localContract(plan: FieldPlan, prepared: PreparedTwin, destinationText: string): MappingContract | null {
  if (!plan.localReady) return null;
  const summary = summarizeDestination(destinationText);
  const title = summary.ok ? summary.title : "destination";
  return {
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId: `${LOCAL_MAPPING_PREFIX}${slug(title)}`,
    mappingVersion: "1",
    phantomId: prepared.twin.phantom.phantomId,
    destinationSchemaId: slug(title),
    destinationSchemaVersion: "1.0.0",
    operations: plan.targets.flatMap((item) => (item.rule ? [item.rule] : [])),
    notes: "Built on this device from the user's own field choices and category translations. No AI generated this mapping.",
  } as MappingContract;
}

export function isLocalMapping(mappingText: string): boolean {
  try {
    const parsed = JSON.parse(mappingText) as { mappingId?: unknown };
    return typeof parsed.mappingId === "string" && parsed.mappingId.startsWith(LOCAL_MAPPING_PREFIX);
  } catch {
    return false;
  }
}

/**
 * The user's valid category translations, as trusted user-declared
 * enum-meaning constraints. A declaration is dropped (never trusted) when its
 * target is not an enum of the destination on screen, its source is not a
 * field of this data, or any value is not allowed by the destination.
 * "Set aside" labels carry no meaning; `undeclared: "review"` makes any output
 * produced from them a policy conflict, never a pass.
 */
export function meaningConstraints(categoryMeanings: Readonly<Record<string, CategoryMeaning>>, destinationText: string, sourcePaths: readonly string[]): EnumMeaningConstraint[] {
  const summary = summarizeDestination(destinationText);
  if (!summary.ok) return [];
  const enums = new Map(summary.fields.filter((field) => field.type === "enum").map((field) => [field.name, new Set(field.enumValues ?? [])]));
  const paths = new Set(sourcePaths);
  const out: EnumMeaningConstraint[] = [];
  for (const [target, declared] of Object.entries(categoryMeanings).sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = enums.get(target);
    if (!allowed || !paths.has(declared.source)) continue;
    const meaning: Record<string, string> = {};
    let valid = true;
    for (const [label, value] of Object.entries(declared.values)) {
      if (value === null) continue;
      if (!allowed.has(value)) valid = false;
      meaning[label] = value;
    }
    if (!valid || Object.keys(meaning).length === 0) continue;
    out.push({
      id: `declared-meaning-${out.length + 1}`,
      kind: "enum-meaning",
      source: declared.source,
      target,
      meaning,
      undeclared: "review",
      trust: "trusted",
      evidence: { kind: "user-declared" },
    });
  }
  return out;
}

/**
 * The local acceptance policy of the guided flow. Strict, except that for a
 * destination field the user translated, a record whose value was set aside —
 * or is not in the translation at all (a new or unexpected value) — is held
 * for manual review instead of counting as a failure. That is exactly what the
 * translation screen tells the user. More than half the records held for
 * review is never "ready". The user, never a model, is the source of every
 * rule here; no translated value is ever invented.
 */
export function guidedPolicy(categoryMeanings: Readonly<Record<string, CategoryMeaning>>): AcceptancePolicy {
  const targets = Object.keys(categoryMeanings).sort();
  if (targets.length === 0) return STRICT_POLICY;
  return {
    ...STRICT_POLICY,
    policyId: "guided-set-aside",
    description: GUIDED_SET_ASIDE_DESCRIPTION,
    quarantine: targets.map((to) => ({ code: "UNMAPPED_ENUM" as const, to })),
    maxQuarantineRate: 0.5,
  };
}

/** Plain words for one local rule. */
export function describeRule(operation: MappingOperation): string {
  switch (operation.op) {
    case "copy":
    case "rename":
      return "copied as is";
    case "trim":
      return "copied, spaces trimmed";
    case "normalize_email":
      return "as a lower-case email";
    case "parse_date":
      return `read as ${operation.params.inputFormat}`;
    case "map_enum":
      return `translated (${Object.keys(operation.params.map).length} values)`;
    case "default_if_missing":
      return "a default value";
    case "concat":
      return "joined";
  }
}


/**
 * Sprint 17A (Workstream 3): required destination fields that a mapping never
 * writes, in destination order. A pure reading of the mapping and the
 * destination on screen. Such a mapping cannot produce a single valid
 * destination record, whatever the data. EYES never adds the missing rules.
 */
export function unwrittenRequiredTargets(contract: MappingContract | null, destinationText: string): string[] {
  if (!contract) return [];
  const summary = summarizeDestination(destinationText);
  if (!summary.ok) return [];
  const written = new Set(contract.operations.map((operation) => operation.to.split(".")[0]));
  return summary.fields.filter((field) => field.required && !written.has(field.name)).map((field) => field.name);
}

/**
 * Sprint 17A (Workstream 2): required fixed-list destination fields that a
 * Gemini request provably cannot fill, with the reason. Deterministic and
 * local: the field has no category-like source, or Gemini would see only
 * placeholders for its category names (withheld or not shareable). Uncertainty
 * Gemini can resolve (which field gives an id, an email, a date) never blocks.
 */
export function cloudBlockedTargets(
  plan: FieldPlan | null,
): Array<{ target: string; source: string | null; reason: Exclude<TargetPlan["cloud"], "ok"> | "choose-source"; options: string[] }> {
  if (!plan) return [];
  return plan.targets
    .filter((item) => item.target.type === "enum" && item.target.required && item.cloud !== "ok")
    .map((item) => {
      // "no-source" means no field is chosen; it is a missing source only when no field could give it.
      const reason = item.cloud === "no-source" && item.candidates.length > 0 ? ("choose-source" as const) : (item.cloud as Exclude<TargetPlan["cloud"], "ok">);
      return { target: item.target.name, source: item.chosen, reason, options: item.candidates.slice(0, 3).map((candidate) => candidate.path) };
    });
}
