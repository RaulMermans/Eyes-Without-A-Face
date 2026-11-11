import type { CloudDisclosureDestination, CloudDisclosurePayload } from "../domain/contracts/types.ts";
import { assertValidContract, validateContract } from "../domain/validation/validate-contract.ts";
import { findForbiddenCloudSubstrings } from "../privacy/forbidden-cloud-fields.ts";
import { fingerprintCanonicalPayload } from "../privacy/fingerprint.ts";
import { PRIVATE_DATA_CANARY } from "../privacy/canaries.ts";

export const MAX_CLOUD_PAYLOAD_BYTES = 24_576;
export const MAX_CLOUD_RESPONSE_BYTES = 65_536;

export type CloudInferencePurpose = "mapping-proposal";

export interface DisclosureApproval {
  requestId: string;
  payloadHash: string;
  destinationKey: string;
  purpose: CloudInferencePurpose;
  approvedAt: string;
}

export interface DisclosurePreview {
  requestId: string;
  payload: CloudDisclosurePayload;
  canonicalJson: string;
  payloadHash: string;
  destinationKey: string;
  byteLength: number;
}

export interface AuthorizedCloudRequest {
  requestId: string;
  payload: CloudDisclosurePayload;
  canonicalJson: string;
  payloadHash: string;
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
  | "PURPOSE_MISMATCH"
  | "REQUEST_SCOPE_MISMATCH"
  | "HASH_MISMATCH"
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

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export async function inspectDisclosurePayload(
  payload: CloudDisclosurePayload,
): Promise<Omit<DisclosurePreview, "requestId">> {
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

  return {
    payload,
    canonicalJson,
    payloadHash,
    destinationKey: destinationKey(payload.destination),
    byteLength,
  };
}

export async function createDisclosurePreview(
  payload: CloudDisclosurePayload,
  requestId = newRequestId(),
): Promise<DisclosurePreview> {
  const inspected = await inspectDisclosurePayload(payload);
  return {
    requestId,
    ...inspected,
  };
}

export function assertAuthorizedEnvelope(request: AuthorizedCloudRequest): void {
  if (
    request.approval.payloadHash !== request.payloadHash ||
    request.approval.requestId !== request.requestId ||
    request.approval.destinationKey !== request.destinationKey
  ) {
    throw new DisclosureRejectedError("STALE_AUTHORIZATION", [
      "Cloud adapter refused an envelope whose approval does not match the payload.",
    ]);
  }
}

export function approveDisclosurePreview(preview: DisclosurePreview): DisclosureApproval {
  return {
    requestId: preview.requestId,
    payloadHash: preview.payloadHash,
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
  const current = await inspectDisclosurePayload(preview.payload);
  const livePreview: DisclosurePreview = {
    requestId: preview.requestId,
    ...current,
  };
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
  if (approval.payloadHash !== livePreview.payloadHash) {
    throw new DisclosureRejectedError("HASH_MISMATCH", [
      "Payload changed after approval, or approval hash does not match the bytes that would be sent.",
    ]);
  }

  return {
    requestId: livePreview.requestId,
    payload: livePreview.payload,
    canonicalJson: livePreview.canonicalJson,
    payloadHash: livePreview.payloadHash,
    destinationKey: livePreview.destinationKey,
    approval,
  };
}
