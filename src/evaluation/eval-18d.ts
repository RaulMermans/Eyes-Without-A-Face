/**
 * Sprint 18D scorer (docs/evaluation/sprint-18d-semantic-intelligence.md).
 *
 * Pure and offline: nothing here sends, approves or calls a model.
 *
 * An ARM fixes what is sent (model configuration, destination semantics,
 * prompt version). A POLICY fixes what the compiler does with an answer
 * (local candidates, ask-on-alternatives, ask-on-local-disagreement). Policies
 * are applied to the SAME recorded answers, so they cost no extra requests and
 * their comparison is paired.
 *
 * Reused unchanged from the frozen 18B/18C scorers: ground-truth contracts,
 * expected outcomes, correspondence rules, the oracle user (answers exactly
 * what the app asks, truthfully; never corrects an un-asked confident match),
 * the end-to-end run with record-level false verification, and effort.
 *
 * Holdout use: functions return numbers and booleans; rows carry indexes only.
 */
import type { CloudDisclosureDestination, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { DEFAULT_TWIN_SEED } from "../phantom/generate.ts";
import { buildOutboundPromptText, createDisclosurePreview } from "../twin/authorization.ts";
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../workflow/pipeline.ts";
import { parseIntentPlanText, validateIntentPlan } from "../plan/validate.ts";
import { acceptCompiledPlan, MAX_RANKED_CANDIDATES, type CompileInput } from "../plan/compile.ts";
import type { ValidatedIntentPlan } from "../plan/types.ts";
import type { CloudModelConfig } from "../inference/cloud-models.ts";
import { localCandidatesForDestination } from "../matching/destination-candidates.ts";
import type { LocalCandidateSet } from "../matching/types.ts";
import { baselineEffort, classifyTarget, correspondenceCorrect, expectedOutcomes, gtPaths, p2Correspondences, planEffort, sha256Hex, type Built18b } from "./eval-18b.ts";
import { e2eSuccess18c, runEndToEnd18c, runOracle18c, type EndToEnd18c, type Eval18cScenario } from "./eval-18c.ts";

export interface Eval18dScenario extends Eval18cScenario {
  track?: "wedge" | "general";
}

/* ------------------------------------------------------------------ */
/* Arms (what is sent) and policies (what the compiler does)           */
/* ------------------------------------------------------------------ */

export interface Arm18d {
  id: string;
  model: CloudModelConfig;
  /** Sanitized destination descriptions (cloud-disclosure 1.4.0). */
  semantics: boolean;
  planner: "intent-plan-1" | "intent-plan-2";
}

const LITE = { model: "gemini-3.5-flash-lite" } as const;
const FLASH = { model: "gemini-3.8-flash" } as const;

/** Stage 1 arms (ADR 0021 §E). A = the Sprint 18C P1 configuration, byte-identical. */
export const ARMS_18D: Readonly<Record<string, Arm18d>> = {
  A: { id: "A", model: LITE, semantics: false, planner: "intent-plan-1" },
  B: { id: "B", model: LITE, semantics: true, planner: "intent-plan-1" },
  C: { id: "C", model: FLASH, semantics: false, planner: "intent-plan-1" },
  D: { id: "D", model: FLASH, semantics: true, planner: "intent-plan-1" },
  BH: { id: "BH", model: { ...LITE, thinkingLevel: "HIGH" }, semantics: true, planner: "intent-plan-1" },
  DH: { id: "DH", model: { ...FLASH, thinkingLevel: "HIGH" }, semantics: true, planner: "intent-plan-1" },
  RB: { id: "RB", model: LITE, semantics: true, planner: "intent-plan-2" },
  RD: { id: "RD", model: FLASH, semantics: true, planner: "intent-plan-2" },
};

export interface Policy18d {
  id: string;
  local: boolean;
  askOnAlternatives: boolean;
  askOnLocalDisagreement: boolean;
  /** Exploratory (post-Stage-1, dev-tuned; not pre-registered). */
  askOnLocalTopDisagreement?: boolean;
  askOnLocalForUnfilled?: boolean;
  openOnAmbiguous?: boolean;
}

export const POLICIES_18D: Readonly<Record<string, Policy18d>> = {
  /** The Sprint 18C rule only (ADR 0020 §7). */
  base: { id: "base", local: false, askOnAlternatives: false, askOnLocalDisagreement: false },
  rank: { id: "rank", local: true, askOnAlternatives: false, askOnLocalDisagreement: false },
  alt: { id: "alt", local: true, askOnAlternatives: true, askOnLocalDisagreement: false },
  disagree: { id: "disagree", local: true, askOnAlternatives: false, askOnLocalDisagreement: true },
  both: { id: "both", local: true, askOnAlternatives: true, askOnLocalDisagreement: true },
  /** Exploratory, added after Stage 1 on dev only: ask when the local top-1 is clearly another field. */
  top: { id: "top", local: true, askOnAlternatives: false, askOnLocalDisagreement: false, askOnLocalTopDisagreement: true },
  topAlt: { id: "topAlt", local: true, askOnAlternatives: true, askOnLocalDisagreement: false, askOnLocalTopDisagreement: true },
  /** Exploratory, dev-tuned: the local matcher may open questions on fields Gemini left empty or matched to another category field. */
  open: { id: "open", local: true, askOnAlternatives: false, askOnLocalDisagreement: false, askOnLocalForUnfilled: true },
  openAll: { id: "openAll", local: true, askOnAlternatives: false, askOnLocalDisagreement: false, askOnLocalForUnfilled: true, openOnAmbiguous: true },
  openTop: { id: "openTop", local: true, askOnAlternatives: false, askOnLocalDisagreement: false, askOnLocalTopDisagreement: true, askOnLocalForUnfilled: true },
};

export function armDestination(arm: Arm18d): CloudDisclosureDestination {
  return {
    provider: "firebase-ai-logic",
    backend: "google-ai",
    model: arm.model.model,
    purpose: "mapping-proposal",
    ...(arm.model.thinkingLevel ? { thinkingLevel: arm.model.thinkingLevel } : {}),
  };
}

export async function buildScenario18d(scenario: Pick<Eval18dScenario, "records" | "destination">, arm: Arm18d): Promise<Built18b | null> {
  const prepared = prepareTwin({ records: scenario.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts: true });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination, destination: armDestination(arm), destinationSemantics: arm.semantics });
  if (!draft.ok) return null;
  let preview;
  try {
    preview = await createDisclosurePreview(draft.value.payload);
  } catch {
    return null;
  }
  const prompt = buildOutboundPromptText(preview.canonicalJson, draft.value.payload.schemaVersion, arm.planner);
  return { prepared: prepared.value, payload: draft.value.payload, canonicalJson: preview.canonicalJson, prompt, promptSha256: await sha256Hex(prompt), appPreviewPrompt: preview.outboundPrompt };
}

