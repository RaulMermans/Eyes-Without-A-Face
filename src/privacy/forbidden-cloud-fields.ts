import { PRIVATE_DATA_CANARY } from "./canaries.ts";

/**
 * Internal Phantom / Source keys that must never appear in a cloud-bound payload.
 * Detection is string-based on the canonical serialization so renamed wrappers still fail.
 */
export const FORBIDDEN_CLOUD_SUBSTRINGS = [
  "sourceFieldId",
  "sourceDatasetId",
  "nonShareableSourceFieldIds",
  "localOnlyMetadata",
  "approvedForCloud",
  PRIVATE_DATA_CANARY,
] as const;

export function findForbiddenCloudSubstrings(serialized: string): string[] {
  return FORBIDDEN_CLOUD_SUBSTRINGS.filter((item) => serialized.includes(item));
}
