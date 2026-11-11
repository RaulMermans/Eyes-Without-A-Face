/**
 * Private Reality Check: run an executable mapping locally against imported
 * records plus reserved hidden cases, validate every output against the
 * destination JSON Schema, and separate three diagnostic tiers:
 *
 * 1. Local detail   — engine issues verbatim (may contain private values).
 * 2. Safe summary   — fixed explanation per failure code, alias instead of path,
 *                     no values. Shown by default in the UI.
 * 3. Disclosure summary — code + alias + operation index only. Prepared for a
 *                     future reviewed correction loop; never sent in Sprint 3.
 */
import type { MappingIssue, MappingFailureCode } from "../domain/mapping/codes.ts";
import { executeMappingBatch, type MappingBatchResult } from "../domain/mapping/batch.ts";
import type { PrivateBindings } from "../phantom/bindings.ts";
import { inspectJsonValue } from "../domain/json/inspect.ts";
import { validateContract } from "../domain/validation/validate-contract.ts";
import { findExecutableTransformations } from "../domain/mapping/safety.ts";
import { assertTargetSchema } from "../domain/mapping/target-schema.ts";
import { MAPPING_LIMITS } from "../domain/mapping/limits.ts";

export type RecordSet = "imported" | "reserved";

export interface SafeIssue {
  code: MappingFailureCode;
  operationIndex?: number;
  op?: string;
  /** Phantom alias for the source field involved, when known. */
  alias?: string;
  explanation: string;
}

export interface RealityCheckRow {
  index: number;
  set: RecordSet;
  setIndex: number;
  status: "pass" | "fail";
  output: Record<string, unknown> | null;
  localIssues: MappingIssue[];
  safeIssues: SafeIssue[];
}

/** Tri-state outcome of one independent Reality Check stage. */
export type CheckStatus = "pass" | "fail" | "not_evaluated";

/**
 * Independent stage outcomes. Each answers exactly one question; none is
 * inferred from another stage's success.
 *
 * - mappingContract: the contract validates against the canonical schema,
 *   uses only allowlisted operations, and contains no executable content.
 * - targetSchema:    the destination JSON Schema compiles (2020-12).
 * - execution:       every record (imported and reserved) produced an output.
 *                    not_evaluated when the contract or schema is invalid, or
 *                    the batch was refused before any record ran.
 * - outputSchema:    no produced record violated the destination schema.
 *                    not_evaluated when no record reached output validation.
 * - hiddenCases:     every reserved hidden case passed. not_evaluated when no
 *                    reserved cases ran or the engine could not run.
 */
export interface RealityCheckStatuses {
  mappingContract: CheckStatus;
  targetSchema: CheckStatus;
  execution: CheckStatus;
  outputSchema: CheckStatus;
  hiddenCases: CheckStatus;
}

export interface RealityCheckReport {
  statuses: RealityCheckStatuses;
  /** pass only when every evaluated stage passed and the engine actually ran. */
  overall: "pass" | "fail";
  /** Same as statuses.mappingContract === "pass". */
  mappingValid: boolean;
  /** Same as statuses.targetSchema === "pass". */
  targetSchemaValid: boolean;
  total: number;
  passed: number;
  failed: number;
  reservedTotal: number;
  reservedFailed: number;
  failureCodes: Array<{ code: MappingFailureCode; count: number }>;
  rows: RealityCheckRow[];
  /** Contract-level problems (not per record), safe to display. */
  blockingIssues: SafeIssue[];
  durationMs: number;
}

