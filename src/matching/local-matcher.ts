/**
 * Local Semantic Matcher (Sprint 18D, ADR 0021) — `local-lexical-type`.
 *
 * Ranks at most MAX_LOCAL_CANDIDATES source fields per destination field from
 * the local profile, the imported records and the destination schema. Pure,
 * deterministic, bounded; no model, no embeddings, no network.
 *
 * It ranks; it never decides. Output carries local paths, ordinal scores and
 * fixed codes only — never a record value — and stays on this device.
 */
import type { FieldProfile } from "../domain/profile/profile.ts";
import { GENERIC_TOKENS, LEXICON, STOPWORDS } from "./lexicon.ts";
import {
  LOCAL_MATCHER_VERSION,
  MAX_LOCAL_CANDIDATES,
  type LocalCandidate,
  type LocalCandidateSet,
  type LocalContradictionCode,
  type LocalEvidenceCode,
  type LocalMatcher,
  type LocalTargetField,
} from "./types.ts";

/** Work caps: the matcher reads at most this much, whatever it is given. */
export const LOCAL_MATCHER_LIMITS = { maxTargets: 64, maxFields: 200, maxRecords: 250, maxNameLength: 128, maxDescriptionLength: 512, maxTokens: 32, maxEnumValues: 64 } as const;
/** A plain-text field with more distinct values than this is not a category source. */
const MAX_CATEGORY_LABELS = 24;
/** Top-1 must lead the runner-up by at least this many points to be "clear". */
const CLEAR_MARGIN = 2;

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

const fold = (text: string): string => text.replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Split a name (camel, Pascal, snake, kebab, ALL CAPS, digits) into lowercase raw tokens. */
export function splitName(name: string): string[] {
  return fold(name.slice(0, LOCAL_MATCHER_LIMITS.maxNameLength))
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((token) => token.split(/(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0 && !/^[0-9]+$/.test(token))
    .slice(0, LOCAL_MATCHER_LIMITS.maxTokens);
}

const lookup = (word: string): readonly string[] | undefined => LEXICON.get(word);

/** Segment a compound ("kundennummer") into lexicon words, longest pieces first. */
function segment(word: string, depth = 0): string[] | null {
  if (depth > 3) return null;
  for (let cut = word.length - 2; cut >= 3; cut -= 1) {
    const head = lookup(word.slice(0, cut));
    if (!head) continue;
    const rest = word.slice(cut);
    // German/Dutch linking letter: "geburt-s-datum".
    const restTokens = lookup(rest) ?? (rest.length > 3 && /^[sn]/.test(rest) ? lookup(rest.slice(1)) : undefined);
    if (restTokens) return [...head, ...restTokens];
    const deeper = segment(rest, depth + 1);
    if (deeper) return [...head, ...deeper];
  }
  return null;
}

/** Concept tokens for one raw token, plus whether the lexicon translated it. */
function canonical(raw: string): { tokens: string[]; translated: boolean } {
  const direct = lookup(raw);
  if (direct) return { tokens: [...direct], translated: !(direct.length === 1 && direct[0] === raw) };
  if (raw.length > 3 && raw.endsWith("s") && lookup(raw.slice(0, -1))) return canonical(raw.slice(0, -1));
  if (raw.length >= 6) {
    const parts = segment(raw);
    if (parts) return { tokens: parts, translated: true };
  }
  return { tokens: [raw], translated: false };
}

interface Tok {
  token: string;
  weight: number;
}

function weigh(token: string, base: number): number {
  return base * (GENERIC_TOKENS.has(token) ? 0.4 : 1);
}

/** Canonical weighted tokens of a name; `raw` keeps the surface tokens for the lexical/translated split. */
function nameTokens(path: string, ancestorWeight: number): { toks: Tok[]; raw: Set<string> } {
  const segments = path.split(".");
  const toks: Tok[] = [];
  const raw = new Set<string>();
  segments.forEach((segmentName, index) => {
    const base = index === segments.length - 1 ? 1 : ancestorWeight;
    for (const word of splitName(segmentName)) {
      raw.add(word);
      for (const token of canonical(word).tokens) toks.push({ token, weight: weigh(token, base) });
    }
  });
  return { toks: dedupe(toks), raw };
}

function dedupe(toks: Tok[]): Tok[] {
  const best = new Map<string, number>();
  for (const { token, weight } of toks) best.set(token, Math.max(best.get(token) ?? 0, weight));
  return [...best.entries()].map(([token, weight]) => ({ token, weight }));
}

/** Description words → canonical tokens (stopwords dropped). Bag of words: order and phrasing have no effect. */
export function descriptionTokens(text: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const words = fold(text.slice(0, LOCAL_MATCHER_LIMITS.maxDescriptionLength))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^[0-9]+$/.test(word));
  for (const word of words.slice(0, 64)) for (const token of canonical(word).tokens) out.add(token);
  return out;
}

const stem = (a: string, b: string): boolean => a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4);

