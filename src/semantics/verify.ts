/**
 * Semantic verification engine (Sprint 8, Workstream A).
 *
 * Detects silent semantic errors: outputs that pass the Mapping Contract, the
 * engine and the destination JSON Schema but contradict a TRUSTED constraint.
 * It runs AFTER the unchanged engine, on the same rows, and never changes a
 * record or a mapping.
 *
 * Inputs are the executable contract (local paths), the Reality Check report
 * over imported + revision-feedback records, the same records, and a
 * validated Semantic Verification Contract. It never receives ground truth:
 * there is no `expected` parameter, and nothing here imports fixtures.
 *
 * Every check is generic (date interpretation, order preservation, declared
 * meaning, allowed values). No scenario id, field name or expected output is
 * referenced.
 *
 * Status vocabulary (never collapsed into one another):
 *   SEMANTIC_PASS              a trusted constraint was exercised and held
 *   SEMANTIC_MISMATCH          output contradicts a trusted constraint
 *   SEMANTIC_POLICY_CONFLICT   a value requiring review became output, or the
 *                              constraint conflicts with the destination/another constraint
 *   SEMANTIC_AMBIGUOUS         legitimate evidence could not decide; confirmation needed
 *   SEMANTIC_EVIDENCE_MISSING  a meaning-bearing operation has no trusted constraint
 *   SEMANTIC_UNVERIFIED        nothing exercised the constraint, or the field is structural only
 */
