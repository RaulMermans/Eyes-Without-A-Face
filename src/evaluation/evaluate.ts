/**
 * Before/after evaluation (Sprint 7, Workstream E). Both mapping versions run
 * through the same deterministic engine (`runRealityCheck`) and the same
 * outcome classifier. Model output is never an input to a verdict.
 */
import type { MappingContract } from "../domain/contracts/types.ts";
import { canonicalizeJson } from "../domain/json/canonical.ts";
import type { PrivateBindings } from "../phantom/bindings.ts";
import { runRealityCheck, type RealityCheckReport } from "../verification/reality-check.ts";
import {
  classifyReport,
  completionState,
  summarizeOutcomes,
  type AcceptancePolicy,
  type ClassifiedRow,
  type CompletionState,
  type ExpectedOutcome,
  type OutcomeMetrics,
  type RecordOutcome,
} from "../verification/outcomes.ts";

export interface MappingEvaluation {
  report: RealityCheckReport;
  rows: ClassifiedRow[];
  metrics: OutcomeMetrics;
  state: CompletionState;
}

/** Evaluate an executable contract on [imported..., reserved...] records. */
export function evaluateMapping(input: {
  executable: MappingContract;
  targetSchema: unknown;
  bindings: PrivateBindings | null;
  records: readonly unknown[];
  reserved?: readonly unknown[];
  policy: AcceptancePolicy;
  expected?: readonly (ExpectedOutcome | undefined)[];
  now?: () => number;
}): MappingEvaluation {
  const report = runRealityCheck({
    records: input.records,
    reservedRecords: input.reserved ?? [],
    mappingContract: input.executable,
    targetSchema: input.targetSchema,
    bindings: input.bindings,
    now: input.now,
  });
  const rows = classifyReport({
    report,
    records: [...input.records, ...(input.reserved ?? [])],
    executable: input.executable,
    policy: input.policy,
    expected: input.expected,
  });
  return { report, rows, metrics: summarizeOutcomes(rows), state: completionState({ report, rows, policy: input.policy }) };
}

const RANK: Readonly<Record<RecordOutcome, number>> = {
  TRANSFORMED_VALID: 3,
  HANDLED_BY_APPROVED_RULE: 3,
  QUARANTINED: 2,
  UNRESOLVED: 1,
  REJECTED_BY_POLICY: 0,
  INCORRECT_TRANSFORMATION: 0,
};

/** Correct handling outranks everything; without ground truth the outcome rank decides. */
function score(row: ClassifiedRow): number {
  if (row.correct === true) return 4;
  return RANK[row.outcome];
}

export interface CaseComparison {
  index: number;
  set: ClassifiedRow["set"];
  setIndex: number;
  before: RecordOutcome;
  after: RecordOutcome;
  beforeCorrect: boolean | null;
  afterCorrect: boolean | null;
  change: "improved" | "regressed" | "unchanged";
}

export interface EvaluationComparison {
  cases: CaseComparison[];
  improved: number;
  regressed: number;
  unchanged: number;
  before: OutcomeMetrics;
  after: OutcomeMetrics;
  /** after.correctlyHandled − before.correctlyHandled (null without ground truth). */
  correctnessDelta: number | null;
  /** True only when something improved and nothing regressed. */
  strictImprovement: boolean;
}

export function compareEvaluations(before: readonly ClassifiedRow[], after: readonly ClassifiedRow[]): EvaluationComparison {
  const afterByIndex = new Map(after.map((row) => [row.index, row]));
  const cases: CaseComparison[] = before.flatMap((row) => {
    const next = afterByIndex.get(row.index);
    if (!next) return [];
    const delta = score(next) - score(row);
    return [
      {
        index: row.index,
        set: row.set,
        setIndex: row.setIndex,
        before: row.outcome,
        after: next.outcome,
        beforeCorrect: row.correct,
        afterCorrect: next.correct,
        change: delta > 0 ? ("improved" as const) : delta < 0 ? ("regressed" as const) : ("unchanged" as const),
      },
    ];
  });
  const beforeMetrics = summarizeOutcomes(before);
  const afterMetrics = summarizeOutcomes(after);
  const improved = cases.filter((item) => item.change === "improved").length;
  const regressed = cases.filter((item) => item.change === "regressed").length;
  return {
    cases,
    improved,
    regressed,
    unchanged: cases.length - improved - regressed,
    before: beforeMetrics,
    after: afterMetrics,
    correctnessDelta:
      beforeMetrics.correctlyHandled !== null && afterMetrics.correctlyHandled !== null
        ? afterMetrics.correctlyHandled - beforeMetrics.correctlyHandled
        : null,
    strictImprovement: improved > 0 && regressed === 0,
  };
}

export interface OperationChange {
  /** Destination field the operation writes. */
  to: string;
  change: "unchanged" | "changed" | "added" | "removed";
  beforeNumber?: number;
  afterNumber?: number;
}

/** Alias-level diff keyed by destination field (each destination is written at most once). */
export function diffContracts(before: MappingContract, after: MappingContract): OperationChange[] {
  const index = (contract: MappingContract) =>
    new Map(contract.operations.map((operation, position) => [operation.to, { operation, number: position + 1 }]));
  const a = index(before);
  const b = index(after);
  const names = [...new Set([...a.keys(), ...b.keys()])];
  return names
    .map((to): OperationChange => {
      const left = a.get(to);
      const right = b.get(to);
      if (left && !right) return { to, change: "removed", beforeNumber: left.number };
      if (!left && right) return { to, change: "added", afterNumber: right.number };
      const same = canonicalizeJson(left?.operation) === canonicalizeJson(right?.operation);
      return { to, change: same ? "unchanged" : "changed", beforeNumber: left?.number, afterNumber: right?.number };
    })
    .sort((x, y) => (x.afterNumber ?? x.beforeNumber ?? 99) - (y.afterNumber ?? y.beforeNumber ?? 99));
}