/** Weighted F1 between target and source canonical tokens (exact = 1, shared 4-letter stem = 0.6). */
function nameSimilarity(target: Tok[], source: Tok[]): number {
  if (target.length === 0 || source.length === 0) return 0;
  const hit = (token: string, pool: Tok[]): number => (pool.some((other) => other.token === token) ? 1 : pool.some((other) => stem(other.token, token)) ? 0.6 : 0);
  const recall = target.reduce((sum, item) => sum + item.weight * hit(item.token, source), 0) / target.reduce((sum, item) => sum + item.weight, 0);
  const precision = source.reduce((sum, item) => sum + item.weight * hit(item.token, target), 0) / source.reduce((sum, item) => sum + item.weight, 0);
  return recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
}

/* ------------------------------------------------------------------ */
/* Value statistics (computed once per field; values never leave here) */
/* ------------------------------------------------------------------ */

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Own-property dot-path read; never walks a prototype. */
function readOwn(record: unknown, path: string): unknown {
  let current: unknown = record;
  for (const key of path.split(".")) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERSON_NAME = /^\p{Lu}[\p{Ll}'’-]+(?:\s+(?:\p{Ll}{1,4}\s+)*\p{Lu}[\p{Ll}'’-]+){1,3}$/u;
const normLabel = (label: string): string => fold(label).toLowerCase().replace(/[^a-z0-9]+/g, "");

interface FieldStats {
  emailShare: number;
  personNameShare: number;
  /** Normalized distinct labels (category-like fields only), else null. */
  labels: string[] | null;
  rowCounter: boolean;
}

function fieldStats(field: FieldProfile, records: readonly unknown[]): FieldStats {
  let strings = 0;
  let emails = 0;
  let names = 0;
  const counts = new Map<string, number>();
  const ints: number[] = [];
  for (const record of records) {
    const value = readOwn(record, field.path);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") continue;
      strings += 1;
      if (EMAIL.test(trimmed)) emails += 1;
      if (PERSON_NAME.test(trimmed)) names += 1;
      if (counts.size <= MAX_CATEGORY_LABELS) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    } else if (typeof value === "number" && Number.isInteger(value)) ints.push(value);
  }
  let labels: string[] | null = null;
  if (field.categories && field.categories.length > 0) labels = field.categories.map((item) => normLabel(item.value));
  else if (field.type === "string" && counts.size >= 2 && counts.size <= MAX_CATEGORY_LABELS && counts.size < strings) labels = [...counts.keys()].map(normLabel);
  ints.sort((a, b) => a - b);
  const rowCounter = ints.length >= 3 && ints.every((value, index) => index === 0 || value - (ints[index - 1] as number) === 1);
  return { emailShare: strings ? emails / strings : 0, personNameShare: strings ? names / strings : 0, labels: labels ? [...new Set(labels)].sort() : null, rowCounter };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const ID_TOKENS = new Set(["id", "ident", "identifier", "uuid", "guid", "key", "ref", "reference", "number", "no", "nr", "num", "nummer", "numero", "code"]);
const NOT_ID_CONTEXT = new Set(["phone", "mobile", "postal", "tax", "street", "address", "house"]);

function isIdTarget(target: LocalTargetField, raw: Set<string>, toks: Tok[]): boolean {
  if (target.format === "uuid") return true;
  if (target.type !== "string" && target.type !== "integer") return false;
  return [...raw].some((token) => ID_TOKENS.has(token)) && !toks.some((item) => NOT_ID_CONTEXT.has(item.token));
}

