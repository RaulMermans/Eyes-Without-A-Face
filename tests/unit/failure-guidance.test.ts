/**
 * REL-001…006 — provider failure classification and recovery guidance (Sprint 9, B2/B3).
 */
import { describe, expect, it } from "vitest";
import { classifyUnknownError, type InferenceErrorCode } from "../../src/inference/errors.ts";
import { failureCategory, guidanceForFailure } from "../../src/inference/failure-guidance.ts";
import { shouldRetryCloudInference, CLOUD_AUTOMATIC_RETRY_LIMIT } from "../../src/inference/retry-policy.ts";

/** Verbatim provider message recorded in docs/evidence/sprint-8/live-semantic-benchmark.json (project path shortened). */
const SPRINT8_HIGH_DEMAND =
  "AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/gemini-3.5-flash-lite:generateContent: [500 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again";

describe("REL-001 provider errors are classified by what happened", () => {
  it("the recorded Sprint 8 '500 high demand' is PROVIDER_OVERLOADED, not NETWORK", () => {
    expect(classifyUnknownError(new Error(SPRINT8_HIGH_DEMAND)).code).toBe("PROVIDER_OVERLOADED");
  });

  it.each([
    ["AI: Error fetching from https://x/generateContent: [429 ] Resource has been exhausted (e.g. check quota).", "RATE_LIMITED"],
    ["RESOURCE_EXHAUSTED: Quota exceeded for quota metric", "RATE_LIMITED"],
    ["AI: Error fetching from https://x: [503 ] The service is currently unavailable.", "PROVIDER_OVERLOADED"],
    ["AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.", "APP_CHECK_REJECTED"],
    ["TypeError: Failed to fetch", "NETWORK"],
    ["The operation timed out", "TIMEOUT"],
    ["An unknown error occurred: kErrorUnknown", "ON_DEVICE_RUNTIME_ERROR"],
    ["AbortError: signal is aborted without reason", "CANCELLED"],
  ])("%s → %s", (message, code) => {
    expect(classifyUnknownError(new Error(message)).code).toBe(code);
  });
});

const CLOUD_CODES: InferenceErrorCode[] = [
  "TIMEOUT",
  "PROVIDER_OVERLOADED",
  "RATE_LIMITED",
  "APP_CHECK_REJECTED",
  "INVALID_STRUCTURED_OUTPUT",
  "EXECUTABLE_OUTPUT",
  "MODEL_UNAVAILABLE",
  "MISSING_CONFIG",
  "NETWORK",
  "CANCELLED",
  "IN_FLIGHT",
  "DISCLOSURE_REJECTED",
  "PROVENANCE_UNVERIFIED",
  "SDK_INIT_FAILED",
];

describe("REL-002 every failure answers what / why / what next, without raw provider text", () => {
  it.each(CLOUD_CODES)("%s", (code) => {
    for (const stage of ["cloud-mapping", "cloud-revision"] as const) {
      const guidance = guidanceForFailure({ code, stage });
      expect(guidance.title.length).toBeGreaterThan(5);
      expect(guidance.what.length).toBeGreaterThan(10);
      expect(guidance.why.length).toBeGreaterThan(10);
      expect(guidance.next.length).toBeGreaterThan(0);
      expect(JSON.stringify(guidance)).not.toMatch(/googleapis|firebasevertexai|\[500|projects\//);
    }
  });

  it("the required categories are distinct", () => {
    const categories = new Set(["TIMEOUT", "PROVIDER_OVERLOADED", "RATE_LIMITED", "APP_CHECK_REJECTED", "INVALID_STRUCTURED_OUTPUT", "MODEL_UNAVAILABLE", "ON_DEVICE_RUNTIME_ERROR", "CANCELLED"].map(failureCategory));
    expect(categories.size).toBe(8);
  });
});

describe("REL-003 recovery never reuses an approval and never retries on its own", () => {
  it("a sent cloud request's approval is reported consumed; configuration failures consume nothing", () => {
    expect(guidanceForFailure({ code: "TIMEOUT", stage: "cloud-mapping" })).toMatchObject({ approvalConsumed: true, ambiguousAtProvider: true });
    expect(guidanceForFailure({ code: "PROVIDER_OVERLOADED", stage: "cloud-mapping" }).approvalConsumed).toBe(true);
    expect(guidanceForFailure({ code: "MISSING_CONFIG", stage: "cloud-mapping" }).approvalConsumed).toBe(false);
    expect(guidanceForFailure({ code: "DISCLOSURE_REJECTED", stage: "cloud-mapping" }).approvalConsumed).toBe(false);
  });

  it("the fresh-request recovery always means a new approval; nothing says retry automatically", () => {
    for (const code of CLOUD_CODES) {
      const guidance = guidanceForFailure({ code, stage: "cloud-mapping" });
      if (guidance.actions.includes("FRESH_CLOUD_REQUEST")) expect(guidance.next.join(" ")).toMatch(/approve it again|approve it|approve/i);
      expect(guidance.next.join(" ")).not.toMatch(/retrying automatically|will retry/i);
    }
    for (const code of [...CLOUD_CODES, "PROVIDER_OVERLOADED", "RATE_LIMITED"] as InferenceErrorCode[]) expect(shouldRetryCloudInference(code)).toBe(false);
    expect(CLOUD_AUTOMATIC_RETRY_LIMIT).toBe(0);
  });

  it("a failed revision never offers another revision: the single budget is not reset", () => {
    for (const code of CLOUD_CODES) {
      const guidance = guidanceForFailure({ code, stage: "cloud-revision" });
      expect(guidance.actions).not.toContain("FRESH_CLOUD_REQUEST");
      if (guidance.category !== "IN_FLIGHT" && guidance.category !== "APPROVAL_INVALID" && guidance.category !== "NOT_CONFIGURED" && guidance.category !== "APP_CHECK_REJECTED") {
        expect(guidance.next.join(" ")).toContain("budget for this mapping is spent");
      }
    }
  });

  it("on-device failures never point to the cloud", () => {
    for (const code of ["ON_DEVICE_RUNTIME_ERROR", "TIMEOUT", "MODEL_UNAVAILABLE", "UNSUPPORTED_BROWSER", "MISSING_CONFIG", "SDK_INIT_FAILED"]) {
      const guidance = guidanceForFailure({ code, stage: "on-device" });
      expect(guidance.actions.some((action) => action === "FRESH_CLOUD_REQUEST" || action === "MANUAL_CONTRACT")).toBe(false);
      expect(guidance.approvalConsumed).toBe(false);
      expect(`${guidance.why} ${guidance.next.join(" ")}`).not.toMatch(/send .*cloud|use the cloud instead/i);
    }
  });
});
