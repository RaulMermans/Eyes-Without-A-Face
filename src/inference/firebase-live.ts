/**
 * Sprint 1 entry point. This module is the only place that may import Firebase.
 * It is not imported by the application shell in Sprint 0 so boot makes no
 * provider request.
 *
 * Expected implementation (do not enable until App Check and project setup exist):
 *
 *   import { initializeApp } from "firebase/app";
 *   import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
 *   import {
 *     getAI,
 *     getGenerativeModel,
 *     GoogleAIBackend,
 *     InferenceMode,
 *   } from "firebase/ai";
 *
 * On-device: InferenceMode.ONLY_ON_DEVICE, then model.initializeDeviceModel()
 * Cloud mapping: InferenceMode.ONLY_IN_CLOUD
 * Never: PREFER_ON_DEVICE / PREFER_IN_CLOUD (those enable automatic fallback)
 */
export function liveFirebaseAdaptersAreNotWired(): true {
  return true;
}
