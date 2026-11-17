/**
 * Sprint 18C frozen scorer (docs/evaluation/sprint-18c-reliability.md, EVAL-200+).
 *
 * Pure and offline: nothing here sends, approves or calls a model.
 *
 *   P0  the Sprint 18B architecture before its corrective changes
 *       (cb26d64): intent plan prompt v5, token-only category profile,
 *       pre-18C lexicon. Rebuilt here with `labelCategories: false`.
 *   P1  the Sprint 18C candidate: the same prompt and decoder schema,
 *       real-world category labels, category groupings, ADR 0019 engine.
 *
 * Both configurations answer Integration Intent Plans, so both are scored by
 * the same plan path. Reused from the frozen 18B scorer (unchanged): the
 * ground-truth contract, expected outcomes, correspondence rules, the
 * translate / date oracle answers and the effort rules.
 *
 * Scoring choices fixed before any run (search "Scoring choice"):
 *   - Both configurations are EXECUTED by this tree's engine (ADR 0019). P0
 *     therefore also gets the optional-absent fix: the comparison isolates
 *     planning and is conservative against P1.
 *   - Expected outputs come from the ground truth through the engine, and the
 *     author's hand-written `expectedSamples` are checked against them
 *     (`sampleMismatches`) before any live run.
 *
 * Holdout use: functions return numbers and booleans; rows carry indexes only.
 */
import type { CloudDisclosurePayload, MappingContract } from "../domain/contracts/types.ts";
import type { FieldProfile } from "../domain/profile/profile.ts";
import { DEFAULT_TWIN_SEED } from "../phantom/generate.ts";
import { buildIntentPlanPromptText } from "../inference/intent-prompt.ts";
import { buildOutboundPromptText, createDisclosurePreview } from "../twin/authorization.ts";
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../workflow/pipeline.ts";
import { parseIntentPlanText, validateIntentPlan } from "../plan/validate.ts";
import { acceptCompiledPlan, compileIntentPlan, type CompileInput } from "../plan/compile.ts";
import type { Clarification, CompiledIntegration, PlanAnswers } from "../plan/types.ts";
import { guidedPolicy, meaningConstraints, type CategoryMeaning } from "../app/guided/field-plan.ts";
import { confirmationConstraints } from "../app/semantic-context.ts";
import { evaluateMapping } from "./evaluate.ts";
import { buildSemanticContract } from "../semantics/observe.ts";
import { verifySemantics } from "../semantics/verify.ts";
import {
  baselineEffort,
  classifyTarget,
  correspondenceCorrect,
  expectedOutcomes,
  oracleAnswer,
  ORACLE_MAX_ROUNDS,
  p2Correspondences,
  planEffort,
  prescanPrivacy,
  sha256Hex,
  type Built18b,
  type Effort,
  type Eval18bScenario,
  type Expected18b,
} from "./eval-18b.ts";

export type Config18c = "P0" | "P1";

export interface ExpectedSample {
  recordIndex: number;
  outcome: "transformed" | "held";
  output?: Record<string, unknown>;
}

export interface Eval18cScenario extends Eval18bScenario {
  expectedSamples?: ExpectedSample[];
}

/* ------------------------------------------------------------------ */
/* Building a scenario like the app (and like the P0 app)              */
/* ------------------------------------------------------------------ */

export async function buildScenario18c(scenario: Pick<Eval18cScenario, "records" | "destination">, config: Config18c): Promise<Built18b | null> {
  const prepared = prepareTwin({
    records: scenario.records,
    datasetLabel: "imported.json",
    seed: DEFAULT_TWIN_SEED,
    concepts: true,
    // P0 = cb26d64: token-only categories, pre-18B descriptor, pre-18C lexicon.
    ...(config === "P0" ? { labelCategories: false } : {}),
  });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination });
  if (!draft.ok) return null;
  let preview;
  try {
    preview = await createDisclosurePreview(draft.value.payload);
  } catch {
    return null;
  }
  const prompt = buildOutboundPromptText(preview.canonicalJson, draft.value.payload.schemaVersion, "intent-plan-1");
  return {
    prepared: prepared.value,
    payload: draft.value.payload,
    canonicalJson: preview.canonicalJson,
    prompt,
    promptSha256: await sha256Hex(prompt),
    appPreviewPrompt: preview.outboundPrompt,
  };
}

