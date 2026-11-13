import { normalizeCsvText } from "./csv.ts";
import { normalizeJsonText } from "./json.ts";
import { SOURCE_LIMITS } from "./limits.ts";
import { problem, type NormalizedSource, type SourceFormat, type SourceProblem } from "./types.ts";
import { defaultSheet, normalizeSheet, readWorkbook, type WorkbookHandle } from "./xlsx.ts";

/**
 * File import entry point: one control accepts JSON, CSV and XLSX. The format
 * is chosen from the extension (MIME types from the OS are unreliable); the
 * adapter then validates the content itself. Everything runs in this tab.
 */
export const ACCEPTED_FILE_TYPES = ".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function detectFileFormat(fileName: string): Exclude<SourceFormat, "rest-json"> | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

export interface FileLike {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type FileImportResult = { ok: true; value: NormalizedSource; workbook?: WorkbookHandle } | { ok: false; problem: SourceProblem };

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function importFile(file: FileLike): Promise<FileImportResult> {
  const format = detectFileFormat(file.name);
  const label = file.name.slice(0, 128);
  if (!format) {
    if (/\.(xls|xlsm|xlsb|ods|numbers)$/i.test(file.name)) {
      return problem("UNSUPPORTED_FORMAT", "This spreadsheet format is not supported. Save it as Excel Workbook (.xlsx) or CSV.");
    }
    return problem("UNSUPPORTED_FORMAT", "Choose a .json, .csv or .xlsx file.");
  }
  const limit = format === "xlsx" ? SOURCE_LIMITS.maxWorkbookBytes : SOURCE_LIMITS.maxTextBytes;
  if (file.size === 0) return problem("EMPTY_INPUT", "The file is empty.");
  if (file.size > limit) return problem("TOO_LARGE", `The file is larger than ${Math.round(limit / 1024)} KiB. Import a smaller sample.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > limit) return problem("TOO_LARGE", `The file is larger than ${Math.round(limit / 1024)} KiB. Import a smaller sample.`);
  const provenance = { kind: "file" as const, fileName: label, byteLength: bytes.length };

  if (format === "xlsx") {
    const workbook = await readWorkbook(bytes, label);
    if (!workbook.ok) return workbook;
    const sheet = normalizeSheet(workbook.value, defaultSheet(workbook.value));
    if (!sheet.ok) return sheet;
    return { ok: true, value: sheet.value, workbook: workbook.value };
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    return problem("NOT_UTF8", format === "csv" ? "The file is not UTF-8 text. Export it again as \"CSV UTF-8\"." : "The file is not UTF-8 text.");
  }
  return format === "csv" ? normalizeCsvText(text, provenance, label) : normalizeJsonText(text, provenance, label);
}
