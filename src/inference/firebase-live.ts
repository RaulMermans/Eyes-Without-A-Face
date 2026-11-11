import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from "firebase/ai";
import type { AppConfig } from "../config/env.ts";
import { requireFirebaseConfig } from "../config/firebase.ts";
import {
  parseJsonObject,
  validateStructuredOutput,
  type StructuredOutputKind,
} from "../domain/inference-output/validate-output.ts";
import {
  assertAuthorizedEnvelope,
  MAX_CLOUD_RESPONSE_BYTES,
  type AuthorizedCloudRequest,
} from "../twin/authorization.ts";
import { recordDiagnostic } from "./diagnostics.ts";
import { classifyUnknownError, InferenceError, InferenceUnavailableError } from "./errors.ts";
import { probeOnDeviceCapability } from "./on-device-capability.ts";
import {
  buildCloudPrompt,
  buildOnDevicePrompt,
  MAPPING_PROPOSAL_JSON_SCHEMA,
} from "./prompts.ts";
import type {
  ActualInferenceSource,
  CloudInferenceAdapter,
  InferenceResult,
  OnDeviceInferenceAdapter,
  OnDeviceInferenceRequest,
} from "./types.ts";
import { FIREBASE_AI_LOGIC_API } from "./types.ts";

const ON_DEVICE_TIMEOUT_MS = 90_000;
const CLOUD_TIMEOUT_MS = 45_000;
const CLOUD_RETRY_LIMIT = 2;

let runtimePromise: Promise<LiveFirebaseRuntime> | null = null;

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new InferenceUnavailableError(
      "Firebase live adapters only run in the browser.",
      "UNSUPPORTED_BROWSER",
    );
  }
}

