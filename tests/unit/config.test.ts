import { describe, expect, it } from "vitest";
import { isLiveInferenceAvailable, parseAppConfig } from "../../src/config/env.ts";
import { createInferenceServices } from "../../src/inference/adapters.ts";
import { InferenceNotImplementedError, InferenceUnavailableError } from "../../src/inference/errors.ts";

const emptyEnv = {};

describe("parseAppConfig", () => {
  it("allows local development without Firebase credentials", () => {
    const config = parseAppConfig(emptyEnv);
    expect(config.firebase).toBeNull();
    expect(config.missingFirebaseKeys).toContain("VITE_FIREBASE_API_KEY");
    expect(config.onDevice.state).toBe("disabled");
    expect(config.cloud.state).toBe("disabled");
    expect(isLiveInferenceAvailable(config)).toBe(false);
  });

  it("does not treat public config as live-ready in Sprint 0", () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo",
      VITE_FIREBASE_APP_ID: "1:1:web:abc",
      VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
      VITE_ENABLE_CLOUD_INFERENCE: "true",
    });
    expect(config.firebase?.projectId).toBe("demo");
    expect(config.onDevice.state).toBe("not-implemented");
    expect(config.cloud.state).toBe("not-implemented");
    expect(isLiveInferenceAvailable(config)).toBe(false);
  });

  it("keeps App Check debug as a flag, not a token", () => {
    const config = parseAppConfig({ VITE_APP_CHECK_DEBUG: "true" });
    expect(config.appCheckDebug).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("inference adapters", () => {
  it("refuse generation when unconfigured", async () => {
    const config = parseAppConfig({
      VITE_ENABLE_CLOUD_INFERENCE: "true",
    });
    const services = createInferenceServices(config);
    await expect(
      services.cloud.generate({
        purpose: "mapping-proposal",
        prompt: "map fields",
        allowedDisclosure: "phantom-only",
      }),
    ).rejects.toBeInstanceOf(InferenceUnavailableError);
  });

  it("refuse to simulate successful live inference", async () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo",
      VITE_FIREBASE_APP_ID: "1:1:web:abc",
      VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
    });
    const services = createInferenceServices(config);
    await expect(
      services.onDevice.generate({
        purpose: "schema-interpretation",
        prompt: "describe fields",
        allowedDisclosure: "none",
      }),
    ).rejects.toBeInstanceOf(InferenceNotImplementedError);
  });
});
