import type { CloudDisclosureDestination, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { assertValidContract, validateContract } from "../domain/validation/validate-contract.ts";
import { findForbiddenCloudSubstrings } from "../privacy/forbidden-cloud-fields.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import { PRIVATE_DATA_CANARY } from "../privacy/canaries.ts";
import { findPrivateValueLeaks } from "../privacy/leak-scan.ts";
import { buildCloudPromptText, SDK_TRANSPORT_NOTE } from "../inference/prompts.ts";
import { buildIntentPlanPromptText, buildRankedPlanPromptText } from "../inference/intent-prompt.ts";
import { INITIAL_PLANNER, type InitialPlanner } from "../inference/planner-selection.ts";
import { effectiveInitialPlanner } from "../inference/harness-planner.ts";
import { defaultCloudDestination } from "./project-cloud-disclosure.ts";

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
  | "PRIVATE_CANARY"
  | "PRIVATE_VALUE_PRESENT";

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

/** The approved destination. A thinking level (1.4.0) is part of it, so approving one configuration never authorizes another. */
export function destinationKey(destination: CloudDisclosureDestination): string {
  const base = `${destination.provider}:${destination.backend}:${destination.model}:${destination.purpose}`;
  return destination.thinkingLevel ? `${base}:thinking=${destination.thinkingLevel}` : base;
}

export function effectiveCloudDestination(): CloudDisclosureDestination {
  return defaultCloudDestination();
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The outbound application prompt for one payload. Initial requests (1.1.0)
 * carry the selected initial planner's instructions (Sprint 18B: prompt v5,
 * ADR 0018); every other schema version keeps its frozen `buildCloudPromptText`
 * instructions byte-for-byte.
 */
export function buildOutboundPromptText(
  canonicalJson: string,
  schemaVersion: CloudDisclosurePayload["schemaVersion"],
  planner: InitialPlanner = INITIAL_PLANNER,
): string {
  if (schemaVersion === "1.1.0" || schemaVersion === "1.4.0") {
    if (planner === "intent-plan-2") return buildRankedPlanPromptText(canonicalJson);
    // 1.4.0 (ADR 0021) is a plan request only; it never takes the frozen Sprint 3 instructions.
    if (planner === "intent-plan-1" || schemaVersion === "1.4.0") return buildIntentPlanPromptText(canonicalJson);
  }
  return buildCloudPromptText(canonicalJson, schemaVersion);
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
    prompt: buildOutboundPromptText(canonicalJson, payload.schemaVersion, effectiveInitialPlanner()),
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
  const leaks = findPrivateValueLeaks(payload);
  if (leaks.length > 0) {
    throw new DisclosureRejectedError(
      "PRIVATE_VALUE_PRESENT",
      leaks.map((item) => `private source value reproduced at ${item.location}`),
    );
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
    dest.thinkingLevel !== effective.thinkingLevel ||
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