function enableAppCheckDebugToken(config: AppConfig): void {
  if (config.productionBuild) {
    if (config.appCheck.debugFlag) {
      throw new InferenceError(
        "APP_CHECK_REJECTED",
        "App Check debug mode is forbidden in production builds.",
      );
    }
    return;
  }
  if (config.appCheck.debugEnabled) {
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
}

function mapInferenceSource(value: string | undefined): ActualInferenceSource | null {
  if (value === InferenceSource.ON_DEVICE || value === "on_device" || value === "ON_DEVICE") {
    return "ON_DEVICE";
  }
  if (value === InferenceSource.IN_CLOUD || value === "in_cloud" || value === "IN_CLOUD") {
    return "IN_CLOUD";
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ms);
  const onAbort = () => timeout.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await new Promise<T>((resolve, reject) => {
      if (timeout.signal.aborted) {
        reject(new InferenceError("TIMEOUT", `Inference timed out after ${ms} ms`));
        return;
      }
      timeout.signal.addEventListener(
        "abort",
        () => {
          reject(
            signal?.aborted
              ? new InferenceError("CANCELLED", "Inference was cancelled")
              : new InferenceError("TIMEOUT", `Inference timed out after ${ms} ms`),
          );
        },
        { once: true },
      );
      promise.then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

class LiveFirebaseRuntime {
  private readonly config: AppConfig;
  private readonly app: FirebaseApp;
  private readonly appCheckReady: boolean;
  private onDeviceModel: GenerativeModel | null = null;
  private cloudModel: GenerativeModel | null = null;
  private initializingOnDevice: Promise<void> | null = null;
  private onDeviceBusy = false;
  private cloudBusy = false;

  constructor(config: AppConfig) {
    requireFirebaseConfig(config);
    this.config = config;
    enableAppCheckDebugToken(config);
    this.app = initializeApp(config.firebase);
    this.appCheckReady = this.initAppCheck() !== null;
    getAI(this.app, { backend: new GoogleAIBackend() });
  }

  private initAppCheck(): ReturnType<typeof initializeAppCheck> | null {
    if (!this.config.appCheck.siteKeyPresent) {
      return null;
    }
    return initializeAppCheck(this.app, {
      provider: new ReCaptchaEnterpriseProvider(this.config.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  private ai() {
    return getAI(this.app, { backend: new GoogleAIBackend() });
  }

  onDeviceAdapter(): OnDeviceInferenceAdapter {
    return {
      execution: "on-device",
      status: () => this.config.onDevice,
      probeCapability: () => probeOnDeviceCapability(),
      initialize: (onProgress) => this.initializeOnDevice(onProgress),
      generate: (request) => this.generateOnDevice(request),
    };
  }

  cloudAdapter(): CloudInferenceAdapter {
    return {
      execution: "cloud",
      status: () => this.config.cloud,
      generateAuthorized: (request) => this.generateCloud(request),
    };
  }

  private async initializeOnDevice(onProgress?: (progress: number) => void): Promise<void> {
    assertBrowser();
    if (this.config.onDevice.state !== "configured") {
      throw new InferenceUnavailableError("On-device inference is not configured.", "MISSING_CONFIG");
    }
    if (this.initializingOnDevice) {
      await this.initializingOnDevice;
      return;
    }
    const started = performance.now();
    this.initializingOnDevice = (async () => {
      const capability = await probeOnDeviceCapability();
      if (capability.promptApi === "missing") {
        throw new InferenceUnavailableError(capability.guidance, "UNSUPPORTED_BROWSER");
      }
      if (capability.languageModelAvailability === "unavailable") {
        throw new InferenceUnavailableError(capability.guidance, "MODEL_UNAVAILABLE");
      }
      const model = getGenerativeModel(this.ai(), {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: {
          createOptions: {
            expectedInputs: [{ type: "text", languages: ["en"] }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
          },
        },
      });
      await model.initializeDeviceModel((progress) => {
        onProgress?.(progress);
      });
      this.onDeviceModel = model;
    })();
    try {
      await this.initializingOnDevice;
      recordDiagnostic({
        kind: "on-device-init",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_ON_DEVICE",
      });
    } catch (error) {
      this.initializingOnDevice = null;
      const classified = classifyUnknownError(error);
      recordDiagnostic({
        kind: "on-device-init",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_ON_DEVICE",
        errorCode: classified.code,
      });
      throw classified;
    }
  }

  private async generateOnDevice(request: OnDeviceInferenceRequest): Promise<InferenceResult> {
    const started = performance.now();
    if (this.onDeviceBusy) {
      throw new InferenceError("IN_FLIGHT", "On-device inference is already running.");
    }
    this.onDeviceBusy = true;
    try {
      if (!this.onDeviceModel) {
        await this.initializeOnDevice();
      }
      const model = this.onDeviceModel;
      if (!model) {
        throw new InferenceUnavailableError("On-device model was not initialized.", "MODEL_UNAVAILABLE");
      }
      const prompt = buildOnDevicePrompt(request.input);
      const result = await withTimeout(
        model.generateContent(prompt),
        ON_DEVICE_TIMEOUT_MS,
        request.signal,
      );
      return this.finishStructuredResult({
        kind: "field-interpretation",
        text: result.response.text(),
        requestedMode: "ONLY_ON_DEVICE",
        expectedSource: "ON_DEVICE",
        reportedSource: result.response.inferenceSource,
        started,
        retries: 0,
        model: "chrome-prompt-api",
      });
    } catch (error) {
      const classified = classifyUnknownError(error);
      recordDiagnostic({
        kind: "on-device-inference",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_ON_DEVICE",
        errorCode: classified.code,
        schemaValid: false,
      });
      throw classified;
    } finally {
      this.onDeviceBusy = false;
    }
  }

  private async generateCloud(request: AuthorizedCloudRequest): Promise<InferenceResult> {
    assertAuthorizedEnvelope(request);
    const started = performance.now();
    if (this.cloudBusy) {
      throw new InferenceError("IN_FLIGHT", "Cloud inference is already running.");
    }
    if (this.config.cloud.state !== "configured") {
      throw new InferenceUnavailableError("Cloud inference is not configured.", "MISSING_CONFIG");
    }
    if (!this.config.appCheck.readyForCloud || !this.appCheckReady) {
      throw new InferenceUnavailableError(
        "App Check is not ready. Configure a reCAPTCHA Enterprise site key and complete the local debug token workflow.",
        "APP_CHECK_REJECTED",
      );
    }
    if (request.canonicalJson.length > MAX_CLOUD_RESPONSE_BYTES) {
      throw new InferenceError("PAYLOAD_TOO_LARGE", "Authorized payload exceeds the cloud request limit.");
    }
    this.cloudBusy = true;
    let retries = 0;
    try {
      if (!this.cloudModel) {
        this.cloudModel = getGenerativeModel(this.ai(), {
          mode: InferenceMode.ONLY_IN_CLOUD,
          inCloudParams: {
            model: FIREBASE_AI_LOGIC_API.defaultCloudModel,
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: MAPPING_PROPOSAL_JSON_SCHEMA,
            },
          },
        });
      }
      const prompt = buildCloudPrompt(request);
      let lastError: InferenceError | null = null;
      while (retries <= CLOUD_RETRY_LIMIT) {
        try {
          const result = await withTimeout(
            this.cloudModel.generateContent(prompt),
            CLOUD_TIMEOUT_MS,
          );
          return this.finishStructuredResult({
            kind: "mapping-proposal",
            text: result.response.text(),
            requestedMode: "ONLY_IN_CLOUD",
            expectedSource: "IN_CLOUD",
            reportedSource: result.response.inferenceSource,
            started,
            retries,
            model: FIREBASE_AI_LOGIC_API.defaultCloudModel,
          });
        } catch (error) {
          const classified = classifyUnknownError(error);
          lastError = classified;
          const retryable = classified.code === "NETWORK" || classified.code === "TIMEOUT";
          if (!retryable || retries >= CLOUD_RETRY_LIMIT) {
            throw classified;
          }
          retries += 1;
        }
      }
      throw lastError ?? new InferenceError("NETWORK", "Cloud inference failed.");
    } catch (error) {
      const classified = classifyUnknownError(error);
      recordDiagnostic({
        kind: "cloud-inference",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_IN_CLOUD",
        retries,
        errorCode: classified.code,
        schemaValid: false,
      });
      throw classified;
    } finally {
      this.cloudBusy = false;
    }
  }

  private finishStructuredResult(input: {
    kind: StructuredOutputKind;
    text: string;
    requestedMode: "ONLY_ON_DEVICE" | "ONLY_IN_CLOUD";
    expectedSource: ActualInferenceSource;
    reportedSource: string | undefined;
    started: number;
    retries: number;
    model: string;
  }): InferenceResult {
    if (input.text.length > MAX_CLOUD_RESPONSE_BYTES) {
      throw new InferenceError("PAYLOAD_TOO_LARGE", "Model response exceeded the size limit.");
    }
    const mapped = mapInferenceSource(input.reportedSource);
    if (mapped && mapped !== input.expectedSource) {
      throw new InferenceError(
        "PROVENANCE_MISMATCH",
        `Requested ${input.requestedMode} but SDK reported ${mapped}.`,
      );
    }
    const actualSource = mapped ?? input.expectedSource;
    let parsed: unknown;
    try {
      parsed = parseJsonObject(input.text);
    } catch {
      throw new InferenceError("INVALID_STRUCTURED_OUTPUT", "Model did not return JSON.");
    }
    const validation = validateStructuredOutput(input.kind, parsed);
    recordDiagnostic({
      kind: input.kind === "field-interpretation" ? "on-device-inference" : "cloud-inference",
      durationMs: Math.round(performance.now() - input.started),
      requestedMode: input.requestedMode,
      actualSource,
      retries: input.retries,
      schemaValid: validation.valid,
      simulated: false,
      errorCode: validation.valid ? undefined : "INVALID_STRUCTURED_OUTPUT",
    });
    if (!validation.valid) {
      throw new InferenceError(
        validation.issues.some((issue) => issue.toLowerCase().includes("executable"))
          ? "EXECUTABLE_OUTPUT"
          : "INVALID_STRUCTURED_OUTPUT",
        validation.issues.join("; "),
      );
    }
    return {
      text: input.text,
      structured: validation.value,
      provenance: {
        provider: "firebase-ai-logic",
        requestedMode: input.requestedMode,
        actualSource,
        inferenceSourceReported: Boolean(mapped),
        model: input.model,
        simulated: false,
        schemaValid: true,
        durationMs: Math.round(performance.now() - input.started),
        retries: input.retries,
        resultKind: input.expectedSource === "ON_DEVICE" ? "real-on-device" : "real-cloud",
      },
    };
  }
}

export async function createLiveFirebaseServices(config: AppConfig): Promise<{
  onDevice: OnDeviceInferenceAdapter;
  cloud: CloudInferenceAdapter;
}> {
  const started = performance.now();
  try {
    assertBrowser();
    if (!runtimePromise) {
      runtimePromise = Promise.resolve(new LiveFirebaseRuntime(config));
    }
    const runtime = await runtimePromise;
    recordDiagnostic({
      kind: "sdk-init",
      durationMs: Math.round(performance.now() - started),
    });
    return {
      onDevice: runtime.onDeviceAdapter(),
      cloud: runtime.cloudAdapter(),
    };
  } catch (error) {
    runtimePromise = null;
    const classified = classifyUnknownError(error);
    recordDiagnostic({
      kind: "sdk-init",
      durationMs: Math.round(performance.now() - started),
      errorCode: classified.code,
    });
    throw classified;
  }
}

export function resetLiveFirebaseRuntimeForTests(): void {
  runtimePromise = null;
}
