import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import { SOURCE_LIMITS } from "./limits.ts";
import { columnLetter, describeFields, rowsToRecords, type Cell } from "./tabular.ts";
import { SOURCE_ADAPTER_VERSION, problem, type NormalizeResult, type SourceProblem, type SourceWarning } from "./types.ts";
import { preflightWorkbookArchive } from "./zip-preflight.ts";

/**
 * Excel (.xlsx) adapter.
 *
 * Safety:
 *   - the archive preflight runs first (size, parts, compression ratio, ZIP64,
 *     encryption);
 *   - the parser (SheetJS CE, loaded only when a workbook is chosen) reads
 *     cell values and cached formula results only. Formulas are never
 *     evaluated, macros never run, external links never fetched;
 *   - at most `maxRecords` + slack rows are read from any sheet.
 *
 * Values:
 *   - text cells stay text; number cells stay numbers; booleans stay booleans;
 *   - a number cell with a date format becomes an ISO 8601 string
 *     (YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS when it has a time), computed from
 *     the workbook's date system — never from the viewer's time zone;
 *   - a formula contributes its cached result (reported); a formula without a
 *     cached result, and error cells, are missing (reported).
 */
export interface WorkbookHandle {
  workbook: WorkBook;
  sheetNames: string[];
  hiddenSheets: string[];
  fileName: string;
  byteLength: number;
  hasMacros: boolean;
  hasExternalLinks: boolean;
  date1904: boolean;
  isDateFormat: (format: string) => boolean;
}

const ROW_SLACK = 100;

export async function readWorkbook(bytes: Uint8Array, fileName: string): Promise<{ ok: true; value: WorkbookHandle } | { ok: false; problem: SourceProblem }> {
  const preflight = preflightWorkbookArchive(bytes);
  if (!preflight.ok) return problem(preflight.code, preflight.message);
  const XLSX = await import("xlsx");
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      dense: true,
      cellFormula: true,
      cellNF: true,
      cellDates: false,
      cellHTML: false,
      cellText: false,
      cellStyles: false,
      sheetStubs: false,
      bookVBA: false,
      bookFiles: false,
      sheetRows: SOURCE_LIMITS.maxRecords + ROW_SLACK,
      WTF: false,
    });
  } catch {
    return problem("UNSUPPORTED_FORMAT", "The workbook could not be read. Save it again as Excel Workbook (.xlsx), or export the sheet as CSV.");
  }
  const sheetNames = [...workbook.SheetNames];
  if (sheetNames.length === 0) return problem("EMPTY_INPUT", "The workbook has no sheets.");
  const hiddenSheets = (workbook.Workbook?.Sheets ?? []).filter((sheet) => Boolean(sheet.Hidden)).map((sheet) => sheet.name ?? "");
  return {
    ok: true,
    value: {
      workbook,
      sheetNames,
      hiddenSheets,
      fileName,
      byteLength: bytes.length,
      hasMacros: preflight.hasMacros,
      hasExternalLinks: preflight.hasExternalLinks,
      date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
      isDateFormat: (format: string) => Boolean(XLSX.SSF.is_date(format)),
    },
  };
}

/** Excel serial date → ISO 8601, deterministic and time-zone independent. */
export function excelSerialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let base: number;
  if (date1904) base = Date.UTC(1904, 0, 1);
  else if (serial >= 61) base = Date.UTC(1899, 11, 30);
  else if (serial >= 1 && serial < 60) base = Date.UTC(1899, 11, 31);
  else return null; // 0 and the fictitious 1900-02-29 have no real date.
  const days = Math.floor(serial);
  const seconds = Math.round((serial - days) * 86_400);
  const date = new Date(base + days * 86_400_000 + seconds * 1000);
  const iso = date.toISOString();
  return seconds === 0 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function denseRows(sheet: WorkSheet): Array<Array<CellObject | undefined>> {
  const data = (sheet as { "!data"?: Array<Array<CellObject | undefined> | undefined> })["!data"];
  return (data ?? []).map((row) => row ?? []);
}