const TEXTUAL = new Set(["string", "enum", "date", "datetime"]);

interface Scored {
  path: string;
  score: number;
  evidence: Set<LocalEvidenceCode>;
  contradictions: Set<LocalContradictionCode>;
}

/** Evidence that can justify offering a candidate (type alone cannot, except for numeric/boolean destinations). */
const QUALIFYING: ReadonlySet<LocalEvidenceCode> = new Set(["name-lexical", "name-translated", "description-lexical", "concept", "format", "label-overlap", "identifier-shape"]);

function scoreField(
  target: LocalTargetField,
  t: { toks: Tok[]; raw: Set<string>; desc: Set<string>; id: boolean; enumNorm: string[] },
  field: FieldProfile,
  stats: FieldStats,
  concept: string | undefined,
): Scored | null {
  const evidence = new Set<LocalEvidenceCode>();
  const contradictions = new Set<LocalContradictionCode>();
  let score = 0;

  // Hard compatibility gate (as the baseline): incompatible fields are never candidates.
  if (target.type === "enum") {
    if (!stats.labels) return null;
    score += 1;
    evidence.add("type");
  } else if (target.format === "email") {
    if (field.type !== "string") return null;
    evidence.add("type");
    if (field.format === "email" || stats.emailShare >= 0.8) {
      score += 4;
      evidence.add("format");
    } else {
      score -= 3;
      contradictions.add("format-mismatch");
    }
  } else if (target.format === "date" || target.format === "date-time") {
    if (field.type !== "date" && field.type !== "datetime") return null;
    evidence.add("type").add("format");
    score += field.type === (target.format === "date" ? "date" : "datetime") ? 3 : 2;
  } else if (target.type === "string") {
    if (!TEXTUAL.has(field.type)) return null;
    evidence.add("type");
    if (field.type === "date" || field.type === "datetime") {
      score -= 1;
      contradictions.add("type-mismatch");
    } else score += 1;
  } else if (target.type === "integer" || target.type === "number") {
    if (!(field.type === "integer" || (target.type === "number" && field.type === "number"))) return null;
    score += 2;
    evidence.add("type");
  } else if (target.type === "boolean") {
    if (field.type !== "boolean") return null;
    score += 2;
    evidence.add("type");
  } else return null;

  // Names: raw overlap is "lexical"; overlap only after the lexicon is "translated".
  const source = nameTokens(field.path, 0.6);
  const similarity = nameSimilarity(t.toks, source.toks);
  if (similarity > 0) {
    score += 7 * similarity;
    const leafRaw = splitName(field.path.split(".").at(-1) ?? "");
    evidence.add([...t.raw].some((token) => leafRaw.includes(token) || source.raw.has(token)) ? "name-lexical" : "name-translated");
  }

  // Destination description (bag of words, bounded contribution).
  const specific = source.toks.filter((item) => !GENERIC_TOKENS.has(item.token));
  const described = specific.filter((item) => t.desc.has(item.token));
  if (described.length > 0) {
    score += Math.min(2, 1.5 * (described.reduce((sum, item) => sum + item.weight, 0) / specific.reduce((sum, item) => sum + item.weight, 0)) + 0.5);
    evidence.add("description-lexical");
  }

  // Concept claim (fixed wording from the twin): a claim, scored as a hint.
  if (concept) {
    const claim = splitName(concept).flatMap((word) => canonical(word).tokens);
    const wanted = new Set([...t.toks.map((item) => item.token), ...t.desc]);
    const shared = claim.filter((token) => wanted.has(token));
    if (shared.some((token) => !GENERIC_TOKENS.has(token))) {
      score += 2;
      evidence.add("concept");
    } else if (shared.length > 0) score += 0.5;
  }

  // Enumerations: label list size and spelling.
  if (target.type === "enum" && stats.labels) {
    const allowed = t.enumNorm.length;
    if (allowed > 0 && Math.abs(stats.labels.length - allowed) <= 1) {
      score += 1.5;
      evidence.add("category-shape");
    } else if (allowed > 0 && stats.labels.length <= 2 * allowed && 2 * stats.labels.length >= allowed) score += 0.5;
    const translatedLabels = new Set(stats.labels.flatMap((label) => [label, ...(lookup(label) ?? [])]));
    const matched = t.enumNorm.filter((value) => translatedLabels.has(value)).length;
    if (matched > 0) {
      score += 1 + 3 * (matched / Math.max(1, allowed));
      evidence.add("label-overlap");
    }
  }

  // Identifiers.
  if (t.id) {
    const unique = field.allValuesUnique && field.presentCount >= 2;
    if (field.format === "email" || stats.emailShare >= 0.8) {
      score -= 3;
      contradictions.add("email-as-identifier");
    } else if (unique && !field.containsSpaces && (field.type === "string" || field.type === "integer")) {
      score += 2;
      evidence.add("identifier-shape");
    }
    if (stats.rowCounter) {
      score -= 2;
      contradictions.add("row-counter");
    }
  } else if (target.type === "string" && field.allValuesUnique && !field.containsSpaces && field.type === "string" && stats.emailShare < 0.8) score -= 0.5;
  if (target.format !== "email" && !t.id && stats.emailShare >= 0.8) score -= 1;

  // Person-name values offered for a fixed list or an identifier.
  if ((t.id || target.type === "enum") && stats.personNameShare >= 0.6) {
    score -= 3;
    contradictions.add("person-name-values");
  }

  if (target.required && field.missingCount === 0 && field.nullCount === 0) {
    score += 0.5;
    evidence.add("completeness");
  }

  const qualifies = [...evidence].some((code) => QUALIFYING.has(code)) || ((target.type === "integer" || target.type === "number" || target.type === "boolean") && !t.id);
  if (!qualifies || score <= 0) return null;
  return { path: field.path, score: Math.round(score * 1000) / 1000, evidence, contradictions };
}

