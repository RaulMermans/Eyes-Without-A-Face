/**
 * Sprint 8 benchmark replay and aggregation (Workstreams D, E).
 *
 * Every reported number is recomputed offline from recorded ALIAS-LEVEL model
 * text by the same deterministic pipeline the browser runs
 * (`runScenarioPipeline`). The browser's displayed counts are only used to
 * cross-check the replay. Configuration A is computed here directly (no model).
 *
 * Holdout scoring happens inside the pipeline only after the final mapping
 * exists; nothing here feeds holdout results back into any proposer.
 */
import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import { deriveTestProposal } from "../inference/test-proposer.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../phantom/generate.ts";
import { isSemanticRole } from "../phantom/roles.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import type { OutcomeMetrics } from "../verification/outcomes.ts";
import { buildDisclosureDraft, prepareTwin } from "../workflow/pipeline.ts";
import { runScenarioPipeline, semanticDetection, type ScenarioRun, type SemanticDetection } from "./benchmark.ts";
import { compareEvaluations } from "./evaluate.ts";
import type { EvaluationScenario } from "./scenarios.ts";

export const BENCHMARK_REPORT_VERSION = "1.0.0";

/** One recorded live run (tests/live/semantic-benchmark.spec.ts). Alias-level text only. */
export interface LiveEntry {
  check: "S8-B" | "S8-CD";
  trial: number;
  scenarioId: string;
  model?: string;
  promptVersions?: Record<string, string>;
  initial?: { text: string; origin: string | null; provenance: string | null; status: string | null; ms: number; error: string | null };
  initialCounts?: string | null;
  holdoutCounts?: string | null;
  nano?: Array<{ alias: string; localPath: string | null; status: string | null; check: string | null; real: boolean }>;
  nanoMs?: number;
  nanoError?: string | null;
  applied?: string[];
  authorizedConstraints?: string[];
  revised?: { ok: string | null; origin: string | null; provenance: string | null; status: string | null };
  revisedText?: string | null;
  revisionMs?: number;
  revisionBlocked?: string | null;
  revisionComparison?: { metrics: Record<string, [string | null, string | null]> | null } | null;
  holdoutComparison?: { metrics: Record<string, [string | null, string | null]> | null } | null;
  decision?: { verdict: string | null } | null;
  requests: { generateContent: number; leaks: string[] };
}

export type ConfigLabel = "A" | "B" | "C" | "D";

export type RunProvenance =
  | "deterministic-baseline"
  | "real-gemini"
  | "real-gemini-revision"
  | "provider-failure"
  | "revision-not-sent";

export interface SetScore {
  total: number;
  correctTransformations: number;
  correctlyHandled: number;
  incorrect: number;
  quarantined: number;
  unresolved: number;
  rejectedByPolicy: number;
}

export interface RunRecord {
  runId: string;
  scenarioId: string;
  config: ConfigLabel;
  trial: number;
  provenance: RunProvenance;
  model: string | null;
  promptVersion: string;
  mappingHash: string | null;
  mappingValid: boolean;
  providerError: string | null;
  feedbackSet: SetScore | null;
  holdout: SetScore | null;
  semanticOverall: string | null;
  detectionFeedbackSet: SemanticDetection | null;
  detectionHoldout: SemanticDetection | null;
  revision: {
    feedbackVersion: string | null;
    semanticFindings: number;
    approvedConstraints: number;
    verdict: string | null;
    holdoutImproved: number;
    holdoutRegressed: number;
    operationRegressions: number;
    holdoutCorrectTransformationsDelta: number | null;
  } | null;
  privacy: { bodyLeaks: number; promptPrivateMatches: number | null; canaryPresent: boolean | null };
  cloudRequests: number;
  latencyMs: { cloud: number | null; nano: number | null; revision: number | null };
  humanInterventions: number;
  /** Browser-displayed counts equal the replay (null when nothing to compare). */
  replayMatchesBrowser: boolean | null;
}

