/**
 * Private semantic understanding (Sprint 7, Workstream A).
 *
 * Gemini Nano (ONLY_ON_DEVICE) may read a BOUNDED local context for one field:
 * its original name, at most five distinct sampled values (each truncated),
 * deterministic profile facts, sibling field names, and destination field
 * names. The context and Nano's rationale never leave this browser: they are
 * not part of any disclosure, log, telemetry or persisted state.
 *
 * Nano's output is validated against the deterministic profile, which stays
 * authoritative. A suggestion can only refine meaning (role) or resolve a
 * proven ambiguity (day/month order); it can never contradict observed facts,
 * and it changes the twin only after the user applies it (TwinFieldOverride).
 */
import type { FieldProfile } from "../domain/profile/profile.ts";
import { dateOrderOverrideAllowed, inferRole, isSemanticRole, roleCompatible, type SemanticRole } from "../phantom/roles.ts";
import type { TwinFieldOverride } from "../phantom/generate.ts";

export const PRIVATE_CONTEXT_LIMITS = {
  maxSamples: 5,
  maxSampleChars: 48,
  maxSiblings: 12,
  maxTargets: 16,
} as const;

export interface PrivateFieldContext {
  fieldAlias: string;
  /** Original (private) field name. Local only. */
  fieldName: string;
  /** Up to five distinct sampled values, truncated. Local only. */
  samples: string[];
  facts: string[];
  siblingNames: string[];
  targetFields: string[];
}

export interface PrivateFieldSemantics {
  fieldAlias: string;
  semanticRole: SemanticRole;
  valueKind: "string" | "number" | "boolean" | "category" | "date" | "datetime";
  dateFormat: "none" | "YYYY-MM-DD" | "ISO-8601" | "MM/DD/YYYY" | "DD/MM/YYYY";
  relationHint: "none" | "primary-identifier" | "reference-to-other-record" | "contact-channel" | "grouping";
  confidence: "low" | "medium" | "high";
  reviewRequired: boolean;
  /** Free text from the model. Local only; never disclosed, logged or shown in a cloud-bound view. */
  rationale: string;
}

function readField(record: unknown, path: string): unknown {
  let cursor: unknown = record;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !Object.hasOwn(cursor, segment)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function profileFacts(field: FieldProfile): string[] {
  const facts = [`observed type: ${field.type}`];
  if (field.format) facts.push(`format: ${field.format}`);
  if (field.dateFormat) facts.push(`date pattern: ${field.dateFormat}${field.dateFormatAmbiguous ? " (day/month order NOT proven by the sample)" : ""}`);
  facts.push(field.required ? "present in every record" : "missing in some records");
  if (field.nullable) facts.push("sometimes null");
  if (field.allValuesUnique) facts.push("all values unique");
  if (field.categories) facts.push(`${field.categories.length} distinct categories`);
  if (field.hasPaddedWhitespace) facts.push("some values have surrounding whitespace");
  return facts;
}

/** Bounded local context per field. Deterministic: first distinct values in record order. */
export function buildPrivateFieldContexts(input: {
  records: readonly unknown[];
  fields: readonly FieldProfile[];
  aliasByPath: ReadonlyMap<string, string>;
  targetFields: readonly string[];
}): PrivateFieldContext[] {
  const names = input.fields.map((field) => field.path);
  return input.fields.flatMap((field) => {
    const alias = input.aliasByPath.get(field.path);
    if (!alias) return [];
    const seen = new Set<string>();
    for (const record of input.records) {
      if (seen.size >= PRIVATE_CONTEXT_LIMITS.maxSamples) break;
      const value = readField(record, field.path);
      if (value === undefined || value === null || typeof value === "object") continue;
      seen.add(String(value).slice(0, PRIVATE_CONTEXT_LIMITS.maxSampleChars));
    }
    return [
      {
        fieldAlias: alias,
        fieldName: field.path,
        samples: [...seen],
        facts: profileFacts(field),
        siblingNames: names.filter((name) => name !== field.path).slice(0, PRIVATE_CONTEXT_LIMITS.maxSiblings),
        targetFields: input.targetFields.slice(0, PRIVATE_CONTEXT_LIMITS.maxTargets),
      },
    ];
  });
}

export type SuggestionStatus = "applicable" | "consistent" | "rejected";

export interface EvaluatedSuggestion {
  alias: string;
  status: SuggestionStatus;
  /** Fixed-vocabulary reasons; never model text. */
  reasons: string[];
  /** What applying would change. Empty when consistent or rejected. */
  override: Pick<TwinFieldOverride, "role" | "dateFormat">;
  semantics: PrivateFieldSemantics;
}

const KIND_FOR_TYPE: Readonly<Record<string, ReadonlyArray<PrivateFieldSemantics["valueKind"]>>> = {
  string: ["string"],
  enum: ["category", "string"],
  number: ["number"],
  integer: ["number"],
  boolean: ["boolean"],
  date: ["date"],
  datetime: ["datetime"],
};

/**
 * Deterministic validation of one Nano interpretation against the profile.
 * Any contradiction rejects the whole suggestion (fail closed). Confidence is
 * displayed, never used as evidence.
 */
export function evaluateSemanticSuggestion(semantics: PrivateFieldSemantics, field: FieldProfile, expectedAlias: string): EvaluatedSuggestion {
  const reject = (reason: string): EvaluatedSuggestion => ({ alias: expectedAlias, status: "rejected", reasons: [reason], override: {}, semantics });
  if (semantics.fieldAlias !== expectedAlias) return reject("answered for a different field");
  if (!isSemanticRole(semantics.semanticRole)) return reject("unsupported role");
  if (!(KIND_FOR_TYPE[field.type] ?? []).includes(semantics.valueKind)) return reject(`value kind ${semantics.valueKind} contradicts the observed type ${field.type}`);
  if (!roleCompatible(semantics.semanticRole, field)) return reject(`role ${semantics.semanticRole} contradicts the observed profile`);

  const override: EvaluatedSuggestion["override"] = {};
  const reasons: string[] = [];
  if (semantics.semanticRole !== inferRole(field)) {
    override.role = semantics.semanticRole;
    reasons.push(`role ${inferRole(field)} → ${semantics.semanticRole}`);
  }
  if (field.type === "date") {
    if (semantics.dateFormat === "MM/DD/YYYY" || semantics.dateFormat === "DD/MM/YYYY") {
      if (!dateOrderOverrideAllowed(field, semantics.dateFormat)) return reject(`date order ${semantics.dateFormat} contradicts the observed values`);
      if (semantics.dateFormat !== field.dateFormat) {
        override.dateFormat = semantics.dateFormat;
        reasons.push(`date order ${field.dateFormat} → ${semantics.dateFormat} (resolves an unproven order)`);
      }
    } else if (semantics.dateFormat !== "none" && semantics.dateFormat !== field.dateFormat) {
      return reject(`date pattern ${semantics.dateFormat} contradicts the observed ${field.dateFormat}`);
    }
  } else if (semantics.dateFormat !== "none" && field.type !== "datetime") {
    return reject("date pattern given for a non-date field");
  }
  if (Object.keys(override).length === 0) {
    return { alias: expectedAlias, status: "consistent", reasons: ["agrees with the deterministic profile"], override, semantics };
  }
  return { alias: expectedAlias, status: "applicable", reasons, override, semantics };
}
