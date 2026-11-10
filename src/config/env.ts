import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", ""])
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().optional().default(""),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional().default(""),
  VITE_FIREBASE_PROJECT_ID: z.string().optional().default(""),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional().default(""),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional().default(""),
  VITE_FIREBASE_APP_ID: z.string().optional().default(""),
  VITE_FIREBASE_MEASUREMENT_ID: z.string().optional().default(""),
  VITE_ENABLE_ON_DEVICE_INFERENCE: booleanFlag,
  VITE_ENABLE_CLOUD_INFERENCE: booleanFlag,
  VITE_APP_CHECK_DEBUG: booleanFlag,
  VITE_FIREBASE_APP_CHECK_SITE_KEY: z.string().optional().default(""),
});

export const REQUIRED_FIREBASE_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

export type RawEnv = Record<string, string | undefined>;

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export type InferenceAvailability =
  | { state: "disabled"; reason: "feature-flag-off" }
  | { state: "unconfigured"; reason: "missing-firebase-config"; missing: string[] }
  | { state: "not-implemented"; reason: "sprint-0-foundation" };

export interface AppConfig {
  firebase: FirebasePublicConfig | null;
  missingFirebaseKeys: string[];
  enableOnDeviceInference: boolean;
  enableCloudInference: boolean;
  appCheckDebug: boolean;
  appCheckSiteKey: string;
  onDevice: InferenceAvailability;
  cloud: InferenceAvailability;
}

function missingKeys(parsed: z.infer<typeof envSchema>): string[] {
  return REQUIRED_FIREBASE_KEYS.filter((key) => parsed[key].trim() === "");
}

function availability(
  enabled: boolean,
  missing: string[],
): InferenceAvailability {
  if (!enabled) {
    return { state: "disabled", reason: "feature-flag-off" };
  }
  if (missing.length > 0) {
    return {
      state: "unconfigured",
      reason: "missing-firebase-config",
      missing: [...missing],
    };
  }
  return { state: "not-implemented", reason: "sprint-0-foundation" };
}

export function parseAppConfig(env: RawEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const missing = missingKeys(parsed);
  const firebase =
    missing.length === 0
      ? {
          apiKey: parsed.VITE_FIREBASE_API_KEY,
          authDomain: parsed.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: parsed.VITE_FIREBASE_PROJECT_ID,
          storageBucket: parsed.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: parsed.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: parsed.VITE_FIREBASE_APP_ID,
          measurementId: parsed.VITE_FIREBASE_MEASUREMENT_ID || undefined,
        }
      : null;

  return {
    firebase,
    missingFirebaseKeys: missing,
    enableOnDeviceInference: Boolean(parsed.VITE_ENABLE_ON_DEVICE_INFERENCE),
    enableCloudInference: Boolean(parsed.VITE_ENABLE_CLOUD_INFERENCE),
    appCheckDebug: Boolean(parsed.VITE_APP_CHECK_DEBUG),
    appCheckSiteKey: parsed.VITE_FIREBASE_APP_CHECK_SITE_KEY,
    onDevice: availability(Boolean(parsed.VITE_ENABLE_ON_DEVICE_INFERENCE), missing),
    cloud: availability(Boolean(parsed.VITE_ENABLE_CLOUD_INFERENCE), missing),
  };
}

export function isLiveInferenceAvailable(_config: AppConfig): boolean {
  return false;
}

export function liveInferenceLabel(availability: InferenceAvailability): string {
  switch (availability.state) {
    case "disabled":
      return "Unavailable — feature flag off";
    case "unconfigured":
      return "Unavailable — Firebase config missing";
    case "not-implemented":
      return "Unavailable — live inference not implemented (Sprint 0)";
  }
}
