/**
 * Destination semantic projection (Sprint 18D, ADR 0021 §B).
 *
 * A destination schema's own `description` (or `title`) may tell Gemini what
 * a field MEANS ("current lifecycle state of the customer account"), which
 * names and types alone cannot. It may also carry things that must never be
 * forwarded: customer data, identifiers, credentials, URLs, the source's own
 * field names, or instruction-like text. So nothing is forwarded verbatim by
 * default: each description passes this fail-closed sanitizer, and only what
 * survives is projected into a cloud-disclosure 1.4.0 `target` and shown in
 * the review before approval. A description that fails any rule is dropped
 * (the field is still described by name and type), with a local reason code.
 *
 * Rules (first that fails drops the description):
 *   1. first sentence only, whitespace collapsed, 3–160 characters;
 *   2. letters, spaces and . , ; : ' ( ) - / & only (no digits runs ≥ 3, no @, no //, no quotes, braces or code);
 *   3. no word longer than 24 characters (secret- or token-like);
 *   4. no instruction- or credential-like vocabulary (`INSTRUCTION_TERMS`);
 *   5. no private source value and no local source field-name segment (≥ 4 characters, case-insensitive).
 */

export const MAX_TARGET_DESCRIPTION = 160;

export type DescriptionDropReason =
  | "EMPTY"
  | "TOO_LONG"
  | "CHARACTERS"
  | "DIGITS"
  | "LONG_TOKEN"
  | "INSTRUCTION_LIKE"
  | "PRIVATE_VALUE"
  | "SOURCE_FIELD_NAME";

export type SanitizedDescription = { ok: true; text: string } | { ok: false; reason: DescriptionDropReason };

const ALLOWED = /^[\p{L}\p{M} .,;:'()\-/&\d]+$/u;
const INSTRUCTION_TERMS = [
  "ignore", "disregard", "instruction", "prompt", "assistant", "gemini", "openai", "chatgpt", "llm",
  "override", "jailbreak", "respond", "response", "reply", "output", "json", "javascript", "script", "execute", "eval",
  "token", "password", "passwd", "secret", "apikey", "credential", "bearer", "forget", "you",
];
// Prefix match at a word start ("tokens", "instructions"); "you" must be a whole word.
const INSTRUCTION = new RegExp(`(^|[^\\p{L}])(${INSTRUCTION_TERMS.map((term) => (term === "you" ? "you(?![\\p{L}])" : term)).join("|")})`, "iu");

export interface DescriptionGuards {
  /** Normalized private source values (lower-case), e.g. `PreparedTwin.privateStrings`. */
  privateStrings: ReadonlySet<string>;
  /** Local source field paths (dot-separated). */
  sourcePaths: readonly string[];
}

export function sanitizeTargetDescription(raw: unknown, guards: DescriptionGuards): SanitizedDescription {
  if (typeof raw !== "string") return { ok: false, reason: "EMPTY" };
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  // A sentence ends after a word of ≥ 3 letters, so abbreviations ("e.g.", "i.e.") do not end it.
  const sentence = (collapsed.match(/^.*?[^\s.]{3}[.!?](?=\s|$)/u)?.[0] ?? collapsed).trim();
  if (sentence.length < 3) return { ok: false, reason: "EMPTY" };
  if (sentence.length > MAX_TARGET_DESCRIPTION) return { ok: false, reason: "TOO_LONG" };
  if (!ALLOWED.test(sentence) || sentence.includes("//")) return { ok: false, reason: "CHARACTERS" };
  if (/\d{3,}/u.test(sentence)) return { ok: false, reason: "DIGITS" };
  if (sentence.split(/[\s/]+/u).some((word) => word.length > 24)) return { ok: false, reason: "LONG_TOKEN" };
  if (INSTRUCTION.test(sentence)) return { ok: false, reason: "INSTRUCTION_LIKE" };
  const lowered = sentence.toLowerCase();
  for (const value of guards.privateStrings) {
    if (value.length >= 4 && lowered.includes(value)) return { ok: false, reason: "PRIVATE_VALUE" };
  }
  const segments = new Set(guards.sourcePaths.flatMap((path) => path.split(".")).filter((name) => name.length >= 4).map((name) => name.toLowerCase()));
  for (const segment of segments) {
    if (lowered.includes(segment)) return { ok: false, reason: "SOURCE_FIELD_NAME" };
  }
  return { ok: true, text: sentence };
}