import type { MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import { parseDateValue } from "../domain/mapping/ops.ts";
import { parseFieldRef, readPath } from "../domain/mapping/paths.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { SemanticFindingCode } from "../domain/contracts/types.ts";
import {
  validateSemanticContract,
  type SemanticConflictCode,
  type SemanticConstraint,
  type SemanticVerificationContract,
} from "./contract.ts";

export const SEMANTIC_VERIFIER_VERSION = "1.0.0";

export type SemanticStatus =
  | "SEMANTIC_PASS"
  | "SEMANTIC_MISMATCH"
  | "SEMANTIC_POLICY_CONFLICT"
  | "SEMANTIC_AMBIGUOUS"
  | "SEMANTIC_EVIDENCE_MISSING"
  | "SEMANTIC_UNVERIFIED";

/** Worst first. Used for field and overall roll-ups. */
export const SEMANTIC_SEVERITY: readonly SemanticStatus[] = [
  "SEMANTIC_MISMATCH",
  "SEMANTIC_POLICY_CONFLICT",
  "SEMANTIC_AMBIGUOUS",
  "SEMANTIC_EVIDENCE_MISSING",
  "SEMANTIC_PASS",
  "SEMANTIC_UNVERIFIED",
];

export type SemanticReason =
  | "STATIC_FORMAT_CONTRADICTS"
  | "OUTPUT_CONTRADICTS_INTERPRETATION"
  | "ORDER_INVERTED"
  | "VALUE_OUTSIDE_DECLARED_MEANING"
  | "UNDECLARED_CATEGORY_ACCEPTED"
  | "VALUE_NOT_ALLOWED"
  | "AMBIGUOUS_EVIDENCE"
  | "UNTRUSTED_SUGGESTION"
  | "NO_TRUSTED_CONSTRAINT"
  | "NOT_EXERCISED"
  | "STRUCTURAL_ONLY"
  | SemanticConflictCode;

export interface ConstraintResult {
  /** Local id; null for evidence-missing results synthesized per operation. */
  constraintId: string | null;
  kind: SemanticConstraint["kind"] | "operation";
  status: SemanticStatus;
  code?: SemanticFindingCode;
  reasons: SemanticReason[];
  /** Destination field the result concerns. */
  target?: string;
  /** Local source path (never leaves the device). */
  source?: string;
  /** 1-based operation numbers involved. */
  operations: number[];
  checkedRows: number;
  /** Row indices (report order) that violate the constraint. Local only. */
  violatingRows: number[];
}

export interface FieldSemanticStatus {
  target: string;
  status: SemanticStatus;
  operation?: number;
  constraintIds: string[];
}

export interface SemanticReport {
  verifierVersion: typeof SEMANTIC_VERIFIER_VERSION;
  contractId: string;
  /** False when the contract failed validation: nothing was verified (fail closed). */
  contractValid: boolean;
  contractIssues: string[];
  results: ConstraintResult[];
  fields: FieldSemanticStatus[];
  overall: SemanticStatus;
  coverage: { fields: number; verified: number; mismatched: number; unknown: number };
  /** Union of violating rows across MISMATCH / POLICY_CONFLICT results. */
  violatingRows: number[];
}

function readLocal(record: unknown, path: string): { present: boolean; value: unknown } {
  const parsed = parseFieldRef(path, "from");
  if (!parsed.ok) return { present: false, value: undefined };
  const read = readPath(record, parsed.path);
  if ("code" in read || read.kind === "missing") return { present: false, value: undefined };
  return { present: true, value: read.value };
}

function readOutput(output: Record<string, unknown> | null, target: string): unknown {
  let current: unknown = output;
  for (const part of target.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function fromOf(operation: MappingOperation): string | undefined {
  return "from" in operation && typeof operation.from === "string" ? operation.from : undefined;
}

function worst(statuses: readonly SemanticStatus[]): SemanticStatus {
  for (const status of SEMANTIC_SEVERITY) if (statuses.includes(status)) return status;
  return "SEMANTIC_UNVERIFIED";
}

type Row = RealityCheckReport["rows"][number];

function verifyDate(
  constraint: Extract<SemanticConstraint, { kind: "date-interpretation" }>,
  operations: MappingOperation[],
  rows: readonly Row[],
  records: readonly unknown[],
): ConstraintResult {
  const parses = operations
    .map((operation, index) => ({ operation, number: index + 1 }))
    .filter((item) => item.operation.op === "parse_date" && fromOf(item.operation) === constraint.source);
  const base = { constraintId: constraint.id, kind: constraint.kind, source: constraint.source, operations: parses.map((item) => item.number) };
  const target = parses[0]?.operation.to;
  if (parses.length === 0) {
    return { ...base, status: "SEMANTIC_UNVERIFIED", reasons: ["NOT_EXERCISED"], checkedRows: 0, violatingRows: [] };
  }
  if (constraint.trust === "ambiguous") {
    return { ...base, target, status: "SEMANTIC_AMBIGUOUS", code: "SEMANTIC_AMBIGUOUS_DATE", reasons: ["AMBIGUOUS_EVIDENCE"], checkedRows: 0, violatingRows: [] };
  }
  if (constraint.trust !== "trusted" || constraint.format === null) {
    return { ...base, target, status: "SEMANTIC_EVIDENCE_MISSING", code: "SEMANTIC_EVIDENCE_MISSING", reasons: ["UNTRUSTED_SUGGESTION"], checkedRows: 0, violatingRows: [] };
  }
  const reasons = new Set<SemanticReason>();
  const violating = new Set<number>();
  let checked = 0;
  for (const { operation } of parses) {
    if (operation.op !== "parse_date") continue;
    if (operation.params.inputFormat !== constraint.format) reasons.add("STATIC_FORMAT_CONTRADICTS");
    for (const row of rows) {
      if (row.status !== "pass") continue;
      const produced = readOutput(row.output, operation.to);
      const raw = readLocal(records[row.index], constraint.source);
      if (produced === undefined || !raw.present || typeof raw.value !== "string") continue;
      checked += 1;
      const reference = parseDateValue(raw.value, constraint.format, constraint.source);
      if (!reference.ok || reference.value !== produced) {
        violating.add(row.index);
        reasons.add("OUTPUT_CONTRADICTS_INTERPRETATION");
      }
    }
  }
  const mismatch = reasons.size > 0;
  return {
    ...base,
    target,
    status: mismatch ? "SEMANTIC_MISMATCH" : checked > 0 ? "SEMANTIC_PASS" : "SEMANTIC_UNVERIFIED",
    code: mismatch ? "SEMANTIC_DATE_ORDER_CONFLICT" : undefined,
    reasons: mismatch ? [...reasons] : checked > 0 ? [] : ["NOT_EXERCISED"],
    checkedRows: checked,
    violatingRows: [...violating].sort((a, b) => a - b),
  };
}

/** Pairs (source label → output value) realized by the mapping: statically from map_enum, dynamically from rows. */
function realizedPairs(
  source: string,
  target: string,
  operations: MappingOperation[],
  rows: readonly Row[],
  records: readonly unknown[],
): { static: Array<[string, string]>; dynamic: Array<{ row: number; label: string; value: unknown }>; numbers: number[] } {
  const numbers: number[] = [];
  const statics: Array<[string, string]> = [];
  operations.forEach((operation, index) => {
    if (operation.to !== target) return;
    numbers.push(index + 1);
    if (operation.op === "map_enum" && fromOf(operation) === source) {
      for (const [label, value] of Object.entries(operation.params.map)) statics.push([label, value]);
    }
  });
  const dynamic: Array<{ row: number; label: string; value: unknown }> = [];
  for (const row of rows) {
    if (row.status !== "pass") continue;
    const raw = readLocal(records[row.index], source);
    const produced = readOutput(row.output, target);
    if (!raw.present || typeof raw.value !== "string" || produced === undefined) continue;
    dynamic.push({ row: row.index, label: raw.value, value: produced });
  }
  return { static: statics, dynamic, numbers };
}

function verifyCategories(
  constraint: Extract<SemanticConstraint, { kind: "ordered-categories" | "enum-meaning" }>,
  operations: MappingOperation[],
  rows: readonly Row[],
  records: readonly unknown[],
): ConstraintResult {
  const pairs = realizedPairs(constraint.source, constraint.target, operations, rows, records);
  const base = { constraintId: constraint.id, kind: constraint.kind, source: constraint.source, target: constraint.target, operations: pairs.numbers };
  if (pairs.numbers.length === 0) {
    return { ...base, status: "SEMANTIC_UNVERIFIED", reasons: ["NOT_EXERCISED"], checkedRows: 0, violatingRows: [] };
  }
  if (constraint.trust !== "trusted") {
    const ambiguous = constraint.trust === "ambiguous";
    return {
      ...base,
      status: ambiguous ? "SEMANTIC_AMBIGUOUS" : "SEMANTIC_EVIDENCE_MISSING",
      code: "SEMANTIC_EVIDENCE_MISSING",
      reasons: [ambiguous ? "AMBIGUOUS_EVIDENCE" : "UNTRUSTED_SUGGESTION"],
      checkedRows: 0,
      violatingRows: [],
    };
  }
  const declared = new Set(constraint.kind === "ordered-categories" ? constraint.sourceOrder : Object.keys(constraint.meaning));
  const reasons = new Set<SemanticReason>();
  const violating = new Set<number>();
  const policyRows = new Set<number>();
  let policy = false;
  const all: Array<{ row: number | null; label: string; value: unknown }> = [
    ...pairs.static.map(([label, value]) => ({ row: null, label, value })),
    ...pairs.dynamic,
  ];

  for (const pair of all) {
    if (!declared.has(pair.label)) {
      // A category outside the declared set must not become successful output under "review".
      if (constraint.undeclared === "review" && pair.row !== null) {
        policy = true;
        policyRows.add(pair.row);
        reasons.add("UNDECLARED_CATEGORY_ACCEPTED");
      }
      continue;
    }
    if (constraint.kind === "enum-meaning" && pair.value !== constraint.meaning[pair.label]) {
      reasons.add("VALUE_OUTSIDE_DECLARED_MEANING");
      if (pair.row !== null) violating.add(pair.row);
    }
    if (constraint.kind === "ordered-categories" && (typeof pair.value !== "string" || !constraint.targetOrder.includes(pair.value))) {
      reasons.add("VALUE_OUTSIDE_DECLARED_MEANING");
      if (pair.row !== null) violating.add(pair.row);
    }
  }

  let inverted = false;
  if (constraint.kind === "ordered-categories") {
    const sourceRank = new Map(constraint.sourceOrder.map((label, rank) => [label, rank]));
    const targetRank = new Map(constraint.targetOrder.map((label, rank) => [label, rank]));
    const ranked = all.filter(
      (pair): pair is { row: number | null; label: string; value: string } =>
        sourceRank.has(pair.label) && typeof pair.value === "string" && targetRank.has(pair.value),
    );
    // Order preservation: a higher-ranked source label never maps to a lower-ranked destination value.
    for (const a of ranked) {
      for (const b of ranked) {
        const sa = sourceRank.get(a.label) ?? 0;
        const sb = sourceRank.get(b.label) ?? 0;
        const ta = targetRank.get(a.value) ?? 0;
        const tb = targetRank.get(b.value) ?? 0;
        if (sa < sb && ta > tb) {
          inverted = true;
          if (a.row !== null) violating.add(a.row);
          if (b.row !== null) violating.add(b.row);
        }
      }
    }
    if (inverted) reasons.add("ORDER_INVERTED");
  }

  const checkedRows = pairs.dynamic.length;
  const mismatch = violating.size > 0 || inverted || reasons.has("VALUE_OUTSIDE_DECLARED_MEANING");
  const status: SemanticStatus = mismatch ? "SEMANTIC_MISMATCH" : policy ? "SEMANTIC_POLICY_CONFLICT" : checkedRows > 0 || pairs.static.length > 0 ? "SEMANTIC_PASS" : "SEMANTIC_UNVERIFIED";
  const code: SemanticFindingCode | undefined = mismatch
    ? inverted
      ? "SEMANTIC_ORDER_INVERSION"
      : "SEMANTIC_ENUM_MEANING_CONFLICT"
    : policy
      ? "SEMANTIC_POLICY_VIOLATION"
      : undefined;
  return {
    ...base,
    status,
    code,
    reasons: status === "SEMANTIC_UNVERIFIED" ? ["NOT_EXERCISED"] : [...reasons],
    checkedRows,
    violatingRows: [...new Set([...violating, ...policyRows])].sort((a, b) => a - b),
  };
}

function verifyAllowed(
  constraint: Extract<SemanticConstraint, { kind: "allowed-values" }>,
  operations: MappingOperation[],
  rows: readonly Row[],
): ConstraintResult {
  const numbers = operations.flatMap((operation, index) => (operation.to === constraint.target ? [index + 1] : []));
  const base = { constraintId: constraint.id, kind: constraint.kind, target: constraint.target, operations: numbers };
  if (constraint.trust !== "trusted") {
    return { ...base, status: "SEMANTIC_EVIDENCE_MISSING", code: "SEMANTIC_EVIDENCE_MISSING", reasons: ["UNTRUSTED_SUGGESTION"], checkedRows: 0, violatingRows: [] };
  }
  const violating: number[] = [];
  let checked = 0;
  for (const row of rows) {
    if (row.status !== "pass") continue;
    const produced = readOutput(row.output, constraint.target);
    if (produced === undefined) continue;
    checked += 1;
    if (typeof produced !== "string" || !constraint.values.includes(produced)) violating.push(row.index);
  }
  if (violating.length > 0) {
    return { ...base, status: "SEMANTIC_POLICY_CONFLICT", code: "SEMANTIC_POLICY_VIOLATION", reasons: ["VALUE_NOT_ALLOWED"], checkedRows: checked, violatingRows: violating };
  }
  return { ...base, status: checked > 0 ? "SEMANTIC_PASS" : "SEMANTIC_UNVERIFIED", reasons: checked > 0 ? [] : ["NOT_EXERCISED"], checkedRows: checked, violatingRows: [] };
}

/** Operations whose correctness depends on meaning, not structure. */
function meaningBearing(operation: MappingOperation): boolean {
  if (operation.op === "map_enum") return true;
  return operation.op === "parse_date" && (operation.params.inputFormat === "MM/DD/YYYY" || operation.params.inputFormat === "DD/MM/YYYY");
}

function covers(constraint: SemanticConstraint, operation: MappingOperation): boolean {
  if (constraint.kind === "date-interpretation") return operation.op === "parse_date" && fromOf(operation) === constraint.source;
  if (constraint.kind === "allowed-values") return false;
  return operation.to === constraint.target;
}

export function verifySemantics(input: {
  contract: SemanticVerificationContract;
  /** Resolved executable contract (local source paths). */
  executable: MappingContract;
  /** Reality Check over imported + revision-feedback records (never holdout, except in final holdout scoring). */
  report: RealityCheckReport;
  /** Records aligned with report row indices. */
  records: readonly unknown[];
  destinationSchema?: unknown;
}): SemanticReport {
  const validation = validateSemanticContract(input.contract, input.destinationSchema);
  const operations = input.executable.operations;
  const targets = [...new Set(operations.map((operation) => operation.to))];
  if (!validation.valid) {
    return {
      verifierVersion: SEMANTIC_VERIFIER_VERSION,
      contractId: input.contract.contractId,
      contractValid: false,
      contractIssues: validation.issues.map((issue) => issue.code),
      results: [],
      fields: targets.map((target) => ({ target, status: "SEMANTIC_UNVERIFIED", constraintIds: [] })),
      overall: "SEMANTIC_UNVERIFIED",
      coverage: { fields: targets.length, verified: 0, mismatched: 0, unknown: targets.length },
      violatingRows: [],
    };
  }

  const rows = input.report.rows;
  const results: ConstraintResult[] = [];
  for (const constraint of input.contract.constraints) {
    const conflict = validation.conflicts.get(constraint.id);
    if (conflict && conflict.length > 0) {
      results.push({
        constraintId: constraint.id,
        kind: constraint.kind,
        status: "SEMANTIC_POLICY_CONFLICT",
        code: "SEMANTIC_POLICY_VIOLATION",
        reasons: conflict,
        target: "target" in constraint ? constraint.target : undefined,
        source: "source" in constraint ? constraint.source : undefined,
        operations: operations.flatMap((operation, index) => (covers(constraint, operation) ? [index + 1] : [])),
        checkedRows: 0,
        violatingRows: [],
      });
      continue;
    }
    if (constraint.kind === "date-interpretation") results.push(verifyDate(constraint, operations, rows, input.records));
    else if (constraint.kind === "allowed-values") results.push(verifyAllowed(constraint, operations, rows));
    else results.push(verifyCategories(constraint, operations, rows, input.records));
  }

  // Meaning-bearing operations with no constraint at all: explicit unknown, never pass.
  operations.forEach((operation, index) => {
    if (!meaningBearing(operation)) return;
    if (input.contract.constraints.some((constraint) => covers(constraint, operation))) return;
    results.push({
      constraintId: null,
      kind: "operation",
      status: "SEMANTIC_EVIDENCE_MISSING",
      code: "SEMANTIC_EVIDENCE_MISSING",
      reasons: ["NO_TRUSTED_CONSTRAINT"],
      target: operation.to,
      source: fromOf(operation),
      operations: [index + 1],
      checkedRows: 0,
      violatingRows: [],
    });
  });

  const fields: FieldSemanticStatus[] = targets.map((target) => {
    const operationIndex = operations.findIndex((operation) => operation.to === target);
    const relevant = results.filter((result) => result.target === target || result.operations.includes(operationIndex + 1));
    const status = relevant.length > 0 ? worst(relevant.map((result) => result.status)) : "SEMANTIC_UNVERIFIED";
    return {
      target,
      status,
      operation: operationIndex >= 0 ? operationIndex + 1 : undefined,
      constraintIds: relevant.flatMap((result) => (result.constraintId ? [result.constraintId] : [])),
    };
  });
  const verified = fields.filter((field) => field.status === "SEMANTIC_PASS").length;
  const mismatched = fields.filter((field) => field.status === "SEMANTIC_MISMATCH" || field.status === "SEMANTIC_POLICY_CONFLICT").length;
  const violatingRows = [
    ...new Set(
      results
        .filter((result) => result.status === "SEMANTIC_MISMATCH" || result.status === "SEMANTIC_POLICY_CONFLICT")
        .flatMap((result) => result.violatingRows),
    ),
  ].sort((a, b) => a - b);
  return {
    verifierVersion: SEMANTIC_VERIFIER_VERSION,
    contractId: input.contract.contractId,
    contractValid: true,
    contractIssues: [],
    results,
    fields,
    overall: results.length === 0 ? "SEMANTIC_UNVERIFIED" : worst(results.map((result) => result.status)),
    coverage: { fields: fields.length, verified, mismatched, unknown: fields.length - verified - mismatched },
    violatingRows,
  };
}

export interface SemanticComparison {
  /** (constraint, row) violations present before and gone after. */
  resolved: number;
  /** (constraint, row) violations that appear only after: regressions. */
  introduced: number;
  /** Constraints whose status improved to PASS. */
  constraintsResolved: number;
  /** Constraints that were not failing before and fail after. */
  constraintsBroken: number;
  before: SemanticStatus;
  after: SemanticStatus;
}

const failing = (status: SemanticStatus) => status === "SEMANTIC_MISMATCH" || status === "SEMANTIC_POLICY_CONFLICT";

function resultKey(result: ConstraintResult): string {
  return result.constraintId ?? `op:${result.target ?? ""}`;
}

/** Deterministic regression accounting between two reports on the same rows. */
export function compareSemanticReports(before: SemanticReport, after: SemanticReport): SemanticComparison {
  const afterByKey = new Map(after.results.map((result) => [resultKey(result), result]));
  const beforeByKey = new Map(before.results.map((result) => [resultKey(result), result]));
  let resolved = 0;
  let introduced = 0;
  let constraintsResolved = 0;
  let constraintsBroken = 0;
  for (const [key, a] of beforeByKey) {
    const b = afterByKey.get(key);
    const beforeRows = new Set(failing(a.status) ? a.violatingRows : []);
    const afterRows = new Set(b && failing(b.status) ? b.violatingRows : []);
    for (const row of beforeRows) if (!afterRows.has(row)) resolved += 1;
    for (const row of afterRows) if (!beforeRows.has(row)) introduced += 1;
    if (failing(a.status) && b?.status === "SEMANTIC_PASS") constraintsResolved += 1;
    if (!failing(a.status) && b && failing(b.status)) constraintsBroken += 1;
  }
  for (const [key, b] of afterByKey) {
    if (beforeByKey.has(key)) continue;
    if (failing(b.status)) {
      constraintsBroken += 1;
      introduced += b.violatingRows.length;
    }
  }
  return { resolved, introduced, constraintsResolved, constraintsBroken, before: before.overall, after: after.overall };
}