function score(metrics: OutcomeMetrics | null | undefined): SetScore | null {
  if (!metrics) return null;
  return {
    total: metrics.total,
    correctTransformations: metrics.correctTransformations ?? 0,
    correctlyHandled: metrics.correctlyHandled ?? 0,
    incorrect: metrics.incorrect,
    quarantined: metrics.quarantined,
    unresolved: metrics.unresolved,
    rejectedByPolicy: metrics.rejectedByPolicy,
  };
}

export function countsLine(m: OutcomeMetrics): string {
  return `${m.transformedValid} transformed · ${m.handledByApprovedRule} by approved rule · ${m.quarantined} quarantined · ${m.unresolved} unresolved · ${m.rejectedByPolicy} rejected by policy · ${m.incorrect} incorrect · ${m.correctlyHandled}/${m.total} correctly handled`;
}

/** Rebuild the overrides the user applied from the fixed-vocabulary check line. */
export function appliedOverridesFromEvidence(entry: LiveEntry): Record<string, TwinFieldOverride> {
  const out: Record<string, TwinFieldOverride> = {};
  for (const alias of entry.applied ?? []) {
    const row = entry.nano?.find((item) => item.alias === alias);
    if (!row?.localPath || !row.check) continue;
    const role = /role \S+ → (\S+)/.exec(row.check)?.[1];
    const date = /date order \S+ → (MM\/DD\/YYYY|DD\/MM\/YYYY)/.exec(row.check)?.[1] as "MM/DD/YYYY" | "DD/MM/YYYY" | undefined;
    const override: TwinFieldOverride = {};
    if (role && isSemanticRole(role)) override.role = role;
    if (date) override.dateFormat = date;
    out[row.localPath] = override;
  }
  return out;
}

function sec(provenance: string | null | undefined): number | null {
  const match = /(\d+)ms/.exec(provenance ?? "");
  return match ? Number(match[1]) : null;
}

async function mappingHash(text: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(text) as { operations?: unknown };
    return (await fingerprintCanonicalPayload({ operations: parsed.operations ?? null })).payloadHash;
  } catch {
    return null;
  }
}

function tableOf(before: OutcomeMetrics, after: OutcomeMetrics): Record<string, [string, string]> {
  const keys = ["transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy", "incorrect", "correctlyHandled"] as const;
  return Object.fromEntries(keys.map((key) => [key, [String(before[key]), String(after[key])]]));
}

function browserTable(metrics: Record<string, [string | null, string | null]> | null | undefined): Record<string, [string | null, string | null]> | null {
  if (!metrics) return null;
  const { semantic: _semantic, ...rest } = metrics;
  return rest;
}

export interface ReplayResult {
  records: RunRecord[];
  run: ScenarioRun | null;
}

