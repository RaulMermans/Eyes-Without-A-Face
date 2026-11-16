/**
 * Sprint 18A live AI-value scoring, L1–L5 (docs/evaluation/sprint-18a-ai-value.md).
 *
 * The browser run records only alias-level model text and prompt hashes. Each
 * scenario's twin, payload and exact outbound prompt are reconstructed here
 * with the same seed. `promptMatches` proves the scored payload is the one
 * that was previewed and sent.
 *
 * Scores the raw model text against the ground truth, valid or not. Validity
 * (L2) comes only from `convertProposal`, unchanged.
 */
import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { DEFAULT_TWIN_SEED } from "../phantom/generate.ts";
import { convertProposal, parseProposalText } from "../proposal/convert.ts";
import { createDisclosurePreview } from "../twin/authorization.ts";
import { buildDisclosureDraft, prepareTwin } from "../workflow/pipeline.ts";
import type { AiValueScenario } from "./ai-value.ts";

export interface LiveEntry {
  config: "G0" | "G1";
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
  ms: number;
}

export interface Reconstruction {
  payload: CloudDisclosurePayload;
  outboundPrompt: string;
  aliasByPath: Map<string, string>;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reconstruct(scenario: AiValueScenario, concepts: boolean): Promise<Reconstruction | null> {
  const prepared = prepareTwin({ records: scenario.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination });
  if (!draft.ok) return null;
  const preview = await createDisclosurePreview(draft.value.payload);
  return {
    payload: draft.value.payload,
    outboundPrompt: preview.outboundPrompt,
    aliasByPath: new Map(prepared.value.twin.fields.map((field) => [field.localPath, field.alias])),
  };
}

export async function promptSha256(reconstruction: Reconstruction): Promise<string> {
  return sha256(reconstruction.outboundPrompt);
}

interface Op {
  op?: unknown;
  from?: unknown;
  to?: unknown;
  params?: { unmapped?: unknown };
}

export interface EntryScore {
  config: "G0" | "G1";
  trial: number;
  index: number;
  /** A request was sent and an answer text came back. */
  answered: boolean;
  providerFailure: boolean;
  promptMatches: boolean | null;
  parseable: boolean;
  /** L1 */
  targets: number;
  correct: number;
  /** L2 */
  valid: boolean;
  /** Converter issue codes when invalid (codes only). */
  rejectionCodes: string[];
  /** L3 */
  hallucinated: number;
  /** L4 */
  invented: number;
  leakCount: number;
  ms: number;
}

export async function scoreEntry(entry: LiveEntry, scenario: AiValueScenario): Promise<EntryScore> {
  const base: EntryScore = {
    config: entry.config,
    trial: entry.trial,
    index: entry.index,
    answered: false,
    providerFailure: false,
    promptMatches: null,
    parseable: false,
    targets: Object.keys(scenario.groundTruth).length,
    correct: 0,
    valid: false,
    rejectionCodes: [],
    hallucinated: 0,
    invented: 0,
    leakCount: entry.leakCount,
    ms: entry.ms,
  };
  const reconstruction = await reconstruct(scenario, entry.config === "G1");
  if (entry.requests === 0 || !reconstruction) return base;
  const expected = await promptSha256(reconstruction);
  base.promptMatches = entry.promptSha256.length === 1 && entry.promptSha256[0] === expected && entry.previewSha256 === expected;
  const answer = entry.answers[0];
  const ok = entry.httpStatus[0] === 200 && typeof answer === "string" && answer.length > 0 && !answer.startsWith("<unreadable");
  base.answered = ok;
  base.providerFailure = !ok;
  if (!ok) return base;

  let operations: Op[] = [];
  try {
    const parsed = JSON.parse(answer) as { operations?: unknown };
    if (Array.isArray(parsed.operations)) {
      operations = parsed.operations as Op[];
      base.parseable = true;
    }
  } catch {
    base.parseable = false;
  }
  if (!base.parseable) return base;

  const aliases = new Set(reconstruction.payload.fields.map((field) => field.alias));
  const targetFields = new Map((reconstruction.payload.target?.fields ?? []).map((field) => [field.name, field]));
  for (const op of operations) {
    const froms = Array.isArray(op.from) ? op.from : op.from === undefined ? [] : [op.from];
    if (typeof op.to !== "string" || !targetFields.has(op.to) || froms.some((from) => typeof from !== "string" || !aliases.has(from))) base.hallucinated += 1;
  }
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const writers = operations.filter((op) => op.to === target);
    if (truth.source === null) {
      if (writers.length === 0) base.correct += 1;
    } else {
      const alias = reconstruction.aliasByPath.get(truth.source);
      if (writers.length === 1 && typeof writers[0]!.from === "string" && writers[0]!.from === alias) base.correct += 1;
    }
    const isEnum = targetFields.get(target)?.type === "enum";
    for (const op of writers) {
      const defaulted = op.op === "default_if_missing" || (op.op === "map_enum" && op.params?.unmapped === "default");
      if (defaulted && (truth.source === null || isEnum)) base.invented += 1;
    }
  }
  const parsedText = parseProposalText(answer);
  const converted = parsedText.ok ? convertProposal(parsedText.value, { disclosure: reconstruction.payload, mappingId: "s18a-live", origin: "gemini-cloud" }) : parsedText;
  base.valid = converted.ok;
  base.rejectionCodes = converted.ok ? [] : [...new Set(converted.issues.map((issue) => issue.code))].sort();
  return base;
}

