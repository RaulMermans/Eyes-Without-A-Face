/**
 * Source Adapter Layer (Sprint 13, ADR 0012).
 *
 * Every input — a JSON, CSV or XLSX file, or a read-only REST connection — is
 * parsed, validated and normalized by deterministic code into ONE canonical
 * shape. The existing engine (profile → twin → disclosure → mapping →
 * verification → export) consumes only `records` and `label`; there is no
 * per-format pipeline.
 *
 * Privacy: records and field names are private and stay in this browser.
 * Issue and warning messages carry row numbers, column positions, column
 * names and counts — never cell values — and are shown locally only. Nothing
 * here is sent to telemetry, the cloud, or an export.
 */

export type SourceFormat = "json" | "csv" | "xlsx" | "rest-json";

export type SourceAdapterId = "json-file" | "csv-file" | "xlsx-file" | "rest-json";

export const SOURCE_ADAPTER_VERSION = "1.0.0";

/** A non-blocking note about how the input was normalized. */
export interface SourceWarning {
  code:
    | "EMPTY_ROWS_SKIPPED"
    | "EMPTY_CELLS_MISSING"
    | "BOM_REMOVED"
    | "DATES_CONVERTED"
    | "FORMULA_CACHED_VALUES"
    | "FORMULA_WITHOUT_VALUE"
    | "CELL_ERRORS"
    | "MIXED_TYPES"
    | "MACROS_IGNORED"
    | "EXTERNAL_LINKS_IGNORED"
    | "OTHER_SHEETS"
    | "HIDDEN_SHEET"
    | "TEXT_KEPT"
    | "ENVELOPE_UNWRAPPED";
  message: string;
  /** "attention" warnings change what the integration sees (e.g. a formula without a value). */
  severity: "info" | "attention";
  count?: number;
  columns?: string[];
}

/** A blocking problem: nothing is loaded. One actionable sentence, no values. */
export interface SourceProblem {
  code:
    | "EMPTY_INPUT"
    | "TOO_LARGE"
    | "TOO_MANY_RECORDS"
    | "TOO_MANY_COLUMNS"
    | "TOO_MANY_CELLS"
    | "CELL_TOO_LONG"
    | "NOT_UTF8"
    | "MALFORMED"
    | "MALFORMED_ROWS"
    | "MISSING_HEADER"
    | "EMPTY_HEADER"
    | "DUPLICATE_HEADER"
    | "HEADER_TOO_LONG"
    | "NO_RECORDS"
    | "NOT_RECORDS"
    | "UNSUPPORTED_FORMAT"
    | "UNSAFE_ARCHIVE"
    | "ENCRYPTED"
    | "SHEET_NOT_FOUND";
  message: string;
}

/** Column that is text in the file but could be read as a number or boolean without loss. */
export interface TypeCandidate {
  column: string;
  /** What the column could losslessly become. */
  as: "number" | "boolean";
}

/** Column kept as text on purpose, with the reason (shown in the review control). */
export interface TextKept {
  column: string;
  reason: "leading-zeros" | "precision" | "date-like";
}

export interface SourceFieldInfo {
  name: string;
  /** Records in which the field is present (not missing). */
  present: number;
  kinds: Array<"string" | "number" | "boolean" | "null" | "object" | "array">;
}

/** Non-sensitive provenance: format facts and sizes, never values. */
export type SourceProvenance =
  | { kind: "file"; fileName: string; byteLength: number; sheet?: string; sheetNames?: string[] }
  | { kind: "connector"; origin: string; path: string; byteLength: number; status: number; retrievedAt: string }
  | { kind: "demo"; name: string };

export interface NormalizedSource {
  adapter: { id: SourceAdapterId; version: typeof SOURCE_ADAPTER_VERSION };
  format: SourceFormat;
  /** Dataset label shown in the UI (file name, scenario id, or host). */
  label: string;
  records: Record<string, unknown>[];
  fields: SourceFieldInfo[];
  provenance: SourceProvenance;
  warnings: SourceWarning[];
  typeCandidates: TypeCandidate[];
  textKept: TextKept[];
}

export type NormalizeResult = { ok: true; value: NormalizedSource } | { ok: false; problem: SourceProblem };

export function problem(code: SourceProblem["code"], message: string): { ok: false; problem: SourceProblem } {
  return { ok: false, problem: { code, message } };
}
