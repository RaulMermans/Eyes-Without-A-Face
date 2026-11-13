import Papa from "papaparse";
import type { RealityCheckReport } from "../../verification/reality-check.ts";

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
