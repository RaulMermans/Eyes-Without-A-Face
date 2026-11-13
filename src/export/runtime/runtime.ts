/**
 * Portable mapping runtime (Sprint 9, Workstream A).
 *
 * This module is bundled verbatim into every exported integration package as
 * `runtime/eyes-mapping-runtime.mjs` (scripts/build-runtime.mjs). It is the SAME
 * deterministic engine the app uses: `executeMappingBatch` for execution,
 * `validateContract` for the canonical Mapping Contract, and `classifyRow` for
 * the local acceptance policy. There is no second interpreter here; this file
 * only adds alias binding and a stable, value-free result shape.
 *
 * Pure: no Node, no browser, no network, no React, no Firebase.
 */
import type { MappingContract, MappingOperation } from "../../domain/contracts/types.ts";
import { canonicalizeJson } from "../../domain/json/canonical.ts";
import { executeMappingBatch } from "../../domain/mapping/batch.ts";
import type { MappingIssue } from "../../domain/mapping/codes.ts";
import { parseFieldRef } from "../../domain/mapping/paths.ts";
import { validateContract } from "../../domain/validation/validate-contract.ts";
import { classifyRow, validateAcceptancePolicy, type AcceptancePolicy, type RecordOutcome } from "../../verification/outcomes.ts";

export const RUNTIME_NAME = "eyes-mapping-runtime";
export const RUNTIME_VERSION = "1.0.0";
export const BINDINGS_VERSION = "1.0.0";
/** Records per engine batch (the engine caps a batch at 250 records / 1 MB). */
export const RUNTIME_CHUNK_SIZE = 100;

const ALIAS_PATTERN = /^f_\d{2,3}$/;

export interface RuntimeIssue {
  code: string;
  /** 1-based operation number, when the engine attributed the failure to one. */
  operation?: number;
  op?: string;
  /** Destination or source path the engine reported. May be a local field path when bound. */
  path?: string;
  /** Engine message. Only with `detail`: it may quote record values. */
  message?: string;
}

export interface RuntimeRecordResult {
  index: number;
  status: "pass" | "fail";
  outcome: Exclude<RecordOutcome, "INCORRECT_TRANSFORMATION">;
  output: Record<string, unknown> | null;
  issues: RuntimeIssue[];
}

export interface RuntimeSummary {
  total: number;
  transformedValid: number;
  handledByApprovedRule: number;
  quarantined: number;
  unresolved: number;
  rejectedByPolicy: number;
  /** Indices of quarantined records: held for manual review, never dropped. */
  quarantinedIndices: number[];
  quarantineRate: number;
  withinQuarantinePolicy: boolean;
}

export type RuntimeRunResult =
  | { ok: true; results: RuntimeRecordResult[]; summary: RuntimeSummary }
  | { ok: false; error: { code: string; message: string; issues: RuntimeIssue[] } };

export interface BindingProblem {
  code:
    | "BINDINGS_MALFORMED"
    | "BINDINGS_VERSION"
    | "MAPPING_MISMATCH"
    | "UNBOUND_ALIAS"
    | "UNKNOWN_ALIAS"
    | "INVALID_SOURCE_PATH"
    | "DUPLICATE_SOURCE_PATH"
    | "BOUND_CONTRACT_INVALID";
  alias?: string;
  message: string;
}

/** Aliases a contract reads, sorted. A hand-written alias contract may only read aliases. */
export function mappingAliases(contract: MappingContract): string[] {
  const aliases = new Set<string>();
  for (const operation of contract.operations) {
    if (operation.op === "concat") operation.from.forEach((alias) => aliases.add(alias));
    else if (operation.from !== undefined) aliases.add(operation.from);
  }
  return [...aliases].sort();
}

function rewriteOperation(operation: MappingOperation, bind: (alias: string) => string): MappingOperation {
  switch (operation.op) {
    case "concat":
      return { ...operation, from: operation.from.map(bind), params: { ...operation.params } };
    case "default_if_missing":
      return operation.from === undefined
        ? { op: operation.op, to: operation.to, params: { ...operation.params } }
        : { ...operation, from: bind(operation.from), params: { ...operation.params } };
    case "map_enum":
      return { ...operation, from: bind(operation.from), params: { ...operation.params, map: { ...operation.params.map } } };
    case "parse_date":
      return { ...operation, from: bind(operation.from), params: { ...operation.params } };
    default:
      return { ...operation, from: bind(operation.from) };
  }
}

/**
 * Rewrite an alias-level contract over local source paths. Mirrors
 * `resolveAliases` (src/proposal/resolve.ts); a contract test proves both
 * produce identical operations for the same bindings.
 */
