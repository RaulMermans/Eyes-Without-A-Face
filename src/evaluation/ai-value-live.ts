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
import { buildCloudPromptText } from "../inference/prompts.ts";
import { createDisclosurePreview } from "../twin/authorization.ts";
import { buildDisclosureDraft, prepareTwin } from "../workflow/pipeline.ts";
import type { AiValueScenario } from "./ai-value.ts";

export type LiveConfig = "G0" | "G1" | "P0" | "P1";

export interface LiveEntry {
  config: LiveConfig;
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

/**
 * `prompt: "sprint3"` rebuilds the pre-A.5 initial prompt (MAPPING_PROPOSAL_INSTRUCTIONS
 * via the unchanged `buildCloudPromptText`); `"current"` is what this app sends now.
 */
export async function reconstruct(scenario: AiValueScenario, concepts: boolean, prompt: "current" | "sprint3" = "current"): Promise<Reconstruction | null> {
  const prepared = prepareTwin({ records: scenario.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts });
  if (!prepared.ok) return null;
  const draft = buildDisclosureDraft({ prepared: prepared.value, targetSchema: scenario.destination });
  if (!draft.ok) return null;
  const preview = await createDisclosurePreview(draft.value.payload);
  return {
    payload: draft.value.payload,
    outboundPrompt: prompt === "sprint3" ? buildCloudPromptText(preview.canonicalJson, draft.value.payload.schemaVersion) : preview.outboundPrompt,
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
  config: LiveConfig;
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
  /** A.5: every default_if_missing, and every map_enum with unmapped=default, on any target. */
  inventedAll: number;
  /** A.5 C: targets that are neither category targets nor empty targets. */
  mappableTargets: number;
  mappableCorrect: number;
  /** A.5 W: enum targets whose ground-truth source is a category field (no labels shared). */
  categoryTargets: number;
  categoryUnwritten: number;
  /** A.5 N: targets whose ground truth is null. */
  emptyTargets: number;
  emptyUnwritten: number;
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
    inventedAll: 0,
    mappableTargets: 0,
    mappableCorrect: 0,
    categoryTargets: 0,
    categoryUnwritten: 0,
    emptyTargets: 0,
    emptyUnwritten: 0,
    leakCount: entry.leakCount,
    ms: entry.ms,
  };
  // G0: pre-18A twin + Sprint 3 prompt; G1 and P0: concept twin + Sprint 3 prompt; P1: concept twin + current prompt.
  const reconstruction = await reconstruct(scenario, entry.config !== "G0", entry.config === "P1" ? "current" : "sprint3");
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
  const enumAliases = new Set(reconstruction.payload.fields.filter((field) => field.type === "enum").map((field) => field.alias));
  for (const op of operations) {
    if (op.op === "default_if_missing" || (op.op === "map_enum" && op.params?.unmapped === "default")) base.inventedAll += 1;
  }
  for (const [target, truth] of Object.entries(scenario.groundTruth)) {
    const writers = operations.filter((op) => op.to === target);
    const sourceAlias = truth.source === null ? undefined : reconstruction.aliasByPath.get(truth.source);
    const isCategoryTarget = targetFields.get(target)?.type === "enum" && sourceAlias !== undefined && enumAliases.has(sourceAlias);
    if (truth.source === null) {
      base.emptyTargets += 1;
      if (writers.length === 0) base.emptyUnwritten += 1;
    } else if (isCategoryTarget) {
      base.categoryTargets += 1;
      if (writers.length === 0) base.categoryUnwritten += 1;
    } else {
      base.mappableTargets += 1;
      if (writers.length === 1 && typeof writers[0]!.from === "string" && writers[0]!.from === sourceAlias) base.mappableCorrect += 1;
    }
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

export interface PlannerSummary {
  requests: number;
  answered: number;
  providerFailures: number;
  promptMismatches: number;
  leaks: number;
  /** V: valid proposals over sent requests (a provider failure is not valid). */
  V_validProposals: number;
  /** I: invented values (any default). */
  I_inventedValues: number;
  /** C: correct correspondences on mappable targets, over sent requests. */
  C_mappableCorrect: number;
  /** W: category targets left unwritten, over answered proposals. */
  W_categoryAbstention: number;
  /** N: empty targets left unwritten, over answered proposals. */
  N_emptyAbstention: number;
  /** H: hallucinated references. */
  H_hallucinatedReferences: number;
  L1_correctCorrespondences: number;
  rejectionCodes: Record<string, number>;
  medianMs: number | null;
}

export function summarizePlanner(scores: readonly EntryScore[]): PlannerSummary {
  const base = summarizeLive(scores);
  const sent = scores.filter((score) => score.promptMatches !== null);
  const answered = sent.filter((score) => score.answered && score.parseable);
  const sum = (rows: readonly EntryScore[], key: keyof EntryScore) => rows.reduce((total, row) => total + (row[key] as number), 0);
  return {
    requests: base.requests,
    answered: base.answered,
    providerFailures: base.providerFailures,
    promptMismatches: base.promptMismatches,
    leaks: base.leaks,
    V_validProposals: base.L2_validProposals,
    I_inventedValues: sum(answered, "inventedAll"),
    // Failed or unparseable requests contribute their targets with 0 correct.
    C_mappableCorrect: ratio(sum(sent, "mappableCorrect"), sum(sent, "mappableTargets")),
    W_categoryAbstention: ratio(sum(answered, "categoryUnwritten"), sum(answered, "categoryTargets")),
    N_emptyAbstention: ratio(sum(answered, "emptyUnwritten"), sum(answered, "emptyTargets")),
    H_hallucinatedReferences: base.L3_hallucinatedReferences,
    L1_correctCorrespondences: base.L1_correctCorrespondences,
    rejectionCodes: base.rejectionCodes,
    medianMs: base.medianMs,
  };
}

/**
 * Request-body privacy scan used by the live harness and re-run by the scorer.
 *
 * Terms: coded source keys and source string values of 6+ characters. The
 * reviewed destination `target` is approved disclosure: its names and enum
 * values are blanked as exact quoted strings first (the `checkOutboundPrompt`
 * method of src/evaluation/benchmark.ts), so a source value that is only a
 * substring of a destination value ("refund" in "refunded", Sprint 18A.5 trace)
 * is not a finding, while the same value anywhere else still is. Nothing is
 * allowlisted by word.
 */
export function privateTermsInBody(body: string, scenario: Pick<AiValueScenario, "records" | "destination">): string[] {
  const approved = new Set<string>();
  const visitSchema = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
        approved.add(key);
        visitSchema(child);
      }
    }
    if (Array.isArray(record.enum)) for (const value of record.enum) if (typeof value === "string") approved.add(value);
  };
  visitSchema(scenario.destination);
  const approvedLower = new Set([...approved].map((term) => term.toLowerCase()));
  const terms = new Set<string>();
  const visit = (value: unknown, key?: string) => {
    if (key && (/[_0-9]/.test(key) || /[a-z][A-Z]/.test(key)) && !approvedLower.has(key.toLowerCase())) terms.add(key);
    if (typeof value === "string" && value.trim().length >= 6 && !approvedLower.has(value.trim().toLowerCase())) terms.add(value.trim());
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k);
  };
  for (const record of scenario.records) visit(record);
  let residual = body;
  for (const term of [...approved].sort((a, b) => b.length - a.length)) {
    // Plain JSON and JSON-in-a-JSON-string (the request body embeds the prompt as a string).
    residual = residual.split(`"${term}"`).join('" "').split(`\\"${term}\\"`).join('\\" \\"');
  }
  return [...terms].filter((term) => residual.includes(term));
}

/** Offline re-scan of a recorded request: the reconstructed prompt is hash-proven identical to the one sent. */
export async function rescanEntry(entry: LiveEntry, scenario: AiValueScenario): Promise<number | null> {
  if (entry.requests === 0) return null;
  const reconstruction = await reconstruct(scenario, entry.config !== "G0", entry.config === "P1" ? "current" : "sprint3");
  if (!reconstruction) return null;
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: reconstruction.outboundPrompt }] }] });
  return privateTermsInBody(body, scenario).length;
}
