/**
 * Sprint 18B frozen scorer (docs/evaluation/sprint-18b-intent-plan.md, EVAL-190+).
 *
 * Pure and offline: nothing here sends, approves or calls a model. The caller
 * loads the scenarios and the recorded alias-level answers.
 *
 *   P0  baseline: concept-bearing twin, Sprint 3 instructions
 *       (`buildCloudPromptText`), answered with a Mapping Proposal 1.0.0
 *   P2  this branch: same twin, intent plan prompt v5
 *       (`buildOutboundPromptText(…, "intent-plan-1")`), answered with an
 *       Integration Intent Plan 1.0.0
 *
 * Every scenario is built exactly like the app builds it (prepareTwin with
 * concepts → buildDisclosureDraft → createDisclosurePreview), and the scorer
 * proves the recorded prompt hash equals the reconstruction before scoring.
 *
 * Scoring definitions are the pre-registered ones. Choices the
 * pre-registration leaves open are fixed here, before any live run, and
 * stated where they are made (search "Scoring choice").
 *
 * Holdout use: the functions below return numbers and booleans only. Nothing
 * here returns a scenario id, a field name or a value for a holdout caller;
 * per-answer rows carry the scenario INDEX only.
 */
import type { CloudDisclosurePayload, MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import type { FieldProfile } from "../domain/profile/profile.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { DEFAULT_TWIN_SEED } from "../phantom/generate.ts";
import { buildCloudPromptText } from "../inference/prompts.ts";
import { buildIntentPlanPromptText } from "../inference/intent-prompt.ts";
import { buildOutboundPromptText, createDisclosurePreview } from "../twin/authorization.ts";
import { acceptProposal, buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../workflow/pipeline.ts";
import { parseIntentPlanText, validateIntentPlan } from "../plan/validate.ts";
import { acceptCompiledPlan, compileIntentPlan, type CompileInput } from "../plan/compile.ts";
import type { Clarification, CompiledIntegration, PlanAnswers, ValidatedIntentPlan } from "../plan/types.ts";
import { distinctLabels, guidedPolicy, meaningConstraints, unwrittenRequiredTargets, type CategoryMeaning } from "../app/guided/field-plan.ts";
import { confirmationConstraints } from "../app/semantic-context.ts";
import { runRealityCheck, type RealityCheckReport } from "../verification/reality-check.ts";
import { evaluateMapping } from "./evaluate.ts";
import { buildSemanticContract } from "../semantics/observe.ts";
import { verifySemantics, type SemanticReport } from "../semantics/verify.ts";
import { privateTermsInBody } from "./ai-value-live.ts";

/* ------------------------------------------------------------------ */
/* Scenario format (tests/fixtures/eval-18b/README.md)                 */
/* ------------------------------------------------------------------ */

export type GtTransform = "copy" | "trim" | "normalize_email" | "parse_date" | "map_enum" | "concat" | "none";
export type SourceDateFormat = "YYYY-MM-DD" | "ISO-8601" | "DD/MM/YYYY" | "MM/DD/YYYY";

export interface GroundTruthEntry {
  source: string | null;
  sources?: string[];
  transform: GtTransform;
  dateFormat?: SourceDateFormat;
  separator?: string;
  categoryMap?: Record<string, string | null>;
}

export interface Eval18bScenario {
  scenarioId: string;
  split: "dev" | "holdout";
  completable: boolean;
  records: Record<string, unknown>[];
  destination: Record<string, unknown>;
  groundTruth: Record<string, GroundTruthEntry>;
}

export type Config18b = "P0" | "P2";

/* ------------------------------------------------------------------ */
/* Building a scenario exactly like the app, and the prompt proof      */
/* ------------------------------------------------------------------ */

export interface Built18b {
  prepared: PreparedTwin;
  payload: CloudDisclosurePayload;
  canonicalJson: string;
  /** The outbound prompt text of this configuration (what the request body carries as its text part). */
  prompt: string;
  promptSha256: string;
  /** The prompt the CURRENT app previews for this payload (`createDisclosurePreview`). P2 must equal it. */
  appPreviewPrompt: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The prompt text of one configuration for an approved canonical payload. */
export function promptFor(config: Config18b, canonicalJson: string, schemaVersion: CloudDisclosurePayload["schemaVersion"]): string {
  return config === "P0" ? buildCloudPromptText(canonicalJson, schemaVersion) : buildOutboundPromptText(canonicalJson, schemaVersion, "intent-plan-1");
}

/** Twin + disclosure + preview, as the app builds them (same seed, same label, concepts on). Null when the scenario cannot be built. */
export async function buildScenario(scenario: Pick<Eval18bScenario, "records" | "destination">, config: Config18b): Promise<Built18b | null> {
  const prepared = prepareTwin({ records: scenario.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts: true });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination });
  if (!draft.ok) return null;
  let preview;
  try {
    preview = await createDisclosurePreview(draft.value.payload);
  } catch {
    return null;
  }
  const prompt = promptFor(config, preview.canonicalJson, draft.value.payload.schemaVersion);
  return {
    prepared: prepared.value,
    payload: draft.value.payload,
    canonicalJson: preview.canonicalJson,
    prompt,
    promptSha256: await sha256Hex(prompt),
    appPreviewPrompt: preview.outboundPrompt,
  };
}

/**
 * Reconstruction proof without a request: P2 equals the prompt this app
 * previews and starts with the v5 instructions; P0 equals the frozen Sprint 3
 * text; and a second build is byte-identical (deterministic twin).
 */
export async function proveReconstruction(scenario: Pick<Eval18bScenario, "records" | "destination">, config: Config18b): Promise<boolean> {
  const first = await buildScenario(scenario, config);
  const second = await buildScenario(scenario, config);
  if (!first || !second || first.promptSha256 !== second.promptSha256) return false;
  if (config === "P2") return first.prompt === first.appPreviewPrompt && first.prompt === buildIntentPlanPromptText(first.canonicalJson);
  return first.prompt === buildCloudPromptText(first.canonicalJson, first.payload.schemaVersion);
}

/** The request body the live harness scans (Firebase AI Logic shape), for the zero-request privacy pre-scan. */
export function requestBodyFor(prompt: string): string {
  return JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
}

export function prescanPrivacy(built: Built18b, scenario: Pick<Eval18bScenario, "records" | "destination">): number {
  return privateTermsInBody(requestBodyFor(built.prompt), scenario).length;
}

/* ------------------------------------------------------------------ */
/* Target classes                                                      */
/* ------------------------------------------------------------------ */

export type TargetClass = "null" | "category" | "mappable";

/** Ground-truth local source paths of a target: one path, the concat set, or null. */
export function gtPaths(entry: GroundTruthEntry): string[] | null {
  if (entry.transform === "concat" && entry.sources && entry.sources.length > 0) return [...entry.sources];
  return entry.source === null ? null : [entry.source];
}

/**
 * Scoring choice (fixed before any run): "mappable" = a ground-truth source
 * exists (one path, or the concat set) and the target is not a category
 * target. A category target = a destination enum fed by a category field
 * (ground-truth transform map_enum, with a categoryMap). Concat targets are
 * mappable: they have ground-truth sources.
 */
export function classifyTarget(entry: GroundTruthEntry): TargetClass {
  if (gtPaths(entry) === null) return "null";
  if (entry.transform === "map_enum") return "category";
  return "mappable";
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/** A correspondence (local paths, or null for none) is correct against the ground truth. Concat: set equality. */
export function correspondenceCorrect(paths: readonly string[] | null, entry: GroundTruthEntry): boolean {
  const truth = gtPaths(entry);
  if (truth === null) return paths === null || paths.length === 0;
  if (!paths || paths.length === 0) return false;
  return entry.transform === "concat" ? sameSet(paths, truth) : paths.length === 1 && paths[0] === truth[0];
}

/* ------------------------------------------------------------------ */
/* Correspondence extraction                                           */
/* ------------------------------------------------------------------ */

/** One target's correspondence: resolved local paths, or null (none). `question` = multi-candidate field-meaning. */
export interface Correspondence {
  paths: string[] | null;
  /** P2: a field-meaning entry listing more than one candidate. Never correct. */
  question: boolean;
}

interface RawOp {
  op?: unknown;
  from?: unknown;
  to?: unknown;
  params?: { unmapped?: unknown; map?: unknown };
}

const resolvePaths = (aliases: readonly string[], prepared: PreparedTwin): string[] =>
  aliases.map((alias) => prepared.twin.bindings.resolve(alias) ?? `<unresolved:${alias}>`);

/**
 * P0: the source alias(es) of the SINGLE operation that writes the target.
 * A default_if_missing without `from` is no correspondence. Two or more
 * writers: no single correspondence (scored as an incorrect correspondence).
 */
export function p0Correspondences(operations: readonly RawOp[], targets: readonly string[], prepared: PreparedTwin): Map<string, Correspondence & { writers: number }> {
  const out = new Map<string, Correspondence & { writers: number }>();
  for (const target of targets) {
    const writers = operations.filter((op) => op.to === target && !(op.op === "default_if_missing" && op.from === undefined));
    if (writers.length !== 1) {
      out.set(target, { paths: writers.length === 0 ? null : ["<multiple writers>"], question: false, writers: writers.length });
      continue;
    }
    const from = writers[0]!.from;
    const aliases = Array.isArray(from) ? from.filter((item): item is string => typeof item === "string") : typeof from === "string" ? [from] : [];
    out.set(target, { paths: aliases.length === 0 ? null : resolvePaths(aliases, prepared), question: false, writers: 1 });
  }
  return out;
}

/**
 * P2: the `from` of the target's plan entry when the validator kept the
 * correspondence (accepted / correspondence-only) and the status is not
 * no_source. A field-meaning entry with more than one candidate is a question.
 */
export function p2Correspondences(validated: ValidatedIntentPlan, targets: readonly string[], prepared: PreparedTwin): Map<string, Correspondence> {
  const out = new Map<string, Correspondence>();
  for (const target of targets) {
    const kept = validated.entries.find((item) => item.entry.target === target && item.verdict !== "rejected");
    if (!kept || kept.entry.status === "no_source" || kept.entry.from.length === 0) {
      out.set(target, { paths: null, question: false });
      continue;
    }
    const question = kept.entry.missing.includes("field-meaning") && kept.entry.from.length > 1;
    out.set(target, { paths: resolvePaths(kept.entry.from, prepared), question });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ground-truth mapping and expected outputs                           */
/* ------------------------------------------------------------------ */

/** The ground-truth Mapping Contract (local paths), in destination order. Fields without a source are not written. */
export function groundTruthContract(scenario: Pick<Eval18bScenario, "groundTruth">): MappingContract {
  const operations: MappingOperation[] = [];
  for (const [to, entry] of Object.entries(scenario.groundTruth)) {
    switch (entry.transform) {
      case "copy":
      case "trim":
      case "normalize_email":
        if (entry.source) operations.push({ op: entry.transform, from: entry.source, to });
        break;
      case "parse_date":
        if (entry.source && entry.dateFormat) operations.push({ op: "parse_date", from: entry.source, to, params: { inputFormat: entry.dateFormat } });
        break;
      case "map_enum": {
        if (!entry.source) break;
        const map: Record<string, string> = {};
        for (const [label, value] of Object.entries(entry.categoryMap ?? {})) if (value !== null) map[label] = value;
        operations.push({ op: "map_enum", from: entry.source, to, params: { map, unmapped: "fail" } });
        break;
      }
      case "concat":
        if (entry.sources && entry.sources.length >= 2) operations.push({ op: "concat", from: [...entry.sources], to, params: { separator: entry.separator ?? " " } });
        break;
      case "none":
        break;
    }
  }
  const contract: MappingContract = {
    contractKind: "mapping",
    schemaVersion: "1.0.0",
    mappingId: "eval-18b-ground-truth",
    mappingVersion: "1",
    phantomId: "ground-truth",
    destinationSchemaId: "approved-target",
    operations,
  };
  if (!validateContract(contract).valid) throw new Error("groundTruthContract: the ground-truth contract is invalid.");
  return contract;
}

/**
 * Expected handling of each record, computed by running the ground-truth
 * contract through the same engine:
 *   transform  the engine produced this output
 *   quarantine the engine refused it ONLY for a set-aside category label (null in the categoryMap)
 *   fail       the engine cannot transform it under the correct mapping (e.g. a required field with no source)
 */
export type Expected18b = { kind: "transform"; output: Record<string, unknown> } | { kind: "quarantine" } | { kind: "fail" };

export function expectedOutcomes(scenario: Pick<Eval18bScenario, "groundTruth" | "records" | "destination">): Expected18b[] {
  const report = runRealityCheck({ records: scenario.records, mappingContract: groundTruthContract(scenario), targetSchema: scenario.destination, bindings: null });
  return report.rows.map((row) => {
    if (row.status === "pass" && row.output) return { kind: "transform", output: row.output };
    if (row.localIssues.length > 0 && row.localIssues.every((issue) => issue.code === "UNMAPPED_ENUM")) return { kind: "quarantine" };
    return { kind: "fail" };
  });
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item));

/* ------------------------------------------------------------------ */
/* End-to-end run of an executable mapping                             */
/* ------------------------------------------------------------------ */

export interface EndToEnd {
  /** Every required destination field is written (P2: compiled.complete). */
  complete: boolean;
  /** An executable contract existed and ran. */
  ran: boolean;
  records: number;
  /** Records output as transformed (any engine output, including policy-rejected ones). */
  transformed: number;
  /** Transformed records whose output differs from the expected output (or should not have been transformed). */
  incorrectTransformed: number;
  /** Records handled as expected: equal output, correctly held for review, or correctly not transformed. */
  recordsOk: number;
  quarantined: number;
  quarantinedCorrect: number;
  unresolved: number;
  rejectedByPolicy: number;
  semanticMismatch: boolean;
  semanticOverall: SemanticReport["overall"] | null;
}

const NOT_RUN = (complete: boolean, records: number): EndToEnd => ({
  complete,
  ran: false,
  records,
  transformed: 0,
  incorrectTransformed: 0,
  recordsOk: 0,
  quarantined: 0,
  quarantinedCorrect: 0,
  unresolved: 0,
  rejectedByPolicy: 0,
  semanticMismatch: false,
  semanticOverall: null,
});

/** Run a resolved executable contract like the app: engine + acceptance policy + semantic verifier. */
export function runEndToEnd(input: {
  scenario: Pick<Eval18bScenario, "records" | "destination">;
  executable: MappingContract;
  prepared: PreparedTwin;
  answers: PlanAnswers;
  complete: boolean;
  expected: readonly Expected18b[];
}): EndToEnd {
  const { scenario, executable, prepared, answers, expected } = input;
  const policy = guidedPolicy(answers.categoryMeanings as Record<string, CategoryMeaning>);
  const evaluation = evaluateMapping({ executable, targetSchema: scenario.destination, bindings: prepared.twin.bindings, records: scenario.records, policy });
  const report: RealityCheckReport = evaluation.report;
  let transformed = 0;
  let incorrectTransformed = 0;
  let recordsOk = 0;
  let quarantined = 0;
  let quarantinedCorrect = 0;
  let unresolved = 0;
  let rejectedByPolicy = 0;
  evaluation.rows.forEach((row, index) => {
    const output = report.rows[index]?.output ?? null;
    const want = expected[row.index] ?? { kind: "fail" };
    if (row.outcome === "QUARANTINED") quarantined += 1;
    if (row.outcome === "UNRESOLVED") unresolved += 1;
    if (row.outcome === "REJECTED_BY_POLICY") rejectedByPolicy += 1;
    const produced = report.rows[index]?.status === "pass" && output !== null;
    if (produced) {
      transformed += 1;
      const ok = row.outcome !== "REJECTED_BY_POLICY" && want.kind === "transform" && canonical(output) === canonical(want.output);
      if (ok) recordsOk += 1;
      else incorrectTransformed += 1;
      return;
    }
    if (want.kind === "quarantine" && row.outcome === "QUARANTINED") {
      quarantinedCorrect += 1;
      recordsOk += 1;
    } else if (want.kind === "fail") {
      // The correct mapping cannot transform it either; not transforming it is correct.
      recordsOk += 1;
    }
  });
  const destinationText = JSON.stringify(scenario.destination);
  const contract = buildSemanticContract({
    contractId: "eval-18b-semantics",
    declared: [
      ...confirmationConstraints(answers.semanticConfirmations as Record<string, "MM/DD/YYYY" | "DD/MM/YYYY">),
      ...meaningConstraints(answers.categoryMeanings as Record<string, CategoryMeaning>, destinationText, prepared.profile.fields.map((field) => field.path)),
    ],
    profile: prepared.profile,
    records: scenario.records,
  });
  const semantic = verifySemantics({ contract, executable, report, records: scenario.records, destinationSchema: scenario.destination });
  const semanticMismatch = semantic.fields.some((field) => field.status === "SEMANTIC_MISMATCH" || field.status === "SEMANTIC_POLICY_CONFLICT");
  return {
    complete: input.complete,
    ran: true,
    records: report.rows.length,
    transformed,
    incorrectTransformed,
    recordsOk,
    quarantined,
    quarantinedCorrect,
    unresolved,
    rejectedByPolicy,
    semanticMismatch,
    semanticOverall: semantic.overall,
  };
}

/** E1 for one answer: complete, every record handled as expected, no semantic mismatch. */
export function endToEndSuccess(e2e: EndToEnd): boolean {
  return e2e.ran && e2e.complete && e2e.records > 0 && e2e.recordsOk === e2e.records && !e2e.semanticMismatch;
}

/* ------------------------------------------------------------------ */
/* Oracle user (P2)                                                    */
/* ------------------------------------------------------------------ */

export const ORACLE_MAX_ROUNDS = 5;

export interface OracleRun {
  compiled: CompiledIntegration;
  answers: PlanAnswers;
  /** Every clarification the app asked, across rounds (unique ids). */
  asked: Clarification[];
  answered: number;
  rounds: number;
}

const SLASH = new Set(["MM/DD/YYYY", "DD/MM/YYYY"]);

/**
 * The oracle answers one clarification truthfully from the ground truth, or
 * returns null when it cannot.
 *
 * Scoring choice (fixed before any run): the oracle never corrects a confident
 * wrong correspondence. A translate-categories or confirm-date-order question
 * about a source field that is NOT the ground-truth source cannot be answered
 * truthfully (the ground truth describes a different field), so it stays
 * unanswered. A choose-field answer is the ground-truth source path when it is
 * a field of the data, otherwise "no field" (null), as pre-registered; a
 * concat target has no single source, so its choose-field answer is "no field".
 */
export function oracleAnswer(
  clarification: Clarification,
  scenario: Pick<Eval18bScenario, "groundTruth" | "records">,
  prepared: PreparedTwin,
): { fieldMatch?: [string, string | null]; categoryMeaning?: [string, CategoryMeaning]; dateOrder?: [string, "MM/DD/YYYY" | "DD/MM/YYYY"] } | null {
  const truth = scenario.groundTruth[clarification.target];
  if (!truth) return null;
  const profile = (path: string): FieldProfile | undefined => prepared.profile.fields.find((field) => field.path === path);
  switch (clarification.kind) {
    case "choose-field": {
      const source = truth.transform === "concat" ? null : truth.source;
      return { fieldMatch: [clarification.target, source !== null && profile(source) ? source : null] };
    }
    case "translate-categories": {
      const path = clarification.localPaths.length === 1 ? clarification.localPaths[0]! : null;
      if (!path || path !== truth.source || !truth.categoryMap) return null;
      const field = profile(path);
      const labels = field ? distinctLabels(scenario.records, field) : null;
      if (!labels) return null;
      const map = truth.categoryMap;
      const values: Record<string, string | null> = {};
      for (const { value } of labels) values[value] = Object.hasOwn(map, value) ? (map[value] ?? null) : null;
      return { categoryMeaning: [clarification.target, { source: path, values }] };
    }
    case "confirm-date-order": {
      const path = clarification.localPaths.length === 1 ? clarification.localPaths[0]! : null;
      if (!path || path !== truth.source || !truth.dateFormat || !SLASH.has(truth.dateFormat)) return null;
      return { dateOrder: [path, truth.dateFormat as "MM/DD/YYYY" | "DD/MM/YYYY"] };
    }
    case "missing-required-source":
      return null;
  }
}

/** Compile ↔ oracle answers until no new answerable question (bounded). */
export function runOracle(base: Omit<CompileInput, "answers">, scenario: Pick<Eval18bScenario, "groundTruth" | "records">): OracleRun {
  const fieldMatches: Record<string, string | null> = {};
  const categoryMeanings: Record<string, CategoryMeaning> = {};
  const semanticConfirmations: Record<string, "MM/DD/YYYY" | "DD/MM/YYYY"> = {};
  const answers = (): PlanAnswers => ({ fieldMatches: { ...fieldMatches }, categoryMeanings: { ...categoryMeanings }, semanticConfirmations: { ...semanticConfirmations } });
  const asked = new Map<string, Clarification>();
  const done = new Set<string>();
  let answered = 0;
  let rounds = 0;
  let compiled = compileIntentPlan({ ...base, answers: answers() });
  for (; rounds < ORACLE_MAX_ROUNDS; rounds += 1) {
    let progressed = false;
    for (const clarification of compiled.clarifications) {
      if (!asked.has(clarification.id)) asked.set(clarification.id, clarification);
      if (done.has(clarification.id)) continue;
      done.add(clarification.id);
      const answer = oracleAnswer(clarification, scenario, base.prepared);
      if (!answer) continue;
      if (answer.fieldMatch) fieldMatches[answer.fieldMatch[0]] = answer.fieldMatch[1];
      if (answer.categoryMeaning) categoryMeanings[answer.categoryMeaning[0]] = answer.categoryMeaning[1];
      if (answer.dateOrder) semanticConfirmations[answer.dateOrder[0]] = answer.dateOrder[1];
      answered += 1;
      progressed = true;
    }
    if (!progressed) break;
    compiled = compileIntentPlan({ ...base, answers: answers() });
  }
  // Questions of the final compilation count as asked too.
  for (const clarification of compiled.clarifications) if (!asked.has(clarification.id)) asked.set(clarification.id, clarification);
  return { compiled, answers: answers(), asked: [...asked.values()], answered, rounds };
}

/* ------------------------------------------------------------------ */
/* Manual mapping effort                                               */
/* ------------------------------------------------------------------ */

export interface Effort {
  /** Field choices only (manual mapping operations). */
  manualOps: number;
  /** Every clarification answer (manual ops + translations + date orders). */
  allAnswers: number;
}

/**
 * Baseline guided flow (1e9de92, Sprint 16B rules): one decision per
 * destination field with a ground-truth source, one per enum (category)
 * target, one per date target whose source order the data does not prove.
 */
export function baselineEffort(scenario: Pick<Eval18bScenario, "groundTruth">, prepared: PreparedTwin): Effort {
  let manualOps = 0;
  let translations = 0;
  let dates = 0;
  for (const entry of Object.values(scenario.groundTruth)) {
    if (gtPaths(entry) === null) continue;
    manualOps += 1;
    if (entry.transform === "map_enum") translations += 1;
    if (entry.transform === "parse_date" && entry.source) {
      const field = prepared.profile.fields.find((item) => item.path === entry.source);
      const proven = field?.dateFormat !== undefined && !field.dateFormatAmbiguous;
      if (!proven) dates += 1;
    }
  }
  return { manualOps, allAnswers: manualOps + translations + dates };
}

export function planEffort(asked: readonly Clarification[], scenario: Pick<Eval18bScenario, "groundTruth">): Effort & { unnecessary: number } {
  const manualOps = asked.filter((item) => item.kind === "choose-field" || item.kind === "missing-required-source").length;
  const unnecessary = asked.filter((item) => {
    const truth = scenario.groundTruth[item.target];
    return truth !== undefined && gtPaths(truth) === null;
  }).length;
  return { manualOps, allAnswers: asked.length, unnecessary };
}

/* ------------------------------------------------------------------ */
/* Scoring one answer                                                  */
/* ------------------------------------------------------------------ */

export interface AnswerScore18b {
  config: Config18b;
  trial: number;
  index: number;
  completable: boolean;
  /** A request was sent. */
  sent: boolean;
  /** HTTP 200 with a non-empty text. */
  answered: boolean;
  providerFailure: boolean;
  promptMatches: boolean | null;
  /** P0: parseable proposal JSON with an operations array. P2: the validator accepted the plan as a whole. */
  usable: boolean;
  /** P2: MALFORMED_PLAN / not JSON / wrong disclosure (whole plan rejected). */
  wholePlanRejected: boolean;
  /** P0: convertProposal + resolve accepted the proposal. */
  accepted: boolean;
  targets: number;
  correct: number;
  mappableTargets: number;
  mappableCorrect: number;
  mappableNoCorrespondence: number;
  categoryTargets: number;
  categoryCorrect: number;
  nullTargets: number;
  nullNoCorrespondence: number;
  /** M4 */
  invented: number;
  /** M5 */
  invalidEnumTranslations: number;
  /** M8 */
  incorrectUnsupported: number;
  /** M10 */
  hallucinated: number;
  e2e: EndToEnd;
  e2eSuccess: boolean;
  falseComplete: boolean;
  effort: Effort & { unnecessary: number };
  baseline: Effort;
  leakCount: number;
  ms: number;
}

export interface ScoreContext {
  config: Config18b;
  trial: number;
  index: number;
  leakCount?: number;
  ms?: number;
}

function emptyScore(scenario: Eval18bScenario, built: Built18b | null, context: ScoreContext): AnswerScore18b {
  const classes = Object.values(scenario.groundTruth).map(classifyTarget);
  const baseline = built ? baselineEffort(scenario, built.prepared) : { manualOps: 0, allAnswers: 0 };
  return {
    config: context.config,
    trial: context.trial,
    index: context.index,
    completable: scenario.completable,
    sent: false,
    answered: false,
    providerFailure: false,
    promptMatches: null,
    usable: false,
    wholePlanRejected: false,
    accepted: false,
    targets: classes.length,
    correct: 0,
    mappableTargets: classes.filter((item) => item === "mappable").length,
    mappableCorrect: 0,
    mappableNoCorrespondence: 0,
    categoryTargets: classes.filter((item) => item === "category").length,
    categoryCorrect: 0,
    nullTargets: classes.filter((item) => item === "null").length,
    nullNoCorrespondence: 0,
    invented: 0,
    invalidEnumTranslations: 0,
    incorrectUnsupported: 0,
    hallucinated: 0,
    e2e: NOT_RUN(false, scenario.records.length),
    e2eSuccess: false,
    falseComplete: false,
    // Scoring choice: an answer that yields nothing usable leaves the user with the baseline's manual work.
    effort: { ...baseline, unnecessary: 0 },
    baseline,
    leakCount: context.leakCount ?? 0,
    ms: context.ms ?? 0,
  };
}

function scoreCorrespondences(score: AnswerScore18b, scenario: Eval18bScenario, correspondences: Map<string, Correspondence>): void {
  score.correct = 0;
  score.mappableCorrect = 0;
  score.mappableNoCorrespondence = 0;
  score.categoryCorrect = 0;
  score.nullNoCorrespondence = 0;
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const found = correspondences.get(target) ?? { paths: null, question: false };
    const none = found.paths === null || found.paths.length === 0;
    const correct = !found.question && correspondenceCorrect(found.paths, truth);
    if (correct) score.correct += 1;
    const kind = classifyTarget(truth);
    if (kind === "mappable") {
      if (correct) score.mappableCorrect += 1;
      if (none) score.mappableNoCorrespondence += 1;
    } else if (kind === "category") {
      if (correct) score.categoryCorrect += 1;
    } else if (none) {
      score.nullNoCorrespondence += 1;
    }
  }
}

/** Score one recorded answer text (the request is assumed sent and proven by the caller). */
export function scoreAnswer(scenario: Eval18bScenario, built: Built18b, answerText: string, context: ScoreContext): AnswerScore18b {
  const score = emptyScore(scenario, built, context);
  score.sent = true;
  score.answered = true;
  const targets = Object.keys(scenario.groundTruth);
  const expected = expectedOutcomes(scenario);
  const enumLabels = new Map(built.payload.fields.map((field) => [field.alias, new Set(field.enumValues ?? [])]));
  const aliases = new Set(built.payload.fields.map((field) => field.alias));
  const targetNames = new Set((built.payload.target?.fields ?? []).map((field) => field.name));

  if (context.config === "P0") {
    let operations: RawOp[] | null = null;
    try {
      const parsed = JSON.parse(answerText) as { operations?: unknown };
      if (Array.isArray(parsed.operations)) operations = parsed.operations as RawOp[];
    } catch {
      operations = null;
    }
    if (!operations) return score;
    score.usable = true;
    scoreCorrespondences(score, scenario, p0Correspondences(operations, targets, built.prepared));
    for (const op of operations) {
      const froms = Array.isArray(op.from) ? op.from : op.from === undefined ? [] : [op.from];
      if (typeof op.to !== "string" || !targetNames.has(op.to) || froms.some((from) => typeof from !== "string" || !aliases.has(from))) score.hallucinated += 1;
      if (op.op === "default_if_missing" || (op.op === "map_enum" && op.params?.unmapped === "default")) score.invented += 1;
      if (op.op === "map_enum") {
        const labels = typeof op.from === "string" ? enumLabels.get(op.from) : undefined;
        const keys = op.params?.map && typeof op.params.map === "object" ? Object.keys(op.params.map as Record<string, unknown>) : [];
        if (!labels || labels.size === 0 || keys.some((key) => !labels.has(key))) score.invalidEnumTranslations += 1;
      }
    }
    const result = acceptProposal({ proposal: undefined, proposalText: answerText, disclosure: built.payload, twin: built.prepared.twin, origin: "gemini-cloud", mappingId: "eval-18b-p0" });
    score.accepted = result.ok;
    // P0 has no clarification mechanism: no question is asked; the user maps by hand what the proposal leaves out.
    score.effort = { ...score.baseline, unnecessary: 0 };
    if (!result.ok) return score;
    const executable = result.value.resolved.executable;
    const complete = unwrittenRequiredTargets(result.value.converted.contract, JSON.stringify(scenario.destination)).length === 0;
    const none: PlanAnswers = { fieldMatches: {}, categoryMeanings: {}, semanticConfirmations: {} };
    score.e2e = runEndToEnd({ scenario, executable, prepared: built.prepared, answers: none, complete, expected });
    score.e2eSuccess = scenario.completable && endToEndSuccess(score.e2e);
    score.falseComplete = !scenario.completable && complete;
    return score;
  }

  // P2
  const parsed = parseIntentPlanText(answerText);
  const validation = parsed.ok ? validateIntentPlan(parsed.value, built.payload) : parsed;
  if (!validation.ok) {
    score.wholePlanRejected = true;
    return score;
  }
  score.usable = true;
  const validated = validation.value;
  scoreCorrespondences(score, scenario, p2Correspondences(validated, targets, built.prepared));
  for (const item of validated.entries) {
    if (item.issues.some((issue) => issue.code === "UNKNOWN_ALIAS" || issue.code === "UNKNOWN_TARGET_FIELD")) score.hallucinated += 1;
    const valueMap = item.entry.valueMap;
    if (valueMap !== undefined) {
      const labels = item.entry.from.length === 1 ? enumLabels.get(item.entry.from[0]!) : undefined;
      if (!labels || labels.size === 0 || Object.keys(valueMap).some((key) => !labels.has(key))) score.invalidEnumTranslations += 1;
    }
    const truth = scenario.groundTruth[item.entry.target];
    if (truth && truth.transform !== "none" && item.entry.status === "unsupported" && item.verdict !== "rejected") score.incorrectUnsupported += 1;
  }
  const base: Omit<CompileInput, "answers"> = {
    validated,
    disclosure: built.payload,
    prepared: built.prepared,
    records: scenario.records,
    requestId: `eval18b-${context.config}-${context.trial}-${context.index}`,
    origin: "gemini-cloud",
  };
  const oracle = runOracle(base, scenario);
  const compiled = oracle.compiled;
  const disclosed = (alias: string) => enumLabels.get(alias) ?? new Set<string>();
  for (const [position, operation] of (compiled.aliasContract?.operations ?? []).entries()) {
    void position;
    if (operation.op === "default_if_missing") score.invented += 1;
    else if (operation.op === "map_enum") {
      if (operation.params.unmapped === "default") score.invented += 1;
      const field = compiled.fields.find((item) => item.target === operation.to);
      // A Gemini-authored translation may only use disclosed labels; the user's own translation is the user's value.
      if (field?.operationOrigin === "gemini" && Object.keys(operation.params.map).some((key) => !disclosed(operation.from).has(key))) score.invented += 1;
    }
  }
  score.effort = planEffort(oracle.asked, scenario);
  score.falseComplete = !scenario.completable && compiled.complete;
  const accepted = acceptCompiledPlan(compiled, { ...base, answers: oracle.answers });
  score.accepted = accepted.ok;
  if (accepted.ok) {
    score.e2e = runEndToEnd({ scenario, executable: accepted.value.resolved.executable, prepared: built.prepared, answers: oracle.answers, complete: compiled.complete, expected });
    score.e2eSuccess = scenario.completable && endToEndSuccess(score.e2e);
  } else {
    score.e2e = NOT_RUN(compiled.complete, scenario.records.length);
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* Live entries                                                         */
/* ------------------------------------------------------------------ */

/** One recorded live (or dry) request, as written by tests/live/ai-value.spec.ts set "b". Alias-level only. */
export interface LiveEntry18b {
  config: Config18b;
  trial: number;
  index: number;
  requests: number;
  leakCount: number;
  previewSha256?: string;
  promptSha256: string[];
  httpStatus: number[];
  answers: string[];
  harnessError?: string;
  cloudError?: boolean;
  proposalStatus?: string | null;
  origin?: string | null;
  provenance?: string | null;
  ms: number;
}

export async function scoreLiveEntry(entry: LiveEntry18b, scenario: Eval18bScenario): Promise<AnswerScore18b> {
  const built = await buildScenario(scenario, entry.config);
  const context: ScoreContext = { config: entry.config, trial: entry.trial, index: entry.index, leakCount: entry.leakCount, ms: entry.ms };
  const score = emptyScore(scenario, built, context);
  if (entry.requests === 0 || !built) return score;
  score.sent = true;
  score.promptMatches = entry.promptSha256.length === 1 && entry.promptSha256[0] === built.promptSha256 && entry.previewSha256 === built.promptSha256;
  const answer = entry.answers[0];
  const ok = entry.httpStatus[0] === 200 && typeof answer === "string" && answer.length > 0 && !answer.startsWith("<unreadable");
  if (!ok) {
    score.providerFailure = true;
    return score;
  }
  const scored = scoreAnswer(scenario, built, answer, context);
  return { ...scored, promptMatches: score.promptMatches };
}

/** Offline re-scan of a recorded request: the hash-proven reconstructed prompt. Null when nothing was sent. */
export async function rescanEntry18b(entry: LiveEntry18b, scenario: Eval18bScenario): Promise<number | null> {
  if (entry.requests === 0) return null;
  const built = await buildScenario(scenario, entry.config);
  return built ? prescanPrivacy(built, scenario) : null;
}

/* ------------------------------------------------------------------ */
/* Aggregates and the pre-registered verdict                           */
/* ------------------------------------------------------------------ */

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const round = (value: number) => Math.round(value * 1000) / 1000;

export interface Summary18b {
  requests: number;
  answered: number;
  providerFailures: number;
  wholePlanRejections: number;
  promptMismatches: number;
  harnessLeakMatches: number;
  M1_correctAll: number;
  M2_correctMappable: number;
  M3_categoryCorrect: number;
  M4_invented: number;
  M5_invalidEnumTranslations: number;
  M6_unnecessaryAbstention: number;
  M7_appropriateAbstention: number;
  M8_incorrectUnsupported: number;
  M9_rejectionsAndFailures: number;
  M10_hallucinated: number;
  E1_success: number;
  E1_completableAnswers: number;
  E2_incorrectTransformed: number;
  E2_transformedRecords: number;
  E3_falseCompletes: number;
  E4: {
    quarantined: number;
    quarantinedCorrect: number;
    unresolved: number;
    rejectedByPolicy: number;
    semanticOverall: Record<string, number>;
  };
  U1_manualOpsMean: number;
  U2_allAnswersMean: number;
  U2_unnecessaryQuestions: number;
  baselineManualOpsMean: number;
  baselineAllAnswersMean: number;
  medianMs: number | null;
}

export function summarize18b(scores: readonly AnswerScore18b[]): Summary18b {
  const sent = scores.filter((score) => score.sent);
  const answered = sent.filter((score) => score.answered);
  const usable = answered.filter((score) => score.usable);
  const sum = (rows: readonly AnswerScore18b[], pick: (row: AnswerScore18b) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const completable = sent.filter((score) => score.completable);
  const times = sent.map((score) => score.ms).sort((a, b) => a - b);
  const semanticOverall: Record<string, number> = {};
  for (const score of sent) {
    const key = score.e2e.semanticOverall ?? "not-run";
    semanticOverall[key] = (semanticOverall[key] ?? 0) + 1;
  }
  return {
    requests: sent.length,
    answered: answered.length,
    providerFailures: sent.filter((score) => score.providerFailure).length,
    wholePlanRejections: answered.filter((score) => score.wholePlanRejected).length,
    promptMismatches: sent.filter((score) => score.promptMatches === false).length,
    harnessLeakMatches: sum(scores, (row) => row.leakCount),
    // M1–M3 over every sent request: a failed or unusable answer contributes its targets with 0 correct.
    M1_correctAll: round(ratio(sum(sent, (row) => row.correct), sum(sent, (row) => row.targets))),
    M2_correctMappable: round(ratio(sum(sent, (row) => row.mappableCorrect), sum(sent, (row) => row.mappableTargets))),
    M3_categoryCorrect: round(ratio(sum(sent, (row) => row.categoryCorrect), sum(sent, (row) => row.categoryTargets))),
    M4_invented: sum(usable, (row) => row.invented),
    M5_invalidEnumTranslations: sum(usable, (row) => row.invalidEnumTranslations),
    // M6/M7 over usable answers (as 18A.5 W/N); failures and rejections are counted in M9.
    M6_unnecessaryAbstention: round(ratio(sum(usable, (row) => row.mappableNoCorrespondence), sum(usable, (row) => row.mappableTargets))),
    M7_appropriateAbstention: round(ratio(sum(usable, (row) => row.nullNoCorrespondence), sum(usable, (row) => row.nullTargets))),
    M8_incorrectUnsupported: sum(usable, (row) => row.incorrectUnsupported),
    M9_rejectionsAndFailures: round(ratio(sent.filter((row) => row.providerFailure || row.wholePlanRejected).length, sent.length)),
    M10_hallucinated: sum(usable, (row) => row.hallucinated),
    E1_success: round(ratio(completable.filter((row) => row.e2eSuccess).length, completable.length)),
    E1_completableAnswers: completable.length,
    E2_incorrectTransformed: round(ratio(sum(sent, (row) => row.e2e.incorrectTransformed), sum(sent, (row) => row.e2e.transformed))),
    E2_transformedRecords: sum(sent, (row) => row.e2e.transformed),
    E3_falseCompletes: sent.filter((row) => row.falseComplete).length,
    E4: {
      quarantined: sum(sent, (row) => row.e2e.quarantined),
      quarantinedCorrect: sum(sent, (row) => row.e2e.quarantinedCorrect),
      unresolved: sum(sent, (row) => row.e2e.unresolved),
      rejectedByPolicy: sum(sent, (row) => row.e2e.rejectedByPolicy),
      semanticOverall,
    },
    U1_manualOpsMean: round(ratio(sum(sent, (row) => row.effort.manualOps), sent.length)),
    U2_allAnswersMean: round(ratio(sum(sent, (row) => row.effort.allAnswers), sent.length)),
    U2_unnecessaryQuestions: sum(sent, (row) => row.effort.unnecessary),
    baselineManualOpsMean: round(ratio(sum(sent, (row) => row.baseline.manualOps), sent.length)),
    baselineAllAnswersMean: round(ratio(sum(sent, (row) => row.baseline.allAnswers), sent.length)),
    medianMs: times.length === 0 ? null : times[Math.floor(times.length / 2)]!,
  };
}

export interface Verdict18b {
  M1: boolean;
  M2: boolean;
  M3: boolean;
  M4: boolean;
  M5: boolean;
  M6: boolean;
  M9: boolean;
  M10: boolean;
  E1: boolean;
  E2: boolean;
  E3: boolean;
  U1: boolean;
  S1: boolean;
  S2: boolean;
  gateBAI: boolean;
}

/**
 * The pre-registered bold conditions. Ratios compare the rounded (3-decimal)
 * summary values. U1 compares P2's mean manual mapping operations with the
 * baseline guided flow's mean on the same scenarios. S2 also requires every
 * planned request to have been sent and proven (`expectedRequests`).
 */
export function verdict18b(input: { p0: Summary18b; p2: Summary18b; sourceDerivedFindings: number; expectedRequests?: number }): Verdict18b {
  const { p0, p2 } = input;
  const sentAll = input.expectedRequests === undefined || p0.requests + p2.requests === input.expectedRequests;
  const verdict = {
    M1: p2.M1_correctAll >= p0.M1_correctAll,
    M2: p2.M2_correctMappable >= round(p0.M2_correctMappable - 0.05),
    M3: p2.M3_categoryCorrect >= 0.6,
    M4: p2.M4_invented === 0,
    M5: p2.M5_invalidEnumTranslations <= 0.25 * p0.M5_invalidEnumTranslations,
    M6: p2.M6_unnecessaryAbstention <= 0.15,
    M9: p2.M9_rejectionsAndFailures <= 0.1,
    M10: p2.M10_hallucinated <= p0.M10_hallucinated,
    E1: p2.E1_completableAnswers > 0 && p2.E1_success >= 0.5,
    E2: p2.E2_incorrectTransformed <= 0.05,
    E3: p2.E3_falseCompletes === 0,
    U1: p2.requests > 0 && p2.U1_manualOpsMean <= 0.5 * p2.baselineManualOpsMean,
    S1: input.sourceDerivedFindings === 0,
    S2: p0.promptMismatches + p2.promptMismatches === 0 && sentAll,
  };
  return { ...verdict, gateBAI: Object.values(verdict).every(Boolean) };
}

/** Holdout-safe per-answer row: index, config, trial and numbers only. */
export function indexRow(score: AnswerScore18b): Record<string, number | string | boolean | null> {
  return {
    config: score.config,
    trial: score.trial,
    index: score.index,
    sent: score.sent,
    promptMatches: score.promptMatches,
    providerFailure: score.providerFailure,
    wholePlanRejected: score.wholePlanRejected,
    correct: score.correct,
    targets: score.targets,
    mappableCorrect: score.mappableCorrect,
    mappableTargets: score.mappableTargets,
    categoryCorrect: score.categoryCorrect,
    categoryTargets: score.categoryTargets,
    invented: score.invented,
    complete: score.e2e.complete,
    e2eSuccess: score.e2eSuccess,
    falseComplete: score.falseComplete,
    transformed: score.e2e.transformed,
    incorrectTransformed: score.e2e.incorrectTransformed,
    manualOps: score.effort.manualOps,
    allAnswers: score.effort.allAnswers,
    baselineManualOps: score.baseline.manualOps,
    ms: score.ms,
  };
}