/** Local candidates for every destination field (LOCAL ONLY), exactly as the app computes them. */
export function localCandidates18d(scenario: Pick<Eval18dScenario, "records" | "destination">, prepared: PreparedTwin): LocalCandidateSet[] {
  return localCandidatesForDestination(scenario.destination, prepared, scenario.records);
}

/* ------------------------------------------------------------------ */
/* Candidate recall (top-1 / top-3)                                    */
/* ------------------------------------------------------------------ */

export interface Recall {
  /** Single-source targets with a valid ground-truth source (concat excluded). */
  n: number;
  top1: number;
  top3: number;
}

const emptyRecall = (): Recall => ({ n: 0, top1: 0, top3: 0 });

/** Gemini's ranked list for one target: from (+ alternatives), resolved to local paths. */
function geminiRanked(validated: ValidatedIntentPlan, target: string, prepared: PreparedTwin): string[] {
  const entry = validated.entries.find((item) => item.entry.target === target && item.verdict !== "rejected")?.entry;
  if (!entry || entry.status === "no_source") return [];
  return [...new Set([...entry.from, ...(entry.alternatives ?? [])].map((alias) => prepared.twin.bindings.resolve(alias)).filter((path): path is string => typeof path === "string"))];
}

export function recallOf(lists: ReadonlyMap<string, readonly string[]>, scenario: Pick<Eval18dScenario, "groundTruth">): Recall {
  const out = emptyRecall();
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const paths = gtPaths(truth);
    if (paths === null || truth.transform === "concat") continue;
    out.n += 1;
    const list = lists.get(target) ?? [];
    if (list[0] === paths[0]) out.top1 += 1;
    if (list.slice(0, MAX_RANKED_CANDIDATES).includes(paths[0]!)) out.top3 += 1;
  }
  return out;
}

