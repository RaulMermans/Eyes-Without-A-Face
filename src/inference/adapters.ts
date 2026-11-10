import type { AppConfig, InferenceAvailability } from "../config/env.ts";
import { InferenceUnavailableError } from "./errors.ts";
import { probeOnDeviceCapability } from "./on-device-capability.ts";
import { createTestCloudAdapter, createTestOnDeviceAdapter, type TestHarness } from "./test-adapters.ts";
import type {
  CloudInferenceAdapter,
  InferenceServices,
  OnDeviceCapability,
  OnDeviceInferenceAdapter,
  OnDeviceInferenceRequest,
} from "./types.ts";
import type { AuthorizedCloudRequest } from "../twin/authorization.ts";

function testHarness(): TestHarness | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!import.meta.env.DEV) {
    return null;
  }
  return window.__EYES_WITHOUT_A_FACE_TEST__ ?? null;
}

function unavailableMessage(execution: "on-device" | "cloud", availability: InferenceAvailability): string {
  if (availability.state === "disabled") {
    return `${execution} inference is disabled. Set the feature flag only when Firebase is configured.`;
  }
  if (availability.state === "unconfigured") {
    return `${execution} inference is unconfigured. Missing: ${availability.missing.join(", ")}`;
  }
  return `${execution} inference is configured but the live SDK has not been initialized yet.`;
}

function createUnavailableOnDevice(availability: InferenceAvailability): OnDeviceInferenceAdapter {
  return {
    execution: "on-device",
    status: () => availability,
    probeCapability: () => probeOnDeviceCapability(),
    initialize: async () => {
      throw new InferenceUnavailableError(unavailableMessage("on-device", availability), "MISSING_CONFIG");
    },
    generate: async (_request: OnDeviceInferenceRequest) => {
      throw new InferenceUnavailableError(unavailableMessage("on-device", availability), "MISSING_CONFIG");
    },
  };
}

function createUnavailableCloud(availability: InferenceAvailability): CloudInferenceAdapter {
  return {
    execution: "cloud",
    status: () => availability,
    generateAuthorized: async (_request: AuthorizedCloudRequest) => {
      throw new InferenceUnavailableError(unavailableMessage("cloud", availability), "MISSING_CONFIG");
    },
  };
}

function createLazyLiveOnDevice(
  config: AppConfig,
  fallback: OnDeviceInferenceAdapter,
): OnDeviceInferenceAdapter {
  return {
    execution: "on-device",
    status: () => config.onDevice,
    probeCapability: async (): Promise<OnDeviceCapability> => {
      const harness = testHarness();
      if (harness?.onDeviceUnavailable) {
        return {
          chromeVersion: null,
          promptApi: "missing",
          languageModelAvailability: "unavailable",
          guidance: "Local model unavailable in this session. Cloud fallback is disabled.",
        };
      }
      return fallback.probeCapability();
    },
    initialize: async (onProgress) => {
      const live = await loadLive(config);
      await live.onDevice.initialize(onProgress);
    },
    generate: async (request) => {
      const live = await loadLive(config);
      return live.onDevice.generate(request);
    },
  };
}

function createLazyLiveCloud(config: AppConfig): CloudInferenceAdapter {
  return {
    execution: "cloud",
    status: () => config.cloud,
    generateAuthorized: async (request) => {
      const live = await loadLive(config);
      return live.cloud.generateAuthorized(request);
    },
  };
}

async function loadLive(config: AppConfig): Promise<InferenceServices> {
  const module = await import("./firebase-live.ts");
  return module.createLiveFirebaseServices(config);
}

export type { InferenceServices } from "./types.ts";

export function createInferenceServices(config: AppConfig): InferenceServices {
  const harness = testHarness();
  if (harness) {
    return {
      onDevice: createTestOnDeviceAdapter(harness, config.onDevice),
      cloud: createTestCloudAdapter(harness, config.cloud),
    };
  }

  const onDeviceUnavailable = createUnavailableOnDevice(config.onDevice);
  const cloudUnavailable = createUnavailableCloud(config.cloud);

  return {
    onDevice:
      config.onDevice.state === "configured"
        ? createLazyLiveOnDevice(config, onDeviceUnavailable)
        : onDeviceUnavailable,
    cloud: config.cloud.state === "configured" ? createLazyLiveCloud(config) : cloudUnavailable,
  };
}
