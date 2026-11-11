export type InferenceErrorCode =
  | "INFERENCE_UNAVAILABLE"
  | "INFERENCE_NOT_IMPLEMENTED"
  | "MISSING_CONFIG"
  | "FEATURE_DISABLED"
  | "APP_CHECK_REJECTED"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED_BROWSER"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_STRUCTURED_OUTPUT"
  | "DISCLOSURE_REJECTED"
  | "STALE_AUTHORIZATION"
  | "USER_REJECTED"
  | "SDK_INIT_FAILED"
  | "PROVENANCE_MISMATCH"
  | "PAYLOAD_TOO_LARGE"
  | "EXECUTABLE_OUTPUT"
  | "CANCELLED"
  | "IN_FLIGHT";

export class InferenceError extends Error {
  readonly code: InferenceErrorCode;

  constructor(code: InferenceErrorCode, message: string) {
    super(message);
    this.name = "InferenceError";
    this.code = code;
  }
}

export class InferenceUnavailableError extends InferenceError {
  constructor(message: string, code: InferenceErrorCode = "INFERENCE_UNAVAILABLE") {
    super(code, message);
    this.name = "InferenceUnavailableError";
  }
}

export class InferenceNotImplementedError extends InferenceError {
  constructor(message = "Live Firebase inference is not available in this adapter") {
    super("INFERENCE_NOT_IMPLEMENTED", message);
    this.name = "InferenceNotImplementedError";
  }
}

export function classifyUnknownError(error: unknown): InferenceError {
  if (error instanceof InferenceError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("app check") || lowered.includes("appcheck") || lowered.includes("403")) {
    return new InferenceError("APP_CHECK_REJECTED", message);
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return new InferenceError("TIMEOUT", message);
  }
  if (lowered.includes("network") || lowered.includes("fetch") || lowered.includes("failed to fetch")) {
    return new InferenceError("NETWORK", message);
  }
  if (lowered.includes("abort")) {
    return new InferenceError("CANCELLED", message);
  }
  if (lowered.includes("not supported") || lowered.includes("prompt api")) {
    return new InferenceError("UNSUPPORTED_BROWSER", message);
  }
  if (lowered.includes("unavailable") || lowered.includes("not ready")) {
    return new InferenceError("MODEL_UNAVAILABLE", message);
  }
  return new InferenceError("SDK_INIT_FAILED", message);
}
