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

/**
 * On-device failures the user may retry once, by explicit action. Chrome
 * restarts its on-device model service when the next session is created, so a
 * runtime crash or failed start is often recoverable. Never retried
 * automatically and never redirected to the cloud.
 */
export const ON_DEVICE_USER_RETRY_LIMIT = 1;

export function isRecoverableOnDeviceFailure(code: InferenceErrorCode): boolean {
  // TIMEOUT: Sprint 5 observed a hung on-device prompt; a fresh session after
  // it answered normally.
  return code === "ON_DEVICE_RUNTIME_ERROR" || code === "SDK_INIT_FAILED" || code === "TIMEOUT";
}

export function timeoutErrorMessage(ms: number, cancellationVerified: boolean): string {
  if (cancellationVerified) {
    return `Inference timed out after ${ms} ms. The local wait was aborted.`;
  }
  return `Inference timed out after ${ms} ms. The Firebase request may still be in flight; this authorization cannot be reused.`;
}