export const SAFE_EXPLANATIONS: Partial<Record<MappingFailureCode, string>> = {
  UNMAPPED_ENUM: "A source category value is not covered by the enum map. The value is withheld from this summary.",
  MISSING_SOURCE_FIELD: "A source field the mapping reads is missing from this record.",
  NULL_VALUE: "A source field is null and the operation does not accept null.",
  TYPE_MISMATCH: "A source value has a different type than the operation expects.",
  EMPTY_VALUE: "A source value is an empty string where a value is required.",
  INVALID_EMAIL: "A source value is not a valid email address after normalization.",
  INVALID_DATE: "A source value does not match the declared date format.",
  CONFLICTING_DESTINATION: "Two operations write the same destination field.",
  OUTPUT_SCHEMA_MISMATCH: "The produced record does not satisfy the destination JSON Schema.",
  INVALID_MAPPING_CONTRACT: "The mapping contract is not valid against the canonical Mapping Contract schema.",
  UNSAFE_MAPPING: "The mapping contains executable content and was refused.",
  UNSUPPORTED_OPERATION: "The mapping uses an operation outside the eight-operation allowlist.",
  PROTOTYPE_POLLUTION: "A forbidden object key was found.",
  INVALID_TARGET_SCHEMA: "The destination JSON Schema could not be compiled.",
  INVALID_FIELD_REF: "A field reference is not a safe dotted identifier.",
  UNSUPPORTED_NESTED_STRUCTURE: "A field reference addresses an array or unsupported nesting.",
  NON_JSON_VALUE: "The record contains a value that is not JSON.",
  CIRCULAR_REFERENCE: "The record contains a circular reference.",
  INPUT_TOO_LARGE: "The record or mapping exceeds a local engine limit.",
  BATCH_LIMIT_EXCEEDED: "The batch exceeds a local engine limit.",
  DEFAULT_UNMAPPED_MISSING: "An enum map with unmapped=default has no default value.",
};

export function safeIssue(issue: MappingIssue, bindings: PrivateBindings | null): SafeIssue {
  const sourceRef = issue.path && !issue.path.startsWith("/") ? issue.path : undefined;
  const alias = sourceRef && bindings ? (bindings.aliasForPath(sourceRef) ?? undefined) : undefined;
  const safe: SafeIssue = {
    code: issue.code,
    explanation: SAFE_EXPLANATIONS[issue.code] ?? "The local engine rejected this record.",
  };
  if (typeof issue.operationIndex === "number") safe.operationIndex = issue.operationIndex;
  if (issue.op) safe.op = issue.op;
  if (alias) safe.alias = alias;
  return safe;
}

