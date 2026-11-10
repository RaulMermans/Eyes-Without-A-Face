import {
  DisclosureRejectedError,
  type DisclosureApproval,
  type AuthorizedCloudRequest,
} from "./authorization.ts";

export type AuthorizationLedgerState = "unused" | "in-flight" | "consumed";

interface LedgerEntry {
  key: string;
  state: AuthorizationLedgerState;
}

const entries = new Map<string, LedgerEntry>();

export function approvalLedgerKey(approval: DisclosureApproval): string {
  return [
    approval.requestId,
    approval.payloadHash,
    approval.outboundHash,
    approval.destinationKey,
    approval.purpose,
  ].join(":");
}

export function reserveAuthorization(approval: DisclosureApproval): void {
  const key = approvalLedgerKey(approval);
  const current = entries.get(key);
  if (!current) {
    entries.set(key, { key, state: "in-flight" });
    return;
  }
  if (current.state === "in-flight") {
    throw new DisclosureRejectedError("CONCURRENT_SUBMISSION", [
      "This approval is already being submitted.",
    ]);
  }
  if (current.state === "consumed") {
    throw new DisclosureRejectedError("APPROVAL_REUSED", [
      "This approval was already used and cannot authorize another cloud request.",
    ]);
  }
  current.state = "in-flight";
}

export function finalizeAuthorization(approval: DisclosureApproval): void {
  const key = approvalLedgerKey(approval);
  const current = entries.get(key);
  if (current) {
    current.state = "consumed";
    return;
  }
  entries.set(key, { key, state: "consumed" });
}

export function assertReservedAuthorization(request: AuthorizedCloudRequest): void {
  const key = approvalLedgerKey(request.approval);
  const current = entries.get(key);
  if (!current || current.state !== "in-flight") {
    throw new DisclosureRejectedError("STALE_AUTHORIZATION", [
      "Cloud adapter refused a request that was not reserved by the disclosure authority.",
    ]);
  }
}

export function authorizationState(approval: DisclosureApproval): AuthorizationLedgerState | "missing" {
  return entries.get(approvalLedgerKey(approval))?.state ?? "missing";
}

export function resetAuthorizationLedgerForTests(): void {
  entries.clear();
}