const EVIDENCE_ORDER: readonly LocalEvidenceCode[] = ["name-lexical", "name-translated", "description-lexical", "type", "format", "concept", "category-shape", "label-overlap", "identifier-shape", "completeness", "embedding"];
const CONTRADICTION_ORDER: readonly LocalContradictionCode[] = ["type-mismatch", "format-mismatch", "person-name-values", "row-counter", "email-as-identifier"];

export const matchLocally: LocalMatcher = (input) => {
  const fields = input.profile.fields.slice(0, LOCAL_MATCHER_LIMITS.maxFields).filter((field) => field.supported);
  const records = input.records.slice(0, LOCAL_MATCHER_LIMITS.maxRecords);
  const stats = new Map(fields.map((field) => [field.path, fieldStats(field, records)]));
  const concepts = input.conceptsByPath;
  const conceptOf = (path: string): string | undefined => (concepts && Object.hasOwn(concepts, path) && typeof concepts[path] === "string" ? concepts[path] : undefined);

  return input.targets.slice(0, LOCAL_MATCHER_LIMITS.maxTargets).map((target): LocalCandidateSet => {
    const name = nameTokens(target.name, 0.6);
    const t = {
      toks: name.toks,
      raw: name.raw,
      desc: descriptionTokens(target.localDescription),
      id: isIdTarget(target, name.raw, name.toks),
      enumNorm: [...new Set((target.enumValues ?? []).slice(0, LOCAL_MATCHER_LIMITS.maxEnumValues).map(normLabel))],
    };
    const scored = fields
      .map((field) => scoreField(target, t, field, stats.get(field.path) as FieldStats, conceptOf(field.path)))
      .filter((item): item is Scored => item !== null)
      .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, MAX_LOCAL_CANDIDATES);
    const candidates: LocalCandidate[] = scored.map((item, index) => ({
      path: item.path,
      rank: index + 1,
      score: item.score,
      evidence: EVIDENCE_ORDER.filter((code) => item.evidence.has(code)),
      contradictions: CONTRADICTION_ORDER.filter((code) => item.contradictions.has(code)),
    }));
    const [first, second] = candidates;
    const uncertainty = !first ? "none" : !second || first.score - second.score >= CLEAR_MARGIN ? "clear" : "ambiguous";
    return { matcherVersion: LOCAL_MATCHER_VERSION, target: target.name, candidates, uncertainty, provenance: "local-lexical-type" };
  });
};