/** Replay one live entry into one (B) or two (C, D) run records. */
export async function replayLiveEntry(entry: LiveEntry, scenario: EvaluationScenario): Promise<ReplayResult> {
  const model = entry.model ?? null;
  const leaks = entry.requests.leaks.length;
  const base = { scenarioId: scenario.scenarioId, trial: entry.trial, model };
  const providerError = entry.initial?.error ?? (entry.initial ? null : "NO_INITIAL_RESPONSE");
  const failed = (config: ConfigLabel, promptVersion: string): RunRecord => ({
    ...base,
    runId: `${scenario.scenarioId}-${config}-t${entry.trial}`,
    config,
    provenance: "provider-failure",
    promptVersion,
    mappingHash: null,
    mappingValid: false,
    providerError,
    feedbackSet: null,
    holdout: null,
    semanticOverall: null,
    detectionFeedbackSet: null,
    detectionHoldout: null,
    revision: null,
    privacy: { bodyLeaks: leaks, promptPrivateMatches: null, canaryPresent: null },
    cloudRequests: entry.requests.generateContent,
    latencyMs: { cloud: entry.initial?.ms ?? null, nano: entry.nanoMs ?? null, revision: null },
    humanInterventions: 0,
    replayMatchesBrowser: null,
  });
  if (providerError || !entry.initial?.text) {
    return entry.check === "S8-B" ? { records: [failed("B", "mapping-proposal-1.1.0")], run: null } : { records: [failed("C", "mapping-proposal-1.1.0"), failed("D", "revision-3")], run: null };
  }
  const isB = entry.check === "S8-B";
  const revisedText = entry.revisedText ?? null;
  const run = await runScenarioPipeline({
    scenario,
    config: isB ? "B-cloud" : "D-nano-cloud-revision",
    seed: DEFAULT_TWIN_SEED,
    semanticOverrides: isB ? undefined : appliedOverridesFromEvidence(entry),
    propose: () => ({ text: entry.initial!.text, origin: "gemini-cloud" }),
    revise: !isB && revisedText ? () => ({ text: revisedText, origin: "gemini-cloud" }) : !isB ? () => null : undefined,
    semantic: { authorizeConstraints: (entry.authorizedConstraints ?? []).length > 0 },
  });
  const initialEval = run.initial.evaluation;
  const initialHoldout = run.initial.holdout;
  const browserInitialMatches = entry.initialCounts && initialEval ? countsLine(initialEval.metrics) === entry.initialCounts : null;
  const initialHash = await mappingHash(entry.initial.text);
  const common = {
    ...base,
    model,
    mappingHash: initialHash,
    mappingValid: run.initial.accepted,
    providerError: null,
  };
  const cRecord: RunRecord = {
    ...common,
    runId: `${scenario.scenarioId}-${isB ? "B" : "C"}-t${entry.trial}`,
    config: isB ? "B" : "C",
    provenance: "real-gemini",
    promptVersion: "mapping-proposal-1.1.0",
    feedbackSet: score(initialEval?.metrics),
    holdout: score(initialHoldout?.metrics),
    semanticOverall: run.initial.semantic?.overall ?? null,
    detectionFeedbackSet: initialEval ? semanticDetection(initialEval.rows, run.initial.semantic) : null,
    detectionHoldout: initialHoldout ? semanticDetection(initialHoldout.rows, run.initial.holdoutSemantic) : null,
    revision: null,
    privacy: { bodyLeaks: leaks, promptPrivateMatches: run.initialPromptCheck.privateMatches, canaryPresent: run.initialPromptCheck.canaryPresent },
    cloudRequests: 1,
    latencyMs: { cloud: sec(entry.initial.provenance) ?? entry.initial.ms, nano: isB ? null : (entry.nanoMs ?? null), revision: null },
    humanInterventions: isB ? 0 : (entry.applied ?? []).length,
    replayMatchesBrowser: isB && entry.holdoutCounts && initialHoldout ? browserInitialMatches !== false && countsLine(initialHoldout.metrics) === entry.holdoutCounts : browserInitialMatches,
  };
  if (isB) return { records: [cRecord], run };

  // D: the revised mapping when it exists and is valid; otherwise the system keeps the initial one.
  const revisedValid = Boolean(run.revised?.accepted && run.revised.evaluation);
  const finalEval = revisedValid ? run.revised!.evaluation! : initialEval;
  const finalHoldout = revisedValid ? run.revised!.holdout! : initialHoldout;
  const holdoutCompare = initialHoldout && finalHoldout ? compareEvaluations(initialHoldout.rows, finalHoldout.rows) : null;
  let matches: boolean | null = browserInitialMatches;
  const browserRevision = browserTable(entry.revisionComparison?.metrics);
  if (browserRevision && run.revised?.evaluation && initialEval) {
    matches = matches !== false && canonicalizeJson(tableOf(initialEval.metrics, run.revised.evaluation.metrics)) === canonicalizeJson(browserRevision);
  }
  const browserHoldout = browserTable(entry.holdoutComparison?.metrics);
  if (browserHoldout && run.revised?.holdout && initialHoldout) {
    matches = matches !== false && canonicalizeJson(tableOf(initialHoldout.metrics, run.revised.holdout.metrics)) === canonicalizeJson(browserHoldout);
  }
  if (entry.decision?.verdict && run.decision) matches = matches !== false && entry.decision.verdict === run.decision.verdict;
  const sent = Boolean(entry.revisedText) || Boolean(entry.revisionBlocked);
  const dRecord: RunRecord = {
    ...common,
    runId: `${scenario.scenarioId}-D-t${entry.trial}`,
    config: "D",
    provenance: entry.revisedText ? "real-gemini-revision" : sent ? "provider-failure" : "revision-not-sent",
    promptVersion: run.feedbackVersion === "1.1.0" ? "revision-3" : "revision-2",
    mappingHash: revisedText ? await mappingHash(revisedText) : initialHash,
    mappingValid: revisedValid,
    providerError: entry.revisionBlocked ?? null,
    feedbackSet: score(finalEval?.metrics),
    holdout: score(finalHoldout?.metrics),
    semanticOverall: (revisedValid ? run.revised!.semantic : run.initial.semantic)?.overall ?? null,
    detectionFeedbackSet: finalEval ? semanticDetection(finalEval.rows, revisedValid ? run.revised!.semantic : run.initial.semantic) : null,
    detectionHoldout: finalHoldout ? semanticDetection(finalHoldout.rows, revisedValid ? run.revised!.holdoutSemantic : run.initial.holdoutSemantic) : null,
    revision: {
      feedbackVersion: run.feedbackVersion ?? null,
      semanticFindings: run.feedbackValue?.semanticFindings?.length ?? 0,
      approvedConstraints: run.feedbackValue?.approvedConstraints?.length ?? 0,
      verdict: run.decision?.verdict ?? (entry.revisionBlocked ? "BLOCKED" : sent ? null : "NOT_SENT"),
      holdoutImproved: holdoutCompare?.improved ?? 0,
      holdoutRegressed: holdoutCompare?.regressed ?? 0,
      operationRegressions: run.decision?.operationRegressions ?? 0,
      holdoutCorrectTransformationsDelta:
        finalHoldout && initialHoldout ? (finalHoldout.metrics.correctTransformations ?? 0) - (initialHoldout.metrics.correctTransformations ?? 0) : null,
    },
    privacy: {
      bodyLeaks: leaks,
      promptPrivateMatches: run.revisionPromptCheck?.privateMatches ?? null,
      canaryPresent: run.revisionPromptCheck?.canaryPresent ?? null,
    },
    cloudRequests: entry.requests.generateContent,
    latencyMs: { cloud: sec(entry.initial.provenance) ?? entry.initial.ms, nano: entry.nanoMs ?? null, revision: sec(entry.revised?.provenance) ?? entry.revisionMs ?? null },
    humanInterventions: (entry.applied ?? []).length + ((entry.authorizedConstraints ?? []).length > 0 ? 1 : 0) + (sent ? 1 : 0),
    replayMatchesBrowser: matches,
  };
  return { records: [cRecord, dRecord], run };
}

