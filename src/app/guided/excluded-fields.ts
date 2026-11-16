import type { SourceProfile } from "../../domain/profile/profile.ts";

/**
 * Sprint 16B (D4) — source fields the import accepted but the mapping cannot
 * use, with the reason. A pure reading of the local profile's warnings. Local
 * only: field names here are the user's and are never logged, sent or packed.
 */
export type ExclusionReason = "name" | "array" | "mixed" | "null";

export interface ExcludedField {
  path: string;
  reason: ExclusionReason;
}

const REASON_BY_CODE: Readonly<Record<string, ExclusionReason>> = {
  UNSUPPORTED_FIELD_NAME: "name",
  UNSUPPORTED_ARRAY: "array",
  MIXED_TYPES: "mixed",
  ALL_NULL: "null",
};

export const EXCLUSION_TEXT: Readonly<Record<ExclusionReason, string>> = {
  name: "its name has spaces or punctuation. EYES can map only names made of letters, digits and _ that start with a letter or _.",
  array: "it holds lists. Lists can't be mapped.",
  mixed: "it mixes kinds of values across records (for example text in some, numbers in others).",
  null: "it is empty in every record.",
};

export function excludedFields(profile: SourceProfile | null | undefined): ExcludedField[] {
  if (!profile) return [];
  const out: ExcludedField[] = [];
  const seen = new Set<string>();
  for (const issue of profile.issues) {
    const reason = REASON_BY_CODE[issue.code];
    if (!reason || !issue.path || seen.has(issue.path)) continue;
    seen.add(issue.path);
    out.push({ path: issue.path, reason });
  }
  return out;
}

/** A supported spelling of an unsupported name, as an example for the user (never applied automatically). */
export function suggestedRename(name: string): string {
  const leaf = name.split(".").at(-1) ?? name;
  const slug = leaf
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z_]/.test(slug) ? slug : `col_${slug}`;
}
