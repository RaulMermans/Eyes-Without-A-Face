import sourceRecords from "../examples/crm/source-records.json" with { type: "json" };
import edgeRecords from "../examples/crm/edge-records.json" with { type: "json" };
import { parseSourceDataset } from "./source-import.ts";
import { invalidateDownstream, type WorkspaceState } from "./workspace-state.ts";

export const CRM_DEMO_LABEL = "fictional-crm-accounts";

/**
 * Load the bundled fictional CRM dataset (3 records) plus its 3 reserved hidden
 * cases. Everything is synthetic; the reserved cases are never profiled or disclosed.
 */
export function withCrmDemo(workspace: WorkspaceState): WorkspaceState {
  const base = invalidateDownstream({ ...workspace, overrides: {} });
  const parsed = parseSourceDataset(JSON.stringify(sourceRecords), CRM_DEMO_LABEL);
  if (!parsed.ok) {
    return { ...base, source: null, reservedRecords: null, sourceError: parsed.message };
  }
  return { ...base, source: parsed.value, reservedRecords: edgeRecords.records as Record<string, unknown>[], sourceError: null };
}
