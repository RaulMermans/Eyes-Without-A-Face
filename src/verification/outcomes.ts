/**
 * Safe exception handling (Sprint 7, Workstream D).
 *
 * A separate, deterministic layer AFTER the unchanged eight-operation engine.
 * It never modifies a record and never writes a value: it only classifies what
 * the engine already did, under a versioned acceptance policy owned locally
 * (fixture or user), never by Gemini.
 *
 *   TRANSFORMED_VALID        engine output, schema-valid, no rule used
 *                            (and equal to ground truth when one exists)
 *   HANDLED_BY_APPROVED_RULE engine output that relied on a policy-approved
 *                            fallback/default (and equals ground truth)
 *   QUARANTINED              engine refused the record for a reason the policy
 *                            routes to manual review. Not a success.
 *   UNRESOLVED               engine refused the record for any other reason
 *   REJECTED_BY_POLICY       engine produced output by inventing a value the
 *                            policy did not approve (unapproved enum fallback
 *                            or default). Counted as a failure.
 *   INCORRECT_TRANSFORMATION output differs from ground truth (evaluation
 *                            fixtures only)
 */
import type { MappingContract, MappingOperation } from "../domain/contracts/types.ts";
import type { MappingFailureCode } from "../domain/mapping/codes.ts";
import { parseFieldRef, readPath } from "../domain/mapping/paths.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import type { RealityCheckReport, RealityCheckRow } from "./reality-check.ts";

export const ACCEPTANCE_POLICY_VERSION = "1.0.0";

export interface AcceptancePolicy {
  policyVersion: typeof ACCEPTANCE_POLICY_VERSION;
  policyId: string;
  /** Short local description. Never sent anywhere. */
  description: string;
  /** Engine failures routed to manual review. `to` narrows the rule to one destination. */
  quarantine: Array<{ code: MappingFailureCode; to?: string }>;
  /** map_enum unmapped=default values the owner approved per destination. */
  approvedFallbacks: Array<{ to: string; value: string; appliesTo: "undisclosed-category" }>;
  /** default_if_missing values the owner approved per destination. */
  approvedDefaults: Array<{ to: string; value: string | number | boolean | null }>;
  /** Highest quarantined share (0..1) still eligible for VERIFIED_WITH_EXCEPTIONS. */
  maxQuarantineRate: number;
}

/** Default for user-imported data: nothing is quarantined, no value may be invented. */
export const STRICT_POLICY: AcceptancePolicy = {
  policyVersion: ACCEPTANCE_POLICY_VERSION,
  policyId: "strict",
  description: "No quarantine rules, no approved fallbacks or defaults. Every refused record is unresolved.",
  quarantine: [],
  approvedFallbacks: [],
  approvedDefaults: [],
  maxQuarantineRate: 0,
};

export function validateAcceptancePolicy(policy: AcceptancePolicy): string[] {
  const issues: string[] = [];
  if (policy.policyVersion !== ACCEPTANCE_POLICY_VERSION) issues.push("Unsupported policy version.");
  if (!(policy.maxQuarantineRate >= 0 && policy.maxQuarantineRate <= 1)) issues.push("maxQuarantineRate must be within 0..1.");
  for (const rule of policy.quarantine) {
    if (rule.code === "INVALID_MAPPING_CONTRACT" || rule.code === "UNSAFE_MAPPING" || rule.code === "UNSUPPORTED_OPERATION") {
      issues.push(`${rule.code} is a contract failure and cannot be quarantined.`);
    }
  }
  return issues;
}

export type RecordOutcome =
  | "TRANSFORMED_VALID"
  | "HANDLED_BY_APPROVED_RULE"
  | "QUARANTINED"
  | "UNRESOLVED"
  | "REJECTED_BY_POLICY"
  | "INCORRECT_TRANSFORMATION";

/** Ground truth for evaluation fixtures. Never available for user data. */
export type ExpectedOutcome =
  | { kind: "transform"; output: Record<string, unknown> }
  | { kind: "fallback"; output: Record<string, unknown> }
  | { kind: "quarantine" };

export interface ClassifiedRow {
  index: number;
  set: RealityCheckRow["set"];
  setIndex: number;
  outcome: RecordOutcome;
  /** Whether the outcome matches ground truth (null without ground truth). */
  correct: boolean | null;
  /** 1-based operation numbers that used an approved or unapproved rule. */
  rulesUsed: number[];
  /** 1-based operation numbers whose fallback/default was NOT approved by the policy. */
  unapprovedRules: number[];
  codes: MappingFailureCode[];
  outputSchemaViolation: boolean;
}

