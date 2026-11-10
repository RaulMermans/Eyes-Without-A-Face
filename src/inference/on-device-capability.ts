import { FIREBASE_AI_LOGIC_API, type OnDeviceCapability } from "./types.ts";

function chromeVersionFromUserAgent(userAgent: string): string | null {
  const match = /Chrome\/(\d+(?:\.\d+)*)/.exec(userAgent);
  return match?.[1] ?? null;
}

function guidanceFor(
  chromeVersion: string | null,
  promptApi: "available" | "missing",
  languageModelAvailability: string | null,
): string {
  const major = chromeVersion ? Number.parseInt(chromeVersion, 10) : 0;
  if (!chromeVersion || Number.isNaN(major) || major < FIREBASE_AI_LOGIC_API.minChrome) {
    return `On-device inference needs Chrome desktop ${FIREBASE_AI_LOGIC_API.minChrome}+. Current Chrome version: ${chromeVersion ?? "not detected"}.`;
  }
  if (promptApi === "missing") {
    return "Enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input, restart Chrome, then retry. Do not replace this path with Ollama or another local server.";
  }
  if (languageModelAvailability === "unavailable") {
    return "The on-device model is unavailable on this hardware or Chrome build. The app will not fall back to cloud Gemini.";
  }
  if (languageModelAvailability === "downloadable" || languageModelAvailability === "downloading") {
    return "The on-device model still needs to download. Use Initialize local model after a user gesture, then wait for completion.";
  }
  if (languageModelAvailability === "available") {
    return "Prompt API reports the on-device model is available. Initialize it after a user gesture, then run local inference.";
  }
  return "Check Chrome flags, disk space, and LanguageModel.availability() before retrying. Initialization requires a user gesture.";
}

export async function probeOnDeviceCapability(): Promise<OnDeviceCapability> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      chromeVersion: null,
      promptApi: "missing",
      languageModelAvailability: null,
      guidance: "On-device inference only runs in a Chromium desktop browser window.",
      userAgent: null,
      platform: null,
      hardwareConcurrency: null,
      deviceMemoryGiB: null,
    };
  }

  const chromeVersion = chromeVersionFromUserAgent(navigator.userAgent);
  const extras = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB:
      "deviceMemory" in navigator && typeof navigator.deviceMemory === "number"
        ? navigator.deviceMemory
        : null,
  };
  const languageModel = window.LanguageModel;
  if (!languageModel || typeof languageModel.availability !== "function") {
    return {
      chromeVersion,
      promptApi: "missing",
      languageModelAvailability: null,
      guidance: guidanceFor(chromeVersion, "missing", null),
      ...extras,
    };
  }

  try {
    let languageModelAvailability: string;
    try {
      languageModelAvailability = String(
        await languageModel.availability({
          expectedInputs: [{ type: "text", languages: ["en"] }],
        }),
      );
    } catch {
      languageModelAvailability = String(await languageModel.availability());
    }
    return {
      chromeVersion,
      promptApi: "available",
      languageModelAvailability,
      guidance: guidanceFor(chromeVersion, "available", languageModelAvailability),
      ...extras,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      chromeVersion,
      promptApi: "available",
      languageModelAvailability: "error",
      guidance: `Prompt API is present but availability() failed: ${message}`,
      ...extras,
    };
  }
}
