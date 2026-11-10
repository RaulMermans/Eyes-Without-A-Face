import type { InferenceAvailability } from "../config/env.ts";
import type { AuthorizedCloudRequest } from "../twin/authorization.ts";

export type InferencePurpose = "schema-interpretation" | "mapping-proposal";
export type InferenceExecution = "on-device" | "cloud";
export type RequestedInferenceMode = "ONLY_ON_DEVICE" | "ONLY_IN_CLOUD";
export type ActualInferenceSource =
  | "ON_DEVICE"
  | "IN_CLOUD"
  | "TEST"
  | "UNAVAILABLE"
  | "FAILED";
export type ResultKind =
  | "real-on-device"
  | "real-cloud"
  | "simulated-test"
  | "unavailable"
  | "failed";

export interface OnDeviceFieldInput {
  fieldAlias: string;
  sampleValues: string[];
  hint: string;
}

export interface OnDeviceInferenceRequest {
  purpose: "schema-interpretation";
  input: OnDeviceFieldInput;
  signal?: AbortSignal;
}

export interface InferenceProvenance {
  provider: "firebase-ai-logic" | "test-harness";
  requestedMode: RequestedInferenceMode;
  actualSource: ActualInferenceSource;
  inferenceSourceReported: boolean;
  model: string;
  simulated: boolean;
  schemaValid: boolean;
  durationMs: number;
  retries: number;
  errorCode?: string;
  resultKind: ResultKind;
}

export interface InferenceResult {
  text: string;
  structured?: unknown;
  provenance: InferenceProvenance;
}

export interface OnDeviceCapability {
  chromeVersion: string | null;
  promptApi: "available" | "missing";
  languageModelAvailability: string | null;
  guidance: string;
}

export interface OnDeviceInferenceAdapter {
  readonly execution: "on-device";
  status(): InferenceAvailability;
  probeCapability(): Promise<OnDeviceCapability>;
  initialize(onProgress?: (progress: number) => void): Promise<void>;
  generate(request: OnDeviceInferenceRequest): Promise<InferenceResult>;
}

export interface CloudInferenceAdapter {
  readonly execution: "cloud";
  status(): InferenceAvailability;
  generateAuthorized(request: AuthorizedCloudRequest): Promise<InferenceResult>;
}

export interface InferenceServices {
  onDevice: OnDeviceInferenceAdapter;
  cloud: CloudInferenceAdapter;
}

/**
 * Firebase AI Logic JS SDK v13.2.0 surface used in Sprint 1.
 * Documented from https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 * Re-verified 2026-11-10.
 *
 * Do not use InferenceMode.PREFER_ON_DEVICE or PREFER_IN_CLOUD.
 */
export const FIREBASE_AI_LOGIC_API = {
  package: "firebase",
  module: "firebase/ai",
  symbols: [
    "getAI",
    "getGenerativeModel",
    "GoogleAIBackend",
    "InferenceMode",
    "Schema",
    "initializeAppCheck",
  ],
  onDeviceInit: "GenerativeModel.initializeDeviceModel",
  requiredOnDeviceMode: "ONLY_ON_DEVICE",
  requiredCloudMode: "ONLY_IN_CLOUD",
  defaultCloudModel: "gemini-3.5-flash-lite",
  minSdk: "12.5.0",
  pinnedSdk: "13.2.0",
  minChrome: 139,
} as const;

export const SYNTHETIC_ON_DEVICE_INPUT: OnDeviceFieldInput = {
  fieldAlias: "lifecycle_status",
  sampleValues: ["active", "paused", "closed"],
  hint: "Fictional CRM lifecycle field. Classify semantic meaning. Do not invent private identifiers.",
};
