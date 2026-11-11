/**
 * Deterministic local source profiling.
 *
 * Reads private records to infer structure. The profile itself contains local
 * observations (field paths, category labels, counts) and must never be
 * serialized into a cloud request. Only the Phantom Twin projection may leave
 * the browser, and only after explicit approval.
 */
import { inspectJsonValue, isPlainJsonObject, safeJsonByteLength } from "../json/inspect.ts";

export const PROFILE_LIMITS = {
  maxRecords: 250,
  maxBytes: 1024 * 1024,
  maxFields: 64,
  maxDepth: 4,
  maxKeyLength: 64,
  maxCategories: 12,
  maxCategoryLength: 32,
} as const;

export type ObservedType = "string" | "integer" | "number" | "boolean" | "null" | "object" | "array";

export type ProfiledFieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "unsupported";

export type DateInputFormat = "ISO-8601" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";

export type ProfileIssueCode =
  | "EMPTY_DATASET"
  | "NOT_AN_OBJECT"
  | "TOO_MANY_RECORDS"
  | "INPUT_TOO_LARGE"
  | "TOO_MANY_FIELDS"
  | "NESTING_TOO_DEEP"
  | "NON_JSON_VALUE"
  | "CIRCULAR_REFERENCE"
  | "PROTOTYPE_POLLUTION"
  | "UNSUPPORTED_FIELD_NAME"
  | "UNSUPPORTED_ARRAY"
  | "MIXED_TYPES"
  | "ALL_NULL"
  | "OPTIONAL_FIELD"
  | "NULL_VALUES"
  | "AMBIGUOUS_DATE_FORMAT";

export interface ProfileIssue {
  code: ProfileIssueCode;
  severity: "error" | "warning" | "info";
  /** Local field path or structural location. Never a value. */
  path?: string;
  message: string;
}

export interface CategoryObservation {
  value: string;
  count: number;
}

export interface FieldProfile {
  path: string;
  presentCount: number;
  missingCount: number;
  nullCount: number;
  observedTypes: ObservedType[];
  type: ProfiledFieldType;
  required: boolean;
  nullable: boolean;
  supported: boolean;
  format?: "email";
  dateFormat?: DateInputFormat;
  /** Local-only category labels with counts. Not disclosed unless the user opts in. */
  categories?: CategoryObservation[];
  stringLength?: { min: number; max: number };
  numberRange?: { min: number; max: number };
  /** Character-class shapes like "AAAA-999" (letters/digits replaced). */
  shapes?: string[];
  hasPaddedWhitespace: boolean;
  hasMixedCase: boolean;
  allValuesUnique: boolean;
  averageLength?: number;
  containsSpaces: boolean;
}

export interface SourceProfile {
  recordCount: number;
  fields: FieldProfile[];
  issues: ProfileIssue[];
}

export type ProfileResult =
  | { ok: true; profile: SourceProfile }
  | { ok: false; issues: ProfileIssue[] };

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:z|Z|[+-]\d{2}:\d{2})$/;
const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CATEGORY_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/;

interface Accumulator {
  path: string;
  present: number;
  nulls: number;
  types: Set<ObservedType>;
  strings: string[];
  numbers: number[];
  unsupportedName: boolean;
}

function observedType(value: unknown): ObservedType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "object";
}

export function shapeOf(value: string): string {
  let out = "";
  for (const char of value.slice(0, 48)) {
    if (/[A-Z]/.test(char)) out += "A";
    else if (/[a-z]/.test(char)) out += "a";
    else if (/[0-9]/.test(char)) out += "9";
    else if (char === " " || char === "-" || char === "_" || char === "." || char === ":" || char === "/") out += char;
    else out += "x";
  }
  return out;
}

function detectDateFormat(values: string[]): { type: "date" | "datetime"; format: DateInputFormat; ambiguous?: boolean } | null {
  if (values.length === 0) return null;
  if (values.every((value) => ISO_DATE.test(value.trim()))) {
    return { type: "date", format: "YYYY-MM-DD" };
  }
  if (values.every((value) => ISO_DATE.test(value.trim()) || ISO_DATETIME.test(value.trim()))) {
    return { type: "datetime", format: "ISO-8601" };
  }
  const slash = values.map((value) => SLASH_DATE.exec(value.trim()));
  if (slash.every((match) => match !== null)) {
    const firstOver12 = slash.some((match) => Number(match?.[1]) > 12);
    const secondOver12 = slash.some((match) => Number(match?.[2]) > 12);
    if (firstOver12 && !secondOver12) return { type: "date", format: "DD/MM/YYYY" };
    if (secondOver12 && !firstOver12) return { type: "date", format: "MM/DD/YYYY" };
    if (!firstOver12 && !secondOver12) return { type: "date", format: "MM/DD/YYYY", ambiguous: true };
  }
  return null;
}

