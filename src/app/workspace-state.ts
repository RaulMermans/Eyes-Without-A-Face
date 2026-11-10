import destinationSchema from "../examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../examples/crm/mapping-contract.json" with { type: "json" };
import type { MappingBatchResult } from "../domain/mapping/batch.ts";
import type { ImportedSource } from "./source-import.ts";

export interface WorkspaceState {
  source: ImportedSource | null;
  sourceError: string | null;
  destinationText: string;
  mappingText: string;
  batch: MappingBatchResult | null;
  mappingRunError: string | null;
}

export function initialWorkspaceState(): WorkspaceState {
  return {
    source: null,
    sourceError: null,
    destinationText: JSON.stringify(destinationSchema, null, 2),
    mappingText: JSON.stringify(mappingContract, null, 2),
    batch: null,
    mappingRunError: null,
  };
}