/** Disclosure-shaped summary. Code, op index and alias only. Not sent in Sprint 3. */
export function disclosureSummary(report: RealityCheckReport): Array<Pick<SafeIssue, "code" | "operationIndex" | "alias">> {
  const seen = new Set<string>();
  const out: Array<Pick<SafeIssue, "code" | "operationIndex" | "alias">> = [];
  for (const row of report.rows) {
    for (const issue of row.safeIssues) {
      const key = `${issue.code}:${issue.operationIndex ?? ""}:${issue.alias ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item: Pick<SafeIssue, "code" | "operationIndex" | "alias"> = { code: issue.code };
      if (issue.operationIndex !== undefined) item.operationIndex = issue.operationIndex;
      if (issue.alias) item.alias = issue.alias;
      out.push(item);
    }
  }
  return out;
}

const CONTRACT_LEVEL: ReadonlySet<MappingFailureCode> = new Set([
  "INVALID_MAPPING_CONTRACT",
  "UNSAFE_MAPPING",
  "UNSUPPORTED_OPERATION",
  "UNSUPPORTED_SCHEMA_VERSION",
  "INVALID_TARGET_SCHEMA",
]);

/** Validates the mapping contract on its own, independent of any record. */
export function mappingContractStatus(contract: unknown): CheckStatus {
  if (inspectJsonValue(contract).length > 0) return "fail";
  const result = validateContract(contract);
  if (!result.valid || result.kind !== "mapping") return "fail";
  const operations = (contract as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length > MAPPING_LIMITS.maxOperations) return "fail";
  if (findExecutableTransformations(contract).length > 0) return "fail";
  return "pass";
}

/** Compiles the destination schema on its own, independent of any record. */
export function targetSchemaStatus(schema: unknown): CheckStatus {
  if (inspectJsonValue(schema).length > 0) return "fail";
  return assertTargetSchema(schema).ok ? "pass" : "fail";
}

export function runRealityCheck(input: {
  records: readonly unknown[];
  reservedRecords?: readonly unknown[];
  mappingContract: unknown;
  targetSchema: unknown;
  bindings: PrivateBindings | null;
  now?: () => number;
}): RealityCheckReport {
  const now = input.now ?? (() => performance.now());
  const started = now();
  const imported = [...input.records];
  const reserved = [...(input.reservedRecords ?? [])];
  const batch: MappingBatchResult = executeMappingBatch({
    sourceRecords: [...imported, ...reserved],
    mappingContract: input.mappingContract,
    targetSchema: input.targetSchema,
  });

  const rows: RealityCheckRow[] = batch.results.map((result) => {
    const set: RecordSet = result.index < imported.length ? "imported" : "reserved";
    return {
      index: result.index,
      set,
      setIndex: set === "imported" ? result.index : result.index - imported.length,
      status: result.status,
      output: result.output,
      localIssues: result.issues,
      safeIssues: result.issues.map((issue) => safeIssue(issue, input.bindings)),
    };
  });

  const allIssues = rows.flatMap((row) => row.localIssues);
  const contractLevel = allIssues.filter((issue) => CONTRACT_LEVEL.has(issue.code));
  const counts = new Map<MappingFailureCode, number>();
  for (const row of rows) {
    for (const code of new Set(row.localIssues.map((issue) => issue.code))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const blocking =
    rows.length === 0 ? batch.issues.map((issue) => safeIssue(issue, input.bindings)) : [];
  const dedupe = new Map<string, SafeIssue>();
  for (const issue of contractLevel.map((item) => safeIssue(item, input.bindings))) {
    dedupe.set(`${issue.code}:${issue.operationIndex ?? ""}`, issue);
  }

  const statuses = computeStatuses({
    mappingContract: input.mappingContract,
    targetSchema: input.targetSchema,
    rows,
    batchRejected: rows.length === 0,
  });

  return {
    statuses,
    overall: overallVerdict(statuses),
    mappingValid: statuses.mappingContract === "pass",
    targetSchemaValid: statuses.targetSchema === "pass",
    total: rows.length,
    passed: batch.passed,
    failed: batch.failed,
    reservedTotal: reserved.length,
    reservedFailed: rows.filter((row) => row.set === "reserved" && row.status === "fail").length,
    failureCodes: [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    rows,
    blockingIssues: [...blocking, ...dedupe.values()],
    durationMs: Math.max(0, Math.round(now() - started)),
  };
}

function computeStatuses(input: {
  mappingContract: unknown;
  targetSchema: unknown;
  rows: readonly RealityCheckRow[];
  batchRejected: boolean;
}): RealityCheckStatuses {
  const mappingContract = mappingContractStatus(input.mappingContract);
  const targetSchema = targetSchemaStatus(input.targetSchema);
  const engineCanRun = mappingContract === "pass" && targetSchema === "pass" && !input.batchRejected;
  if (!engineCanRun) {
    return { mappingContract, targetSchema, execution: "not_evaluated", outputSchema: "not_evaluated", hiddenCases: "not_evaluated" };
  }
  const execution: CheckStatus = input.rows.every((row) => row.status === "pass") ? "pass" : "fail";
  const reachedOutput = input.rows.filter(
    (row) => row.status === "pass" || row.localIssues.some((issue) => issue.code === "OUTPUT_SCHEMA_MISMATCH"),
  );
  const outputSchema: CheckStatus =
    reachedOutput.length === 0
      ? "not_evaluated"
      : reachedOutput.some((row) => row.localIssues.some((issue) => issue.code === "OUTPUT_SCHEMA_MISMATCH"))
        ? "fail"
        : "pass";
  const reservedRows = input.rows.filter((row) => row.set === "reserved");
  const hiddenCases: CheckStatus =
    reservedRows.length === 0 ? "not_evaluated" : reservedRows.every((row) => row.status === "pass") ? "pass" : "fail";
  return { mappingContract, targetSchema, execution, outputSchema, hiddenCases };
}

function overallVerdict(statuses: RealityCheckStatuses): "pass" | "fail" {
  if (statuses.execution !== "pass") return "fail";
  return Object.values(statuses).every((status) => status !== "fail") ? "pass" : "fail";
}
