/**
 * Sprint 18A AI-value experiment, offline metrics O1–O5
 * (docs/evaluation/sprint-18a-ai-value.md). Pure functions: the caller loads
 * the scenarios. T0 = pre-18A twin (`concepts: false`), T1 = concept-bearing
 * twin. Nothing here sends, approves or calls a model.
 */
import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { DEFAULT_TWIN_SEED } from "../phantom/generate.ts";
import { findPrivateValueLeaks } from "../privacy/leak-scan.ts";
import { buildDisclosureDraft, prepareTwin, type PreparedTwin } from "../workflow/pipeline.ts";

export interface AiValueScenario {
  scenarioId: string;
  split: "dev" | "holdout";
  records: Record<string, unknown>[];
  destination: Record<string, unknown>;
  groundTruth: Record<string, { source: string | null; dateFormat?: string }>;
  confusablePairs: Array<{ kind: string; fields: [string, string]; correctFor: string }>;
  sourceConcepts: Record<string, string>;
}

export interface ScenarioMetrics {
  scenarioId: string;
  ok: boolean;
  failure?: string;
  /** O1: ground-truth targets with a non-null source; how many sources are uniquely described. */
  gtSources: number;
  distinguishable: number;
  /** O2 */
  pairs: number;
  pairsSeparated: number;
  /** O3: fields with a stated concept; how many equal the author's label. */
  conceptsStated: number;
  conceptsCorrect: number;
  /** O4: ground-truth-referenced source fields with any concept. */
  gtSourcesWithConcept: number;
  /** O5 */
  leakFindings: number;
  verbatimKeys: number;
  /** Local detail for dev tuning only (never computed into holdout output). */
  wrong: Array<{ path: string; stated: string; truth: string }>;
  missed: Array<{ path: string; truth: string }>;
}

/** A key that is not a plain word: contains `_`, a digit or an inner capital. Matched case-sensitively. */
function isCodedKey(segment: string): boolean {
  return /[_0-9]/.test(segment) || /[a-z][A-Z]/.test(segment);
}

export function scoreScenario(scenario: AiValueScenario, concepts: boolean, detail = false): ScenarioMetrics {
  const empty: ScenarioMetrics = {
    scenarioId: scenario.scenarioId,
    ok: false,
    gtSources: 0,
    distinguishable: 0,
    pairs: scenario.confusablePairs.length,
    pairsSeparated: 0,
    conceptsStated: 0,
    conceptsCorrect: 0,
    gtSourcesWithConcept: 0,
    leakFindings: 0,
    verbatimKeys: 0,
    wrong: [],
    missed: [],
  };
  const prepared = prepareTwin({ records: scenario.records, datasetLabel: "ai-value", seed: DEFAULT_TWIN_SEED, concepts, labelCategories: false });
  if (!prepared.ok) return { ...empty, failure: `twin-${prepared.stage}` };
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination });
  if (!draft.ok) return { ...empty, failure: "disclosure" };
  return score(scenario, prepared.value, draft.value.payload, detail);
}

function score(scenario: AiValueScenario, prepared: PreparedTwin, payload: CloudDisclosurePayload, detail: boolean): ScenarioMetrics {
  const aliasByPath = new Map(prepared.twin.fields.map((field) => [field.localPath, field.alias]));
  const viewByPath = new Map(prepared.twin.fields.map((field) => [field.localPath, field]));
  const disclosed = new Map(payload.fields.map((field) => [field.alias, field]));
  const signature = (alias: string | undefined) => {
    const field = alias ? disclosed.get(alias) : undefined;
    return field ? `${field.type}|${field.semanticDescriptor}` : null;
  };
  const signatures = payload.fields.map((field) => `${field.type}|${field.semanticDescriptor}`);

  const gtPaths = [...new Set(Object.values(scenario.groundTruth).map((entry) => entry.source).filter((source): source is string => source !== null))];
  let gtSources = 0;
  let distinguishable = 0;
  for (const entry of Object.values(scenario.groundTruth)) {
    if (entry.source === null) continue;
    gtSources += 1;
    const own = signature(aliasByPath.get(entry.source));
    if (own !== null && signatures.filter((item) => item === own).length === 1) distinguishable += 1;
  }

  let pairsSeparated = 0;
  for (const pair of scenario.confusablePairs) {
    const a = signature(aliasByPath.get(pair.fields[0]));
    const b = signature(aliasByPath.get(pair.fields[1]));
    if (a !== null && b !== null && a !== b) pairsSeparated += 1;
  }

  let conceptsStated = 0;
  let conceptsCorrect = 0;
  const wrong: ScenarioMetrics["wrong"] = [];
  for (const view of prepared.twin.fields) {
    if (!view.concept) continue;
    conceptsStated += 1;
    const truth = scenario.sourceConcepts[view.localPath] ?? "other";
    if (truth === view.concept.concept) conceptsCorrect += 1;
    else if (detail) wrong.push({ path: view.localPath, stated: view.concept.concept, truth });
  }
  const gtSourcesWithConcept = gtPaths.filter((path) => viewByPath.get(path)?.concept).length;
  const missed = detail
    ? gtPaths.filter((path) => !viewByPath.get(path)?.concept).map((path) => ({ path, truth: scenario.sourceConcepts[path] ?? "other" }))
    : [];

  const leakFindings = findPrivateValueLeaks(payload, prepared.privateStrings).length;
  const { target: _target, ...sourceDerived } = payload;
  const text = JSON.stringify(sourceDerived);
  const codedKeys = new Set(prepared.profile.fields.flatMap((field) => field.path.split(".")).filter(isCodedKey));
  const verbatimKeys = [...codedKeys].filter((key) => text.includes(key)).length;

  return {
    scenarioId: scenario.scenarioId,
    ok: true,
    gtSources,
    distinguishable,
    pairs: scenario.confusablePairs.length,
    pairsSeparated,
    conceptsStated,
    conceptsCorrect,
    gtSourcesWithConcept,
    leakFindings,
    verbatimKeys,
    wrong,
    missed,
  };
}

export interface SplitSummary {
  scenarios: number;
  failures: number;
  O1_distinguishability: number;
  O2_confusableSeparation: number;
  O3_conceptPrecision: number | null;
  O4_conceptCoverage: number;
  O5_privacyFindings: number;
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 1000);

export function summarize(metrics: readonly ScenarioMetrics[]): SplitSummary {
  const sum = (key: keyof ScenarioMetrics) => metrics.reduce((total, item) => total + (item[key] as number), 0);
  const stated = sum("conceptsStated");
  return {
    scenarios: metrics.length,
    failures: metrics.filter((item) => !item.ok).length,
    O1_distinguishability: ratio(sum("distinguishable"), sum("gtSources")),
    O2_confusableSeparation: ratio(sum("pairsSeparated"), sum("pairs")),
    O3_conceptPrecision: stated === 0 ? null : ratio(sum("conceptsCorrect"), stated),
    O4_conceptCoverage: ratio(sum("gtSourcesWithConcept"), sum("gtSources")),
    O5_privacyFindings: sum("leakFindings") + sum("verbatimKeys") + metrics.filter((item) => item.failure === "twin-twin").length,
  };
}
