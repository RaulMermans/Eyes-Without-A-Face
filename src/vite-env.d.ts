/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.webp" {
  const src: string;
  export default src;
}

interface LanguageModelAvailability {
  availability(options?: { expectedInputs?: Array<{ type: string; languages?: string[] }> }): Promise<string>;
}

interface Navigator {
  deviceMemory?: number;
}

interface EyesTestHarness {
  label: "test-harness";
  onDeviceUnavailable?: boolean;
  onDeviceAvailable?: boolean;
  onDeviceRuntimeFailures?: number[];
  onDeviceOutput?: unknown;
  cloudOutput?: unknown;
  deriveProposal?: boolean;
  rawCloudText?: string;
  malformedCloudOutput?: unknown;
  cloudErrorCode?:
    | "TIMEOUT"
    | "PROVENANCE_UNVERIFIED"
    | "PROVENANCE_UNKNOWN"
    | "PROVENANCE_MISMATCH"
    | "SIMULATED_RESULT"
    | "IN_FLIGHT"
    | "PROVIDER_OVERLOADED"
    | "RATE_LIMITED"
    | "APP_CHECK_REJECTED"
    | "MODEL_UNAVAILABLE"
    | "NETWORK";
  cloudRawError?: string;
  cloudFailCalls?: number[];
  cloudDelayMs?: number;
}

interface Window {
  LanguageModel?: LanguageModelAvailability;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  __EYES_WITHOUT_A_FACE_TEST__?: EyesTestHarness;
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_ENABLE_ON_DEVICE_INFERENCE?: string;
  readonly VITE_ENABLE_CLOUD_INFERENCE?: string;
  readonly VITE_APP_CHECK_DEBUG?: string;
  readonly VITE_FIREBASE_APP_CHECK_SITE_KEY?: string;
  readonly VITE_BUILD_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
