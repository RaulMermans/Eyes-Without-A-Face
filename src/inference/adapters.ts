import type { AppConfig, InferenceAvailability } from "../config/env.ts";
import { InferenceNotImplementedError, InferenceUnavailableError } from "./errors.ts";
import type {
  InferenceAdapter,
  InferenceExecution,
  InferenceRequest,
  InferenceResult,
} from "./types.ts";

class FoundationAdapter implements InferenceAdapter {
  readonly execution: InferenceExecution;
  private readonly availability: InferenceAvailability;

  constructor(execution: InferenceExecution, availability: InferenceAvailability) {
    this.execution = execution;
    this.availability = availability;
  }

  status(): InferenceAvailability {
    return this.availability;
  }

  generate(_request: InferenceRequest): Promise<InferenceResult> {
    const status = this.availability;
    if (status.state === "disabled") {
      return Promise.reject(
        new InferenceUnavailableError(
          `${this.execution} inference is disabled. Enable the feature flag only after Sprint 1 wiring is complete.`,
        ),
      );
    }
    if (status.state === "unconfigured") {
      return Promise.reject(
        new InferenceUnavailableError(
          `${this.execution} inference is unconfigured. Missing: ${status.missing.join(", ")}`,
        ),
      );
    }
    return Promise.reject(new InferenceNotImplementedError());
  }
}

export interface InferenceServices {
  onDevice: InferenceAdapter;
  cloud: InferenceAdapter;
}

export function createInferenceServices(config: AppConfig): InferenceServices {
  return {
    onDevice: new FoundationAdapter("on-device", config.onDevice),
    cloud: new FoundationAdapter("cloud", config.cloud),
  };
}