function readLocal(record: unknown, ref: string): { present: boolean; value: unknown } {
  const parsed = parseFieldRef(ref, "from");
  if (!parsed.ok) return { present: false, value: undefined };
  const read = readPath(record, parsed.path);
  if ("code" in read || read.kind === "missing") return { present: false, value: undefined };
  return { present: true, value: read.value };
}

function issueDestination(row: RealityCheckRow, position: number, contract: MappingContract): string | undefined {
  const issue = row.localIssues[position];
  if (!issue) return undefined;
  if (typeof issue.operationIndex === "number") return contract.operations[issue.operationIndex]?.to;
  if (issue.code === "OUTPUT_SCHEMA_MISMATCH" && issue.path && issue.path.startsWith("/") && issue.path.length > 1) {
    return issue.path.slice(1).split("/").join(".");
  }
  return undefined;
}

/**
 * Which operations relied on a fallback/default for this record, and whether
 * each was approved. Reads the private record locally; returns numbers only.
 */
function ruleUsage(
  record: unknown,
  executable: MappingContract,
  policy: AcceptancePolicy,
): { approved: number[]; unapproved: number[] } {
  const approved: number[] = [];
  const unapproved: number[] = [];
  executable.operations.forEach((operation: MappingOperation, index) => {
    if (operation.op === "map_enum" && operation.params.unmapped === "default") {
      const read = readLocal(record, operation.from);
      if (read.present && typeof read.value === "string" && !Object.hasOwn(operation.params.map, read.value)) {
        const ok = policy.approvedFallbacks.some((rule) => rule.to === operation.to && rule.value === operation.params.default);
        (ok ? approved : unapproved).push(index + 1);
      }
    }
    if (operation.op === "default_if_missing") {
      const used = operation.from === undefined ? true : !readLocal(record, operation.from).present;
      if (used) {
        const ok = policy.approvedDefaults.some(
          (rule) => rule.to === operation.to && canonicalizeJson(rule.value) === canonicalizeJson(operation.params.value),
        );
        (ok ? approved : unapproved).push(index + 1);
      }
    }
  });
  return { approved, unapproved };
}

export function classifyRow(input: {
  row: RealityCheckRow;
  record: unknown;
  /** Resolved executable contract (local paths). */
  executable: MappingContract;
  policy: AcceptancePolicy;
  expected?: ExpectedOutcome;
}): ClassifiedRow {
  const { row, executable, policy, expected } = input;
  const codes = [...new Set(row.localIssues.map((issue) => issue.code))];
  const base = {
    index: row.index,
    set: row.set,
    setIndex: row.setIndex,
    codes,
    outputSchemaViolation: codes.includes("OUTPUT_SCHEMA_MISMATCH"),
  };

  if (row.status === "fail") {
    const quarantinable =
      row.localIssues.length > 0 &&
      row.localIssues.every((issue, position) => {
        const to = issueDestination(row, position, executable);
        return policy.quarantine.some((rule) => rule.code === issue.code && (rule.to === undefined || rule.to === to));
      });
    const outcome: RecordOutcome = quarantinable ? "QUARANTINED" : "UNRESOLVED";
    const correct = expected ? outcome === "QUARANTINED" && expected.kind === "quarantine" : null;
    return { ...base, outcome, correct, rulesUsed: [], unapprovedRules: [] };
  }

  const usage = ruleUsage(input.record, executable, policy);
  const rulesUsed = [...usage.approved, ...usage.unapproved].sort((a, b) => a - b);
  const unapprovedRules = [...usage.unapproved].sort((a, b) => a - b);
  if (usage.unapproved.length > 0) {
    return { ...base, outcome: "REJECTED_BY_POLICY", correct: expected ? false : null, rulesUsed, unapprovedRules };
  }
  const outcome: RecordOutcome = usage.approved.length > 0 ? "HANDLED_BY_APPROVED_RULE" : "TRANSFORMED_VALID";
  if (!expected) return { ...base, outcome, correct: null, rulesUsed, unapprovedRules };
  if (expected.kind === "quarantine") {
    // The record should have been held for review; producing output from it is wrong.
    return { ...base, outcome: "INCORRECT_TRANSFORMATION", correct: false, rulesUsed, unapprovedRules };
  }
  const equal = canonicalizeJson(row.output ?? null) === canonicalizeJson(expected.output);
  if (!equal) return { ...base, outcome: "INCORRECT_TRANSFORMATION", correct: false, rulesUsed, unapprovedRules };
  return { ...base, outcome, correct: true, rulesUsed, unapprovedRules };
}

