import { describe, expect, it } from "vitest";
import { InferenceMode } from "firebase/ai";
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/types.ts";
import { liveFirebaseAdaptersAreNotWired } from "../../src/inference/firebase-live.ts";

describe("Firebase AI Logic SDK surface", () => {
  it("exposes explicit on-device and in-cloud modes", () => {
    expect(InferenceMode.ONLY_ON_DEVICE).toBeDefined();
    expect(InferenceMode.ONLY_IN_CLOUD).toBeDefined();
    expect(InferenceMode.PREFER_ON_DEVICE).toBeDefined();
    expect(FIREBASE_AI_LOGIC_API.requiredOnDeviceMode).toBe("ONLY_ON_DEVICE");
    expect(FIREBASE_AI_LOGIC_API.requiredCloudMode).toBe("ONLY_IN_CLOUD");
    expect(liveFirebaseAdaptersAreNotWired()).toBe(true);
  });
});
