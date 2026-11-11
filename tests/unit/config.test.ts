import { describe, expect, it } from "vitest";
import { isLiveInferenceAvailable, parseAppConfig } from "../../src/config/env.ts";
import { createInferenceServices } from "../../src/inference/adapters.ts";
import { InferenceUnavailableError } from "../../src/inference/errors.ts";

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

  it("marks adapters configured when public config and flags are present", () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo",
      VITE_FIREBASE_APP_ID: "1:1:web:abc",
      VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
      VITE_ENABLE_CLOUD_INFERENCE: "true",
    });
    expect(config.firebase?.projectId).toBe("demo");
    expect(config.onDevice.state).toBe("configured");
    expect(config.cloud.state).toBe("configured");
  });

  it("keeps App Check debug as a flag, not a token", () => {
    const config = parseAppConfig({ VITE_APP_CHECK_DEBUG: "true" });
    expect(config.appCheck.debugEnabled).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("never enables App Check debug in production builds", () => {
    const config = parseAppConfig({
      MODE: "production",
      VITE_APP_CHECK_DEBUG: "true",
      VITE_FIREBASE_APP_CHECK_SITE_KEY: "site-key",
    });
    expect(config.appCheck.debugEnabled).toBe(false);
    expect(config.appCheck.debugBlockedInProduction).toBe(true);
  });
});

describe("inference adapters", () => {
  it("refuse generation when unconfigured", async () => {
    const config = parseAppConfig({
      VITE_ENABLE_CLOUD_INFERENCE: "true",
    });
    const services = createInferenceServices(config);
    await expect(
      services.cloud.generateAuthorized({
        requestId: "req",
        payloadHash: "abc",
        canonicalJson: "{}",
        destinationKey: "firebase-ai-logic:google-ai:gemini-3.5-flash-lite:mapping-proposal",
        payload: {
          contractKind: "cloud-disclosure",
          schemaVersion: "1.0.0",
          payloadId: "x",
          phantomId: "p",
          destination: {
            provider: "firebase-ai-logic",
            backend: "google-ai",
            model: "gemini-3.5-flash-lite",
            purpose: "mapping-proposal",
          },
          purpose: "mapping-proposal",
          entities: [{ id: "e", label: "E" }],
          fields: [
            {
              alias: "a",
              entityId: "e",
              type: "string",
              semanticDescriptor: "synthetic",
            },
          ],
          syntheticExamples: [{ a: "b" }],
        },
        approval: {
          requestId: "req",
          payloadHash: "abc",
          destinationKey: "firebase-ai-logic:google-ai:gemini-3.5-flash-lite:mapping-proposal",
          purpose: "mapping-proposal",
          approvedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toBeInstanceOf(InferenceUnavailableError);
  });

  it("refuse to return a simulated success from the live path", async () => {
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
        input: {
          fieldAlias: "lifecycle_status",
          sampleValues: ["active"],
          hint: "synthetic",
        },
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
