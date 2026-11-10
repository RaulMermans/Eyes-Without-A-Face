import type { InferenceErrorCode } from "./errors.ts";

/**
 * Cloud generateContent is not retried. A rejected local promise does not
 * cancel the backend operation (Firebase SDK AbortSignal docs). Retrying after
 * TIMEOUT would risk a second cloud inference against a consumed approval.
 */
export const CLOUD_AUTOMATIC_RETRY_LIMIT = 0;
export const ON_DEVICE_TIMEOUT_MS = 90_000;
export const CLOUD_TIMEOUT_MS = 45_000;

export function isAmbiguousCloudOutcome(code: InferenceErrorCode): boolean {
  return code === "TIMEOUT" || code === "NETWORK" || code === "CANCELLED";
}

export function shouldRetryCloudInference(_code: InferenceErrorCode): boolean {
  return false;
}

export function timeoutErrorMessage(ms: number, cancellationVerified: boolean): string {
  if (cancellationVerified) {
    return `Inference timed out after ${ms} ms. The local wait was aborted.`;
  }
  return `Inference timed out after ${ms} ms. The Firebase request may still be in flight; this authorization cannot be reused.`;
}
