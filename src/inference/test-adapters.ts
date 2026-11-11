import type { InferenceAvailability } from "../config/env.ts";
import { validateStructuredOutput } from "../domain/inference-output/validate-output.ts";
import { assertAuthorizedEnvelope, type AuthorizedCloudRequest } from "../twin/authorization.ts";
import { assertReservedAuthorization } from "../twin/authorization-ledger.ts";
import { InferenceError, InferenceUnavailableError } from "./errors.ts";
import { probeOnDeviceCapability } from "./on-device-capability.ts";
import { deriveTestProposal } from "./test-proposer.ts";
import type {
  CloudInferenceAdapter,
  InferenceResult,
  OnDeviceCapability,
  OnDeviceInferenceAdapter,
  OnDeviceInferenceRequest,
} from "./types.ts";

export interface TestHarness {
  label: "test-harness";
  onDeviceUnavailable?: boolean;
  /** Report the on-device path as configured and available (simulated, E2E only). */
  onDeviceAvailable?: boolean;
  /** 0-based on-device generate() call indices that fail like a Chrome model-service crash (E2E only). */
  onDeviceRuntimeFailures?: number[];
  onDeviceOutput?: unknown;
  cloudOutput?: unknown;
  /** Build a labeled simulated proposal from the approved payload (E2E only). */
  deriveProposal?: boolean;
  /** Return this raw text as the model response, bypassing adapter validation (E2E only). */
  rawCloudText?: string;
  malformedCloudOutput?: unknown;
  cloudErrorCode?:
    | "TIMEOUT"
    | "PROVENANCE_UNVERIFIED"
    | "PROVENANCE_UNKNOWN"
    | "PROVENANCE_MISMATCH"
    | "SIMULATED_RESULT"
    | "IN_FLIGHT";
}

export function createTestOnDeviceAdapter(
  harness: TestHarness,
  availability: InferenceAvailability,
): OnDeviceInferenceAdapter {
  let calls = 0;
  return {
    execution: "on-device",
    status: () => (harness.onDeviceAvailable ? { state: "configured", reason: "adapters-ready" } : availability),
    probeCapability: async (): Promise<OnDeviceCapability> => {
      if (harness.onDeviceAvailable) {
        return {
          chromeVersion: null,
          promptApi: "available",
          languageModelAvailability: "available",
          guidance: "Test harness: simulated on-device availability. Results are labeled simulated.",
          userAgent: null,
          platform: null,
          hardwareConcurrency: null,
          deviceMemoryGiB: null,
        };
      }
      if (harness.onDeviceUnavailable) {
        return {
          chromeVersion: null,
          promptApi: "missing",
          languageModelAvailability: "unavailable",
          guidance:
            "Test harness: local inference unavailable. The app must not call the cloud adapter.",
          userAgent: null,
          platform: null,
          hardwareConcurrency: null,
          deviceMemoryGiB: null,
        };
      }
      return probeOnDeviceCapability();
    },
    initialize: async () => {
      if (harness.onDeviceUnavailable) {
        throw new InferenceUnavailableError(
          "Test harness: on-device model unavailable.",
          "MODEL_UNAVAILABLE",
        );
      }
    },
    generate: async (request: OnDeviceInferenceRequest): Promise<InferenceResult> => {
      if (harness.onDeviceUnavailable) {
        throw new InferenceUnavailableError(
          "Test harness: on-device model unavailable. No cloud fallback will run.",
          "MODEL_UNAVAILABLE",
        );
      }
      const call = calls;
      calls += 1;
      if (harness.onDeviceRuntimeFailures?.includes(call)) {
        throw new InferenceError(
          "ON_DEVICE_RUNTIME_ERROR",
          "Test harness: simulated Chrome on-device model service failure (kErrorUnknown).",
        );
      }
      const structured = harness.onDeviceOutput ?? {
        fieldAlias: request.input.fieldAlias,
        semanticRole: "lifecycle-state",
        valueKind: "enum",
        shareabilityHint: "synthetic-ok",
        rationale: "Synthetic test adapter classification; not a live model.",
      };
      const validation = validateStructuredOutput("field-interpretation", structured);
      if (!validation.valid) {
        throw new InferenceError("INVALID_STRUCTURED_OUTPUT", validation.issues.join("; "));
      }
      return {
        text: JSON.stringify(structured),
        structured,
        provenance: {
          provider: "test-harness",
          requestedMode: "ONLY_ON_DEVICE",
          actualSource: "TEST",
          inferenceSourceReported: true,
          model: "test-adapter",
          simulated: true,
          schemaValid: true,
          durationMs: 1,
          retries: 0,
          resultKind: "simulated-test",
        },
      };
    },
  };
}

export function createTestCloudAdapter(
  harness: TestHarness,
  availability: InferenceAvailability,
): CloudInferenceAdapter {
  return {
    execution: "cloud",
    status: () => availability,
    generateAuthorized: async (request: AuthorizedCloudRequest): Promise<InferenceResult> => {
      assertAuthorizedEnvelope(request);
      assertReservedAuthorization(request);
      if (harness.cloudErrorCode) {
        throw new InferenceError(
          harness.cloudErrorCode,
          harness.cloudErrorCode === "TIMEOUT"
            ? "Inference timed out after 45000 ms. The Firebase request may still be in flight; this authorization cannot be reused."
            : `Test harness forced ${harness.cloudErrorCode}.`,
        );
      }
      if (harness.malformedCloudOutput !== undefined) {
        const validation = validateStructuredOutput("mapping-proposal", harness.malformedCloudOutput);
        throw new InferenceError(
          "INVALID_STRUCTURED_OUTPUT",
          validation.issues.join("; ") || "Malformed test output rejected",
        );
      }
      if (harness.rawCloudText !== undefined) {
        return {
          text: harness.rawCloudText,
          structured: undefined,
          provenance: {
            provider: "test-harness",
            requestedMode: "ONLY_IN_CLOUD",
            actualSource: "TEST",
            inferenceSourceReported: true,
            model: "test-adapter",
            simulated: true,
            schemaValid: false,
            durationMs: 1,
            retries: 0,
            resultKind: "simulated-test",
          },
        };
      }
      const structured = harness.deriveProposal ? deriveTestProposal(request.payload) : harness.cloudOutput ?? {
        operations: [
          { op: "copy", from: request.payload.fields[0]?.alias ?? "contact_email", to: "email" },
        ],
        rationale: "Synthetic test adapter proposal; not a live Gemini response.",
      };
      const validation = validateStructuredOutput("mapping-proposal", structured);
      if (!validation.valid) {
        throw new InferenceError("INVALID_STRUCTURED_OUTPUT", validation.issues.join("; "));
      }
      return {
        text: JSON.stringify(structured),
        structured,
        provenance: {
          provider: "test-harness",
          requestedMode: "ONLY_IN_CLOUD",
          actualSource: "TEST",
          inferenceSourceReported: true,
          model: "test-adapter",
          simulated: true,
          schemaValid: true,
          durationMs: 1,
          retries: 0,
          resultKind: "simulated-test",
        },
      };
    },
  };
}