/** P1 equals what this app previews; both are deterministic and start with the v5 instructions. */
export async function proveReconstruction18c(scenario: Pick<Eval18cScenario, "records" | "destination">, config: Config18c): Promise<boolean> {
  const first = await buildScenario18c(scenario, config);
  const second = await buildScenario18c(scenario, config);
  if (!first || !second || first.promptSha256 !== second.promptSha256) return false;
  if (first.prompt !== buildIntentPlanPromptText(first.canonicalJson)) return false;
  return config === "P0" || first.prompt === first.appPreviewPrompt;
}

export { prescanPrivacy };

/* ------------------------------------------------------------------ */
/* Ground-truth integrity: the author's hand-written samples           */
/* ------------------------------------------------------------------ */

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item,
  );

/** Samples whose hand-written outcome disagrees with the engine run of the ground truth. A count only. */
export function sampleMismatches(scenario: Eval18cScenario): number {
  if (!scenario.expectedSamples || !scenario.completable) return 0;
  const expected = expectedOutcomes(scenario);
  let mismatches = 0;
  for (const sample of scenario.expectedSamples) {
    const engine = expected[sample.recordIndex];
    if (!engine) mismatches += 1;
    else if (sample.outcome === "held") mismatches += engine.kind === "transform" ? 1 : 0;
    else mismatches += engine.kind === "transform" && canonical(engine.output) === canonical(sample.output ?? null) ? 0 : 1;
  }
  return mismatches;
}

/* ------------------------------------------------------------------ */
/* Oracle user                                                         */
/* ------------------------------------------------------------------ */

/**
 * Scoring choice: the oracle answers what the guided flow asks, truthfully from
 * the ground truth, as 18B did, with one change. A `missing-required-source`
 * question offers a field picker that lists every usable field ("Choose another
 * field", Sprint 18C), so the oracle picks the ground-truth source when it is a
 * single usable field of the data. A concat target cannot be chosen as one
 * field and stays unanswered. The oracle never corrects a confident wrong
 * correspondence it was not asked about.
 */
export function oracleAnswer18c(clarification: Clarification, scenario: Pick<Eval18cScenario, "groundTruth" | "records">, prepared: PreparedTwin): ReturnType<typeof oracleAnswer> {
  if (clarification.kind !== "missing-required-source") return oracleAnswer(clarification, scenario, prepared);
  const truth = scenario.groundTruth[clarification.target];
  if (!truth || truth.transform === "concat" || truth.source === null) return null;
  const field: FieldProfile | undefined = prepared.profile.fields.find((item) => item.path === truth.source);
  return field && field.type !== "unsupported" ? { fieldMatch: [clarification.target, truth.source] } : null;
}

export interface OracleRun18c {
  compiled: CompiledIntegration;
  answers: PlanAnswers;
  asked: Clarification[];
  answered: number;
}

