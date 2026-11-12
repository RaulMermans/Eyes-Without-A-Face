/**
 * Display model for the Integration Studio: derives mapping connections from
 * the existing AcceptProposalResult and Reality Check report. Pure; no React.
 */
import type { MappingOperation } from "../domain/contracts/types.ts";
import type { ProposalIssue } from "../proposal/convert.ts";
import type { ResolutionIssue } from "../proposal/resolve.ts";
import type { AcceptProposalResult } from "../workflow/pipeline.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import { executionByOperation, operationSources, type OperationExecution } from "./view-model.ts";

export type ConnectionState = "rejected" | "validated" | "executed-pass" | "executed-fail";

export interface Connection {
  index: number;
  op: string;
  sources: string[];
  to: string;
  params: Record<string, unknown> | null;
  state: ConnectionState;
  issues: Array<ProposalIssue | ResolutionIssue>;
  execution: OperationExecution | null;
}

/** Best-effort, display-only reading of rejected model output. Never repaired, never executed. */
function rawOperations(text: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    const operations = (parsed as { operations?: unknown } | null)?.operations;
    if (!Array.isArray(operations)) return null;
    return operations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  } catch {
    return null;
  }
}

function displayRef(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (typeof value === "string") return [value];
  if (value === undefined) return [];
  return [JSON.stringify(value)];
}

export function buildConnections(input: {
  result: AcceptProposalResult;
  text: string;
  report: RealityCheckReport | null;
}): Connection[] | null {
  const { result } = input;
  const execution = result.ok ? executionByOperation(input.report) : new Map<number, OperationExecution>();
  const fromContract = (operations: readonly MappingOperation[], issues: Array<ProposalIssue | ResolutionIssue>, rejected: boolean): Connection[] =>
    operations.map((operation, index) => {
      const own = issues.filter((issue) => issue.operationIndex === index);
      const run = execution.get(index) ?? null;
      const state: ConnectionState = rejected
        ? "rejected"
        : input.report
          ? run
            ? "executed-fail"
            : "executed-pass"
          : "validated";
      return {
        index,
        op: operation.op,
        sources: operationSources(operation),
        to: operation.to,
        params: "params" in operation ? (operation.params as Record<string, unknown>) : null,
        state,
        issues: own,
        execution: run,
      };
    });

  if (result.ok) return fromContract(result.value.converted.contract.operations, [], false);
  if (result.stage === "resolve") return fromContract(result.converted.contract.operations, result.issues, true);
  if (result.stage === "parse") return null;
  const raw = rawOperations(input.text);
  if (!raw) return null;
  return raw.map((item, index) => ({
    index,
    op: typeof item.op === "string" ? item.op : "(missing op)",
    sources: displayRef(item.from),
    to: typeof item.to === "string" ? item.to : "(missing)",
    params: item.params && typeof item.params === "object" && !Array.isArray(item.params) ? (item.params as Record<string, unknown>) : null,
    state: "rejected",
    issues: result.issues.filter((issue) => issue.operationIndex === index),
    execution: null,
  }));
}

