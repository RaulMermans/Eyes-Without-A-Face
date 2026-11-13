import Papa from "papaparse";
import { SOURCE_LIMITS } from "./limits.ts";
import { rowsToRecords, describeFields, type Cell } from "./tabular.ts";
import { SOURCE_ADAPTER_VERSION, problem, type NormalizeResult, type SourceProvenance, type SourceWarning } from "./types.ts";

/**
 * CSV adapter (RFC 4180 style, comma-delimited), parsed by Papa Parse with
 * dynamic typing OFF: every value stays the exact text in the file.
 * Quoted fields, escaped quotes ("") and multi-line quoted values are
 * supported by the parser. Rows that do not match the header block the import.
 */
export function normalizeCsvText(input: string, provenance: SourceProvenance, label: string): NormalizeResult {
  const warnings: SourceWarning[] = [];
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    warnings.push({ code: "BOM_REMOVED", severity: "info", message: "A byte-order mark at the start of the file was removed." });
  }
  if (!text.trim()) return problem("EMPTY_INPUT", "The CSV file is empty.");
  if (new TextEncoder().encode(text).length > SOURCE_LIMITS.maxTextBytes) {
    return problem("TOO_LARGE", `The CSV file is larger than ${SOURCE_LIMITS.maxTextBytes} bytes. Import a smaller sample.`);
  }
  const parsed = Papa.parse<string[]>(text, {
    delimiter: ",",
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    quoteChar: '"',
    escapeChar: '"',
  });
  // Line numbers of each data row, for messages (multi-line values span lines).
  const quoteErrors = parsed.errors.filter((error) => error.type === "Quotes");
  if (quoteErrors.length > 0) {
    const rows = [...new Set(quoteErrors.map((error) => (error.row ?? 0) + 1))].slice(0, 3).join(", ");
    return problem("MALFORMED", `The CSV has an unclosed or misplaced quote near row ${rows}. Every quoted value must end with a closing quote.`);
  }
  const rows = parsed.data as Cell[][];
  // Papa Parse reports a trailing newline as one empty row; drop it silently.
  if (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  const header = rows.find((row) => row.some((cell) => typeof cell === "string" && cell.trim() !== ""));
  if (header && header.length === 1 && typeof header[0] === "string" && /;|\t/.test(header[0])) {
    return problem("MALFORMED", "This file looks semicolon- or tab-separated. Only comma-separated CSV is supported; export it as \"CSV (comma delimited)\".");
  }
  const table = rowsToRecords(rows, { rowLabel: (index) => `row ${index + 1}`, strictWidth: true });
  if (!table.ok) return table;
  return {
    ok: true,
    value: {
      adapter: { id: "csv-file", version: SOURCE_ADAPTER_VERSION },
      format: "csv",
      label,
      records: table.value.records,
      fields: describeFields(table.value.records),
      provenance,
      warnings: [...warnings, ...table.value.warnings],
      typeCandidates: table.value.typeCandidates,
      textKept: table.value.textKept,
    },
  };
}