export function localRecall(scenario: Pick<Eval18dScenario, "groundTruth">, sets: readonly LocalCandidateSet[]): Recall {
  return recallOf(new Map(sets.map((set) => [set.target, set.candidates.map((item) => item.path)])), scenario);
}

/* ------------------------------------------------------------------ */
/* Scoring one answer under one policy                                 */
/* ------------------------------------------------------------------ */

export interface Score18d {
  arm: string;
  policy: string;
  trial: number;
  index: number;
  track: "wedge" | "general";
  completable: boolean;
  answered: boolean;
  wholePlanRejected: boolean;
  usable: boolean;
  targets: number;
  correct: number;
  mappableTargets: number;
  mappableCorrect: number;
  categoryTargets: number;
  categoryCorrect: number;
  hallucinated: number;
  invented: number;
  gemini: Recall;
  local: Recall;
  combined: Recall;
  /** High-confidence executable single-field matches, split by local agreement, and how many were wrong. */
  disagreement: { agreeN: number; agreeWrong: number; disagreeN: number; disagreeWrong: number; topDisagreeN: number; topDisagreeWrong: number };
  e2e: EndToEnd18c;
  e2eSuccess: boolean;
  falseComplete: boolean;
  effort: { manualOps: number; allAnswers: number; unnecessary: number; offList: number };
  baselineManualOps: number;
  /** All answers the baseline guided flow (Sprint 16B rules) needs for this scenario. */
  baselineAnswers: number;
}

