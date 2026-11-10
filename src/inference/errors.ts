export class InferenceUnavailableError extends Error {
  readonly code = "INFERENCE_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "InferenceUnavailableError";
  }
}

export class InferenceNotImplementedError extends Error {
  readonly code = "INFERENCE_NOT_IMPLEMENTED";

  constructor(message = "Live Firebase inference is not implemented in Sprint 0") {
    super(message);
    this.name = "InferenceNotImplementedError";
  }
}