export function normalizeSheet(handle: WorkbookHandle, sheetName: string): NormalizeResult {
  const sheet = handle.workbook.Sheets[sheetName];
  if (!sheet || !handle.sheetNames.includes(sheetName)) return problem("SHEET_NOT_FOUND", `The workbook has no sheet named "${sheetName}".`);
  const fullRef = (sheet as { "!fullref"?: string })["!fullref"] ?? (sheet as { "!ref"?: string })["!ref"];
  if (fullRef) {
    const match = /^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/.exec(fullRef);
    if (match) {
      const rows = Number(match[2] ?? match[1]) - Number(match[1]) + 1;
      if (rows > SOURCE_LIMITS.maxRecords + ROW_SLACK) {
        return problem("TOO_MANY_RECORDS", `Sheet "${sheetName}" has more than ${SOURCE_LIMITS.maxRecords} rows. Import a smaller sample.`);
      }
    }
  }

  const dateColumns = new Set<number>();
  const formulaCached = { count: 0, columns: new Set<number>() };
  const formulaMissing = { count: 0, cells: [] as string[] };
  const errorCells = { count: 0, cells: [] as string[] };
  const rows: Cell[][] = [];
  const raw = denseRows(sheet);
  for (let r = 0; r < raw.length; r += 1) {
    const source = raw[r]!;
    const width = Math.min(source.length, SOURCE_LIMITS.maxColumns + 1);
    const row: Cell[] = [];
    for (let c = 0; c < width; c += 1) {
      const cell = source[c];
      row.push(readCell(cell, r, c));
    }
    rows.push(row);
  }

  function readCell(cell: CellObject | undefined, r: number, c: number): Cell {
    if (!cell) return null;
    const address = `${columnLetter(c)}${r + 1}`;
    if (cell.f !== undefined) {
      if (cell.v === undefined || cell.t === "z") {
        formulaMissing.count += 1;
        if (formulaMissing.cells.length < 5) formulaMissing.cells.push(address);
        return null;
      }
      formulaCached.count += 1;
      formulaCached.columns.add(c);
    }
    switch (cell.t) {
      case "s":
      case "str" as CellObject["t"]:
        return typeof cell.v === "string" ? cell.v : String(cell.v ?? "");
      case "b":
        return Boolean(cell.v);
      case "n": {
        const value = typeof cell.v === "number" ? cell.v : Number(cell.v);
        if (typeof cell.z === "string" && handle.isDateFormat(cell.z)) {
          const iso = excelSerialToIso(value, handle.date1904);
          if (iso) {
            dateColumns.add(c);
            return iso;
          }
        }
        return value;
      }
      case "e":
        errorCells.count += 1;
        if (errorCells.cells.length < 5) errorCells.cells.push(address);
        return null;
      case "d":
        return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : null;
      default:
        return null;
    }
  }

  const table = rowsToRecords(rows, { rowLabel: (index) => `row ${index + 1}`, strictWidth: false });
  if (!table.ok) return table;
  const headers = table.value.headers;
  const name = (columns: Iterable<number>) => [...columns].map((c) => headers[c]).filter((item): item is string => Boolean(item));

  const warnings: SourceWarning[] = [];
  const otherSheets = handle.sheetNames.filter((item) => item !== sheetName);
  if (otherSheets.length > 0) {
    warnings.push({ code: "OTHER_SHEETS", severity: "info", count: otherSheets.length, message: `Only sheet "${sheetName}" is used. The workbook has ${otherSheets.length} other sheet${otherSheets.length === 1 ? "" : "s"}.` });
  }
  if (handle.hiddenSheets.includes(sheetName)) {
    warnings.push({ code: "HIDDEN_SHEET", severity: "attention", message: `Sheet "${sheetName}" is hidden in Excel. Check that it is the sheet you mean.` });
  }
  if (dateColumns.size > 0) {
    const columns = name(dateColumns);
    warnings.push({ code: "DATES_CONVERTED", severity: "info", columns, message: `Excel dates were written as ISO 8601 text (YYYY-MM-DD): ${columns.join(", ")}.` });
  }
  if (formulaCached.count > 0) {
    const columns = name(formulaCached.columns);
    warnings.push({
      code: "FORMULA_CACHED_VALUES",
      severity: "info",
      count: formulaCached.count,
      columns,
      message: `${formulaCached.count} formula cell${formulaCached.count === 1 ? "" : "s"} use the value Excel last saved. Formulas are never recalculated.`,
    });
  }
  if (formulaMissing.count > 0) {
    warnings.push({
      code: "FORMULA_WITHOUT_VALUE",
      severity: "attention",
      count: formulaMissing.count,
      message: `${formulaMissing.count} formula cell${formulaMissing.count === 1 ? " has" : "s have"} no saved value and ${formulaMissing.count === 1 ? "is" : "are"} treated as missing (${formulaMissing.cells.join(", ")}). Open and save the workbook in Excel to store the results.`,
    });
  }
  if (errorCells.count > 0) {
    warnings.push({
      code: "CELL_ERRORS",
      severity: "attention",
      count: errorCells.count,
      message: `${errorCells.count} cell${errorCells.count === 1 ? " contains" : "s contain"} an Excel error and ${errorCells.count === 1 ? "is" : "are"} treated as missing (${errorCells.cells.join(", ")}).`,
    });
  }
  if (handle.hasMacros) warnings.push({ code: "MACROS_IGNORED", severity: "info", message: "The workbook contains macros. They were ignored and never run." });
  if (handle.hasExternalLinks) warnings.push({ code: "EXTERNAL_LINKS_IGNORED", severity: "info", message: "The workbook links to other files. Links were ignored and never fetched." });

  const fields = describeFields(table.value.records);
  const mixed = fields.filter((field) => field.kinds.length > 1).map((field) => field.name);
  if (mixed.length > 0) {
    warnings.push({ code: "MIXED_TYPES", severity: "attention", columns: mixed, message: `These columns mix numbers and text; values were kept as they are: ${mixed.join(", ")}.` });
  }
  return {
    ok: true,
    value: {
      adapter: { id: "xlsx-file", version: SOURCE_ADAPTER_VERSION },
      format: "xlsx",
      label: `${handle.fileName} · ${sheetName}`,
      records: table.value.records,
      fields,
      provenance: { kind: "file", fileName: handle.fileName, byteLength: handle.byteLength, sheet: sheetName, sheetNames: handle.sheetNames },
      warnings: [...warnings, ...table.value.warnings],
      typeCandidates: table.value.typeCandidates,
      textKept: table.value.textKept,
    },
  };
}

/** Pick the first visible sheet that has any content. */
export function defaultSheet(handle: WorkbookHandle): string {
  for (const name of handle.sheetNames) {
    if (handle.hiddenSheets.includes(name)) continue;
    const rows = denseRows(handle.workbook.Sheets[name]!);
    if (rows.some((row) => row.some((cell) => cell !== undefined && cell.v !== undefined && cell.v !== ""))) return name;
  }
  return handle.sheetNames[0]!;
}
