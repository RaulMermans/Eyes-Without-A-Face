import { describe, expect, it } from "vitest";
import { parseAppConfig } from "../../src/config/env.ts";
import { raceAbort } from "../../src/inference/abort.ts";
import { classifyUnknownError, InferenceError } from "../../src/inference/errors.ts";
import {
  isRecoverableOnDeviceFailure,
  ON_DEVICE_USER_RETRY_LIMIT,
  shouldRetryCloudInference,
} from "../../src/inference/retry-policy.ts";

describe("Sprint 5 on-device failure classification", () => {
  it("classifies Chrome kError* failures as ON_DEVICE_RUNTIME_ERROR, not SDK_INIT_FAILED", () => {
    const error = classifyUnknownError(new Error("An unknown error occurred: kErrorUnknown"));
    expect(error.code).toBe("ON_DEVICE_RUNTIME_ERROR");
    expect(error.message).toContain("kErrorUnknown");
    expect(error.message).toContain("browser runtime failure");
  });

  it("keeps other unknown errors as SDK_INIT_FAILED", () => {
    expect(classifyUnknownError(new Error("something odd")).code).toBe("SDK_INIT_FAILED");
  });

  it("passes InferenceError through unchanged", () => {
    const original = new InferenceError("MODEL_UNAVAILABLE", "x");
    expect(classifyUnknownError(original)).toBe(original);
  });

  it("allows exactly one user-initiated retry, only for recoverable runtime/startup failures", () => {
    expect(ON_DEVICE_USER_RETRY_LIMIT).toBe(1);
    expect(isRecoverableOnDeviceFailure("ON_DEVICE_RUNTIME_ERROR")).toBe(true);
    expect(isRecoverableOnDeviceFailure("SDK_INIT_FAILED")).toBe(true);
    expect(isRecoverableOnDeviceFailure("TIMEOUT")).toBe(true);
    for (const code of ["MODEL_UNAVAILABLE", "UNSUPPORTED_BROWSER", "INVALID_STRUCTURED_OUTPUT", "PROVENANCE_MISMATCH", "IN_FLIGHT"] as const) {
      expect(isRecoverableOnDeviceFailure(code)).toBe(false);
    }
  });

  it("still never retries cloud inference", () => {
    expect(shouldRetryCloudInference("ON_DEVICE_RUNTIME_ERROR")).toBe(false);
    expect(shouldRetryCloudInference("TIMEOUT")).toBe(false);
  });
});

describe("Sprint 5 build revision", () => {
  it("accepts a stamped git sha and rejects anything else", () => {
    expect(parseAppConfig({ VITE_BUILD_SHA: "9a58928abcde" }).buildSha).toBe("9a58928abcde");
    expect(parseAppConfig({ VITE_BUILD_SHA: "9a58928abcde-dirty" }).buildSha).toBe("9a58928abcde-dirty");
    expect(parseAppConfig({ VITE_BUILD_SHA: "<script>" }).buildSha).toBe("");
    expect(parseAppConfig({}).buildSha).toBe("");
  });

  it("still blocks App Check debug mode in production builds", () => {
    const config = parseAppConfig({ PROD: true, MODE: "production", VITE_APP_CHECK_DEBUG: "true" });
    expect(config.appCheck.debugBlockedInProduction).toBe(true);
    expect(config.appCheckDebug).toBe(false);
  });
});

describe("raceAbort (Sprint 5: effective on-device timeout)", () => {
  it("rejects when the signal aborts even if the underlying promise never settles", async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => {});
    const raced = raceAbort(never, controller.signal);
    controller.abort("timeout");
    await expect(raced).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resolves with the value when the promise settles first", async () => {
    const controller = new AbortController();
    await expect(raceAbort(Promise.resolve("ok"), controller.signal)).resolves.toBe("ok");
  });

  it("propagates the original rejection", async () => {
    const controller = new AbortController();
    await expect(raceAbort(Promise.reject(new Error("kErrorUnknown")), controller.signal)).rejects.toThrow("kErrorUnknown");
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceAbort(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
