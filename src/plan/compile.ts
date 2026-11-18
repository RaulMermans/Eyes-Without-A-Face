/**
 * Deterministic Intent Plan compiler (ADR 0018). OWNER: Worker B.
 *
 * ValidatedIntentPlan + the user's answers → CompiledIntegration.
 * Gemini-authored operations are compiled into a Mapping Proposal and passed
 * through the UNCHANGED `convertProposal` gate. User-declared operations come
 * only from the user's explicit answers. No default is ever filled, no label
 * is ever translated by similarity, and no second engine exists: execution is
 * `resolveAliases` → `executeMapping` as today.
 *
 * Per destination field (destination order):
 *
 *   1. the plan path: the model's entry (if any survived validation) gives the
 *      correspondence; its transformation becomes a Gemini operation only when
 *      the entry is `ready` + `accepted`, local date evidence agrees, and the
 *      ONE-operation proposal passes `convertProposal` on its own (so one bad
 *      operation never sinks the others);
 *   2. the user's answers complete what the plan left open: a complete
 *      category translation of the corresponding source field (map_enum,
 *      `unmapped: "fail"`), or a confirmed slash-date order (origin
 *      `gemini+user`);
 *   3. an explicit `fieldMatches[target]` overrides the plan: `null` = no field;
 *      a path builds the Sprint 15 rule (`deriveRule`, origin `user`), unless it
 *      names the very field whose plan operation is already executable (the
 *      user agrees with Gemini; the Gemini operation stands).
 *
 * Privacy: the alias contract contains aliases only, except the category
 * labels of a user-declared `map_enum` (the user's own translation keys). Those
 * never enter a cloud payload (revision is refused for such plans) and enter an
 * export only through the existing per-field label opt-in.
 */
