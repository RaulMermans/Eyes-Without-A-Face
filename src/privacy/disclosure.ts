import type { PhantomContract, SourceContract } from "../domain/contracts/types.ts";
import { PRIVATE_DATA_CANARY } from "./canaries.ts";

export const SHAREABLE_SENSITIVITY = "synthetic-ok";

export function privateFieldIds(source: SourceContract): string[] {
  return source.fields
    .filter((field) => field.sensitivity === "private")
    .map((field) => field.id);
}

export function shareablePhantomAliases(phantom: PhantomContract): string[] {
  return phantom.fields.filter((field) => field.shareable).map((field) => field.alias);
}

export function phantomContainsPrivateCanary(phantom: PhantomContract): boolean {
  const blob = JSON.stringify(phantom);
  return blob.includes(PRIVATE_DATA_CANARY);
}

export function privateFieldsMarkedShareable(
  source: SourceContract,
  phantom: PhantomContract,
): string[] {
  const privateIds = new Set(privateFieldIds(source));
  return phantom.fields
    .filter((field) => field.shareable && field.sourceFieldId && privateIds.has(field.sourceFieldId))
    .map((field) => field.alias);
}
