import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
} from "firebase/ai";
import type { AppConfig } from "../config/env.ts";
import { assertExpectedFirebaseIdentity, requireFirebaseConfig } from "../config/firebase.ts";
import {
  parseJsonObject,
  validateStructuredOutput,
  type StructuredOutputKind,
} from "../domain/inference-output/validate-output.ts";
import {
  assertAuthorizedEnvelope,
  assertEffectiveDestination,
  MAX_CLOUD_RESPONSE_BYTES,
  type AuthorizedCloudRequest,
} from "../twin/authorization.ts";
import { assertReservedAuthorization } from "../twin/authorization-ledger.ts";
import { recordDiagnostic } from "./diagnostics.ts";
import { classifyUnknownError, InferenceError, InferenceUnavailableError } from "./errors.ts";
import { FIREBASE_AI_LOGIC_API } from "./firebase-api.ts";
import { probeOnDeviceCapability } from "./on-device-capability.ts";
import { buildCloudPrompt, buildOnDevicePrompt, MAPPING_PROPOSAL_JSON_SCHEMA } from "./prompts.ts";
import {
  assertLiveProvenance,
  expectedSourceForMode,
  resolveReportedInferenceSource,
} from "./provenance.ts";
import {
  CLOUD_TIMEOUT_MS,
  ON_DEVICE_TIMEOUT_MS,
  timeoutErrorMessage,
} from "./retry-policy.ts";
import type {
  CloudInferenceAdapter,
  InferenceResult,
  OnDeviceInferenceAdapter,
  OnDeviceInferenceRequest,
} from "./types.ts";

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
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
}

function getOrInitializeApp(config: AppConfig): FirebaseApp {
  requireFirebaseConfig(config);
  assertExpectedFirebaseIdentity(config);
  const existing = getApps()[0];
  if (existing) {
    if (
      existing.options.projectId !== config.firebase.projectId ||
      existing.options.appId !== config.firebase.appId
    ) {
      throw new InferenceError(
        "SDK_INIT_FAILED",
        "Firebase is already initialized with a different project or web app.",
      );
    }
    return getApp();
  }
  return initializeApp(config.firebase);
}

class LiveFirebaseRuntime {
  private readonly config: AppConfig;
  private readonly app: FirebaseApp;
  private readonly appCheck: AppCheck | null;
  private onDeviceModel: GenerativeModel | null = null;
  private cloudModel: GenerativeModel | null = null;
  private initializingOnDevice: Promise<void> | null = null;
  private onDeviceBusy = false;
  private cloudBusy = false;

  constructor(config: AppConfig) {
    requireFirebaseConfig(config);
    this.config = config;
    enableAppCheckDebugToken(config);
    this.app = getOrInitializeApp(config);
    this.appCheck = this.initAppCheck();
    getAI(this.app, { backend: new GoogleAIBackend() });
  }

