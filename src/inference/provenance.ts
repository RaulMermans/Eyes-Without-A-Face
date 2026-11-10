import { InferenceError } from "./errors.ts";
import type { ActualInferenceSource, InferenceProvenance, RequestedInferenceMode } from "./types.ts";

export const REPORTED_ON_DEVICE = new Set(["on_device", "ON_DEVICE"]);
export const REPORTED_IN_CLOUD = new Set(["in_cloud", "IN_CLOUD"]);

export type ConfirmedInferenceSource = "ON_DEVICE" | "IN_CLOUD";

export type ProvenanceResolution =
  | { ok: true; actualSource: ConfirmedInferenceSource; inferenceSourceReported: true }
  | {
      ok: false;
      code: "PROVENANCE_UNVERIFIED" | "PROVENANCE_UNKNOWN" | "PROVENANCE_MISMATCH";
      message: string;
    };

export function expectedSourceForMode(mode: RequestedInferenceMode): ConfirmedInferenceSource {
  return mode === "ONLY_ON_DEVICE" ? "ON_DEVICE" : "IN_CLOUD";
}

export function parseReportedInferenceSource(
  reported: string | undefined | null,
): ConfirmedInferenceSource | "unknown" | "missing" {
  if (reported === undefined || reported === null || reported.trim() === "") {
    return "missing";
  }
  if (REPORTED_ON_DEVICE.has(reported)) {
    return "ON_DEVICE";
  }
  if (REPORTED_IN_CLOUD.has(reported)) {
    return "IN_CLOUD";
  }
  return "unknown";
}

/**
 * Provenance is taken only from the SDK response. Requested mode is never used
 * as a substitute for a missing inferenceSource.
 */
export function resolveReportedInferenceSource(
  reported: string | undefined | null,
  expected: ConfirmedInferenceSource,
): ProvenanceResolution {
  const parsed = parseReportedInferenceSource(reported);
  if (parsed === "missing") {
    return {
      ok: false,
      code: "PROVENANCE_UNVERIFIED",
      message: "SDK response did not include inferenceSource. Provenance cannot be claimed from the requested mode.",
    };
  }
  if (parsed === "unknown") {
    return {
      ok: false,
      code: "PROVENANCE_UNKNOWN",
      message: `SDK reported unrecognized inferenceSource ${JSON.stringify(reported)}.`,
    };
  }
  if (parsed !== expected) {
    return {
      ok: false,
      code: "PROVENANCE_MISMATCH",
      message: `Requested ${expected} but SDK reported ${parsed}.`,
    };
  }
  return { ok: true, actualSource: parsed, inferenceSourceReported: true };
}

export function assertLiveProvenance(provenance: InferenceProvenance): void {
  if (provenance.simulated || provenance.provider === "test-harness" || provenance.resultKind === "simulated-test") {
    throw new InferenceError(
      "SIMULATED_RESULT",
      "A simulated result cannot be presented as live Firebase inference.",
    );
  }
  if (provenance.actualSource === "TEST" || provenance.actualSource === "UNAVAILABLE" || provenance.actualSource === "FAILED") {
    throw new InferenceError(
      "PROVENANCE_UNVERIFIED",
      `Live adapters cannot claim actualSource=${provenance.actualSource}.`,
    );
  }
  if (!provenance.inferenceSourceReported) {
    throw new InferenceError("PROVENANCE_UNVERIFIED", "Live provenance requires a reported inferenceSource.");
  }
}

export function confirmedSourceLabel(source: ActualInferenceSource): string {
  return source;
}
