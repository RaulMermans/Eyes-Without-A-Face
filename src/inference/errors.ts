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
  | "ON_DEVICE_RUNTIME_ERROR"
  | "PROVENANCE_MISMATCH"
  | "PROVENANCE_UNVERIFIED"
  | "PROVENANCE_UNKNOWN"
  | "SIMULATED_RESULT"
  | "PAYLOAD_TOO_LARGE"
  | "EXECUTABLE_OUTPUT"
  | "CANCELLED"
  | "IN_FLIGHT"
  | "DESTINATION_MISMATCH"
  | "PROVIDER_OVERLOADED"
  | "RATE_LIMITED";

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
  // Chrome's built-in AI reports model-service failures as kError* codes.
  // Sprint 5: kErrorUnknown coincided with a native crash of the
  // on_device_model utility process (SIGILL) while a prompt was running.
  const chromeCode = /\bkError[A-Za-z]+\b/.exec(message)?.[0];
  if (chromeCode) {
    return new InferenceError(
      "ON_DEVICE_RUNTIME_ERROR",
      `Chrome's on-device model service failed (${chromeCode}). This is a browser runtime failure, not a problem with the input. ${message}`,
    );
  }
  // Sprint 9: provider status codes first. Sprint 8 recorded "[500 ] This model is
  // currently experiencing high demand" inside an "Error fetching from …" message,
  // which the network rule below misread as NETWORK.
  if (/\[(429)\b|\b429\b.*(too many|rate|quota)|resource[_ ]exhausted|quota exceeded|rate limit/i.test(message)) {
    return new InferenceError("RATE_LIMITED", message);
  }
  if (/\[(500|502|503|504)\b|high demand|overloaded|service unavailable|internal error/i.test(message)) {
    return new InferenceError("PROVIDER_OVERLOADED", message);
  }
  if (
    lowered.includes("app check") ||
    lowered.includes("appcheck") ||
    lowered.includes("403") ||
    lowered.includes("attestation")
  ) {
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
