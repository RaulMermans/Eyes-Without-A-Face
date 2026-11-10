import type { CloudInferenceAdapter, InferenceResult } from "../inference/types.ts";
import { recordOutboundAttempt } from "../inference/outbound-log.ts";
import {
  assertEffectiveDestination,
  bindAuthorizedCloudRequest,
  type CloudInferencePurpose,
  type DisclosureApproval,
  type DisclosurePreview,
  DisclosureRejectedError,
} from "./authorization.ts";
import { finalizeAuthorization, reserveAuthorization } from "./authorization-ledger.ts";

export type CloudGateListener = (event: {
  allowed: boolean;
  requestId: string;
  payloadHash: string;
  outboundHash?: string;
  destinationKey: string;
  canonicalJson?: string;
  outboundPrompt?: string;
  reason?: string;
}) => void;

let listener: CloudGateListener | null = null;

export function setCloudGateListener(next: CloudGateListener | null): void {
  listener = next;
}

function recordRejection(
  preview: DisclosurePreview,
  intended: { requestId: string; destinationKey: string },
  reason: string,
): void {
  listener?.({
    allowed: false,
    requestId: intended.requestId,
    payloadHash: preview.payloadHash,
    outboundHash: preview.outboundHash,
    destinationKey: intended.destinationKey,
    reason,
  });
  recordOutboundAttempt({
    allowed: false,
    requestId: intended.requestId,
    payloadHash: preview.payloadHash,
    destinationKey: intended.destinationKey,
    byteLength: preview.byteLength,
    reason,
  });
}

/**
 * Canonical cloud entry point. UI and adapters must not send Phantom Contracts
 * or free-form prompts through another path.
 */
export async function submitApprovedCloudInference(
  adapter: CloudInferenceAdapter,
  preview: DisclosurePreview,
  approval: DisclosureApproval | null,
  intended: {
    requestId: string;
    destinationKey: string;
    purpose: CloudInferencePurpose;
  },
): Promise<InferenceResult> {
  let reservedApproval: DisclosureApproval | null = null;
  try {
    const authorized = await bindAuthorizedCloudRequest(preview, approval, intended);
    assertEffectiveDestination(authorized);
    reserveAuthorization(authorized.approval);
    reservedApproval = authorized.approval;
    listener?.({
      allowed: true,
      requestId: authorized.requestId,
      payloadHash: authorized.payloadHash,
      outboundHash: authorized.outboundHash,
      destinationKey: authorized.destinationKey,
      canonicalJson: authorized.canonicalJson,
      outboundPrompt: authorized.outboundPrompt,
    });
    recordOutboundAttempt({
      allowed: true,
      requestId: authorized.requestId,
      payloadHash: authorized.payloadHash,
      destinationKey: authorized.destinationKey,
      byteLength: preview.byteLength,
    });
    try {
      return await adapter.generateAuthorized(authorized);
    } finally {
      finalizeAuthorization(authorized.approval);
    }
  } catch (error) {
    if (reservedApproval) {
      finalizeAuthorization(reservedApproval);
    } else {
      const reason = error instanceof DisclosureRejectedError ? error.reason : "GATE_ERROR";
      recordRejection(preview, intended, reason);
    }
    throw error;
  }
}

export type { AuthorizedCloudRequest } from "./authorization.ts";