  private initAppCheck(): AppCheck | null {
    if (!this.config.appCheck.siteKeyPresent) {
      return null;
    }
    enableAppCheckDebugToken(this.config);
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
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), ON_DEVICE_TIMEOUT_MS);
    try {
      if (!this.onDeviceModel) {
        await this.initializeOnDevice();
      }
      const model = this.onDeviceModel;
      if (!model) {
        throw new InferenceUnavailableError("On-device model was not initialized.", "MODEL_UNAVAILABLE");
      }
      const prompt = buildOnDevicePrompt(request.input);
      const result = await model.generateContent(prompt, { signal: controller.signal });
      return this.finishStructuredResult({
        kind: "field-interpretation",
        text: result.response.text(),
        requestedMode: "ONLY_ON_DEVICE",
        reportedSource: result.response.inferenceSource,
        started,
        model: "chrome-prompt-api",
      });
    } catch (error) {
      const classified = this.classifyGenerateError(error, controller, ON_DEVICE_TIMEOUT_MS);
      recordDiagnostic({
        kind: "on-device-inference",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_ON_DEVICE",
        errorCode: classified.code,
        schemaValid: false,
      });
      throw classified;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      this.onDeviceBusy = false;
    }
  }

  private async generateCloud(request: AuthorizedCloudRequest): Promise<InferenceResult> {
    assertAuthorizedEnvelope(request);
    assertReservedAuthorization(request);
    assertEffectiveDestination(request);
    const started = performance.now();
    if (this.cloudBusy) {
      throw new InferenceError("IN_FLIGHT", "Cloud inference is already running.");
    }
    if (this.config.cloud.state !== "configured") {
      throw new InferenceUnavailableError("Cloud inference is not configured.", "MISSING_CONFIG");
    }
    if (!this.config.appCheck.readyForCloud || !this.appCheck) {
      throw new InferenceUnavailableError(
        "App Check is not ready. Configure the registered reCAPTCHA Enterprise site key and complete the local debug token workflow.",
        "APP_CHECK_REJECTED",
      );
    }
    if (request.canonicalJson.length > MAX_CLOUD_RESPONSE_BYTES) {
      throw new InferenceError("PAYLOAD_TOO_LARGE", "Authorized payload exceeds the cloud request limit.");
    }
    this.cloudBusy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), CLOUD_TIMEOUT_MS);
    try {
      await this.requireAppCheckToken();
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
      if (prompt !== request.outboundPrompt) {
        throw new InferenceError("DESTINATION_MISMATCH", "Outbound prompt changed after authorization.");
      }
      const result = await this.cloudModel.generateContent(prompt, { signal: controller.signal });
      return this.finishStructuredResult({
        kind: "mapping-proposal",
        text: result.response.text(),
        requestedMode: "ONLY_IN_CLOUD",
        reportedSource: result.response.inferenceSource,
        started,
        model: FIREBASE_AI_LOGIC_API.defaultCloudModel,
      });
    } catch (error) {
      const classified = this.classifyGenerateError(error, controller, CLOUD_TIMEOUT_MS);
      recordDiagnostic({
        kind: "cloud-inference",
        durationMs: Math.round(performance.now() - started),
        requestedMode: "ONLY_IN_CLOUD",
        retries: 0,
        errorCode: classified.code,
        schemaValid: false,
      });
      throw classified;
    } finally {
      clearTimeout(timer);
      this.cloudBusy = false;
    }
  }

  private async requireAppCheckToken(): Promise<void> {
    if (!this.appCheck) {
      throw new InferenceUnavailableError("App Check was not initialized.", "APP_CHECK_REJECTED");
    }
    try {
      const token = await getToken(this.appCheck, false);
      if (!token.token) {
        throw new InferenceError("APP_CHECK_REJECTED", "App Check returned an empty token.");
      }
    } catch (error) {
      const classified = classifyUnknownError(error);
      throw new InferenceError(
        "APP_CHECK_REJECTED",
        classified.message.includes("APP_CHECK")
          ? classified.message
          : `App Check did not authenticate this request. If you are on localhost, safelist the debug token from the browser console. ${classified.message}`,
      );
    }
  }

  private classifyGenerateError(error: unknown, controller: AbortController, timeoutMs: number): InferenceError {
    if (controller.signal.aborted && controller.signal.reason === "timeout") {
      return new InferenceError("TIMEOUT", timeoutErrorMessage(timeoutMs, false));
    }
    return classifyUnknownError(error);
  }

  private finishStructuredResult(input: {
    kind: StructuredOutputKind;
    text: string;
    requestedMode: "ONLY_ON_DEVICE" | "ONLY_IN_CLOUD";
    reportedSource: string | undefined;
    started: number;
    model: string;
  }): InferenceResult {
    if (input.text.length > MAX_CLOUD_RESPONSE_BYTES) {
      throw new InferenceError("PAYLOAD_TOO_LARGE", "Model response exceeded the size limit.");
    }
    const expected = expectedSourceForMode(input.requestedMode);
    const resolved = resolveReportedInferenceSource(input.reportedSource, expected);
    if (!resolved.ok) {
      throw new InferenceError(resolved.code, resolved.message);
    }
    let parsed: unknown;
    try {
      parsed = parseJsonObject(input.text);
    } catch {
      throw new InferenceError("INVALID_STRUCTURED_OUTPUT", "Model did not return JSON.");
    }
    const validation = validateStructuredOutput(input.kind, parsed);
    const provenance = {
      provider: "firebase-ai-logic" as const,
      requestedMode: input.requestedMode,
      actualSource: resolved.actualSource,
      inferenceSourceReported: true,
      model: input.model,
      simulated: false,
      schemaValid: validation.valid,
      durationMs: Math.round(performance.now() - input.started),
      retries: 0,
      resultKind: resolved.actualSource === "ON_DEVICE" ? ("real-on-device" as const) : ("real-cloud" as const),
    };
    recordDiagnostic({
      kind: input.kind === "field-interpretation" ? "on-device-inference" : "cloud-inference",
      durationMs: provenance.durationMs,
      requestedMode: input.requestedMode,
      actualSource: provenance.actualSource,
      retries: 0,
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
    assertLiveProvenance(provenance);
    return {
      text: input.text,
      structured: validation.value,
      provenance,
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
