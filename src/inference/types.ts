import type { InferenceAvailability } from "../config/env.ts";

export type InferencePurpose = "schema-interpretation" | "mapping-proposal";
export type InferenceExecution = "on-device" | "cloud";

export interface InferenceRequest {
  purpose: InferencePurpose;
  prompt: string;
  allowedDisclosure: "none" | "phantom-only";
}

export interface InferenceProvenance {
  provider: "firebase-ai-logic";
  execution: InferenceExecution;
  model: string;
  simulated: false;
}

export interface InferenceResult {
  text: string;
  provenance: InferenceProvenance;
}

export interface InferenceAdapter {
  readonly execution: InferenceExecution;
  status(): InferenceAvailability;
  generate(request: InferenceRequest): Promise<InferenceResult>;
}

/**
 * Firebase AI Logic JS SDK v13.2.0 surface we will call in Sprint 1.
 * Documented from https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 * Verified 2026-11-10.
 *
 * Do not use InferenceMode.PREFER_ON_DEVICE or PREFER_IN_CLOUD.
 * Automatic cloud fallback is forbidden for this product.
 */
export const FIREBASE_AI_LOGIC_API = {
  package: "firebase",
  module: "firebase/ai",
  symbols: [
    "getAI",
    "getGenerativeModel",
    "GoogleAIBackend",
    "InferenceMode",
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
