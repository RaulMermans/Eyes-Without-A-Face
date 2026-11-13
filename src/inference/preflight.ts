/**
 * Runtime capability preflight (Sprint 9, Workstream B4).
 *
 * Reports what this browser and build can do WITHOUT sending anything: no
 * cloud request, no App Check token exchange, no model download. Statuses:
 *
 *   CONFIGURED  the build has what the feature needs; not exercised yet
 *   AVAILABLE   the local runtime reports the capability ready
 *   VERIFIED    a real result was observed in this session
 *   UNAVAILABLE missing, disabled or refused
 *   UNVERIFIED  cannot be known without acting (e.g. a model still to download),
 *               or a simulated test adapter is active
 *
 * Configuration readiness is never presented as provider availability.
 */
import type { AppConfig } from "../config/env.ts";
import type { DiagnosticEvent } from "./diagnostics.ts";
import { FIREBASE_AI_LOGIC_API, type OnDeviceCapability } from "./types.ts";

export type PreflightStatus = "CONFIGURED" | "AVAILABLE" | "VERIFIED" | "UNAVAILABLE" | "UNVERIFIED";

export interface PreflightRow {
  id: "browser" | "on-device" | "firebase" | "app-check" | "cloud";
  label: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightInput {
  config: AppConfig;
  capability: OnDeviceCapability | null;
  /** True when the labeled test harness replaces the live adapters. */
  harness: boolean;
  diagnostics: readonly DiagnosticEvent[];
}

export const PREFLIGHT_LIMITATIONS = [
  "Provider availability is never tested automatically: the preflight sends no cloud request, so a CONFIGURED cloud can still be overloaded or rate-limited.",
  "App Check is attested on the first approved request; only the approved Hosting domains are on the reCAPTCHA allowlist (preview channels are not).",
  "On-device AI needs desktop Chrome with the Prompt API and a downloaded Gemini Nano model; without it the workflow stays deterministic, never cloud.",
];

function observed(diagnostics: readonly DiagnosticEvent[], kind: DiagnosticEvent["kind"], source: string): boolean {
  return diagnostics.some((event) => event.kind === kind && event.actualSource === source && !event.errorCode && event.simulated === false);
}

export function runtimePreflight(input: PreflightInput): PreflightRow[] {
  const { config, capability, harness, diagnostics } = input;
  const major = capability?.chromeVersion ? Number.parseInt(capability.chromeVersion, 10) : Number.NaN;
  const chromeOk = Number.isFinite(major) && major >= FIREBASE_AI_LOGIC_API.minChrome;
  const rows: PreflightRow[] = [];

  rows.push({
    id: "browser",
    label: "Browser",
    status: capability === null ? "UNVERIFIED" : chromeOk ? "AVAILABLE" : "UNAVAILABLE",
    detail:
      capability === null
        ? "Not probed yet."
        : chromeOk
          ? `Chrome ${capability.chromeVersion}: supports the on-device path. Every other step runs in any modern browser.`
          : `On-device AI needs desktop Chrome ${FIREBASE_AI_LOGIC_API.minChrome}+ (${capability.chromeVersion ? `found ${capability.chromeVersion}` : "Chrome not detected"}). Every other step works here.`,
  });

  if (harness) {
    rows.push({ id: "on-device", label: "On-device model (Gemini Nano)", status: "UNVERIFIED", detail: "Test harness active: on-device results are simulated and labeled as such." });
  } else if (config.onDevice.state !== "configured") {
    rows.push({ id: "on-device", label: "On-device model (Gemini Nano)", status: "UNAVAILABLE", detail: "Disabled in this build. Profiling and the twin stay deterministic." });
  } else if (observed(diagnostics, "on-device-inference", "ON_DEVICE")) {
    rows.push({ id: "on-device", label: "On-device model (Gemini Nano)", status: "VERIFIED", detail: "A real ON_DEVICE result was received in this session." });
  } else if (capability === null) {
    rows.push({ id: "on-device", label: "On-device model (Gemini Nano)", status: "UNVERIFIED", detail: "Probing the local runtime…" });
  } else {
    const availability = capability.languageModelAvailability;
    rows.push({
      id: "on-device",
      label: "On-device model (Gemini Nano)",
      status: availability === "available" ? "AVAILABLE" : availability === "downloadable" || availability === "downloading" ? "UNVERIFIED" : "UNAVAILABLE",
      detail: capability.guidance,
    });
  }

  rows.push({
    id: "firebase",
    label: "Firebase configuration",
    status: config.firebase ? "CONFIGURED" : "UNAVAILABLE",
    detail: config.firebase
      ? `Public web config present for project ${config.firebase.projectId}.`
      : `${config.missingFirebaseKeys.length} public config value(s) missing. The app runs fully without them; AI steps stay unavailable, never simulated.`,
  });

  const cloudVerified = !harness && observed(diagnostics, "cloud-inference", "IN_CLOUD");
  rows.push({
    id: "app-check",
    label: "App Check",
    status: harness
      ? "UNVERIFIED"
      : config.appCheck.debugBlockedInProduction || !config.appCheck.readyForCloud
        ? "UNAVAILABLE"
        : cloudVerified
          ? "VERIFIED"
          : "CONFIGURED",
    detail: harness
      ? "Test harness active: no App Check token is requested."
      : cloudVerified
        ? "A real cloud response was accepted in this session, so attestation succeeded."
        : config.appCheck.readyForCloud
          ? `${config.appCheck.label}. A token is requested only with the first approved request.`
          : config.appCheck.label,
  });

  rows.push({
    id: "cloud",
    label: "Cloud inference (Gemini)",
    status: harness
      ? "UNVERIFIED"
      : config.cloud.state !== "configured" || !config.appCheck.readyForCloud
        ? "UNAVAILABLE"
        : cloudVerified
          ? "VERIFIED"
          : "CONFIGURED",
    detail: harness
      ? "Test harness active: cloud results are simulated and labeled \"Simulated test adapter — not Gemini\"."
      : cloudVerified
        ? "A real IN_CLOUD result was received in this session."
        : config.cloud.state === "configured" && config.appCheck.readyForCloud
          ? `ONLY_IN_CLOUD with ${FIREBASE_AI_LOGIC_API.defaultCloudModel}. Not contacted: nothing is sent before you approve a request.`
          : "Not configured in this build. You can still finish with a hand-written contract, labeled manual.",
  });
  return rows;
}
