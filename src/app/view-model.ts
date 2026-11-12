/**
 * Pure presentation helpers (Sprint 6). Derive display data from existing
 * application state; never create new authoritative state and never touch
 * the network. Values produced here are rendered locally only.
 */
import type { CloudDisclosurePayload, MappingOperation } from "../domain/contracts/types.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";

/** Read a dotted path from a local record (display only). */
export function valueAtPath(record: unknown, path: string): unknown {
  let current: unknown = record;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** First present value for a path across records (display only). */
export function firstPresent(records: readonly unknown[], path: string): unknown {
  for (const record of records) {
    const value = valueAtPath(record, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** JSON-quoted, length-limited rendering that keeps surrounding whitespace visible. */
export function formatSample(value: unknown, max = 40): string {
  if (value === undefined) return "—";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Source references of one operation, always as an array. */
export function operationSources(operation: MappingOperation): string[] {
  if (!("from" in operation) || operation.from === undefined) return [];
  return Array.isArray(operation.from) ? operation.from : [operation.from];
}

export const OPERATION_SUMMARY: Record<MappingOperation["op"], string> = {
  copy: "Copies the value unchanged.",
  rename: "Copies the value onto a differently named field.",
  trim: "Removes leading and trailing whitespace.",
  normalize_email: "Trims, lowercases, and validates an email address.",
  parse_date: "Parses a date in the declared input format.",
  map_enum: "Translates source categories to destination values.",
  default_if_missing: "Writes a constant when the source is missing.",
  concat: "Joins several text fields with a separator.",
};

export interface OperationExecution {
  /** Records (imported + reserved) that failed at this operation. */
  failed: number;
  codes: string[];
  reservedFailed: number;
}

/**
 * Per-operation failure counts from a Reality Check report. Uses the
 * operationIndex carried by safe issues only (no private values).
 */
export function executionByOperation(report: RealityCheckReport | null): Map<number, OperationExecution> {
  const byOp = new Map<number, OperationExecution>();
  if (!report) return byOp;
  for (const row of report.rows) {
    const seen = new Set<number>();
    for (const issue of row.safeIssues) {
      if (typeof issue.operationIndex !== "number" || seen.has(issue.operationIndex)) continue;
      seen.add(issue.operationIndex);
      const entry = byOp.get(issue.operationIndex) ?? { failed: 0, codes: [], reservedFailed: 0 };
      entry.failed += 1;
      if (row.set === "reserved") entry.reservedFailed += 1;
      if (!entry.codes.includes(issue.code)) entry.codes.push(issue.code);
      byOp.set(issue.operationIndex, entry);
    }
  }
  return byOp;
}

/** Destination fields that no operation writes. */
export function unmappedTargets(payload: CloudDisclosurePayload, operations: readonly MappingOperation[]) {
  const written = new Set(operations.map((operation) => operation.to));
  return (payload.target?.fields ?? []).filter((field) => !written.has(field.name));
}

/** Human operation number (1-based) — the single numbering used across the UI. */
export function opNumber(index: number): string {
  return `#${index + 1}`;
}
