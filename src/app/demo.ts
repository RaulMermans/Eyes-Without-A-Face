import sourceRecords from "../examples/crm/source-records.json" with { type: "json" };
import edgeRecords from "../examples/crm/edge-records.json" with { type: "json" };
import { parseSourceDataset, type ImportedSource } from "./source-import.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";
import type { EvaluationScenario } from "../evaluation/scenarios.ts";

export const CRM_DEMO_LABEL = "fictional-crm-accounts";

/**
 * Load the bundled fictional CRM dataset (3 records) plus its 3 reserved hidden
 * cases. Everything is synthetic; the reserved cases are never profiled or disclosed.
 */
export function withCrmDemo(workspace: WorkspaceState): WorkspaceState {
  const base = invalidateDownstream({ ...workspace, overrides: {}, semanticConfirmations: {} });
  const parsed = parseSourceDataset(JSON.stringify(sourceRecords), CRM_DEMO_LABEL);
  if (!parsed.ok) {
    return { ...base, source: null, reservedRecords: null, sourceError: parsed.message };
  }
  return { ...base, source: parsed.value, reservedRecords: edgeRecords.records as Record<string, unknown>[], sourceError: null, scenario: null };
}

/**
 * Load a fictional evaluation scenario: imported records are profiled; the
 * revision-feedback cases become the reserved hidden cases; the holdout cases
 * and ground truth stay in local scenario context and are only used after the
 * mapping is final. The scenario's destination schema and twin decisions are
 * applied as if the user had made them.
 */
export function withScenario(workspace: WorkspaceState, scenario: EvaluationScenario): WorkspaceState {
  const base = invalidateDownstream({ ...workspace, overrides: { ...scenario.twinOverrides }, semanticConfirmations: {} });
  const parsed = parseSourceDataset(JSON.stringify(scenario.imported.map((item) => item.record)), scenario.datasetLabel);
  if (!parsed.ok) {
    return { ...base, source: null, reservedRecords: null, sourceError: parsed.message, scenario: null };
  }
  return {
    ...base,
    source: parsed.value,
    reservedRecords: scenario.revisionFeedback.map((item) => item.record),
    destinationText: JSON.stringify(scenario.destinationSchema, null, 2),
    sourceError: null,
    scenario: {
      id: scenario.scenarioId,
      title: scenario.title,
      policy: scenario.policy,
      expected: [...scenario.imported, ...scenario.revisionFeedback].map((item) => item.expected),
      holdout: scenario.holdout.map((item) => ({ record: item.record, expected: item.expected })),
      semanticDeclared: structuredClone(scenario.semanticSpec.declared),
    },
  };
}

/**
 * Sprint 13: load any normalized source (file, connector or demo file) as the
 * new source. Like the demos above, this starts a new run: every decision,
 * approval and result that depended on the previous source is cleared.
 * `reserved` attaches the fictional CRM hidden test cases for demo files only.
 */
export function withImportedSource(workspace: WorkspaceState, source: ImportedSource | null, reserved: Record<string, unknown>[] | null): WorkspaceState {
  const base = invalidateDownstream({ ...workspace, overrides: {}, semanticConfirmations: {} });
  return { ...base, source, reservedRecords: reserved, sourceError: null, scenario: null };
}

/** The fictional CRM hidden test cases (never profiled, never disclosed). */
export function crmReservedRecords(): Record<string, unknown>[] {
  return structuredClone(edgeRecords.records as Record<string, unknown>[]);
}