import type { CloudDisclosurePayload, CloudDisclosureTargetField, MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import type { DateInputFormat, FieldProfile } from "../domain/profile/profile.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { convertProposal, MAX_PROPOSAL_OPERATIONS, type ProposalIssue, type ProposalIssueCode, type ProposalOrigin, type ProposalWarning } from "../proposal/convert.ts";
import { resolveAliases } from "../proposal/resolve.ts";
import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { ProposalResult } from "../app/workspace-state.ts";
import { deriveRule, rankCandidates } from "../app/guided/field-plan.ts";
import { buildClarifications } from "./clarify.ts";
import { classifyAgreement, noSourceNeedsQuestion } from "./agreement.ts";
import type { LocalCandidateSet } from "../matching/types.ts";
import { classifyPlanIssue, nextActionFor } from "./failures.ts";
import {
  PLAN_MAPPING_PREFIX,
  RANKED_PLAN_VERSION,
  type Clarification,
  type ClassifiedFailure,
  type CompiledField,
  type CompiledIntegration,
  type FailureCategory,
  type IntentPlanEntry,
  type MissingCode,
  type OperationOrigin,
  type PlanAnswers,
  type ValidatedEntry,
  type ValidatedIntentPlan,
} from "./types.ts";

export interface CompileInput {
  validated: ValidatedIntentPlan;
  /** The approved 1.1.0 disclosure the plan answered. */
  disclosure: CloudDisclosurePayload;
  prepared: PreparedTwin;
  /** Imported records (local only), for label lists and evidence. */
  records: readonly unknown[];
  answers: PlanAnswers;
  requestId: string;
  /** Origin of the answer (`originFor`); defaults to Gemini. A simulated test-adapter plan is never labelled Gemini. */
  origin?: ProposalOrigin;
  /**
   * Sprint 18D (ADR 0021 §C–D, rescue). LOCAL ONLY candidate evidence.
   * Absent = the Sprint 18C behaviour, unchanged.
   *   localCandidates      local matcher output; orders choose-field candidates.
   *   askOnLocalEvidence   local evidence may turn a field into ONE question
   *                        (never into an executed match), by `classifyAgreement`
   *                        (src/plan/agreement.ts, Sprint 18E):
   *     - significant disagreement with Gemini's single pick (contradicted, local
   *       clear about another field, or the pick not listed): asked whatever
   *       Gemini's confidence, also before a category translation;
   *     - an optional field Gemini gave no source, with a clear local candidate.
   *   Agreement never upgrades a match: both can be wrong in the same way.
   */
  local?: {
    localCandidates?: readonly LocalCandidateSet[];
    askOnLocalEvidence?: boolean;
  };
}

/** Fixed rationale of every gate check (application-owned; model text never enters it). */
const GATE_RATIONALE = "Compiled from an Integration Intent Plan entry.";
const CONTRACT_NOTES = "Alias-level mapping compiled from an Integration Intent Plan and the user's own answers. Resolved to local source fields only inside this browser.";
const SLASH_FORMATS = new Set<DateInputFormat>(["MM/DD/YYYY", "DD/MM/YYYY"]);

type SlashOrder = Extract<DateInputFormat, "MM/DD/YYYY" | "DD/MM/YYYY">;

/** One field's compiled state before its operation is checked. */
interface Draft {
  readiness: CompiledField["readiness"];
  correspondence: CompiledField["correspondence"];
  operation: MappingOperation | null;
  origin: OperationOrigin | null;
  missing: MissingCode[];
  failures: ClassifiedFailure[];
  /**
   * Sprint 18D: Gemini's own parameterless operation (copy / trim /
   * normalize_email) for a single-field match that was ASKED instead of
   * executed. Used only if the user then picks exactly that field, so a
   * confirmation never silently replaces Gemini's transformation with the
   * local rule (found in 18D: trim → copy).
   */
  held?: MappingOperation;
}

const HOLDABLE = new Set(["copy", "trim", "normalize_email"]);

function failure(category: FailureCategory, target: string, evidence: string[]): ClassifiedFailure {
  return { category, target, next: nextActionFor(category), evidence };
}

/** The failure category of a gate refusal of one operation. Application codes only. */
function categoryForProposalIssue(code: ProposalIssueCode): FailureCategory {
  switch (code) {
    case "INVALID_ENUM_MAPPING":
      return "invented-values";
    case "UNKNOWN_ALIAS":
      return "incorrect-correspondence";
    case "UNKNOWN_TARGET_FIELD":
    case "DISCLOSURE_MISSING_TARGET":
      return "destination-incompatible";
    case "UNKNOWN_OPERATION":
      return "unsupported-operation";
    default:
      return "invalid-parameters";
  }
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** A Mapping Proposal 1.0.0 operation (alias-level) for one plan entry, or null when the entry carries no executable transformation. */
function proposalOperation(entry: IntentPlanEntry, inputFormat?: DateInputFormat): Record<string, unknown> | null {
  const to = entry.target;
  switch (entry.transform) {
    case "copy":
    case "trim":
    case "normalize_email":
      return entry.from.length === 1 ? { op: entry.transform, from: entry.from[0], to } : null;
    case "parse_date": {
      const format = inputFormat ?? entry.inputFormat;
      return entry.from.length === 1 && format ? { op: "parse_date", from: entry.from[0], to, params: { inputFormat: format } } : null;
    }
    case "map_enum":
      return entry.from.length === 1 && entry.valueMap ? { op: "map_enum", from: entry.from[0], to, params: { map: { ...entry.valueMap }, unmapped: "fail" } } : null;
    case "concat":
      return entry.from.length >= 2 && typeof entry.separator === "string" ? { op: "concat", from: [...entry.from], to, params: { separator: entry.separator } } : null;
    default:
      return null;
  }
}

/**
 * The frozen gate judges against a 1.1.0 disclosure. A 1.4.0 disclosure
 * (ADR 0021) is the same request plus destination descriptions and a thinking
 * level, neither of which the gate reads; it is judged through this exact
 * 1.1.0 view (same aliases, labels and target fields). The gate is unchanged.
 */
export function gateDisclosureView(disclosure: CloudDisclosurePayload): CloudDisclosurePayload {
  if (disclosure.schemaVersion !== "1.4.0" || !disclosure.target) return disclosure;
  const { thinkingLevel: _thinking, ...destination } = disclosure.destination;
  return {
    ...disclosure,
    schemaVersion: "1.1.0",
    destination,
    target: { fields: disclosure.target.fields.map(({ description: _description, ...field }) => field) },
  };
}

/** Run operations through the unchanged gate as one proposal. */
function gate(operations: Array<Record<string, unknown>>, disclosure: CloudDisclosurePayload, mappingId: string) {
  return convertProposal({ operations, rationale: GATE_RATIONALE }, { disclosure: gateDisclosureView(disclosure), mappingId, origin: "gemini-cloud" });
}

/** Alias-level copy of a local-path operation from `deriveRule` (aliases only; map_enum keeps the user's labels). */
function toAliasOperation(operation: MappingOperation, alias: string): MappingOperation {
  switch (operation.op) {
    case "concat":
      return { ...operation, from: [alias], params: { ...operation.params } };
    case "default_if_missing":
      // deriveRule never produces a default; refuse to express one.
      throw new Error("A default is never compiled.");
    case "map_enum":
      return { ...operation, from: alias, params: { ...operation.params, map: { ...operation.params.map } } };
    case "parse_date":
      return { ...operation, from: alias, params: { ...operation.params } };
    default:
      return { ...operation, from: alias };
  }
}

export function compileIntentPlan(input: CompileInput): CompiledIntegration {
  const { validated, disclosure, prepared, records, answers } = input;
  const mappingId = `${PLAN_MAPPING_PREFIX}${input.requestId.slice(0, 8)}`;
  const bindings = prepared.twin.bindings;
  const targets: CloudDisclosureTargetField[] = disclosure.target?.fields ?? [];
  const disclosed = new Set(disclosure.fields.map((field) => field.alias));
  const shareable = new Set(prepared.twin.phantom.shareableFieldAliases);
  const usableAlias = (alias: string) => disclosed.has(alias) && shareable.has(alias) && bindings.resolve(alias) !== null;
  const profileFor = (path: string): FieldProfile | undefined => prepared.profile.fields.find((field) => field.path === path);
  const unaddressed = new Set(validated.unaddressed);
  const policy = input.local ?? {};
  const localByTarget = new Map((policy.localCandidates ?? []).map((set) => [set.target, set]));

  /** Check one operation through the gate (gate-able ops) or the contract validator (user map_enum with local labels). */
  const checkOperation = (operation: MappingOperation, viaGate: boolean): ProposalIssue[] => {
    const aliases = operation.op === "concat" ? operation.from : "from" in operation && operation.from !== undefined ? [operation.from] : [];
    const unusable = aliases.filter((alias) => !usableAlias(alias));
    if (unusable.length > 0) return [{ code: "UNKNOWN_ALIAS", message: "An alias of this operation is not part of the approved disclosure." }];
    if (viaGate) {
      const checked = gate([operation as unknown as Record<string, unknown>], disclosure, mappingId);
      return checked.ok ? [] : checked.issues;
    }
    const contract = assemble([operation]);
    const validation = validateContract(contract);
    return validation.valid ? [] : validation.issues.map((issue) => ({ code: "CONTRACT_INVALID" as const, message: `${issue.path}: ${issue.message}` }));
  };

  const assemble = (operations: MappingOperation[]): MappingContract => ({
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId,
    mappingVersion: "1",
    phantomId: disclosure.phantomId,
    destinationSchemaId: "approved-target",
    operations,
    notes: CONTRACT_NOTES,
  });

  /** The user's complete translation of `path` for an enum target, as an alias-level map_enum (Sprint 15 rule), or null. */
  const userTranslation = (target: CloudDisclosureTargetField, path: string, alias: string): MappingOperation | null => {
    if (target.type !== "enum") return null;
    const meaning = answers.categoryMeanings[target.name];
    if (!meaning || meaning.source !== path) return null;
    const candidate = rankCandidates(prepared, records, target).find((item) => item.path === path);
    const derived = deriveRule(prepared, target, path, candidate, meaning, answers.semanticConfirmations);
    return derived.rule && derived.rule.op === "map_enum" ? toAliasOperation(derived.rule, alias) : null;
  };

  /** The plan path for one field: correspondence, Gemini operation and user completion. */
  const planDraft = (target: CloudDisclosureTargetField, entries: ValidatedEntry[]): Draft => {
    const failures: ClassifiedFailure[] = entries.flatMap((item) => item.issues.map((issue) => classifyPlanIssue(issue)));
    const usable = entries.find((item) => item.verdict !== "rejected");
    if (!usable) {
      // Unaddressed, or every entry for this target rejected: unresolved, never "no source".
      return { readiness: "needs_clarification", correspondence: null, operation: null, origin: null, missing: [], failures };
    }
    const entry = usable.entry;
    const correspondence = entry.from.length > 0 ? { aliases: [...entry.from], by: "gemini" as const } : null;
    const single = entry.from.length === 1 ? entry.from[0]! : null;
    const path = single ? bindings.resolve(single) : null;
    const base = { correspondence, failures };

    const set = localByTarget.get(target.name);
    const asking = policy.askOnLocalEvidence === true && !Object.hasOwn(answers.fieldMatches, target.name);
    const ask = (draft: Partial<Draft> = {}, why?: string): Draft => ({
      ...base,
      ...draft,
      readiness: "needs_clarification",
      operation: null,
      origin: null,
      missing: unique([...entry.missing.filter((code) => code !== "no-matching-source"), "field-meaning"]),
      failures: why ? [...failures, failure("semantic-disagreement", target.name, [why])] : failures,
    });

    if (entry.status === "no_source") {
      // Class 4 (no valid source) stands unless the local matcher is clear; a required field is already asked.
      if (asking && !target.required && noSourceNeedsQuestion(set)) return ask();
      return { ...base, readiness: "no_source", operation: null, origin: null, missing: [...entry.missing] };
    }

    // Sprint 18E: a significant, evidence-backed disagreement is one question, whatever Gemini's confidence (also
    // before a category translation). Never a switch to the local candidate; agreement never upgrades a match.
    if (asking && single && path && classifyAgreement(path, set) === "significant-disagreement") return ask({}, "LOCAL_EVIDENCE_DISAGREES");

    // ADR 0020 §7: a single-field match Gemini is not highly confident about is a question (Gemini's pick listed first),
    // never an executed match. Sprint 18C live: high 86 % right, medium 38 %, low 21 %. Exempt: a category match still
    // awaiting the user's translation, whose question already shows that field's own values (no record runs without it).
    const awaitsTranslation = entry.transform === "map_enum" && entry.status !== "ready";
    const heldOperation = entry.status === "ready" && usable.verdict === "accepted" && HOLDABLE.has(entry.transform) ? (proposalOperation(entry) as unknown as MappingOperation | null) : null;
    const held = heldOperation ? { held: heldOperation } : {};
    if (single && entry.confidence !== "high" && !awaitsTranslation) return { ...base, ...held, readiness: "needs_clarification", operation: null, origin: null, missing: unique([...entry.missing, "field-meaning"]) };

    // A complete category translation by the user for the corresponding field completes any open enum entry.
    const translated = single && path ? userTranslation(target, path, single) : null;
    const withTranslation = (missing: MissingCode[], readiness: CompiledField["readiness"]): Draft =>
      translated ? { ...base, readiness: "ready", operation: translated, origin: "gemini+user", missing: [] } : { ...base, readiness, operation: null, origin: null, missing };

    if (entry.status === "unsupported") return withTranslation([...entry.missing], "unsupported");

    if (entry.transform === "map_enum") {
      if (entry.status === "ready" && usable.verdict === "accepted") {
        const operation = proposalOperation(entry);
        if (operation) {
          const draft = checked(target, { ...base, readiness: "ready", operation: operation as unknown as MappingOperation, origin: "gemini", missing: [] });
          if (draft.operation) return draft;
          // The gate refused Gemini's translation: the correspondence is kept, the user may still translate.
          base.failures = draft.failures;
        }
      }
      // Withheld or invented labels: the correspondence is kept; only the user can translate.
      return withTranslation(unique([...entry.missing.filter((code) => code !== "category-labels"), "category-labels"]), "needs_clarification");
    }

    if (entry.transform === "parse_date" && single && path) {
      const field = profileFor(path);
      const confirmed = answers.semanticConfirmations[path] as SlashOrder | undefined;
      const claimed = entry.inputFormat;
      const proven = field?.dateFormat && !field.dateFormatAmbiguous ? field.dateFormat : null;
      const slashSource = Boolean(field?.dateFormat && SLASH_FORMATS.has(field.dateFormat));
      const dateOrderOpen = entry.missing.includes("date-order");
      if ((claimed && SLASH_FORMATS.has(claimed)) || (dateOrderOpen && slashSource)) {
        if (confirmed) {
          // The user's order is in force; Gemini gave the correspondence.
          const origin: OperationOrigin = entry.status === "ready" && claimed === confirmed && proven === confirmed ? "gemini" : "gemini+user";
          const operation = proposalOperation(entry, confirmed);
          const otherMissing = entry.missing.filter((code) => code !== "date-order");
          if (operation && otherMissing.length === 0) return { ...base, readiness: "ready", operation: operation as unknown as MappingOperation, origin, missing: [] };
        }
        if (entry.status === "ready" && claimed) {
          if (proven === claimed) {
            const operation = proposalOperation(entry);
            if (operation) return { ...base, readiness: "ready", operation: operation as unknown as MappingOperation, origin: "gemini", missing: [] };
          }
          if (proven && proven !== claimed) {
            // Local evidence contradicts the model: ask, never switch silently.
            return {
              ...base,
              readiness: "needs_clarification",
              operation: null,
              origin: null,
              missing: ["date-order"],
              failures: [...failures, failure("semantic-disagreement", target.name, ["DATE_ORDER_CONTRADICTS_PROFILE"])],
            };
          }
          if (field?.dateFormatAmbiguous) return { ...base, readiness: "needs_clarification", operation: null, origin: null, missing: ["date-order"] };
        } else {
          return { ...base, readiness: "needs_clarification", operation: null, origin: null, missing: unique([...entry.missing, "date-order"]) };
        }
      }
    }

    if (entry.status === "ready" && usable.verdict === "accepted") {
      const operation = proposalOperation(entry);
      if (operation) return { ...base, readiness: "ready", operation: operation as unknown as MappingOperation, origin: "gemini", missing: [] };
      return { ...base, readiness: "unsupported", operation: null, origin: null, missing: ["unsupported-transform"] };
    }
    return { ...base, readiness: entry.status === "ready" ? "needs_clarification" : entry.status, operation: null, origin: null, missing: [...entry.missing] };
  };

  /** The user's explicit field choice for one field (Sprint 15 rule). */
  const userDraft = (target: CloudDisclosureTargetField, path: string, failures: ClassifiedFailure[]): Draft => {
    const alias = bindings.aliasForPath(path);
    if (!alias || !usableAlias(alias) || !profileFor(path)) {
      return {
        readiness: "unsupported",
        correspondence: null,
        operation: null,
        origin: null,
        missing: ["unsupported-transform"],
        failures: [...failures, failure("privacy-blocker", target.name, ["FIELD_NOT_DISCLOSED"])],
      };
    }
    const correspondence = { aliases: [alias], by: "user" as const };
    const candidate = rankCandidates(prepared, records, target).find((item) => item.path === path);
    const { rule, need } = deriveRule(prepared, target, path, candidate, answers.categoryMeanings[target.name], answers.semanticConfirmations);
    if (rule) return { readiness: "ready", correspondence, operation: toAliasOperation(rule, alias), origin: "user", missing: [], failures };
    const missing: MissingCode[] = need === "translation" ? ["category-labels"] : need === "date-order" ? ["date-order"] : ["unsupported-transform"];
    return { readiness: need === "translation" || need === "date-order" ? "needs_clarification" : "unsupported", correspondence, operation: null, origin: null, missing, failures };
  };

  /** Check a draft's operation on its own: one bad operation never sinks the others. */
  const checked = (target: CloudDisclosureTargetField, draft: Draft): Draft => {
    if (!draft.operation) return draft;
    const issues = checkOperation(draft.operation, !(draft.operation.op === "map_enum" && draft.origin !== "gemini"));
    if (issues.length === 0) return draft;
    const refused = unique(issues.map((issue) => categoryForProposalIssue(issue.code))).map((category) =>
      failure(category, target.name, unique(issues.filter((issue) => categoryForProposalIssue(issue.code) === category).map((issue) => issue.code))),
    );
    const enumField = draft.operation.op === "map_enum";
    return {
      ...draft,
      readiness: enumField ? "needs_clarification" : "unsupported",
      operation: null,
      origin: null,
      missing: enumField ? ["category-labels"] : ["unsupported-transform"],
      failures: [...draft.failures, ...refused],
    };
  };

  const fields: CompiledField[] = targets.map((target) => {
    const entries = validated.entries.filter((item) => item.entry.target === target.name);
    const claimed = unaddressed.has(target.name) || entries.length === 0 ? null : entries[0]!.entry.status;
    let draft = checked(target, planDraft(target, entries));

    if (Object.hasOwn(answers.fieldMatches, target.name)) {
      const picked = answers.fieldMatches[target.name];
      if (picked === null) {
        draft = { readiness: "no_source", correspondence: null, operation: null, origin: null, missing: ["no-matching-source"], failures: draft.failures };
      } else if (typeof picked === "string") {
        // The user picked the very field whose plan operation is executable: they agree, and the plan operation stands.
        const pickedAlias = bindings.aliasForPath(picked);
        const agrees = draft.operation !== null && draft.correspondence?.aliases.length === 1 && draft.correspondence.aliases[0] === pickedAlias;
        const confirmsHeld = draft.held !== undefined && draft.correspondence?.aliases.length === 1 && draft.correspondence.aliases[0] === pickedAlias;
        if (confirmsHeld) {
          // The user confirmed the field Gemini proposed: Gemini's transformation stands, through the gate.
          const confirmed = checked(target, { ...draft, readiness: "ready", operation: draft.held!, origin: "gemini+user", missing: [], correspondence: { aliases: [pickedAlias!], by: "user" } });
          draft = confirmed.operation ? confirmed : checked(target, userDraft(target, picked, draft.failures));
        } else if (!agrees) draft = checked(target, userDraft(target, picked, draft.failures));
      }
    }

    return {
      target: target.name,
      required: target.required,
      targetType: target.type,
      claimed,
      readiness: draft.operation ? "ready" : draft.readiness,
      correspondence: draft.correspondence,
      operation: draft.operation,
      operationOrigin: draft.operation ? draft.origin : null,
      missing: draft.operation ? [] : draft.missing,
      failures: draft.failures,
    };
  });

  // Every gate-able operation once more as proposals (chunked at the gate's limit; always passes after the per-op checks).
  const executable = fields.filter((field) => field.operation);
  const gateable = executable.filter((field) => !(field.operation!.op === "map_enum" && field.operationOrigin !== "gemini"));
  const canonical = new Map<string, MappingOperation>();
  for (let start = 0; start < gateable.length; start += MAX_PROPOSAL_OPERATIONS) {
    const chunk = gateable.slice(start, start + MAX_PROPOSAL_OPERATIONS);
    const converted = gate(
      chunk.map((field) => field.operation as unknown as Record<string, unknown>),
      disclosure,
      mappingId,
    );
    if (!converted.ok) throw new Error("compileIntentPlan: operations that passed the gate one by one were refused together.");
    converted.value.contract.operations.forEach((operation) => canonical.set(operation.to, operation));
  }
  const operations = executable.map((field) => canonical.get(field.target) ?? field.operation!);
  let aliasContract: MappingContract | null = null;
  if (operations.length > 0) {
    const contract = assemble(operations);
    const validation = validateContract(contract);
    if (!validation.valid) throw new Error("compileIntentPlan: the assembled mapping contract is invalid.");
    aliasContract = contract;
  }

  const unwrittenRequired = fields.filter((field) => field.required && !field.operation).map((field) => field.target);
  const counts = {
    fields: fields.length,
    executable: executable.length,
    byGemini: fields.filter((field) => field.operationOrigin === "gemini").length,
    byUser: fields.filter((field) => field.operationOrigin === "user" || field.operationOrigin === "gemini+user").length,
    needsClarification: fields.filter((field) => field.readiness === "needs_clarification").length,
    unsupported: fields.filter((field) => field.readiness === "unsupported").length,
    noSource: fields.filter((field) => field.readiness === "no_source").length,
  };
  return {
    mappingId,
    fields,
    aliasContract,
    complete: aliasContract !== null && unwrittenRequired.length === 0,
    unwrittenRequired,
    clarifications: withRankedPaths(
      buildClarifications(fields, (alias) => bindings.resolve(alias)),
      validated,
      localByTarget,
      (alias) => (usableAlias(alias) ? bindings.resolve(alias) : null),
      Boolean(input.local),
    ),
    counts,
  };
}

/** At most this many ranked candidates are shown first in a choose-field question. */
export const MAX_RANKED_CANDIDATES = 3;

/**
 * Sprint 18D: ranked candidates for choose-field questions — Gemini's pick and
 * alternatives first, then local matcher candidates, deduplicated, ≤ 3. Only
 * when ranked evidence exists (plan 1.1.0 alternatives or `local`); otherwise
 * the questions are exactly the Sprint 18C ones.
 */
function withRankedPaths(
  clarifications: Clarification[],
  validated: ValidatedIntentPlan,
  localByTarget: ReadonlyMap<string, LocalCandidateSet>,
  pathFor: (alias: string) => string | null,
  localEnabled: boolean,
): Clarification[] {
  const ranked = validated.planVersion === RANKED_PLAN_VERSION;
  if (!ranked && !localEnabled) return clarifications;
  return clarifications.map((item) => {
    if (item.kind !== "choose-field") return item;
    const entry = validated.entries.find((candidate) => candidate.verdict !== "rejected" && candidate.entry.target === item.target)?.entry;
    const gemini = entry ? [...entry.from, ...(entry.alternatives ?? [])].map(pathFor).filter((path): path is string => typeof path === "string") : [];
    const local = (localByTarget.get(item.target)?.candidates ?? []).map((candidate) => candidate.path);
    const rankedPaths = unique([...gemini, ...local]).slice(0, MAX_RANKED_CANDIDATES);
    return rankedPaths.length > 0 ? { ...item, rankedPaths } : item;
  });
}

/**
 * The acceptance record stored as `ProposalState.result` for a plan: ok with
 * converted (alias contract) + resolved (executable) when at least one field
 * is executable; otherwise a `stage: "plan"` refusal that names why. Never
 * calls a planning artifact an integration.
 */
export function acceptCompiledPlan(compiled: CompiledIntegration, input: CompileInput): ProposalResult {
  if (!compiled.aliasContract) {
    // A planning artifact, never an integration. The plan's own issues explain the entries it lost.
    return { ok: false, stage: "plan", issues: [...input.validated.issues] };
  }
  const warnings: ProposalWarning[] = compiled.unwrittenRequired.map((name) => ({
    code: "REQUIRED_TARGET_UNMAPPED",
    message: `Required destination field "${name}" is not written by any operation.`,
  }));
  const converted = { contract: compiled.aliasContract, rationale: input.validated.plan.summary, origin: input.origin ?? "gemini-cloud", warnings };
  const twin = input.prepared.twin;
  const resolved = resolveAliases({ aliasContract: compiled.aliasContract, phantom: twin.phantom, source: twin.source, bindings: twin.bindings });
  if (!resolved.ok) return { ok: false, stage: "resolve", issues: resolved.issues, converted };
  return { ok: true, value: { converted, resolved: resolved.value } };
}
