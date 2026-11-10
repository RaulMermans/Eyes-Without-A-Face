import type { CloudDisclosureDestination, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { assertValidContract, validateContract } from "../domain/validation/validate-contract.ts";
import { findForbiddenCloudSubstrings } from "../privacy/forbidden-cloud-fields.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import { PRIVATE_DATA_CANARY } from "../privacy/canaries.ts";
import { FIREBASE_AI_LOGIC_API } from "../inference/firebase-api.ts";
import { buildCloudPromptText, SDK_TRANSPORT_NOTE } from "../inference/prompts.ts";

export const MAX_CLOUD_PAYLOAD_BYTES = 24_576;
export const MAX_CLOUD_RESPONSE_BYTES = 65_536;

export type CloudInferencePurpose = "mapping-proposal";

export interface OutboundApplicationRequest {
  layer: "application";
  sdkTransportNote: string;
  requestId: string;
  destination: CloudDisclosureDestination;
  purpose: CloudInferencePurpose;
  prompt: string;
  disclosurePayloadHash: string;
}

export interface DisclosureApproval {
  requestId: string;
  payloadHash: string;
  outboundHash: string;
  destinationKey: string;
  purpose: CloudInferencePurpose;
  approvedAt: string;
}

export interface DisclosurePreview {
  requestId: string;
  payload: CloudDisclosurePayload;
  canonicalJson: string;
  payloadHash: string;
  outboundPrompt: string;
  outboundApplicationJson: string;
  outboundHash: string;
  destinationKey: string;
  byteLength: number;
}

export interface AuthorizedCloudRequest {
  requestId: string;
  payload: CloudDisclosurePayload;
  canonicalJson: string;
  payloadHash: string;
  outboundPrompt: string;
  outboundHash: string;
  destinationKey: string;
  approval: DisclosureApproval;
}

export type DisclosureRejectionCode =
  | "SCHEMA_INVALID"
  | "FORBIDDEN_FIELDS"
  | "PAYLOAD_TOO_LARGE"
  | "MISSING_APPROVAL"
  | "STALE_AUTHORIZATION"
  | "DESTINATION_MISMATCH"
  | "EFFECTIVE_DESTINATION_MISMATCH"
  | "PURPOSE_MISMATCH"
  | "REQUEST_SCOPE_MISMATCH"
  | "HASH_MISMATCH"
  | "OUTBOUND_MISMATCH"
  | "APPROVAL_REUSED"
  | "CONCURRENT_SUBMISSION"
  | "PRIVATE_CANARY";

export class DisclosureRejectedError extends Error {
  readonly code = "DISCLOSURE_REJECTED";
  readonly reason: DisclosureRejectionCode;
  readonly details: string[];

  constructor(reason: DisclosureRejectionCode, details: string[]) {
    super(`Cloud disclosure rejected (${reason}): ${details.join("; ")}`);
    this.name = "DisclosureRejectedError";
    this.reason = reason;
    this.details = details;
  }
}

export function destinationKey(destination: CloudDisclosureDestination): string {
  return `${destination.provider}:${destination.backend}:${destination.model}:${destination.purpose}`;
}

export function effectiveCloudDestination(): CloudDisclosureDestination {
  return {
    provider: "firebase-ai-logic",
    backend: "google-ai",
    model: FIREBASE_AI_LOGIC_API.defaultCloudModel,
    purpose: "mapping-proposal",
  };
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function buildOutboundApplicationRequest(
  requestId: string,
  payload: CloudDisclosurePayload,
  canonicalJson: string,
  payloadHash: string,
): OutboundApplicationRequest {
  return {
    layer: "application",
    sdkTransportNote: SDK_TRANSPORT_NOTE,
    requestId,
    destination: payload.destination,
    purpose: payload.purpose,
    prompt: buildCloudPromptText(canonicalJson),
    disclosurePayloadHash: payloadHash,
  };
}

async function fingerprintOutbound(
  requestId: string,
  payload: CloudDisclosurePayload,
  canonicalJson: string,
  payloadHash: string,
): Promise<{ outbound: OutboundApplicationRequest; outboundApplicationJson: string; outboundHash: string }> {
  const outbound = buildOutboundApplicationRequest(requestId, payload, canonicalJson, payloadHash);
  const fingerprinted = await fingerprintCanonicalPayload(outbound);
  return {
    outbound,
    outboundApplicationJson: fingerprinted.canonicalJson,
    outboundHash: fingerprinted.payloadHash,
  };
}

export async function inspectDisclosurePayload(
  payload: CloudDisclosurePayload,
  requestId = newRequestId(),
): Promise<Omit<DisclosurePreview, never>> {
  const schema = validateContract(payload);
  if (!schema.valid) {
    throw new DisclosureRejectedError(
      "SCHEMA_INVALID",
      schema.issues.map((issue) => `${issue.path}: ${issue.message}`),
    );
  }

  const { canonicalJson, payloadHash } = await fingerprintCanonicalPayload(payload);
  const forbidden = findForbiddenCloudSubstrings(canonicalJson);
  if (forbidden.length > 0) {
    throw new DisclosureRejectedError(
      "FORBIDDEN_FIELDS",
      forbidden.map((item) => `forbidden substring present: ${item}`),
    );
  }
  if (canonicalJson.includes(PRIVATE_DATA_CANARY)) {
    throw new DisclosureRejectedError("PRIVATE_CANARY", ["private-data canary present"]);
  }

  const byteLength = new TextEncoder().encode(canonicalJson).byteLength;
  if (byteLength > MAX_CLOUD_PAYLOAD_BYTES) {
    throw new DisclosureRejectedError("PAYLOAD_TOO_LARGE", [
      `payload is ${byteLength} bytes; max ${MAX_CLOUD_PAYLOAD_BYTES}`,
    ]);
  }

  assertValidContract<CloudDisclosurePayload>(payload);
  const outbound = await fingerprintOutbound(requestId, payload, canonicalJson, payloadHash);

  return {
    requestId,
    payload,
    canonicalJson,
    payloadHash,
    outboundPrompt: outbound.outbound.prompt,
    outboundApplicationJson: outbound.outboundApplicationJson,
    outboundHash: outbound.outboundHash,
    destinationKey: destinationKey(payload.destination),
    byteLength,
  };
}

export async function createDisclosurePreview(
  payload: CloudDisclosurePayload,
  requestId = newRequestId(),
): Promise<DisclosurePreview> {
  return inspectDisclosurePayload(payload, requestId);
}

export function assertAuthorizedEnvelope(request: AuthorizedCloudRequest): void {
  if (
    request.approval.payloadHash !== request.payloadHash ||
    request.approval.outboundHash !== request.outboundHash ||
    request.approval.requestId !== request.requestId ||
    request.approval.destinationKey !== request.destinationKey
  ) {
    throw new DisclosureRejectedError("STALE_AUTHORIZATION", [
      "Cloud adapter refused an envelope whose approval does not match the payload.",
    ]);
  }
}

export function assertEffectiveDestination(request: AuthorizedCloudRequest): void {
  const effective = effectiveCloudDestination();
  const effectiveKey = destinationKey(effective);
  if (request.destinationKey !== effectiveKey || request.approval.destinationKey !== effectiveKey) {
    throw new DisclosureRejectedError("EFFECTIVE_DESTINATION_MISMATCH", [
      `Approved destination ${request.destinationKey} does not match the effective runtime destination ${effectiveKey}.`,
    ]);
  }
  const dest = request.payload.destination;
  if (
    dest.provider !== effective.provider ||
    dest.backend !== effective.backend ||
    dest.model !== effective.model ||
    dest.purpose !== effective.purpose
  ) {
    throw new DisclosureRejectedError("EFFECTIVE_DESTINATION_MISMATCH", [
      "Payload destination fields do not match the model this adapter will call.",
    ]);
  }
}

export function approveDisclosurePreview(preview: DisclosurePreview): DisclosureApproval {
  return {
    requestId: preview.requestId,
    payloadHash: preview.payloadHash,
    outboundHash: preview.outboundHash,
    destinationKey: preview.destinationKey,
    purpose: preview.payload.purpose,
    approvedAt: new Date().toISOString(),
  };
}

export async function bindAuthorizedCloudRequest(
  preview: DisclosurePreview,
  approval: DisclosureApproval | null,
  intended: {
    requestId: string;
    destinationKey: string;
    purpose: CloudInferencePurpose;
  },
): Promise<AuthorizedCloudRequest> {
  const livePreview = await inspectDisclosurePayload(preview.payload, preview.requestId);
  if (!approval) {
    throw new DisclosureRejectedError("MISSING_APPROVAL", [
      "Cloud inference requires an explicit approval of the outbound payload.",
    ]);
  }
  if (approval.requestId !== intended.requestId || approval.requestId !== livePreview.requestId) {
    throw new DisclosureRejectedError("REQUEST_SCOPE_MISMATCH", [
      "Approval is bound to a different request id.",
    ]);
  }
  if (
    approval.destinationKey !== intended.destinationKey ||
    approval.destinationKey !== livePreview.destinationKey
  ) {
    throw new DisclosureRejectedError("DESTINATION_MISMATCH", [
      "Approval destination does not match this request.",
    ]);
  }
  if (approval.purpose !== intended.purpose || approval.purpose !== livePreview.payload.purpose) {
    throw new DisclosureRejectedError("PURPOSE_MISMATCH", [
      "Approval purpose does not match this request.",
    ]);
  }
  if (livePreview.payloadHash !== preview.payloadHash) {
    throw new DisclosureRejectedError("STALE_AUTHORIZATION", [
      "The preview no longer matches the payload bytes.",
    ]);
  }
  if (livePreview.outboundHash !== preview.outboundHash || livePreview.outboundPrompt !== preview.outboundPrompt) {
    throw new DisclosureRejectedError("OUTBOUND_MISMATCH", [
      "The outbound application prompt changed after preview.",
    ]);
  }
  if (approval.payloadHash !== livePreview.payloadHash) {
    throw new DisclosureRejectedError("HASH_MISMATCH", [
      "Payload changed after approval, or approval hash does not match the bytes that would be sent.",
    ]);
  }
  if (approval.outboundHash !== livePreview.outboundHash) {
    throw new DisclosureRejectedError("OUTBOUND_MISMATCH", [
      "Approved outbound prompt fingerprint does not match the request that would be sent.",
    ]);
  }

  return {
    requestId: livePreview.requestId,
    payload: livePreview.payload,
    canonicalJson: livePreview.canonicalJson,
    payloadHash: livePreview.payloadHash,
    outboundPrompt: livePreview.outboundPrompt,
    outboundHash: livePreview.outboundHash,
    destinationKey: livePreview.destinationKey,
    approval,
  };
}
