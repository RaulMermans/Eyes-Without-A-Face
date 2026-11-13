import type { PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

/**
 * The trust-ledger facts (Sprint 6–10), shown by the Privacy Boundary since
 * Sprint 11. Every value is derived from current workspace state, so it stays
 * truthful when the source, seed, or descriptors change (those changes clear
 * the review and proposal via invalidateDownstream).
 */
export function ledgerFacts(workspace: WorkspaceState, prepared: PreparedTwin | null) {
  const review = workspace.review;
  const proposal = workspace.proposal;
  const twin = prepared?.twin ?? null;
  const offered = twin ? twin.fields.filter((field) => field.shareable).length : 0;

  const approved = !review
    ? "Not reviewed yet"
    : review.status === "pending"
      ? "Awaiting your decision"
      : review.status === "rejected"
        ? "Rejected — nothing approved"
        : review.status === "approved"
          ? `${review.preview.payload.fields.length} aliases approved for one request`
          : "Approval used for one request";

  let transmitted = "Nothing sent";
  if (review?.status === "sent") {
    if (proposal?.provenance?.simulated) transmitted = "1 request · simulated test adapter, no network";
    else if (proposal) transmitted = "1 request · aliases and synthetic examples only";
    else if (workspace.cloudError) transmitted = "1 attempt · no proposal returned";
    else transmitted = "1 request in flight";
  }
  const revision = workspace.revision && workspace.revision.initialProposal === workspace.proposal ? workspace.revision : null;
  if (revision?.history.includes("REVISION_SENT")) transmitted += " · + 1 revision request, findings only, no values";

  return {
    private: workspace.source ? `${workspace.source.records.length} records · stays in this browser` : "None loaded",
    synthetic: twin ? `${twin.fields.length} aliases · ${offered} offered for review` : "Not generated",
    approved,
    transmitted,
  };
}