export function scorePlan18d(
  scenario: Eval18dScenario,
  built: Built18b,
  answerText: string,
  context: { arm: Arm18d; policy: Policy18d; trial: number; index: number },
): Score18d {
  const classes = Object.values(scenario.groundTruth).map(classifyTarget);
  const sets = localCandidates18d(scenario, built.prepared);
  const score: Score18d = {
    arm: context.arm.id,
    policy: context.policy.id,
    trial: context.trial,
    index: context.index,
    track: scenario.track ?? "general",
    completable: scenario.completable,
    answered: true,
    wholePlanRejected: false,
    usable: false,
    targets: classes.length,
    correct: 0,
    mappableTargets: classes.filter((item) => item === "mappable").length,
    mappableCorrect: 0,
    categoryTargets: classes.filter((item) => item === "category").length,
    categoryCorrect: 0,
    hallucinated: 0,
    invented: 0,
    gemini: emptyRecall(),
    local: localRecall(scenario, sets),
    combined: emptyRecall(),
    disagreement: { agreeN: 0, agreeWrong: 0, disagreeN: 0, disagreeWrong: 0, topDisagreeN: 0, topDisagreeWrong: 0 },
    e2e: { ran: false, complete: false, records: scenario.records.length, transformed: 0, correctTransformed: 0, incorrectTransformed: 0, incorrectAccepted: 0, falseVerified: 0, quarantined: 0, quarantinedCorrect: 0, unresolved: 0, recordsOk: 0, semanticMismatch: false },
    e2eSuccess: false,
    falseComplete: false,
    effort: { manualOps: 0, allAnswers: 0, unnecessary: 0, offList: 0 },
    baselineManualOps: baselineEffort(scenario, built.prepared).manualOps,
    baselineAnswers: baselineEffort(scenario, built.prepared).allAnswers,
  };
  const parsed = parseIntentPlanText(answerText);
  const validation = parsed.ok ? validateIntentPlan(parsed.value, built.payload, { ranked: context.arm.planner === "intent-plan-2" }) : parsed;
  if (!validation.ok) {
    score.wholePlanRejected = true;
    return score;
  }
  score.usable = true;
  const validated = validation.value;
  const targets = Object.keys(scenario.groundTruth);
  const found = p2Correspondences(validated, targets, built.prepared);
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const item = found.get(target) ?? { paths: null, question: false };
    const correct = !item.question && correspondenceCorrect(item.paths, truth);
    if (correct) score.correct += 1;
    const kind = classifyTarget(truth);
    if (kind === "mappable" && correct) score.mappableCorrect += 1;
    if (kind === "category" && correct) score.categoryCorrect += 1;
  }
  for (const item of validated.entries) if (item.issues.some((issue) => issue.code === "UNKNOWN_ALIAS" || issue.code === "UNKNOWN_TARGET_FIELD")) score.hallucinated += 1;

  const localBy = new Map(sets.map((set) => [set.target, set]));
  const geminiLists = new Map(targets.map((target) => [target, geminiRanked(validated, target, built.prepared)]));
  score.gemini = recallOf(geminiLists, scenario);
  score.combined = recallOf(new Map(targets.map((target) => [target, [...new Set([...(geminiLists.get(target) ?? []), ...(localBy.get(target)?.candidates.map((item) => item.path) ?? [])])]])), scenario);
  for (const item of validated.entries) {
    const entry = item.entry;
    const truth = scenario.groundTruth[entry.target];
    if (!truth || item.verdict === "rejected" || entry.status !== "ready" || entry.confidence !== "high" || entry.from.length !== 1 || entry.transform === "concat") continue;
    const path = built.prepared.twin.bindings.resolve(entry.from[0]!);
    const set = localBy.get(entry.target);
    const top = set?.candidates[0];
    const disagrees = Boolean(set && set.uncertainty === "clear" && top && top.path !== path && !set.candidates.some((candidate) => candidate.path === path));
    const wrong = !correspondenceCorrect(path ? [path] : null, truth);
    if (set && set.uncertainty === "clear" && top && top.path !== path) {
      score.disagreement.topDisagreeN += 1;
      if (wrong) score.disagreement.topDisagreeWrong += 1;
    }
    if (disagrees) {
      score.disagreement.disagreeN += 1;
      if (wrong) score.disagreement.disagreeWrong += 1;
    } else {
      score.disagreement.agreeN += 1;
      if (wrong) score.disagreement.agreeWrong += 1;
    }
  }

  const base: Omit<CompileInput, "answers"> = {
    validated,
    disclosure: built.payload as CloudDisclosurePayload,
    prepared: built.prepared,
    records: scenario.records,
    requestId: `eval18d-${context.arm.id}-${context.trial}-${context.index}`,
    origin: "gemini-cloud",
    ...(context.policy.local
      ? { local: { localCandidates: sets, askOnAlternatives: context.policy.askOnAlternatives, askOnLocalDisagreement: context.policy.askOnLocalDisagreement, askOnLocalTopDisagreement: context.policy.askOnLocalTopDisagreement === true, askOnLocalForUnfilled: context.policy.askOnLocalForUnfilled === true, openOnAmbiguous: context.policy.openOnAmbiguous === true } }
      : {}),
  };
  const oracle = runOracle18c(base, scenario);
  const compiled = oracle.compiled;
  const enumLabels = new Map(built.payload.fields.map((field) => [field.alias, new Set(field.enumValues ?? [])]));
  for (const operation of compiled.aliasContract?.operations ?? []) {
    if (operation.op === "default_if_missing") score.invented += 1;
    else if (operation.op === "map_enum") {
      if (operation.params.unmapped === "default") score.invented += 1;
      const field = compiled.fields.find((item) => item.target === operation.to);
      const disclosed = enumLabels.get(operation.from) ?? new Set<string>();
      if (field?.operationOrigin === "gemini" && Object.keys(operation.params.map).some((key) => !disclosed.has(key))) score.invented += 1;
    }
  }
  const effort = planEffort(oracle.asked, scenario);
  const offList = oracle.asked.filter((item) => {
    if (item.kind !== "choose-field") return false;
    const truth = scenario.groundTruth[item.target];
    const paths = truth ? gtPaths(truth) : null;
    if (!paths || truth?.transform === "concat") return false;
    const shown = item.rankedPaths ?? item.localPaths;
    return !shown.slice(0, MAX_RANKED_CANDIDATES).includes(paths[0]!);
  }).length;
  score.effort = { ...effort, offList };
  score.falseComplete = !scenario.completable && compiled.complete;
  const accepted = acceptCompiledPlan(compiled, { ...base, answers: oracle.answers });
  if (accepted.ok) {
    score.e2e = runEndToEnd18c({ scenario, executable: accepted.value.resolved.executable, prepared: built.prepared, answers: oracle.answers, complete: compiled.complete, expected: expectedOutcomes(scenario) });
    score.e2eSuccess = scenario.completable && e2eSuccess18c(score.e2e);
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export interface Summary18d {
  n: number;
  completableSent: number;
  e2eSuccess: number;
  e2eRate: number;
  transformed: number;
  incorrectTransformed: number;
  incorrectRate: number;
  falseVerified: number;
  falseComplete: number;
  invented: number;
  hallucinated: number;
  wholePlanRejected: number;
  correspondence: number;
  mappable: number;
  category: number;
  geminiTop1: number;
  geminiTop3: number;
  localTop1: number;
  localTop3: number;
  combinedTop3: number;
  manualOpsPerTrial: number;
  answersPerTrial: number;
  unnecessaryPerTrial: number;
  offListPerTrial: number;
  baselineManualOpsPerTrial: number;
  baselineAnswersPerTrial: number;
  disagreement: Score18d["disagreement"];
}

const rate = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 1000) / 1000);

