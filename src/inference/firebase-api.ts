/**
 * Firebase AI Logic JS SDK v13.2.0 surface used in this product.
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