/** Configuration A: the deterministic test proposer over the same approved disclosure. */
export async function deterministicBaseline(scenario: EvaluationScenario): Promise<RunRecord> {
  const run = await runScenarioPipeline({
    scenario,
    config: "A-deterministic",
    seed: DEFAULT_TWIN_SEED,
    propose: (payload: CloudDisclosurePayload) => ({ text: JSON.stringify(deriveTestProposal(payload)), origin: "test-adapter" }),
    semantic: { authorizeConstraints: false },
  });
  const text = JSON.stringify(deriveTestProposal((await baselinePayload(scenario)) as CloudDisclosurePayload));
  return {
    runId: `${scenario.scenarioId}-A`,
    scenarioId: scenario.scenarioId,
    config: "A",
    trial: 0,
    provenance: "deterministic-baseline",
    model: null,
    promptVersion: "none",
    mappingHash: await mappingHash(text),
    mappingValid: run.initial.accepted,
    providerError: null,
    feedbackSet: score(run.initial.evaluation?.metrics),
    holdout: score(run.initial.holdout?.metrics),
    semanticOverall: run.initial.semantic?.overall ?? null,
    detectionFeedbackSet: run.initial.evaluation ? semanticDetection(run.initial.evaluation.rows, run.initial.semantic) : null,
    detectionHoldout: run.initial.holdout ? semanticDetection(run.initial.holdout.rows, run.initial.holdoutSemantic) : null,
    revision: null,
    privacy: { bodyLeaks: 0, promptPrivateMatches: run.initialPromptCheck.privateMatches, canaryPresent: run.initialPromptCheck.canaryPresent },
    cloudRequests: 0,
    latencyMs: { cloud: null, nano: null, revision: null },
    humanInterventions: 0,
    replayMatchesBrowser: null,
  };
}