/**
 * Profile an array of JSON records. Expected failures return `{ ok: false }`.
 */
export function profileRecords(records: unknown): ProfileResult {
  if (!Array.isArray(records)) {
    return fail("NOT_AN_OBJECT", "Source must be an array of JSON objects.");
  }
  if (records.length === 0) {
    return fail("EMPTY_DATASET", "Source contains no records.");
  }
  if (records.length > PROFILE_LIMITS.maxRecords) {
    return fail("TOO_MANY_RECORDS", `Source exceeds ${PROFILE_LIMITS.maxRecords} records.`);
  }
  const structural = inspectJsonValue(records, { maxDepth: PROFILE_LIMITS.maxDepth + 2 });
  if (structural.length > 0) {
    return {
      ok: false,
      issues: structural.map((item) => ({
        code: item.code,
        severity: "error" as const,
        path: item.path,
        message: item.message,
      })),
    };
  }
  const bytes = safeJsonByteLength(records);
  if (bytes === null) {
    return fail("NON_JSON_VALUE", "Source is not JSON-serializable.");
  }
  if (bytes > PROFILE_LIMITS.maxBytes) {
    return fail("INPUT_TOO_LARGE", `Source exceeds ${PROFILE_LIMITS.maxBytes} bytes.`);
  }

  const accumulators = new Map<string, Accumulator>();
  const issues: ProfileIssue[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record: unknown = records[index];
    if (!isPlainJsonObject(record)) {
      return fail("NOT_AN_OBJECT", `Record ${index} is not a JSON object.`);
    }
    const error = collect(record, "", 1, accumulators);
    if (error) {
      return { ok: false, issues: [error] };
    }
  }

  if (accumulators.size > PROFILE_LIMITS.maxFields) {
    return fail("TOO_MANY_FIELDS", `Source has more than ${PROFILE_LIMITS.maxFields} fields.`);
  }

  const fields: FieldProfile[] = [];
  for (const accumulator of [...accumulators.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const field = finalize(accumulator, records.length, issues);
    if (field) {
      fields.push(field);
    }
  }

  if (fields.length === 0) {
    return fail("EMPTY_DATASET", "Source records contain no fields.");
  }

  return { ok: true, profile: { recordCount: records.length, fields, issues } };
}

function fail(code: ProfileIssueCode, message: string): ProfileResult {
  return { ok: false, issues: [{ code, severity: "error", message }] };
}

function collect(
  record: Record<string, unknown>,
  prefix: string,
  depth: number,
  accumulators: Map<string, Accumulator>,
): ProfileIssue | null {
  if (depth > PROFILE_LIMITS.maxDepth) {
    return {
      code: "NESTING_TOO_DEEP",
      severity: "error",
      path: prefix,
      message: `Objects nested deeper than ${PROFILE_LIMITS.maxDepth} levels are not supported.`,
    };
  }
  for (const key of Object.keys(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = record[key];
    const kind = observedType(value);
    let accumulator = accumulators.get(path);
    if (!accumulator) {
      accumulator = {
        path,
        present: 0,
        nulls: 0,
        types: new Set(),
        strings: [],
        numbers: [],
        unsupportedName: !SEGMENT.test(key) || key.length > PROFILE_LIMITS.maxKeyLength,
      };
      accumulators.set(path, accumulator);
      if (accumulators.size > PROFILE_LIMITS.maxFields * 2) {
        return {
          code: "TOO_MANY_FIELDS",
          severity: "error",
          message: `Source has more than ${PROFILE_LIMITS.maxFields} fields.`,
        };
      }
    }
    accumulator.present += 1;
    accumulator.types.add(kind);
    if (kind === "null") accumulator.nulls += 1;
    if (kind === "string") accumulator.strings.push(value as string);
    if (kind === "integer" || kind === "number") accumulator.numbers.push(value as number);
    if (kind === "object" && !accumulator.unsupportedName) {
      const nested = collect(value as Record<string, unknown>, path, depth + 1, accumulators);
      if (nested) return nested;
    }
  }
  return null;
}

function finalize(accumulator: Accumulator, recordCount: number, issues: ProfileIssue[]): FieldProfile | null {
  const types = new Set(accumulator.types);
  types.delete("null");
  // Container-only paths (always objects) are represented by their children.
  if (types.size === 1 && types.has("object")) {
    return null;
  }
  const missingCount = recordCount - accumulator.present;
  const base: FieldProfile = {
    path: accumulator.path,
    presentCount: accumulator.present,
    missingCount,
    nullCount: accumulator.nulls,
    observedTypes: [...accumulator.types].sort(),
    type: "unsupported",
    required: missingCount === 0,
    nullable: accumulator.nulls > 0,
    supported: false,
    hasPaddedWhitespace: false,
    hasMixedCase: false,
    allValuesUnique: false,
    containsSpaces: false,
  };

  if (accumulator.unsupportedName) {
    issues.push({
      code: "UNSUPPORTED_FIELD_NAME",
      severity: "warning",
      path: accumulator.path,
      message: "Field name is not a simple identifier; it cannot be referenced by the mapping DSL.",
    });
    return base;
  }
  if (types.has("array")) {
    issues.push({
      code: "UNSUPPORTED_ARRAY",
      severity: "warning",
      path: accumulator.path,
      message: "Array values are not supported by the mapping DSL and are excluded from the twin.",
    });
    return base;
  }
  if (types.size === 0) {
    issues.push({
      code: "ALL_NULL",
      severity: "warning",
      path: accumulator.path,
      message: "Field is always null; its type cannot be inferred and it is excluded from the twin.",
    });
    return base;
  }
  const numeric = types.size === 2 && types.has("integer") && types.has("number");
  if (types.size > 1 && !numeric) {
    issues.push({
      code: "MIXED_TYPES",
      severity: "warning",
      path: accumulator.path,
      message: `Field mixes ${[...types].sort().join(", ")} values and is excluded from the twin.`,
    });
    return base;
  }

  if (missingCount > 0) {
    issues.push({
      code: "OPTIONAL_FIELD",
      severity: "info",
      path: accumulator.path,
      message: `Field is missing in ${missingCount} of ${recordCount} records.`,
    });
  }
  if (accumulator.nulls > 0) {
    issues.push({
      code: "NULL_VALUES",
      severity: "info",
      path: accumulator.path,
      message: `Field is null in ${accumulator.nulls} of ${recordCount} records.`,
    });
  }

  const field: FieldProfile = { ...base, supported: true };
  if (numeric || types.has("number")) {
    field.type = "number";
  } else if (types.has("integer")) {
    field.type = "integer";
  } else if (types.has("boolean")) {
    field.type = "boolean";
  }
  if (field.type === "number" || field.type === "integer") {
    field.numberRange = {
      min: Math.min(...accumulator.numbers),
      max: Math.max(...accumulator.numbers),
    };
    return field;
  }
  if (field.type === "boolean") {
    return field;
  }

  const strings = accumulator.strings;
  const trimmed = strings.map((value) => value.trim());
  field.hasPaddedWhitespace = strings.some((value) => value !== value.trim());
  field.containsSpaces = trimmed.some((value) => value.includes(" "));
  field.allValuesUnique = new Set(strings).size === strings.length;
  field.stringLength = {
    min: Math.min(...strings.map((value) => value.length)),
    max: Math.max(...strings.map((value) => value.length)),
  };
  field.averageLength = strings.reduce((sum, value) => sum + value.length, 0) / Math.max(strings.length, 1);
  field.shapes = [...new Set(trimmed.map(shapeOf))].slice(0, 4);

  if (trimmed.length > 0 && trimmed.every((value) => EMAIL.test(value))) {
    field.type = "string";
    field.format = "email";
    field.hasMixedCase = trimmed.some((value) => value !== value.toLowerCase());
    return field;
  }

  const date = detectDateFormat(trimmed);
  if (date) {
    field.type = date.type;
    field.dateFormat = date.format;
    if (date.ambiguous) {
      issues.push({
        code: "AMBIGUOUS_DATE_FORMAT",
        severity: "warning",
        path: accumulator.path,
        message: "Slash dates are ambiguous between MM/DD/YYYY and DD/MM/YYYY; assuming MM/DD/YYYY.",
      });
    }
    return field;
  }

  const counts = new Map<string, number>();
  for (const value of strings) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const categoryLike =
    strings.length >= 2 &&
    counts.size <= PROFILE_LIMITS.maxCategories &&
    [...counts.keys()].every((value) => CATEGORY_TOKEN.test(value) && value.length <= PROFILE_LIMITS.maxCategoryLength);
  if (categoryLike) {
    field.type = "enum";
    field.categories = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return field;
  }

  field.type = "string";
  return field;
}

/**
 * Local-only index of private string values used to verify that synthetic data
 * and cloud payloads do not reproduce them. Never serialize this index.
 */
export function collectPrivateStrings(records: readonly unknown[]): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized.length >= 3) values.add(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isPlainJsonObject(value)) {
      Object.values(value).forEach(visit);
    }
  };
  records.forEach(visit);
  return values;
}
