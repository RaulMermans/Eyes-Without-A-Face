import destinationSchema from "../examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../examples/crm/mapping-contract.json" with { type: "json" };
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../phantom/generate.ts";
import type { DisclosureApproval, DisclosurePreview } from "../twin/authorization.ts";
import type { InferenceProvenance } from "../inference/types.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import type { AcceptProposalResult } from "../workflow/pipeline.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { ImportedSource } from "./source-import.ts";

export interface ReviewState {
  preview: DisclosurePreview;
  approval: DisclosureApproval | null;
  status: "pending" | "approved" | "rejected" | "sent";
}

export interface ProposalState {
  origin: ProposalOrigin;
  /** Text exactly as received from the adapter (or as edited locally). */
  text: string;
  provenance: InferenceProvenance | null;
  requestId: string;
  result: AcceptProposalResult;
}

export type MappingChoice = "proposal" | "manual";

export interface WorkspaceState {
  source: ImportedSource | null;
  sourceError: string | null;
  /** Reserved hidden verification cases. Never profiled, never disclosed. */
  reservedRecords: Record<string, unknown>[] | null;
  seed: number;
  overrides: Record<string, TwinFieldOverride>;
  destinationText: string;
  review: ReviewState | null;
  proposal: ProposalState | null;
  cloudError: string | null;
  /** Sprint 2 manual contract over local source field names. Never sent anywhere. */
  mappingText: string;
  mappingChoice: MappingChoice;
  report: RealityCheckReport | null;
  mappingRunError: string | null;
}

export function initialWorkspaceState(): WorkspaceState {
  return {
    source: null,
    sourceError: null,
    reservedRecords: null,
    seed: DEFAULT_TWIN_SEED,
    overrides: {},
    destinationText: JSON.stringify(destinationSchema, null, 2),
    review: null,
    proposal: null,
    cloudError: null,
    mappingText: JSON.stringify(mappingContract, null, 2),
    mappingChoice: "proposal",
    report: null,
    mappingRunError: null,
  };
}

/**
 * Any change to the source, seed, field decisions, or destination invalidates
 * the disclosure review, the approval, the proposal, and the last run.
 */
export function invalidateDownstream(state: WorkspaceState): WorkspaceState {
  return { ...state, review: null, proposal: null, cloudError: null, report: null, mappingRunError: null };
}