async function baselinePayload(scenario: EvaluationScenario): Promise<CloudDisclosurePayload | null> {
  const prepared = prepareTwin({ records: scenario.imported.map((item) => item.record), datasetLabel: scenario.datasetLabel, seed: DEFAULT_TWIN_SEED, overrides: scenario.twinOverrides });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destinationSchema });
  return draft.ok ? draft.value.payload : null;
}

export interface CellSummary {
  scenarioId: string;
  config: ConfigLabel;
  runs: number;
  providerFailures: number;
  validMappings: number;
  holdoutTotal: number | null;
  /** Per-run holdout correct transformations, in trial order (failures excluded). */
  holdoutCorrectTransformations: number[];
  holdoutCorrectlyHandled: number[];
  holdoutIncorrect: number[];
  meanHoldoutCorrectTransformations: number | null;
  detection: SemanticDetection;
  revisionVerdicts: Record<string, number>;
  holdoutDeltas: number[];
  holdoutRegressions: number;
  operationRegressions: number;
  privacy: { bodyLeaks: number; promptPrivateMatches: number };
  cloudRequests: number;
  medianLatencyMs: { cloud: number | null; nano: number | null; revision: number | null };
  humanInterventions: number;
  replayMismatches: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function summarize(records: readonly RunRecord[]): CellSummary[] {
  const keys = [...new Set(records.map((record) => `${record.scenarioId}|${record.config}`))];
  return keys.map((key) => {
    const [scenarioId, config] = key.split("|") as [string, ConfigLabel];
    const cell = records.filter((record) => record.scenarioId === scenarioId && record.config === config).sort((a, b) => a.trial - b.trial);
    const scored = cell.filter((record) => record.holdout);
    const values = scored.map((record) => record.holdout!.correctTransformations);
    const detection = scored.reduce<SemanticDetection>(
      (sum, record) => {
        const d = record.detectionHoldout;
        return d ? { incorrect: sum.incorrect + d.incorrect, detected: sum.detected + d.detected, missed: sum.missed + d.missed, falseAlarms: sum.falseAlarms + d.falseAlarms } : sum;
      },
      { incorrect: 0, detected: 0, missed: 0, falseAlarms: 0 },
    );
    const verdicts: Record<string, number> = {};
    for (const record of cell) if (record.revision?.verdict) verdicts[record.revision.verdict] = (verdicts[record.revision.verdict] ?? 0) + 1;
    return {
      scenarioId,
      config,
      runs: cell.length,
      providerFailures: cell.filter((record) => record.provenance === "provider-failure").length,
      validMappings: cell.filter((record) => record.mappingValid).length,
      holdoutTotal: scored[0]?.holdout?.total ?? null,
      holdoutCorrectTransformations: values,
      holdoutCorrectlyHandled: scored.map((record) => record.holdout!.correctlyHandled),
      holdoutIncorrect: scored.map((record) => record.holdout!.incorrect),
      meanHoldoutCorrectTransformations: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null,
      detection,
      revisionVerdicts: verdicts,
      holdoutDeltas: cell.flatMap((record) => (record.revision?.holdoutCorrectTransformationsDelta === null || record.revision === null ? [] : [record.revision.holdoutCorrectTransformationsDelta])),
      holdoutRegressions: cell.reduce((sum, record) => sum + (record.revision?.holdoutRegressed ?? 0), 0),
      operationRegressions: cell.reduce((sum, record) => sum + (record.revision?.operationRegressions ?? 0), 0),
      privacy: {
        bodyLeaks: cell.reduce((sum, record) => sum + record.privacy.bodyLeaks, 0),
        promptPrivateMatches: cell.reduce((sum, record) => sum + (record.privacy.promptPrivateMatches ?? 0), 0),
      },
      cloudRequests: config === "C" ? cell.filter((record) => record.provenance !== "provider-failure").length : cell.reduce((sum, record) => sum + record.cloudRequests, 0),
      medianLatencyMs: {
        cloud: median(cell.flatMap((record) => (record.latencyMs.cloud === null ? [] : [record.latencyMs.cloud]))),
        nano: median(cell.flatMap((record) => (record.latencyMs.nano === null ? [] : [record.latencyMs.nano]))),
        revision: median(cell.flatMap((record) => (record.latencyMs.revision === null ? [] : [record.latencyMs.revision]))),
      },
      humanInterventions: cell.reduce((sum, record) => sum + record.humanInterventions, 0),
      replayMismatches: cell.filter((record) => record.replayMatchesBrowser === false).length,
    };
  });
}

export interface NanoAblation {
  scenarioId: string;
  trials: number;
  suggestions: Record<string, number>;
  applied: number;
  /** Trials in which the applied suggestions changed the approved disclosure payload. */
  disclosureChanged: number;
  /** Trials in which C's initial mapping differs from B's in the same trial. */
  mappingDiffersFromB: number;
  /** Per-trial holdout correct transformations, C minus B (paired by trial; failures excluded). */
  pairedHoldoutDelta: number[];
  medianNanoMs: number | null;
  nanoErrors: number;
}

export async function nanoAblation(entries: readonly LiveEntry[], records: readonly RunRecord[], scenario: EvaluationScenario): Promise<NanoAblation> {
  const cd = entries.filter((entry) => entry.check === "S8-CD" && entry.scenarioId === scenario.scenarioId);
  const suggestions: Record<string, number> = {};
  let applied = 0;
  let disclosureChanged = 0;
  const plain = await disclosureHash(scenario, {});
  for (const entry of cd) {
    for (const row of entry.nano ?? []) suggestions[row.status ?? "unknown"] = (suggestions[row.status ?? "unknown"] ?? 0) + 1;
    applied += (entry.applied ?? []).length;
    if ((entry.applied ?? []).length > 0 && (await disclosureHash(scenario, appliedOverridesFromEvidence(entry))) !== plain) disclosureChanged += 1;
  }
  const byTrial = (config: ConfigLabel) => new Map(records.filter((record) => record.scenarioId === scenario.scenarioId && record.config === config).map((record) => [record.trial, record]));
  const b = byTrial("B");
  const c = byTrial("C");
  let differs = 0;
  const paired: number[] = [];
  for (const [trial, cRecord] of c) {
    const bRecord = b.get(trial);
    if (!bRecord || !bRecord.holdout || !cRecord.holdout) continue;
    if (bRecord.mappingHash !== cRecord.mappingHash) differs += 1;
    paired.push(cRecord.holdout.correctTransformations - bRecord.holdout.correctTransformations);
  }
  return {
    scenarioId: scenario.scenarioId,
    trials: cd.length,
    suggestions,
    applied,
    disclosureChanged,
    mappingDiffersFromB: differs,
    pairedHoldoutDelta: paired,
    medianNanoMs: median(cd.flatMap((entry) => (typeof entry.nanoMs === "number" ? [entry.nanoMs] : []))),
    nanoErrors: cd.filter((entry) => Boolean(entry.nanoError)).length,
  };
}

async function disclosureHash(scenario: EvaluationScenario, extra: Record<string, TwinFieldOverride>): Promise<string> {
  const overrides: Record<string, TwinFieldOverride> = { ...scenario.twinOverrides };
  for (const [path, override] of Object.entries(extra)) overrides[path] = { ...overrides[path], ...override };
  const prepared = prepareTwin({ records: scenario.imported.map((item) => item.record), datasetLabel: scenario.datasetLabel, seed: DEFAULT_TWIN_SEED, overrides });
  if (!prepared.ok) return "twin-failed";
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destinationSchema });
  if (!draft.ok) return "disclosure-failed";
  return (await fingerprintCanonicalPayload(draft.value.payload)).payloadHash;
}
