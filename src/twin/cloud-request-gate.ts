import type { InferenceResult } from "../inference/types.ts";
import type { CloudInferenceAdapter } from "../inference/types.ts";
import { recordOutboundAttempt } from "../inference/outbound-log.ts";
import {
  bindAuthorizedCloudRequest,
  type AuthorizedCloudRequest,
  type CloudInferencePurpose,
  type DisclosureApproval,
  type DisclosurePreview,
  DisclosureRejectedError,
} from "./authorization.ts";

export type CloudGateListener = (event: {
  allowed: boolean;
  requestId: string;
  payloadHash: string;
  destinationKey: string;
  canonicalJson?: string;
  reason?: string;
}) => void;

let listener: CloudGateListener | null = null;

export function setCloudGateListener(next: CloudGateListener | null): void {
  listener = next;
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
  try {
    const authorized = await bindAuthorizedCloudRequest(preview, approval, intended);
    listener?.({
      allowed: true,
      requestId: authorized.requestId,
      payloadHash: authorized.payloadHash,
      destinationKey: authorized.destinationKey,
      canonicalJson: authorized.canonicalJson,
    });
    recordOutboundAttempt({
      allowed: true,
      requestId: authorized.requestId,
      payloadHash: authorized.payloadHash,
      destinationKey: authorized.destinationKey,
      byteLength: preview.byteLength,
    });
    return adapter.generateAuthorized(authorized);
  } catch (error) {
    const reason = error instanceof DisclosureRejectedError ? error.reason : "GATE_ERROR";
    listener?.({
      allowed: false,
      requestId: intended.requestId,
      payloadHash: preview.payloadHash,
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
    throw error;
  }
}

export type { AuthorizedCloudRequest };