export interface OutcomeMetrics {
  total: number;
  transformedValid: number;
  handledByApprovedRule: number;
  quarantined: number;
  /** Quarantined records whose ground truth is "quarantine" (correctly held). */
  quarantinedAsExpected: number;
  unresolved: number;
  rejectedByPolicy: number;
  incorrect: number;
  outputSchemaViolations: number;
  /** transformedValid + handledByApprovedRule + quarantinedAsExpected, when ground truth exists. */
  correctlyHandled: number | null;
  /** Records whose correct handling is a transformation and that were transformed correctly. */
  correctTransformations: number | null;
  groundTruth: boolean;
}

export function summarizeOutcomes(rows: readonly ClassifiedRow[]): OutcomeMetrics {
  const count = (outcome: RecordOutcome) => rows.filter((row) => row.outcome === outcome).length;
  const groundTruth = rows.length > 0 && rows.every((row) => row.correct !== null);
  return {
    total: rows.length,
    transformedValid: count("TRANSFORMED_VALID"),
    handledByApprovedRule: count("HANDLED_BY_APPROVED_RULE"),
    quarantined: count("QUARANTINED"),
    quarantinedAsExpected: rows.filter((row) => row.outcome === "QUARANTINED" && row.correct === true).length,
    unresolved: count("UNRESOLVED"),
    rejectedByPolicy: count("REJECTED_BY_POLICY"),
    incorrect: count("INCORRECT_TRANSFORMATION"),
    outputSchemaViolations: rows.filter((row) => row.outputSchemaViolation).length,
    correctlyHandled: groundTruth ? rows.filter((row) => row.correct === true).length : null,
    correctTransformations: groundTruth
      ? rows.filter((row) => row.correct === true && (row.outcome === "TRANSFORMED_VALID" || row.outcome === "HANDLED_BY_APPROVED_RULE")).length
      : null,
    groundTruth,
  };
}

export type CompletionState =
  | "VERIFIED"
  | "VERIFIED_WITH_EXCEPTIONS"
  | "PARTIALLY_VERIFIED"
  | "REVISION_FAILED"
  | "BLOCKED";

export const COMPLETION_CRITERIA: Readonly<Record<CompletionState, string>> = {
  VERIFIED: "Contract valid, engine ran, every record transformed with no rule, no quarantine, and no failure.",
  VERIFIED_WITH_EXCEPTIONS:
    "Contract valid and engine ran; no unresolved, incorrect or policy-rejected record; at least one record handled by an approved rule or quarantined, with the quarantine share within the policy limit.",
  PARTIALLY_VERIFIED: "Contract valid and engine ran, but at least one record is unresolved, incorrect, rejected by policy, or quarantine exceeds the policy limit.",
  REVISION_FAILED: "The revised proposal was rejected before execution (invalid output or contract).",
  BLOCKED: "Nothing could be evaluated: inference unavailable, approval declined, or feedback failed validation.",
};

/**
 * Deterministic completion state. Model assertions are not an input: only the
 * report statuses and the classified rows decide.
 */
export function completionState(input: {
  report: RealityCheckReport | null;
  rows: readonly ClassifiedRow[];
  policy: AcceptancePolicy;
  revisionRejected?: boolean;
}): CompletionState {
  if (input.revisionRejected) return "REVISION_FAILED";
  const report = input.report;
  if (!report) return "BLOCKED";
  if (report.statuses.mappingContract !== "pass" || report.statuses.targetSchema !== "pass" || report.total === 0) {
    return "BLOCKED";
  }
  const metrics = summarizeOutcomes(input.rows);
  if (metrics.unresolved > 0 || metrics.incorrect > 0 || metrics.rejectedByPolicy > 0) return "PARTIALLY_VERIFIED";
  const quarantineRate = metrics.total === 0 ? 0 : metrics.quarantined / metrics.total;
  if (quarantineRate > input.policy.maxQuarantineRate) return "PARTIALLY_VERIFIED";
  if (metrics.quarantined === 0 && metrics.handledByApprovedRule === 0 && metrics.transformedValid === metrics.total) {
    return "VERIFIED";
  }
  return "VERIFIED_WITH_EXCEPTIONS";
}

/** Classify every row of a Reality Check report. `records` must be [imported..., reserved...]. */
export function classifyReport(input: {
  report: RealityCheckReport;
  records: readonly unknown[];
  executable: MappingContract;
  policy: AcceptancePolicy;
  expected?: readonly (ExpectedOutcome | undefined)[];
}): ClassifiedRow[] {
  return input.report.rows.map((row) =>
    classifyRow({
      row,
      record: input.records[row.index],
      executable: input.executable,
      policy: input.policy,
      expected: input.expected?.[row.index],
    }),
  );
}
