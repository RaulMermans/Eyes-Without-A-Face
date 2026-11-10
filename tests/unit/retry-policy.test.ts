import { describe, expect, it } from "vitest";
import {
  CLOUD_AUTOMATIC_RETRY_LIMIT,
  isAmbiguousCloudOutcome,
  shouldRetryCloudInference,
} from "../../src/inference/retry-policy.ts";

describe("cloud retry policy", () => {
  it("does not automatically retry any cloud error", () => {
    expect(CLOUD_AUTOMATIC_RETRY_LIMIT).toBe(0);
    expect(shouldRetryCloudInference("TIMEOUT")).toBe(false);
    expect(shouldRetryCloudInference("NETWORK")).toBe(false);
    expect(shouldRetryCloudInference("APP_CHECK_REJECTED")).toBe(false);
  });

  it("treats timeouts and cancellations as ambiguous submissions", () => {
    expect(isAmbiguousCloudOutcome("TIMEOUT")).toBe(true);
    expect(isAmbiguousCloudOutcome("CANCELLED")).toBe(true);
    expect(isAmbiguousCloudOutcome("NETWORK")).toBe(true);
    expect(isAmbiguousCloudOutcome("INVALID_STRUCTURED_OUTPUT")).toBe(false);
  });
});