export function bindMapping(contract: MappingContract, aliasToPath: Readonly<Record<string, string>>): MappingContract {
  return {
    ...contract,
    mappingId: `${contract.mappingId}-bound`,
    operations: contract.operations.map((operation) =>
      rewriteOperation(operation, (alias) => {
        const path = aliasToPath[alias];
        if (path === undefined) throw new Error(`Alias ${alias} has no binding.`);
        return path;
      }),
    ),
    notes: "Bound locally to source field paths in the destination environment. Contains local field paths; keep it local.",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a local bindings document against the packaged alias contract.
 * Format: { bindingsVersion: "1.0.0", mappingId, aliases: { f_01: "source.path" } }.
 * Every alias the mapping reads must be bound to a distinct, valid field path.
 */
export function validateBindingsDocument(
  document: unknown,
  contract: MappingContract,
): { ok: true; aliasToPath: Record<string, string>; executable: MappingContract } | { ok: false; problems: BindingProblem[] } {
  if (!isObject(document) || !isObject(document.aliases)) {
    return { ok: false, problems: [{ code: "BINDINGS_MALFORMED", message: "Bindings must be an object with an `aliases` object." }] };
  }
  const problems: BindingProblem[] = [];
  if (document.bindingsVersion !== BINDINGS_VERSION) {
    problems.push({ code: "BINDINGS_VERSION", message: `bindingsVersion must be "${BINDINGS_VERSION}".` });
  }
  if (document.mappingId !== contract.mappingId) {
    problems.push({ code: "MAPPING_MISMATCH", message: "The bindings were written for a different mapping (mappingId differs)." });
  }
  const used = new Set(mappingAliases(contract));
  const aliasToPath: Record<string, string> = {};
  const seenPaths = new Map<string, string>();
  for (const [alias, value] of Object.entries(document.aliases)) {
    if (!ALIAS_PATTERN.test(alias) || !used.has(alias)) {
      problems.push({ code: "UNKNOWN_ALIAS", alias, message: `${alias} is not an alias this mapping reads.` });
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({ code: "UNBOUND_ALIAS", alias, message: `${alias} has no source field path.` });
      continue;
    }
    if (!parseFieldRef(value, "from").ok) {
      problems.push({ code: "INVALID_SOURCE_PATH", alias, message: `${alias} is bound to an invalid field path (use dot-separated keys, max depth 8).` });
      continue;
    }
    const other = seenPaths.get(value);
    if (other) {
      problems.push({ code: "DUPLICATE_SOURCE_PATH", alias, message: `${alias} and ${other} are bound to the same source field.` });
      continue;
    }
    seenPaths.set(value, alias);
    aliasToPath[alias] = value;
  }
  for (const alias of used) {
    if (!(alias in document.aliases)) problems.push({ code: "UNBOUND_ALIAS", alias, message: `${alias} is read by the mapping but not bound.` });
  }
  if (problems.length > 0) return { ok: false, problems };
  const executable = bindMapping(contract, aliasToPath);
  const check = validateContract(executable);
  if (!check.valid) {
    return {
      ok: false,
      problems: check.issues.map((issue) => ({ code: "BOUND_CONTRACT_INVALID" as const, message: `${issue.path}: ${issue.message}` })),
    };
  }
  return { ok: true, aliasToPath, executable };
}

/** A bindings template: every alias the mapping reads, unbound. Contains no source names. */
export function bindingsTemplate(contract: MappingContract): { bindingsVersion: string; mappingId: string; aliases: Record<string, string> } {
  return {
    bindingsVersion: BINDINGS_VERSION,
    mappingId: contract.mappingId,
    aliases: Object.fromEntries(mappingAliases(contract).map((alias) => [alias, ""])),
  };
}

function toRuntimeIssue(issue: MappingIssue, detail: boolean): RuntimeIssue {
  return {
    code: issue.code,
    ...(typeof issue.operationIndex === "number" ? { operation: issue.operationIndex + 1 } : {}),
    ...(issue.op ? { op: issue.op } : {}),
    ...(issue.path ? { path: issue.path } : {}),
    ...(detail ? { message: issue.message } : {}),
  };
}

/**
 * Execute an executable contract (alias-level for alias-keyed fixtures, or
 * bound for real local records) with the canonical engine, then classify each
 * record under the packaged acceptance policy. Quarantined records are listed,
 * never dropped, and never counted as transformed.
 */
export function runRecords(input: {
  contract: unknown;
  targetSchema: unknown;
  records: unknown;
  policy: AcceptancePolicy;
  /** Include engine messages. They may quote record values; keep them local. */
  detail?: boolean;
}): RuntimeRunResult {
  const detail = input.detail === true;
  const contractCheck = validateContract(input.contract);
  if (!contractCheck.valid || contractCheck.kind !== "mapping") {
    return {
      ok: false,
      error: {
        code: "INVALID_MAPPING_CONTRACT",
        message: "The mapping is not a valid canonical Mapping Contract.",
        issues: contractCheck.issues.map((issue) => ({ code: "INVALID_MAPPING_CONTRACT", path: issue.path, message: issue.message })),
      },
    };
  }
  const policyIssues = validateAcceptancePolicy(input.policy);
  if (policyIssues.length > 0) {
    return { ok: false, error: { code: "INVALID_POLICY", message: policyIssues.join(" "), issues: [] } };
  }
  if (!Array.isArray(input.records)) {
    return { ok: false, error: { code: "MALFORMED_JSON", message: "Input must be a JSON array of records (or an object with a `records` array).", issues: [] } };
  }
  if (input.records.length === 0) {
    return { ok: false, error: { code: "EMPTY_INPUT", message: "The input contains no records.", issues: [] } };
  }
  const contract = input.contract as MappingContract;
  const results: RuntimeRecordResult[] = [];
  for (let start = 0; start < input.records.length; start += RUNTIME_CHUNK_SIZE) {
    const chunk = input.records.slice(start, start + RUNTIME_CHUNK_SIZE);
    const batch = executeMappingBatch({ sourceRecords: chunk, mappingContract: contract, targetSchema: input.targetSchema });
    if (batch.results.length === 0) {
      return {
        ok: false,
        error: { code: batch.issues[0]?.code ?? "BATCH_REFUSED", message: "The engine refused the batch before any record ran.", issues: batch.issues.map((issue) => toRuntimeIssue(issue, detail)) },
      };
    }
    for (const result of batch.results) {
      const index = start + result.index;
      const classified = classifyRow({
        row: { index, set: "imported", setIndex: index + 1, status: result.status, output: result.output, localIssues: result.issues, safeIssues: [] },
        record: input.records[index],
        executable: contract,
        policy: input.policy,
      });
      results.push({
        index,
        status: result.status,
        outcome: classified.outcome as RuntimeRecordResult["outcome"],
        output: result.output,
        issues: result.issues.map((issue) => toRuntimeIssue(issue, detail)),
      });
    }
  }
  const count = (outcome: RuntimeRecordResult["outcome"]) => results.filter((item) => item.outcome === outcome).length;
  const quarantinedIndices = results.filter((item) => item.outcome === "QUARANTINED").map((item) => item.index);
  const quarantineRate = results.length === 0 ? 0 : quarantinedIndices.length / results.length;
  return {
    ok: true,
    results,
    summary: {
      total: results.length,
      transformedValid: count("TRANSFORMED_VALID"),
      handledByApprovedRule: count("HANDLED_BY_APPROVED_RULE"),
      quarantined: quarantinedIndices.length,
      unresolved: count("UNRESOLVED"),
      rejectedByPolicy: count("REJECTED_BY_POLICY"),
      quarantinedIndices,
      quarantineRate,
      withinQuarantinePolicy: quarantineRate <= input.policy.maxQuarantineRate,
    },
  };
}

/** Value-free fingerprint of one record result, used to compare runs. */
export function resultFingerprint(result: RuntimeRecordResult): string {
  return canonicalizeJson({
    index: result.index,
    status: result.status,
    outcome: result.outcome,
    output: result.output,
    codes: result.issues.map((issue) => [issue.code, issue.operation ?? null]),
  });
}

/**
 * Re-run the packaged fixtures and compare them with the outputs recorded at
 * export time by the same engine. Any difference is a reproducibility failure.
 */
export function verifyFixtures(input: {
  contract: unknown;
  targetSchema: unknown;
  fixtures: unknown;
  expected: unknown;
  policy: AcceptancePolicy;
}): { ok: boolean; checked: number; mismatches: number[]; error?: string } {
  const run = runRecords({ contract: input.contract, targetSchema: input.targetSchema, records: input.fixtures, policy: input.policy });
  if (!run.ok) return { ok: false, checked: 0, mismatches: [], error: `${run.error.code}: ${run.error.message}` };
  const expected = isObject(input.expected) && Array.isArray(input.expected.results) ? (input.expected.results as RuntimeRecordResult[]) : null;
  if (!expected) return { ok: false, checked: 0, mismatches: [], error: "Expected outputs are malformed." };
  const mismatches: number[] = [];
  const length = Math.max(expected.length, run.results.length);
  for (let index = 0; index < length; index += 1) {
    const actual = run.results[index];
    const recorded = expected[index];
    if (!actual || !recorded || resultFingerprint(actual) !== resultFingerprint(recorded)) mismatches.push(index);
  }
  return { ok: mismatches.length === 0, checked: run.results.length, mismatches };
}

/** Canonical JSON used for every contract hash (same function as the app). */
export function canonicalJson(value: unknown): string {
  return canonicalizeJson(value);
}

/** Canonical Mapping Contract 1.0.0 validation, as the app runs it. */
export function validateMappingContract(value: unknown): { valid: boolean; issues: Array<{ path: string; message: string }> } {
  const check = validateContract(value);
  return { valid: check.valid && check.kind === "mapping", issues: check.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
}

/** Accept a bare array or `{ records: [...] }`, the two shapes the app imports. */
export function extractRecords(document: unknown): unknown {
  if (Array.isArray(document)) return document;
  if (isObject(document) && Array.isArray(document.records)) return document.records;
  return document;
}
