import type { PhantomContract, SourceContract } from "../domain/contracts/types.ts";
import {
  phantomContainsPrivateCanary,
  privateFieldsMarkedShareable,
} from "../privacy/disclosure.ts";

export interface DisclosureGateResult {
  allowed: boolean;
  reasons: string[];
}

export function evaluateCloudDisclosure(
  source: SourceContract,
  phantom: PhantomContract,
): DisclosureGateResult {
  const reasons: string[] = [];

  if (phantom.approvedForCloud !== true) {
    reasons.push("Phantom Twin is not approved for cloud disclosure");
  }

  if (phantomContainsPrivateCanary(phantom)) {
    reasons.push("Phantom Twin contains a private-data canary");
  }

  const leaked = privateFieldsMarkedShareable(source, phantom);
  if (leaked.length > 0) {
    reasons.push(`Private source fields marked shareable: ${leaked.join(", ")}`);
  }

  const missing = phantom.nonShareableSourceFieldIds.filter((id) =>
    phantom.fields.some((field) => field.sourceFieldId === id && field.shareable),
  );
  if (missing.length > 0) {
    reasons.push(`Non-shareable source fields appear as shareable aliases: ${missing.join(", ")}`);
  }

  return { allowed: reasons.length === 0, reasons };
}
