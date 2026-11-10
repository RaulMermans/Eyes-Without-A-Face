import type { InferenceAvailability } from "../config/env.ts";
import type { AuthorizedCloudRequest } from "../twin/authorization.ts";
import { FIREBASE_AI_LOGIC_API } from "./firebase-api.ts";

export { FIREBASE_AI_LOGIC_API };

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
  userAgent?: string | null;
  platform?: string | null;
  hardwareConcurrency?: number | null;
  deviceMemoryGiB?: number | null;
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

export const SYNTHETIC_ON_DEVICE_INPUT: OnDeviceFieldInput = {
  fieldAlias: "lifecycle_status",
  sampleValues: ["active", "paused", "closed"],
  hint: "Fictional CRM lifecycle field. Classify semantic meaning. Do not invent private identifiers.",
};
