import { SOURCE_LIMITS } from "./limits.ts";
import { problem, type SourceFieldInfo, type SourceProblem, type SourceWarning, type TextKept, type TypeCandidate } from "./types.ts";

/**
 * Shared tabular normalization for CSV and spreadsheet rows.
 *
 * - The first non-empty row is the header. Headers are trimmed, must be
 *   non-empty, unique and at most `maxHeaderChars` long.
 * - Fully empty rows are skipped (and counted).
 * - An empty cell means "missing": the field is omitted from that record,
 *   exactly as in a JSON record without the key.
 * - Cell values are never coerced here. Text stays text (leading zeros, long
 *   account numbers and ambiguous dates are preserved). Lossless numeric or
 *   boolean readings are only *offered* as `typeCandidates`.
 */
export type Cell = string | number | boolean | null;

export interface TabularResult {
  records: Record<string, unknown>[];
  headers: string[];
  warnings: SourceWarning[];
  typeCandidates: TypeCandidate[];
  textKept: TextKept[];
}

function isEmptyCell(cell: Cell | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

/** Spreadsheet-style column label (1 → A, 27 → AA) for messages. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function rowsToRecords(
  rows: Cell[][],
  options: { rowLabel: (index: number) => string; strictWidth: boolean },
): { ok: true; value: TabularResult } | { ok: false; problem: SourceProblem } {
  const headerIndex = rows.findIndex((row) => row.some((cell) => !isEmptyCell(cell)));
  if (headerIndex < 0) return problem("EMPTY_INPUT", "The file has no rows. Add a header row and at least one record.");
  const headerRow = rows[headerIndex]!;
  // Trailing empty header cells are tolerated (spreadsheets often report them).
  let width = headerRow.length;
  while (width > 0 && isEmptyCell(headerRow[width - 1])) width -= 1;
  if (width > SOURCE_LIMITS.maxColumns) {
    return problem("TOO_MANY_COLUMNS", `The header has ${width} columns; at most ${SOURCE_LIMITS.maxColumns} are supported.`);
  }
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (let col = 0; col < width; col += 1) {
    const raw = headerRow[col];
    const name = typeof raw === "string" ? raw.trim() : raw === null || raw === undefined ? "" : String(raw);
    if (!name) {
      return problem("EMPTY_HEADER", `Column ${columnLetter(col)} has no name in the header row (${options.rowLabel(headerIndex)}). Give every column a name.`);
    }
    if (name.length > SOURCE_LIMITS.maxHeaderChars) {
      return problem("HEADER_TOO_LONG", `The name of column ${columnLetter(col)} is longer than ${SOURCE_LIMITS.maxHeaderChars} characters.`);
    }
    const previous = seen.get(name);
    if (previous !== undefined) {
      return problem(
        "DUPLICATE_HEADER",
        `Column names must be unique: "${name}" appears in columns ${columnLetter(previous)} and ${columnLetter(col)}. Rename one of them.`,
      );
    }
    seen.set(name, col);
    headers.push(name);
  }

  const records: Record<string, unknown>[] = [];
  const malformed: string[] = [];
  let emptyRows = 0;
  let emptyCells = 0;
  let cells = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (!row.some((cell) => !isEmptyCell(cell))) {
      emptyRows += 1;
      continue;
    }
    let rowWidth = row.length;
    if (!options.strictWidth) {
      while (rowWidth > width && isEmptyCell(row[rowWidth - 1])) rowWidth -= 1;
    }
    if (options.strictWidth ? rowWidth !== width : rowWidth > width) {
      malformed.push(`${options.rowLabel(index)} has ${rowWidth} values, the header has ${width}`);
      continue;
    }
    if (records.length >= SOURCE_LIMITS.maxRecords) {
      return problem("TOO_MANY_RECORDS", `The file has more than ${SOURCE_LIMITS.maxRecords} records. Import a smaller sample.`);
    }
    const record: Record<string, unknown> = {};
    for (let col = 0; col < width; col += 1) {
      const cell = row[col];
      cells += 1;
      if (cells > SOURCE_LIMITS.maxCells) {
        return problem("TOO_MANY_CELLS", `The file has more than ${SOURCE_LIMITS.maxCells} cells. Import a smaller sample.`);
      }
      if (isEmptyCell(cell)) {
        emptyCells += 1;
        continue;
      }
      if (typeof cell === "string" && cell.length > SOURCE_LIMITS.maxCellChars) {
        return problem("CELL_TOO_LONG", `A value in column "${headers[col]}" (${options.rowLabel(index)}) is longer than ${SOURCE_LIMITS.maxCellChars} characters.`);
      }
      record[headers[col]!] = cell;
    }
    records.push(record);
  }
  if (malformed.length > 0) {
    const shown = malformed.slice(0, 3).join("; ");
    const more = malformed.length > 3 ? ` (and ${malformed.length - 3} more)` : "";
    return problem("MALFORMED_ROWS", `${malformed.length} row${malformed.length === 1 ? "" : "s"} do not match the header: ${shown}${more}. Fix the file and import it again.`);
  }
  if (records.length === 0) return problem("NO_RECORDS", "The file has a header row but no records.");

  const warnings: SourceWarning[] = [];
  if (emptyRows > 0) warnings.push({ code: "EMPTY_ROWS_SKIPPED", severity: "info", count: emptyRows, message: `${emptyRows} empty row${emptyRows === 1 ? " was" : "s were"} skipped.` });
  if (emptyCells > 0) {
    warnings.push({ code: "EMPTY_CELLS_MISSING", severity: "info", count: emptyCells, message: `${emptyCells} empty cell${emptyCells === 1 ? " is" : "s are"} treated as missing values.` });
  }
  const { typeCandidates, textKept } = reviewTextColumns(records, headers);
  if (textKept.length > 0) {
    warnings.push({
      code: "TEXT_KEPT",
      severity: "info",
      columns: textKept.map((item) => item.column),
      message: `Kept as text to preserve their exact value: ${textKept.map((item) => item.column).join(", ")}.`,
    });
  }
  return { ok: true, value: { records, headers, warnings, typeCandidates, textKept } };
}

const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const LEADING_ZERO = /^-?0\d/;
const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

/**
 * Which text columns could be read as numbers or booleans WITHOUT changing
 * any value, and which numeric-looking columns must stay text. Never applied
 * automatically.
 */
export function reviewTextColumns(records: readonly Record<string, unknown>[], headers: readonly string[]): { typeCandidates: TypeCandidate[]; textKept: TextKept[] } {
  const typeCandidates: TypeCandidate[] = [];
  const textKept: TextKept[] = [];
  for (const column of headers) {
    const values = records.map((record) => record[column]).filter((value): value is string => typeof value === "string");
    if (values.length === 0 || values.length !== records.filter((record) => column in record).length) continue;
    if (values.every((value) => value === "true" || value === "false")) {
      typeCandidates.push({ column, as: "boolean" });
      continue;
    }
    if (values.some((value) => LEADING_ZERO.test(value)) && values.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
      textKept.push({ column, reason: "leading-zeros" });
      continue;
    }
    if (values.every((value) => PLAIN_NUMBER.test(value))) {
      const lossless = values.every((value) => {
        const number = Number(value);
        return Number.isFinite(number) && String(number) === value && (!Number.isInteger(number) || Number.isSafeInteger(number));
      });
      if (lossless) typeCandidates.push({ column, as: "number" });
      else textKept.push({ column, reason: "precision" });
      continue;
    }
    if (values.every((value) => DATE_LIKE.test(value))) textKept.push({ column, reason: "date-like" });
  }
  return { typeCandidates, textKept };
}

/**
 * Apply the user's explicit type choices. Only offered candidates convert;
 * every converted value round-trips to the original text.
 */
export function applyTypeChoices(
  records: readonly Record<string, unknown>[],
  candidates: readonly TypeCandidate[],
  chosen: ReadonlySet<string>,
): Record<string, unknown>[] {
  const active = candidates.filter((candidate) => chosen.has(candidate.column));
  if (active.length === 0) return records.map((record) => ({ ...record }));
  return records.map((record) => {
    const next = { ...record };
    for (const candidate of active) {
      const value = next[candidate.column];
      if (typeof value !== "string") continue;
      if (candidate.as === "boolean") next[candidate.column] = value === "true";
      else {
        const number = Number(value);
        if (String(number) === value) next[candidate.column] = number;
      }
    }
    return next;
  });
}

/** Field summary over normalized records (names, presence and value kinds only). */
export function describeFields(records: readonly Record<string, unknown>[]): SourceFieldInfo[] {
  const fields = new Map<string, SourceFieldInfo>();
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const info = fields.get(name) ?? { name, present: 0, kinds: [] };
      info.present += 1;
      const kind = value === null ? "null" : Array.isArray(value) ? "array" : (typeof value as SourceFieldInfo["kinds"][number]);
      if (!info.kinds.includes(kind)) info.kinds.push(kind);
      fields.set(name, info);
    }
  }
  return [...fields.values()];
}
