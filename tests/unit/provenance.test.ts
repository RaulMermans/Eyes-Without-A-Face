import { describe, expect, it } from "vitest";
import { InferenceError } from "../../src/inference/errors.ts";
import {
  assertLiveProvenance,
  resolveReportedInferenceSource,
} from "../../src/inference/provenance.ts";
import type { InferenceProvenance } from "../../src/inference/types.ts";

function provenance(overrides: Partial<InferenceProvenance>): InferenceProvenance {
  return {
    provider: "firebase-ai-logic",
    requestedMode: "ONLY_IN_CLOUD",
    actualSource: "IN_CLOUD",
    inferenceSourceReported: true,
    model: "gemini-3.5-flash-lite",
    simulated: false,
    schemaValid: true,
    durationMs: 10,
    retries: 0,
    resultKind: "real-cloud",
    ...overrides,
  };
}

describe("inference provenance", () => {
  it("confirms ON_DEVICE only from a reported SDK source", () => {
    expect(resolveReportedInferenceSource("on_device", "ON_DEVICE")).toEqual({
      ok: true,
      actualSource: "ON_DEVICE",
      inferenceSourceReported: true,
    });
  });

  it("confirms IN_CLOUD only from a reported SDK source", () => {
    expect(resolveReportedInferenceSource("in_cloud", "IN_CLOUD")).toEqual({
      ok: true,
      actualSource: "IN_CLOUD",
      inferenceSourceReported: true,
    });
  });

  it("rejects missing provenance instead of inferring the requested mode", () => {
    const result = resolveReportedInferenceSource(undefined, "IN_CLOUD");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROVENANCE_UNVERIFIED");
    }
  });

  it("rejects unknown provenance values", () => {
    const result = resolveReportedInferenceSource("somewhere_else", "IN_CLOUD");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROVENANCE_UNKNOWN");
    }
  });

  it("rejects incorrect provenance", () => {
    const result = resolveReportedInferenceSource("on_device", "IN_CLOUD");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROVENANCE_MISMATCH");
    }
  });

  it("rejects a simulated result presented as live", () => {
    expect(() =>
      assertLiveProvenance(
        provenance({
          provider: "test-harness",
          simulated: true,
          actualSource: "TEST",
          resultKind: "simulated-test",
        }),
      ),
    ).toThrow(InferenceError);
    expect(() =>
      assertLiveProvenance(
        provenance({
          simulated: true,
          resultKind: "real-cloud",
        }),
      ),
    ).toThrow(/simulated/i);
  });
});
