import Papa from "papaparse";
import type { RealityCheckReport } from "../../verification/reality-check.ts";
import type { MappingContract } from "../../domain/contracts/types.ts";

/**
 * Local transformed-data output (Sprint 13, D4). These are YOUR records after
 * the mapping, so they are private: they are only ever produced by an
 * explicit download click, never added to the portable integration ZIP,
 * never uploaded and never written to a destination.
 *
 * Only imported records that passed every check are included. Reserved test
 * cases and records that failed or were set aside are excluded and counted.
 */
export interface TransformedOutput {
  records: Record<string, unknown>[];
  excluded: number;
}

export function transformedRecords(report: RealityCheckReport): TransformedOutput {
  const imported = report.rows.filter((row) => row.set === "imported");
  const records = imported.filter((row) => row.status === "pass" && row.output !== null).map((row) => row.output as Record<string, unknown>);
  return { records, excluded: imported.length - records.length };
}

export function transformedJson(output: TransformedOutput): string {
  return `${JSON.stringify(output.records, null, 2)}\n`;
}

/**
 * CSV with one column per destination field (in first-seen order). Cells that
 * a spreadsheet would treat as a formula (=, +, -, @, tab, CR) are prefixed
 * with ' (Papa Parse `escapeFormulae`) so opening the file cannot run them.
 * Objects and lists are written as JSON text.
 */
export function transformedCsv(output: TransformedOutput): string {
  const columns: string[] = [];
  for (const record of output.records) for (const key of Object.keys(record)) if (!columns.includes(key)) columns.push(key);
  const rows = output.records.map((record) =>
    columns.map((column) => {
      const value = record[column];
      if (value === undefined || value === null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }),
  );
  return `${Papa.unparse({ fields: columns, data: rows }, { escapeFormulae: true, newline: "\r\n" })}\r\n`;
}

/** One representative record, before and after the mapping. Local only: it may contain the user's values. */
export interface BeforeAfterExample {
  /** 1-based position among the user's records. */
  record: number;
  /** The source values the mapping reads, in operation order. */
  input: Array<{ path: string; value: unknown }>;
  /** The destination record, or null when the record was not transformed. */
  output: Record<string, unknown> | null;
  /** Plain explanation when the record was not transformed. */
  issue: string | null;
}

function readSource(record: unknown, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Sprint 15 (D2): up to `limit` of the user's records with what the mapping
 * read and what it produced — the actual canonical result, never a mock-up.
 * Prefers transformed records, and includes one that was not transformed when
 * there is one, so the preview shows both cases. Bounded; shown locally only.
 */
export function beforeAfter(report: RealityCheckReport, records: readonly unknown[], executable: MappingContract | null, limit = 3): BeforeAfterExample[] {
  if (!executable) return [];
  const paths: string[] = [];
  for (const operation of executable.operations) {
    const from = "from" in operation ? operation.from : undefined;
    for (const path of Array.isArray(from) ? from : from ? [from] : []) if (!paths.includes(path)) paths.push(path);
  }
  const imported = report.rows.filter((row) => row.set === "imported");
  const passed = imported.filter((row) => row.status === "pass");
  const failed = imported.filter((row) => row.status !== "pass");
  const picked = failed.length > 0 ? [...passed.slice(0, Math.max(1, limit - 1)), failed[0]!] : passed.slice(0, limit);
  return picked
    .sort((a, b) => a.setIndex - b.setIndex)
    .map((row) => ({
      record: row.setIndex + 1,
      input: paths.map((path) => ({ path, value: readSource(records[row.index], path) })),
      output: row.status === "pass" ? row.output : null,
      issue: row.status === "pass" ? null : (row.safeIssues[0]?.explanation ?? "This record did not produce a valid destination record."),
    }));
}
