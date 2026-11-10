import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", ""])
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  MODE: z.string().optional(),
  PROD: z.union([z.boolean(), z.string()]).optional(),
  DEV: z.union([z.boolean(), z.string()]).optional(),
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

export type RawEnv = Record<string, string | boolean | undefined>;

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
  | { state: "configured"; reason: "adapters-ready" };

export interface AppCheckStatus {
  siteKeyPresent: boolean;
  debugFlag: boolean;
  debugEnabled: boolean;
  debugBlockedInProduction: boolean;
  readyForCloud: boolean;
  label: string;
}

export interface AppConfig {
  firebase: FirebasePublicConfig | null;
  missingFirebaseKeys: string[];
  enableOnDeviceInference: boolean;
  enableCloudInference: boolean;
  productionBuild: boolean;
  appCheckDebug: boolean;
  appCheckSiteKey: string;
  appCheck: AppCheckStatus;
  onDevice: InferenceAvailability;
  cloud: InferenceAvailability;
}

function isProductionBuild(parsed: z.infer<typeof envSchema>): boolean {
  if (parsed.PROD === true || parsed.PROD === "true") {
    return true;
  }
  return parsed.MODE === "production";
}

function missingKeys(parsed: z.infer<typeof envSchema>): string[] {
  return REQUIRED_FIREBASE_KEYS.filter((key) => parsed[key].trim() === "");
}

function availability(enabled: boolean, missing: string[]): InferenceAvailability {
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
  return { state: "configured", reason: "adapters-ready" };
}

export function isUsableAppCheckSiteKey(siteKey: string): boolean {
  const trimmed = siteKey.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.includes("<") || trimmed.includes(">") || /placeholder|replace_with|your_/i.test(trimmed)) {
    return false;
  }
  return true;
}

function appCheckStatus(
  siteKey: string,
  debugFlag: boolean,
  productionBuild: boolean,
  firebaseConfigured: boolean,
): AppCheckStatus {
  const debugBlockedInProduction = debugFlag && productionBuild;
  const debugEnabled = debugFlag && !productionBuild;
  const siteKeyPresent = isUsableAppCheckSiteKey(siteKey);
  const readyForCloud =
    firebaseConfigured && siteKeyPresent && !debugBlockedInProduction;
  let label = "Not configured";
  if (debugBlockedInProduction) {
    label = "Blocked — App Check debug is forbidden in production builds";
  } else if (!firebaseConfigured) {
    label = "Unavailable — Firebase config missing";
  } else if (debugEnabled && siteKeyPresent) {
    label = "Local debug provider (token is not stored in VITE_* )";
  } else if (debugEnabled) {
    label = "Local debug requested; still requires a registered reCAPTCHA Enterprise site key and a safelisted debug token";
  } else if (siteKeyPresent) {
    label = "reCAPTCHA Enterprise site key present";
  } else if (siteKey.trim().length > 0) {
    label = "App Check site key is a placeholder — paste the registered public site key";
  }
  return {
    siteKeyPresent,
    debugFlag,
    debugEnabled,
    debugBlockedInProduction,
    readyForCloud,
    label,
  };
}

export function parseAppConfig(env: RawEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const missing = missingKeys(parsed);
  const productionBuild = isProductionBuild(parsed);
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

  const appCheck = appCheckStatus(
    parsed.VITE_FIREBASE_APP_CHECK_SITE_KEY,
    Boolean(parsed.VITE_APP_CHECK_DEBUG),
    productionBuild,
    Boolean(firebase),
  );

  return {
    firebase,
    missingFirebaseKeys: missing,
    enableOnDeviceInference: Boolean(parsed.VITE_ENABLE_ON_DEVICE_INFERENCE),
    enableCloudInference: Boolean(parsed.VITE_ENABLE_CLOUD_INFERENCE),
    productionBuild,
    appCheckDebug: appCheck.debugEnabled,
    appCheckSiteKey: parsed.VITE_FIREBASE_APP_CHECK_SITE_KEY,
    appCheck,
    onDevice: availability(Boolean(parsed.VITE_ENABLE_ON_DEVICE_INFERENCE), missing),
    cloud: availability(Boolean(parsed.VITE_ENABLE_CLOUD_INFERENCE), missing),
  };
}

export function isLiveInferenceAvailable(config: AppConfig): boolean {
  return (
    (config.onDevice.state === "configured" || config.cloud.state === "configured") &&
    !config.appCheck.debugBlockedInProduction
  );
}

export function liveInferenceLabel(availability: InferenceAvailability): string {
  switch (availability.state) {
    case "disabled":
      return "Unavailable — feature flag off";
    case "unconfigured":
      return "Unavailable — Firebase config missing";
    case "configured":
      return "Configured — live adapter ready (not yet executed)";
  }
}