export interface LiveSummary {
  requests: number;
  answered: number;
  providerFailures: number;
  promptMismatches: number;
  leaks: number;
  L1_correctCorrespondences: number;
  L2_validProposals: number;
  L3_hallucinatedReferences: number;
  L4_inventedValues: number;
  /** Proposals rejected by the converter, per issue code (a proposal may count under several codes). */
  rejectionCodes: Record<string, number>;
  medianMs: number | null;
}

const ratio = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 1000);

export function summarizeLive(scores: readonly EntryScore[]): LiveSummary {
  const sent = scores.filter((score) => score.promptMatches !== null);
  const answered = sent.filter((score) => score.answered);
  const times = sent.map((score) => score.ms).sort((a, b) => a - b);
  return {
    requests: sent.length,
    answered: answered.length,
    providerFailures: sent.filter((score) => score.providerFailure).length,
    promptMismatches: sent.filter((score) => score.promptMatches === false).length,
    leaks: scores.reduce((total, score) => total + score.leakCount, 0),
    // L1 over every sent request: a provider failure or unparseable answer scores 0 for its targets.
    L1_correctCorrespondences: ratio(sent.reduce((t, s) => t + s.correct, 0), sent.reduce((t, s) => t + s.targets, 0)),
    L2_validProposals: ratio(answered.filter((score) => score.valid).length, sent.length),
    L3_hallucinatedReferences: answered.reduce((t, s) => t + s.hallucinated, 0),
    L4_inventedValues: answered.reduce((t, s) => t + s.invented, 0),
    rejectionCodes: answered
      .flatMap((score) => score.rejectionCodes)
      .reduce<Record<string, number>>((counts, code) => ({ ...counts, [code]: (counts[code] ?? 0) + 1 }), {}),
    medianMs: times.length === 0 ? null : times[Math.floor(times.length / 2)]!,
  };
}

/** Per scenario: mean L1 share over trials for G1 minus G0. Positive = G1 better. */
export function pairedByScenario(scores: readonly EntryScore[]): Array<{ index: number; g0: number | null; g1: number | null }> {
  const indices = [...new Set(scores.map((score) => score.index))].sort((a, b) => a - b);
  const mean = (config: "G0" | "G1", index: number) => {
    const rows = scores.filter((score) => score.config === config && score.index === index && score.promptMatches !== null);
    if (rows.length === 0) return null;
    return ratio(rows.reduce((t, s) => t + s.correct, 0), rows.reduce((t, s) => t + s.targets, 0));
  };
  return indices.map((index) => ({ index, g0: mean("G0", index), g1: mean("G1", index) }));
}
