import { recordWorkflowEvent } from "../observability/workflow-log.ts";
import { createDisclosurePreview, DisclosureRejectedError } from "../twin/authorization.ts";
import { buildDisclosureDraft, type PreparedTwin } from "../workflow/pipeline.ts";
import type { WorkspaceState } from "./workspace-state.ts";

export type PrepareReviewResult = { ok: true; workspace: WorkspaceState } | { ok: false; message: string };

/**
 * Build the disclosure preview for the current twin and destination: the
 * allowlisted payload, the exact outbound prompt and its SHA-256. Local only;
 * nothing is sent and nothing is approved. Shared by the Disclosure Review
 * panel and CONNECT's "Build Integration" so there is exactly one
 * implementation of this step (Sprint 10, ADR 0011).
 */
export async function prepareDisclosureReview(workspace: WorkspaceState, prepared: PreparedTwin): Promise<PrepareReviewResult> {
  const started = performance.now();
  try {
    let targetSchema: unknown;
    try {
      targetSchema = JSON.parse(workspace.destinationText) as unknown;
    } catch {
      throw new Error("Destination schema is not valid JSON. Fix it in Connect or on the Phantom Twin stage.");
    }
    const draft = buildDisclosureDraft({ prepared, targetSchema });
    if (!draft.ok) throw new Error(draft.issues.join("; "));
    const preview = await createDisclosurePreview(draft.value.payload);
    recordWorkflowEvent({ kind: "disclosure-preview", ok: true, durationMs: performance.now() - started, payloadHash: preview.payloadHash });
    return {
      ok: true,
      workspace: {
        ...workspace,
        review: { preview, approval: null, status: "pending", targetNotes: draft.value.targetNotes },
        proposal: null,
        cloudError: null,
        report: null,
      },
    };
  } catch (caught) {
    const message =
      caught instanceof DisclosureRejectedError ? `${caught.reason}: ${caught.details.join("; ")}` : caught instanceof Error ? caught.message : String(caught);
    recordWorkflowEvent({ kind: "disclosure-preview", ok: false, code: caught instanceof DisclosureRejectedError ? caught.reason : "DRAFT_INVALID" });
    return { ok: false, message };
  }
}