export function runOracle18c(base: Omit<CompileInput, "answers">, scenario: Pick<Eval18cScenario, "groundTruth" | "records">): OracleRun18c {
  const fieldMatches: Record<string, string | null> = {};
  const categoryMeanings: Record<string, CategoryMeaning> = {};
  const semanticConfirmations: Record<string, "MM/DD/YYYY" | "DD/MM/YYYY"> = {};
  const answers = (): PlanAnswers => ({ fieldMatches: { ...fieldMatches }, categoryMeanings: { ...categoryMeanings }, semanticConfirmations: { ...semanticConfirmations } });
  const asked = new Map<string, Clarification>();
  const done = new Set<string>();
  let answered = 0;
  let compiled = compileIntentPlan({ ...base, answers: answers() });
  for (let round = 0; round < ORACLE_MAX_ROUNDS; round += 1) {
    let progressed = false;
    for (const clarification of compiled.clarifications) {
      if (!asked.has(clarification.id)) asked.set(clarification.id, clarification);
      if (done.has(clarification.id)) continue;
      done.add(clarification.id);
      const answer = oracleAnswer18c(clarification, scenario, base.prepared);
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
  for (const clarification of compiled.clarifications) if (!asked.has(clarification.id)) asked.set(clarification.id, clarification);
  return { compiled, answers: answers(), asked: [...asked.values()], answered };
}

/* ------------------------------------------------------------------ */
/* End-to-end run with record-level false acceptance                   */
/* ------------------------------------------------------------------ */

export interface EndToEnd18c {
  ran: boolean;
  complete: boolean;
  records: number;
  transformed: number;
  correctTransformed: number;
  incorrectTransformed: number;
  /** Wrong records the app counts as accepted (TRANSFORMED_VALID / HANDLED_BY_APPROVED_RULE). */
  incorrectAccepted: number;
  /** Wrong records with a wrong value in a field the semantic verifier reported SEMANTIC_PASS. Must be 0. */
  falseVerified: number;
  quarantined: number;
  quarantinedCorrect: number;
  unresolved: number;
  recordsOk: number;
  semanticMismatch: boolean;
}

const notRun = (complete: boolean, records: number): EndToEnd18c => ({
  ran: false,
  complete,
  records,
  transformed: 0,
  correctTransformed: 0,
  incorrectTransformed: 0,
  incorrectAccepted: 0,
  falseVerified: 0,
  quarantined: 0,
  quarantinedCorrect: 0,
  unresolved: 0,
  recordsOk: 0,
  semanticMismatch: false,
});

const ACCEPTED = new Set(["TRANSFORMED_VALID", "HANDLED_BY_APPROVED_RULE"]);

function differingTargets(output: Record<string, unknown>, want: Expected18b): string[] {
  if (want.kind !== "transform") return ["*"];
  const flat = (value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> => {
    if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) flat(item, prefix ? `${prefix}.${key}` : key, out);
    else out[prefix] = JSON.stringify(value);
    return out;
  };
  const got = flat(output);
  const exp = flat(want.output);
  return [...new Set([...Object.keys(got), ...Object.keys(exp)])].filter((key) => got[key] !== exp[key]);
}

export function runEndToEnd18c(input: {
  scenario: Pick<Eval18cScenario, "records" | "destination">;
  executable: MappingContract;
  prepared: PreparedTwin;
  answers: PlanAnswers;
  complete: boolean;
  expected: readonly Expected18b[];
}): EndToEnd18c {
  const { scenario, executable, prepared, answers, expected } = input;
  const policy = guidedPolicy(answers.categoryMeanings as Record<string, CategoryMeaning>);
  const evaluation = evaluateMapping({ executable, targetSchema: scenario.destination, bindings: prepared.twin.bindings, records: scenario.records, policy });
  const report = evaluation.report;
  const contract = buildSemanticContract({
    contractId: "eval-18c-semantics",
    declared: [
      ...confirmationConstraints(answers.semanticConfirmations as Record<string, "MM/DD/YYYY" | "DD/MM/YYYY">),
      ...meaningConstraints(answers.categoryMeanings as Record<string, CategoryMeaning>, JSON.stringify(scenario.destination), prepared.profile.fields.map((field) => field.path)),
    ],
    profile: prepared.profile,
    records: scenario.records,
  });
  const semantic = verifySemantics({ contract, executable, report, records: scenario.records, destinationSchema: scenario.destination });
  const passed = new Set(semantic.fields.filter((field) => field.status === "SEMANTIC_PASS").map((field) => field.target));
  const out = notRun(input.complete, report.rows.length);
  out.ran = true;
  out.semanticMismatch = semantic.fields.some((field) => field.status === "SEMANTIC_MISMATCH" || field.status === "SEMANTIC_POLICY_CONFLICT");
  evaluation.rows.forEach((row, index) => {
    const output = report.rows[index]?.output ?? null;
    const want = expected[row.index] ?? { kind: "fail" };
    if (row.outcome === "QUARANTINED") out.quarantined += 1;
    if (row.outcome === "UNRESOLVED") out.unresolved += 1;
    if (report.rows[index]?.status === "pass" && output !== null) {
      out.transformed += 1;
      if (row.outcome !== "REJECTED_BY_POLICY" && want.kind === "transform" && canonical(output) === canonical(want.output)) {
        out.correctTransformed += 1;
        out.recordsOk += 1;
        return;
      }
      out.incorrectTransformed += 1;
      if (ACCEPTED.has(row.outcome)) out.incorrectAccepted += 1;
      if (differingTargets(output, want).some((target) => passed.has(target))) out.falseVerified += 1;
      return;
    }
    if (want.kind === "quarantine" && row.outcome === "QUARANTINED") {
      out.quarantinedCorrect += 1;
      out.recordsOk += 1;
    } else if (want.kind === "fail") out.recordsOk += 1;
  });
  return out;
}

export const e2eSuccess18c = (e2e: EndToEnd18c): boolean => e2e.ran && e2e.complete && e2e.records > 0 && e2e.recordsOk === e2e.records && !e2e.semanticMismatch;

/* ------------------------------------------------------------------ */
/* Scoring one answer                                                  */
/* ------------------------------------------------------------------ */

export interface Score18c {
  config: Config18c;
  trial: number;
  index: number;
  completable: boolean;
  /** Requests sent for this scenario-trial (1, or 2 with the approved recovery request). */
  requests: number;
  http: number[];
  providerFailures: number;
  /** The final attempt produced an answer (HTTP 200, non-empty text). */
  answered: boolean;
  promptMatches: boolean | null;
  wholePlanRejected: boolean;
  usable: boolean;
  targets: number;
  correct: number;
  mappableTargets: number;
  mappableCorrect: number;
  mappableNoCorrespondence: number;
  categoryTargets: number;
  categoryCorrect: number;
  nullTargets: number;
  nullNoCorrespondence: number;
  invented: number;
  hallucinated: number;
  incorrectUnsupported: number;
  e2e: EndToEnd18c;
  e2eSuccess: boolean;
  falseComplete: boolean;
  effort: Effort & { unnecessary: number };
  baseline: Effort;
  leakCount: number;
  ms: number[];
  tokens: { prompt: number; output: number };
}

function emptyScore18c(scenario: Eval18cScenario, built: Built18b | null, context: { config: Config18c; trial: number; index: number }): Score18c {
  const classes = Object.values(scenario.groundTruth).map(classifyTarget);
  const baseline = built ? baselineEffort(scenario, built.prepared) : { manualOps: 0, allAnswers: 0 };
  return {
    ...context,
    completable: scenario.completable,
    requests: 0,
    http: [],
    providerFailures: 0,
    answered: false,
    promptMatches: null,
    wholePlanRejected: false,
    usable: false,
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
    hallucinated: 0,
    incorrectUnsupported: 0,
    e2e: notRun(false, scenario.records.length),
    e2eSuccess: false,
    falseComplete: false,
    // Scoring choice: no usable answer leaves the user with the baseline's manual work.
    effort: { ...baseline, unnecessary: 0 },
    baseline,
    leakCount: 0,
    ms: [],
    tokens: { prompt: 0, output: 0 },
  };
}

/** Score one plan text (the request is assumed sent and proven by the caller). */
export function scorePlan18c(scenario: Eval18cScenario, built: Built18b, answerText: string, context: { config: Config18c; trial: number; index: number }): Score18c {
  const score = emptyScore18c(scenario, built, context);
  score.answered = true;
  const targets = Object.keys(scenario.groundTruth);
  const parsed = parseIntentPlanText(answerText);
  const validation = parsed.ok ? validateIntentPlan(parsed.value, built.payload) : parsed;
  if (!validation.ok) {
    score.wholePlanRejected = true;
    return score;
  }
  score.usable = true;
  const validated = validation.value;
  const found = p2Correspondences(validated, targets, built.prepared);
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const item = found.get(target) ?? { paths: null, question: false };
    const none = item.paths === null || item.paths.length === 0;
    const correct = !item.question && correspondenceCorrect(item.paths, truth);
    if (correct) score.correct += 1;
    const kind = classifyTarget(truth);
    if (kind === "mappable") {
      if (correct) score.mappableCorrect += 1;
      if (none) score.mappableNoCorrespondence += 1;
    } else if (kind === "category") {
      if (correct) score.categoryCorrect += 1;
    } else if (none) score.nullNoCorrespondence += 1;
  }
  const enumLabels = new Map(built.payload.fields.map((field) => [field.alias, new Set(field.enumValues ?? [])]));
  for (const item of validated.entries) {
    if (item.issues.some((issue) => issue.code === "UNKNOWN_ALIAS" || issue.code === "UNKNOWN_TARGET_FIELD")) score.hallucinated += 1;
    const truth = scenario.groundTruth[item.entry.target];
    if (truth && truth.transform !== "none" && item.entry.status === "unsupported" && item.verdict !== "rejected") score.incorrectUnsupported += 1;
  }
  const base: Omit<CompileInput, "answers"> = {
    validated,
    disclosure: built.payload as CloudDisclosurePayload,
    prepared: built.prepared,
    records: scenario.records,
    requestId: `eval18c-${context.config}-${context.trial}-${context.index}`,
    origin: "gemini-cloud",
  };
  const oracle = runOracle18c(base, scenario);
  const compiled = oracle.compiled;
  for (const operation of compiled.aliasContract?.operations ?? []) {
    if (operation.op === "default_if_missing") score.invented += 1;
    else if (operation.op === "map_enum") {
      if (operation.params.unmapped === "default") score.invented += 1;
      const field = compiled.fields.find((item) => item.target === operation.to);
      const disclosed = enumLabels.get(operation.from) ?? new Set<string>();
      if (field?.operationOrigin === "gemini" && Object.keys(operation.params.map).some((key) => !disclosed.has(key))) score.invented += 1;
    }
  }
  score.effort = planEffort(oracle.asked, scenario);
  score.falseComplete = !scenario.completable && compiled.complete;
  const accepted = acceptCompiledPlan(compiled, { ...base, answers: oracle.answers });
  if (accepted.ok) {
    score.e2e = runEndToEnd18c({ scenario, executable: accepted.value.resolved.executable, prepared: built.prepared, answers: oracle.answers, complete: compiled.complete, expected: expectedOutcomes(scenario) });
    score.e2eSuccess = scenario.completable && e2eSuccess18c(score.e2e);
  } else score.e2e = notRun(compiled.complete, scenario.records.length);
  return score;
}

/* ------------------------------------------------------------------ */
/* Live entries (tests/live/ai-value.spec.ts, set "c")                 */
/* ------------------------------------------------------------------ */

/** One attempt (one approved request) of one scenario-trial. Alias-level only. */
export interface LiveEntry18c {
  config: Config18c;
  trial: number;
  index: number;
  /** 1 = first request; 2 = the one approved recovery request after a provider failure. */
  attempt: number;
  requests: number;
  leakCount: number;
  previewSha256?: string;
  promptSha256: string[];
  httpStatus: number[];
  answers: string[];
  usage?: Array<{ prompt: number; output: number }>;
  harnessError?: string;
  ms: number;
}

/** A provider failure: any answer that is not HTTP 200 with readable text (HTTP 4xx/5xx, timeout, unreadable body). */
export const isProviderFailure = (entry: Pick<LiveEntry18c, "requests" | "httpStatus" | "answers">): boolean =>
  entry.requests > 0 && !(entry.httpStatus[0] === 200 && typeof entry.answers[0] === "string" && entry.answers[0].length > 0 && !entry.answers[0].startsWith("<unreadable"));

/** Score the attempts of one scenario-trial; the last attempt decides the outcome, every attempt counts as a request. */
export async function scoreScenarioTrial18c(attempts: readonly LiveEntry18c[], scenario: Eval18cScenario): Promise<Score18c> {
  const first = attempts[0]!;
  const context = { config: first.config, trial: first.trial, index: first.index };
  const built = await buildScenario18c(scenario, first.config);
  let score = emptyScore18c(scenario, built, context);
  const sent = attempts.filter((item) => item.requests > 0);
  if (!built || sent.length === 0) return score;
  const last = [...attempts].sort((a, b) => a.attempt - b.attempt).at(-1)!;
  if (!isProviderFailure(last) && last.requests > 0) score = scorePlan18c(scenario, built, last.answers[0]!, context);
  score.requests = sent.reduce((total, item) => total + item.requests, 0);
  score.http = sent.flatMap((item) => item.httpStatus);
  score.providerFailures = sent.filter(isProviderFailure).length;
  score.promptMatches = sent.every((item) => item.promptSha256.length === item.requests && item.promptSha256.every((hash) => hash === built.promptSha256) && item.previewSha256 === built.promptSha256);
  score.leakCount = attempts.reduce((total, item) => total + item.leakCount, 0);
  score.ms = sent.map((item) => item.ms);
  for (const item of sent) for (const usage of item.usage ?? []) {
    score.tokens.prompt += usage.prompt;
    score.tokens.output += usage.output;
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* Aggregates and the pre-registered verdict                           */
/* ------------------------------------------------------------------ */

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);
const round = (value: number) => Math.round(value * 1000) / 1000;

export interface Summary18c {
  scenarioTrials: number;
  requests: number;
  providerFailures: number;
  http400: number;
  http5xx: number;
  otherFailures: number;
  R1_providerSuccess: number;
  wholePlanRejections: number;
  promptMismatches: number;
  leakMatches: number;
  M1_correctAll: number;
  M2_correctMappable: number;
  M3_categoryCorrect: number;
  M4_invented: number;
  M6_unnecessaryAbstention: number;
  M7_appropriateAbstention: number;
  M8_incorrectUnsupported: number;
  M10_hallucinated: number;
  E1_success: number;
  E1_successes: number;
  E1_completable: number;
  E2_incorrectTransformed: number;
  transformed: number;
  correctTransformed: number;
  incorrectAccepted: number;
  S5_falseVerified: number;
  quarantinedCorrect: number;
  unresolved: number;
  E3_falseCompletes: number;
  correctRefusals: number;
  U1_manualOpsMean: number;
  U2_allAnswersMean: number;
  unnecessaryQuestions: number;
  baselineManualOpsMean: number;
  baselineAllAnswersMean: number;
  medianMs: number | null;
  tokens: { prompt: number; output: number };
}

export function summarize18c(scores: readonly Score18c[]): Summary18c {
  const sent = scores.filter((score) => score.requests > 0);
  const usable = sent.filter((score) => score.usable);
  const sum = (rows: readonly Score18c[], pick: (row: Score18c) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const completable = sent.filter((score) => score.completable);
  const statuses = sent.flatMap((score) => score.http);
  const requests = sum(sent, (row) => row.requests);
  const failures = sum(sent, (row) => row.providerFailures);
  const http400 = statuses.filter((status) => status === 400).length;
  const http5xx = statuses.filter((status) => status >= 500).length;
  const times = sent.flatMap((score) => score.ms).sort((a, b) => a - b);
  return {
    scenarioTrials: sent.length,
    requests,
    providerFailures: failures,
    http400,
    http5xx,
    otherFailures: failures - http400 - http5xx,
    R1_providerSuccess: round(ratio(requests - failures, requests)),
    wholePlanRejections: sent.filter((row) => row.wholePlanRejected).length,
    promptMismatches: sent.filter((row) => row.promptMatches === false).length,
    leakMatches: sum(scores, (row) => row.leakCount),
    M1_correctAll: round(ratio(sum(sent, (row) => row.correct), sum(sent, (row) => row.targets))),
    M2_correctMappable: round(ratio(sum(sent, (row) => row.mappableCorrect), sum(sent, (row) => row.mappableTargets))),
    M3_categoryCorrect: round(ratio(sum(sent, (row) => row.categoryCorrect), sum(sent, (row) => row.categoryTargets))),
    M4_invented: sum(usable, (row) => row.invented),
    M6_unnecessaryAbstention: round(ratio(sum(usable, (row) => row.mappableNoCorrespondence), sum(usable, (row) => row.mappableTargets))),
    M7_appropriateAbstention: round(ratio(sum(usable, (row) => row.nullNoCorrespondence), sum(usable, (row) => row.nullTargets))),
    M8_incorrectUnsupported: sum(usable, (row) => row.incorrectUnsupported),
    M10_hallucinated: sum(usable, (row) => row.hallucinated),
    E1_success: round(ratio(completable.filter((row) => row.e2eSuccess).length, completable.length)),
    E1_successes: completable.filter((row) => row.e2eSuccess).length,
    E1_completable: completable.length,
    E2_incorrectTransformed: round(ratio(sum(sent, (row) => row.e2e.incorrectTransformed), sum(sent, (row) => row.e2e.transformed))),
    transformed: sum(sent, (row) => row.e2e.transformed),
    correctTransformed: sum(sent, (row) => row.e2e.correctTransformed),
    incorrectAccepted: sum(sent, (row) => row.e2e.incorrectAccepted),
    S5_falseVerified: sum(sent, (row) => row.e2e.falseVerified),
    quarantinedCorrect: sum(sent, (row) => row.e2e.quarantinedCorrect),
    unresolved: sum(sent, (row) => row.e2e.unresolved),
    E3_falseCompletes: sent.filter((row) => row.falseComplete).length,
    correctRefusals: sent.filter((row) => !row.completable && row.usable && !row.falseComplete).length,
    U1_manualOpsMean: round(ratio(sum(sent, (row) => row.effort.manualOps), sent.length)),
    U2_allAnswersMean: round(ratio(sum(sent, (row) => row.effort.allAnswers), sent.length)),
    unnecessaryQuestions: sum(sent, (row) => row.effort.unnecessary),
    baselineManualOpsMean: round(ratio(sum(sent, (row) => row.baseline.manualOps), sent.length)),
    baselineAllAnswersMean: round(ratio(sum(sent, (row) => row.baseline.allAnswers), sent.length)),
    medianMs: times.length === 0 ? null : times[Math.floor(times.length / 2)]!,
    tokens: { prompt: sum(sent, (row) => row.tokens.prompt), output: sum(sent, (row) => row.tokens.output) },
  };
}

export interface Verdict18c {
  E1: boolean;
  E2: boolean;
  S5: boolean;
  E3: boolean;
  M1: boolean;
  M2: boolean;
  M3: boolean;
  M4: boolean;
  M10: boolean;
  R1: boolean;
  R2: boolean;
  U1: boolean;
  U2: boolean;
  S1: boolean;
  S2: boolean;
  S3: boolean;
  gateC: boolean;
}

/** The pre-registered bold conditions (docs/evaluation/sprint-18c-reliability.md). */
export function verdict18c(input: { p0: Summary18c; p1: Summary18c; sourceDerivedFindings: number; expectedScenarioTrials: number; unauthorizedRequests: number }): Verdict18c {
  const { p0, p1 } = input;
  const verdict = {
    E1: p1.E1_completable > 0 && p1.E1_success >= 0.7,
    E2: p1.E2_incorrectTransformed <= 0.05,
    S5: p1.S5_falseVerified === 0,
    E3: p1.E3_falseCompletes === 0,
    M1: p1.M1_correctAll >= round(p0.M1_correctAll - 0.05),
    M2: p1.M2_correctMappable >= round(p0.M2_correctMappable - 0.05),
    M3: p1.M3_categoryCorrect >= 0.6,
    M4: p1.M4_invented === 0,
    M10: p1.M10_hallucinated <= p0.M10_hallucinated,
    R1: p1.requests > 0 && p1.R1_providerSuccess >= 0.9,
    R2: p1.http400 === 0,
    U1: p1.scenarioTrials > 0 && p1.U1_manualOpsMean <= 0.5 * p1.baselineManualOpsMean,
    U2: p1.scenarioTrials > 0 && p1.U2_allAnswersMean <= 0.6 * p1.baselineAllAnswersMean,
    S1: input.sourceDerivedFindings === 0,
    S2: p0.promptMismatches + p1.promptMismatches === 0 && p0.scenarioTrials + p1.scenarioTrials === input.expectedScenarioTrials,
    S3: input.unauthorizedRequests === 0,
  };
  return { ...verdict, gateC: Object.values(verdict).every(Boolean) };
}

/** Holdout-safe per-scenario-trial row: index, config, trial and numbers only. */
export function indexRow18c(score: Score18c): Record<string, number | string | boolean | null> {
  return {
    config: score.config,
    trial: score.trial,
    index: score.index,
    requests: score.requests,
    http: score.http.join(","),
    providerFailures: score.providerFailures,
    promptMatches: score.promptMatches,
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
    incorrectAccepted: score.e2e.incorrectAccepted,
    falseVerified: score.e2e.falseVerified,
    manualOps: score.effort.manualOps,
    allAnswers: score.effort.allAnswers,
    baselineManualOps: score.baseline.manualOps,
  };
}
