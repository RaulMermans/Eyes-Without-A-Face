/**
 * Sprint 16B (D3) — provenance of package text, for the export privacy scan.
 *
 * The scan looks for the user's private values inside every data-bearing file.
 * A package also contains the application's own fixed text: README prose,
 * report and manifest keys, status codes, sentences built only from counts.
 * When an ordinary source value ("failed", "approved", "verified") equals a
 * word of that fixed text, the old scan blocked a safe package (Sprint 16A,
 * D3). This module lets the package builder say, per position, which text is
 * the application's own, so the scan can skip exactly that text and nothing
 * else:
 *
 *   owned`…${x}…`     the literal parts of a tagged template are compile-time
 *                     constants: application-owned by construction. Each
 *                     interpolation is user-derived (scanned) unless it is an
 *                     `appCode` (a value from a closed application vocabulary:
 *                     a status, code, version, count or hash) or another owned
 *                     text.
 *   maskJson          a JSON value whose application-owned KEYS and code VALUES
 *                     are listed by exact path (never by bare name), and whose
 *                     recognised template sentences sit at listed paths.
 *
 * The result is a parallel `scan` text in which owned spans are replaced by a
 * mask character that no private value (4+ chars) can match. The scanner
 * searches private values in `scan` only; secrets, canaries and source field
 * names are always judged on the full text. A file without a `scan` is
 * scanned exactly as before (fail-closed).
 */

/** Replaces an application-owned span in the scan text. Not a printable character; no private value contains it. */
export const MASK = "\u0000";

export interface ScanText {
  /** The real text, as written to the package. */
  readonly text: string;
  /** The same text with application-owned spans replaced by MASK. */
  readonly scan: string;
}

/** A value from a closed application vocabulary (status, code, version, count, hash, package path). Never user data. */
export interface AppCode {
  readonly appCode: string;
}

export function appCode(value: string | number | boolean): AppCode {
  return { appCode: String(value) };
}

/** User-derived text: scanned in full. */
export function userText(value: string): ScanText {
  return { text: value, scan: value };
}

type Part = string | ScanText | AppCode;

const isScanText = (value: unknown): value is ScanText => typeof value === "object" && value !== null && "text" in value && "scan" in value;
const isAppCode = (value: unknown): value is AppCode => typeof value === "object" && value !== null && "appCode" in value;
const mask = (text: string) => (text.length > 0 ? MASK : "");

/** Tagged template: literal parts are application-owned; plain string interpolations are user-derived. */
export function owned(strings: TemplateStringsArray, ...parts: Part[]): ScanText {
  let text = "";
  let scan = "";
  strings.forEach((fixed, index) => {
    text += fixed;
    scan += mask(fixed);
    if (index >= parts.length) return;
    const part = parts[index];
    if (isAppCode(part)) {
      text += part.appCode;
      scan += mask(part.appCode);
    } else if (isScanText(part)) {
      text += part.text;
      scan += part.scan;
    } else {
      text += String(part);
      scan += String(part);
    }
  });
  return { text, scan };
}

export function joinOwned(items: readonly ScanText[], separator: string): ScanText {
  return { text: items.map((item) => item.text).join(separator), scan: items.map((item) => item.scan).join(mask(separator)) };
}

/**
 * Skeleton of a sentence: digit runs become "#", and UPPER_SNAKE codes (closed
 * application vocabularies such as a revision verdict) become "@". Two sentences
 * with the same skeleton come from the same template.
 */
export function sentenceSkeleton(text: string): string {
  return text.replace(/\d+/g, "#").replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, "@");
}

/** A sentence is application-owned when its skeleton is one of the given template skeletons; otherwise it is user-derived. */
export function ownedSentence(text: string, skeletons: ReadonlySet<string>): ScanText {
  return skeletons.has(sentenceSkeleton(text)) ? { text, scan: mask(text) } : userText(text);
}

/**
 * Where application-owned text sits in one JSON file, by exact path. Paths are
 * dot-separated keys from the root; array items are written "[]"
 * (e.g. "files.[].path"). A key or value at any other path is user-derived.
 */
export interface JsonProvenance {
  /** Paths whose KEY is the application's (its last segment is the key itself). */
  keyPaths: ReadonlySet<string>;
  /** Paths whose string VALUE is an application code (one token, no spaces). */
  codePaths: ReadonlySet<string>;
  /** Paths whose string VALUE is an application sentence, recognised by skeleton. */
  sentencePaths: ReadonlySet<string>;
  sentences: ReadonlySet<string>;
}

const CODE_SHAPE = /^[^\s]+$/;

/**
 * A copy of `value` for scanning: application-owned keys and values (by exact
 * path) are replaced by MASK (keys get a unique suffix to stay distinct). Any
 * key or value not proven application-owned is kept verbatim.
 */
export function maskJson(value: unknown, provenance: JsonProvenance, path = ""): unknown {
  if (typeof value === "string") {
    if (provenance.codePaths.has(path) && CODE_SHAPE.test(value)) return MASK;
    if (provenance.sentencePaths.has(path) && provenance.sentences.has(sentenceSkeleton(value))) return MASK;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => maskJson(item, provenance, path === "" ? "[]" : `${path}.[]`));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let index = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      const maskedKey = provenance.keyPaths.has(childPath) ? `${MASK}${(index += 1)}` : key;
      out[maskedKey] = maskJson(item, provenance, childPath);
    }
    return out;
  }
  return value;
}

/** Every property path declared by a JSON Schema (objects via `properties`, arrays via `items`). */
export function schemaKeyPaths(schema: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties as Record<string, unknown>)) {
        const childPath = path === "" ? key : `${path}.${key}`;
        out.add(childPath);
        walk(child, childPath);
      }
    }
    if (record.items) walk(record.items, path === "" ? "[]" : `${path}.[]`);
    for (const combinator of ["oneOf", "anyOf", "allOf"] as const) {
      const list = record[combinator];
      if (Array.isArray(list)) list.forEach((child) => walk(child, path));
    }
  };
  walk(schema, "");
  return out;
}

/** Expand "a.b.c" into its key paths "a", "a.b", "a.b.c". */
export function withPrefixes(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const path of paths) {
    const parts = path.split(".");
    for (let i = 1; i <= parts.length; i += 1) {
      if (parts[i - 1] === "[]") continue;
      out.add(parts.slice(0, i).join("."));
    }
  }
  return out;
}
