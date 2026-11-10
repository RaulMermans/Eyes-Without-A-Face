import type { MappingOperation } from "../contracts/types.ts";
import type { MappingIssue } from "./codes.ts";
import { readPath, type FieldPath } from "./paths.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type JsonPrimitive = string | number | boolean | null;

function typedIssue(
  code: MappingIssue["code"],
  message: string,
  path: string,
): MappingIssue {
  return { code, message, path };
}

export function requirePresent(
  source: Record<string, unknown>,
  path: FieldPath,
  label: string,
): { ok: true; value: unknown } | { ok: false; issue: MappingIssue } {
  const read = readPath(source, path);
  if ("code" in read) {
    return { ok: false, issue: read };
  }
  if (read.kind === "missing") {
    return {
      ok: false,
      issue: typedIssue("MISSING_SOURCE_FIELD", `Source field "${label}" is missing.`, label),
    };
  }
  return { ok: true, value: read.value };
}

export function requireString(
  value: unknown,
  path: string,
  allowEmpty = true,
): { ok: true; value: string } | { ok: false; issue: MappingIssue } {
  if (value === null) {
    return {
      ok: false,
      issue: typedIssue("NULL_VALUE", `Field "${path}" is null; string operations do not coerce null.`, path),
    };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      issue: typedIssue(
        "TYPE_MISMATCH",
        `Field "${path}" must be a string, received ${describeType(value)}.`,
        path,
      ),
    };
  }
  if (!allowEmpty && value.length === 0) {
    return {
      ok: false,
      issue: typedIssue("EMPTY_VALUE", `Field "${path}" is an empty string.`, path),
    };
  }
  return { ok: true, value };
}

export function requirePrimitive(
  value: unknown,
  path: string,
): { ok: true; value: JsonPrimitive } | { ok: false; issue: MappingIssue } {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { ok: true, value };
  }
  return {
    ok: false,
    issue: typedIssue(
      "TYPE_MISMATCH",
      `Field "${path}" must be a JSON primitive; objects and arrays are not copied.`,
      path,
    ),
  };
}

export function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

export function normalizeEmail(raw: string, path: string): { ok: true; value: string } | { ok: false; issue: MappingIssue } {
  const normalized = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.includes("..")) {
    return {
      ok: false,
      issue: typedIssue("INVALID_EMAIL", `Field "${path}" is not a valid email after normalization.`, path),
    };
  }
  return { ok: true, value: normalized };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function calendarDate(year: number, month: number, day: number, path: string): MappingIssue | string {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || year < 1 || year > 9999) {
    return typedIssue("INVALID_DATE", `Field "${path}" is not a real calendar date.`, path);
  }
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDateValue(
  raw: string,
  inputFormat: Extract<MappingOperation, { op: "parse_date" }>["params"]["inputFormat"],
  path: string,
): { ok: true; value: string } | { ok: false; issue: MappingIssue } {
  const value = raw.trim();
  if (inputFormat === "YYYY-MM-DD") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return { ok: false, issue: typedIssue("INVALID_DATE", `Field "${path}" is not YYYY-MM-DD.`, path) };
    }
    const dated = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]), path);
    return typeof dated === "string" ? { ok: true, value: dated } : { ok: false, issue: dated };
  }
  if (inputFormat === "MM/DD/YYYY") {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) {
      return { ok: false, issue: typedIssue("INVALID_DATE", `Field "${path}" is not MM/DD/YYYY.`, path) };
    }
    const dated = calendarDate(Number(match[3]), Number(match[1]), Number(match[2]), path);
    return typeof dated === "string" ? { ok: true, value: dated } : { ok: false, issue: dated };
  }
  if (inputFormat === "DD/MM/YYYY") {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) {
      return { ok: false, issue: typedIssue("INVALID_DATE", `Field "${path}" is not DD/MM/YYYY.`, path) };
    }
    const dated = calendarDate(Number(match[3]), Number(match[2]), Number(match[1]), path);
    return typeof dated === "string" ? { ok: true, value: dated } : { ok: false, issue: dated };
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const dated = calendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), path);
    return typeof dated === "string" ? { ok: true, value: dated } : { ok: false, issue: dated };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})[tT ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(z|Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!iso) {
    return {
      ok: false,
      issue: typedIssue(
        "INVALID_DATE",
        `Field "${path}" is not ISO-8601 date or UTC/offset date-time.`,
        path,
      ),
    };
  }
  const dated = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), path);
  if (typeof dated !== "string") {
    return { ok: false, issue: dated };
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return { ok: false, issue: typedIssue("INVALID_DATE", `Field "${path}" is not a valid ISO-8601 instant.`, path) };
  }
  return { ok: true, value: new Date(parsed).toISOString() };
}