export function summarize18d(scores: readonly Score18d[]): Summary18d {
  const sum = (pick: (score: Score18d) => number) => scores.reduce((total, score) => total + pick(score), 0);
  const completable = scores.filter((score) => score.completable);
  const transformed = sum((score) => score.e2e.transformed);
  const incorrect = sum((score) => score.e2e.incorrectTransformed);
  const recall = (pick: (score: Score18d) => Recall, field: "top1" | "top3") => rate(sum((score) => pick(score)[field]), sum((score) => pick(score).n));
  return {
    n: scores.length,
    completableSent: completable.length,
    e2eSuccess: completable.filter((score) => score.e2eSuccess).length,
    e2eRate: rate(completable.filter((score) => score.e2eSuccess).length, completable.length),
    transformed,
    incorrectTransformed: incorrect,
    incorrectRate: rate(incorrect, transformed),
    falseVerified: sum((score) => score.e2e.falseVerified),
    falseComplete: scores.filter((score) => score.falseComplete).length,
    invented: sum((score) => score.invented),
    hallucinated: sum((score) => score.hallucinated),
    wholePlanRejected: scores.filter((score) => score.wholePlanRejected).length,
    correspondence: rate(sum((score) => score.correct), sum((score) => score.targets)),
    mappable: rate(sum((score) => score.mappableCorrect), sum((score) => score.mappableTargets)),
    category: rate(sum((score) => score.categoryCorrect), sum((score) => score.categoryTargets)),
    geminiTop1: recall((score) => score.gemini, "top1"),
    geminiTop3: recall((score) => score.gemini, "top3"),
    localTop1: recall((score) => score.local, "top1"),
    localTop3: recall((score) => score.local, "top3"),
    combinedTop3: recall((score) => score.combined, "top3"),
    manualOpsPerTrial: rate(sum((score) => score.effort.manualOps), scores.length),
    answersPerTrial: rate(sum((score) => score.effort.allAnswers), scores.length),
    unnecessaryPerTrial: rate(sum((score) => score.effort.unnecessary), scores.length),
    offListPerTrial: rate(sum((score) => score.effort.offList), scores.length),
    baselineManualOpsPerTrial: rate(sum((score) => score.baselineManualOps), scores.length),
    baselineAnswersPerTrial: rate(sum((score) => score.baselineAnswers), scores.length),
    disagreement: {
      agreeN: sum((score) => score.disagreement.agreeN),
      agreeWrong: sum((score) => score.disagreement.agreeWrong),
      disagreeN: sum((score) => score.disagreement.disagreeN),
      disagreeWrong: sum((score) => score.disagreement.disagreeWrong),
      topDisagreeN: sum((score) => score.disagreement.topDisagreeN),
      topDisagreeWrong: sum((score) => score.disagreement.topDisagreeWrong),
    },
  };
}

/** Per-index row for the holdout: numbers and codes only. */
export function indexRow18d(score: Score18d): Record<string, number | string | boolean> {
  return {
    arm: score.arm,
    policy: score.policy,
    trial: score.trial,
    index: score.index,
    track: score.track,
    completable: score.completable,
    usable: score.usable,
    e2eSuccess: score.e2eSuccess,
    correct: score.correct,
    targets: score.targets,
    incorrectTransformed: score.e2e.incorrectTransformed,
    falseVerified: score.e2e.falseVerified,
    answers: score.effort.allAnswers,
  };
}
