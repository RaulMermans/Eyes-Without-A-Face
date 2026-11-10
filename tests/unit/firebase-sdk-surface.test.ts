import { describe, expect, it } from "vitest";
import { InferenceMode } from "firebase/ai";
import { FIREBASE_AI_LOGIC_API } from "../../src/inference/types.ts";
import { createLiveFirebaseServices } from "../../src/inference/firebase-live.ts";
import { parseAppConfig } from "../../src/config/env.ts";

describe("Firebase AI Logic SDK surface", () => {
  it("exposes explicit on-device and in-cloud modes", () => {
    expect(InferenceMode.ONLY_ON_DEVICE).toBe("only_on_device");
    expect(InferenceMode.ONLY_IN_CLOUD).toBe("only_in_cloud");
    expect(InferenceMode.PREFER_ON_DEVICE).toBeDefined();
    expect(FIREBASE_AI_LOGIC_API.requiredOnDeviceMode).toBe("ONLY_ON_DEVICE");
    expect(FIREBASE_AI_LOGIC_API.requiredCloudMode).toBe("ONLY_IN_CLOUD");
  });

  it("refuses to initialize the live runtime outside a browser", async () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo",
      VITE_FIREBASE_APP_ID: "1:1:web:abc",
      VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
    });
    await expect(createLiveFirebaseServices(config)).rejects.toThrow(/browser/i);
  });
});
