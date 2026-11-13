/**
 * REL-010…013 — runtime preflight (Sprint 9, B4): configuration is never
 * reported as provider availability; VERIFIED needs a real result.
 */
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "../../src/config/env.ts";
import type { DiagnosticEvent } from "../../src/inference/diagnostics.ts";
import { runtimePreflight, type PreflightRow } from "../../src/inference/preflight.ts";
import type { OnDeviceCapability } from "../../src/inference/types.ts";

const configured = parseAppConfig({
  VITE_FIREBASE_API_KEY: "public-web-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo",
  VITE_FIREBASE_APP_ID: "1:1:web:abc",
  VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
  VITE_ENABLE_CLOUD_INFERENCE: "true",
  VITE_FIREBASE_APP_CHECK_SITE_KEY: "6LfREALISTIC_PUBLIC_SITE_KEY_000000000000",
});
const chrome = (availability: string | null, version = "157.0.0.0"): OnDeviceCapability => ({
  chromeVersion: version,
  promptApi: availability === null ? "missing" : "available",
  languageModelAvailability: availability,
  guidance: "probe",
});
const status = (rows: PreflightRow[], id: PreflightRow["id"]) => rows.find((row) => row.id === id)?.status;
const event = (kind: DiagnosticEvent["kind"], actualSource: string, simulated = false, errorCode?: string): DiagnosticEvent => ({ at: "t", kind, actualSource, simulated, errorCode });

describe("REL-010 preflight without any configuration", () => {
  it("reports AI as unavailable and never simulated", () => {
    const rows = runtimePreflight({ config: parseAppConfig({}), capability: chrome(null), harness: false, diagnostics: [] });
    expect(status(rows, "firebase")).toBe("UNAVAILABLE");
    expect(status(rows, "on-device")).toBe("UNAVAILABLE");
    expect(status(rows, "cloud")).toBe("UNAVAILABLE");
    expect(rows.find((row) => row.id === "cloud")?.detail).toContain("hand-written contract");
  });
});

describe("REL-011 configured is not available", () => {
  it("a fully configured build is CONFIGURED for cloud and App Check until a real result arrives", () => {
    const rows = runtimePreflight({ config: configured, capability: chrome("available"), harness: false, diagnostics: [] });
    expect(status(rows, "firebase")).toBe("CONFIGURED");
    expect(status(rows, "app-check")).toBe("CONFIGURED");
    expect(status(rows, "cloud")).toBe("CONFIGURED");
    expect(status(rows, "on-device")).toBe("AVAILABLE");
    expect(rows.find((row) => row.id === "cloud")?.detail).toContain("Not contacted");
  });

  it("only a real, unsimulated, successful result makes it VERIFIED", () => {
    const verified = runtimePreflight({ config: configured, capability: chrome("available"), harness: false, diagnostics: [event("cloud-inference", "IN_CLOUD"), event("on-device-inference", "ON_DEVICE")] });
    expect(status(verified, "cloud")).toBe("VERIFIED");
    expect(status(verified, "app-check")).toBe("VERIFIED");
    expect(status(verified, "on-device")).toBe("VERIFIED");
    const simulated = runtimePreflight({ config: configured, capability: chrome("available"), harness: false, diagnostics: [event("cloud-inference", "IN_CLOUD", true)] });
    expect(status(simulated, "cloud")).toBe("CONFIGURED");
    const failed = runtimePreflight({ config: configured, capability: chrome("available"), harness: false, diagnostics: [event("cloud-inference", "IN_CLOUD", false, "INVALID_STRUCTURED_OUTPUT")] });
    expect(status(failed, "cloud")).toBe("CONFIGURED");
  });
});

describe("REL-012 local runtime states", () => {
  it("a model still to download is UNVERIFIED; an old browser is UNAVAILABLE", () => {
    expect(status(runtimePreflight({ config: configured, capability: chrome("downloadable"), harness: false, diagnostics: [] }), "on-device")).toBe("UNVERIFIED");
    const old = runtimePreflight({ config: configured, capability: chrome(null, "120.0.0.0"), harness: false, diagnostics: [] });
    expect(status(old, "browser")).toBe("UNAVAILABLE");
    expect(status(old, "on-device")).toBe("UNAVAILABLE");
  });

  it("App Check debug in a production build is UNAVAILABLE, and so is the cloud", () => {
    const config = parseAppConfig({ ...{ VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_AUTH_DOMAIN: "d", VITE_FIREBASE_PROJECT_ID: "demo", VITE_FIREBASE_APP_ID: "a" }, VITE_ENABLE_CLOUD_INFERENCE: "true", VITE_FIREBASE_APP_CHECK_SITE_KEY: "6LfREALISTIC_PUBLIC_SITE_KEY_000000000000", VITE_APP_CHECK_DEBUG: "true", MODE: "production", PROD: "true" });
    const rows = runtimePreflight({ config, capability: chrome("available"), harness: false, diagnostics: [] });
    expect(status(rows, "app-check")).toBe("UNAVAILABLE");
    expect(status(rows, "cloud")).toBe("UNAVAILABLE");
  });
});

describe("REL-013 the test harness is labeled, never verified", () => {
  it("reports UNVERIFIED with a simulated label even after simulated results", () => {
    const rows = runtimePreflight({ config: configured, capability: chrome("available"), harness: true, diagnostics: [event("cloud-inference", "IN_CLOUD")] });
    expect(status(rows, "cloud")).toBe("UNVERIFIED");
    expect(status(rows, "on-device")).toBe("UNVERIFIED");
    expect(rows.find((row) => row.id === "cloud")?.detail).toContain("Simulated test adapter");
  });
});
