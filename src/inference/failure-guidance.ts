/**
 * Provider-failure classification and guidance (Sprint 9, Workstream B2/B3).
 *
 * Maps every inference failure code to a user-facing category with three
 * answers: what happened, why it matters, what to do next. The raw provider
 * message is never part of the default text; callers may show it collapsed as
 * local technical detail.
 *
 * Recovery rules encoded here (they mirror AGENTS.md and are tested):
 *   - A consumed cloud approval is never reused. Recovery means a NEW request
 *     with a NEW approval, started by the user.
 *   - Nothing retries automatically, and nothing falls back from on-device to cloud.
 *   - The single revision budget is not reset by a failure.
 */
import type { InferenceErrorCode } from "./errors.ts";

export type FailureCategory =
  | "TIMEOUT"
  | "PROVIDER_OVERLOADED"
  | "RATE_LIMITED"
  | "APP_CHECK_REJECTED"
  | "INVALID_MODEL_RESPONSE"
  | "MODEL_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "NETWORK"
  | "ON_DEVICE_RUNTIME"
  | "CANCELLED"
  | "IN_FLIGHT"
  | "APPROVAL_INVALID"
  | "PROVENANCE_UNVERIFIED"
  | "UNKNOWN";

export type FailureStage = "cloud-mapping" | "cloud-revision" | "on-device";

/** What the user may do next. The UI renders only actions it actually implements. */
export type RecoveryAction =
  | "FRESH_CLOUD_REQUEST"
  | "MANUAL_CONTRACT"
  | "KEEP_INITIAL_MAPPING"
  | "EDIT_PROPOSAL_LOCALLY"
  | "RETRY_ON_DEVICE_ONCE"
  | "CONTINUE_DETERMINISTIC"
  | "WAIT_AND_TRY_LATER"
  | "CHECK_RUNTIME";

export interface FailureGuidance {
  category: FailureCategory;
  code: string;
  title: string;
  what: string;
  why: string;
  next: string[];
  actions: RecoveryAction[];
  /** True when the failed request had consumed an approval. It can never be reused. */
  approvalConsumed: boolean;
  /** True when the outcome at the provider is unknown (it may still have run). */
  ambiguousAtProvider: boolean;
}

const CATEGORY_BY_CODE: Partial<Record<InferenceErrorCode, FailureCategory>> = {
  TIMEOUT: "TIMEOUT",
  PROVIDER_OVERLOADED: "PROVIDER_OVERLOADED",
  RATE_LIMITED: "RATE_LIMITED",
  APP_CHECK_REJECTED: "APP_CHECK_REJECTED",
  INVALID_STRUCTURED_OUTPUT: "INVALID_MODEL_RESPONSE",
  EXECUTABLE_OUTPUT: "INVALID_MODEL_RESPONSE",
  PAYLOAD_TOO_LARGE: "INVALID_MODEL_RESPONSE",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  UNSUPPORTED_BROWSER: "MODEL_UNAVAILABLE",
  MISSING_CONFIG: "NOT_CONFIGURED",
  FEATURE_DISABLED: "NOT_CONFIGURED",
  INFERENCE_UNAVAILABLE: "NOT_CONFIGURED",
  INFERENCE_NOT_IMPLEMENTED: "NOT_CONFIGURED",
  NETWORK: "NETWORK",
  ON_DEVICE_RUNTIME_ERROR: "ON_DEVICE_RUNTIME",
  SDK_INIT_FAILED: "UNKNOWN",
  CANCELLED: "CANCELLED",
  IN_FLIGHT: "IN_FLIGHT",
  DISCLOSURE_REJECTED: "APPROVAL_INVALID",
  STALE_AUTHORIZATION: "APPROVAL_INVALID",
  DESTINATION_MISMATCH: "APPROVAL_INVALID",
  USER_REJECTED: "APPROVAL_INVALID",
  PROVENANCE_MISMATCH: "PROVENANCE_UNVERIFIED",
  PROVENANCE_UNVERIFIED: "PROVENANCE_UNVERIFIED",
  PROVENANCE_UNKNOWN: "PROVENANCE_UNVERIFIED",
  SIMULATED_RESULT: "PROVENANCE_UNVERIFIED",
};

export function failureCategory(code: string): FailureCategory {
  return CATEGORY_BY_CODE[code as InferenceErrorCode] ?? "UNKNOWN";
}

/** Next steps after a cloud failure, per stage. Never "retry automatically". */
function cloudNext(stage: FailureStage, retryable: boolean): { next: string[]; actions: RecoveryAction[] } {
  if (stage === "cloud-revision") {
    return {
      next: [
        "Your initial mapping and its Reality Check results are kept. You can still export it with its own status.",
        "The revision budget for this mapping is spent: the failed request counted. Nothing is retried.",
        "To ask again you would start a new cloud mapping request, which needs a new disclosure approval.",
      ],
      actions: ["KEEP_INITIAL_MAPPING", "EDIT_PROPOSAL_LOCALLY"],
    };
  }
  const next = retryable
    ? ["Prepare a fresh request: it rebuilds the same reviewed disclosure with a new request id. You review and approve it again before anything is sent."]
    : [];
  next.push("Or continue without the cloud: a hand-written contract over your local field names runs through the same Reality Check and is labeled manual.");
  return { next, actions: retryable ? ["FRESH_CLOUD_REQUEST", "MANUAL_CONTRACT"] : ["MANUAL_CONTRACT"] };
}

export function guidanceForFailure(input: { code: string; stage: FailureStage }): FailureGuidance {
  const category = failureCategory(input.code);
  const cloud = input.stage !== "on-device";
  const consumed = cloud && category !== "NOT_CONFIGURED" && category !== "APPROVAL_INVALID" && category !== "IN_FLIGHT";
  const base = { category, code: input.code, approvalConsumed: consumed, ambiguousAtProvider: category === "TIMEOUT" || category === "NETWORK" || category === "CANCELLED" };
  const usedApproval = consumed ? " The approval for this request has been used and cannot authorize another one." : "";

  if (input.stage === "on-device") {
    const onDevice: Record<string, Pick<FailureGuidance, "title" | "what" | "why">> = {
      ON_DEVICE_RUNTIME: {
        title: "The on-device model stopped",
        what: "Chrome's on-device model service failed while it was answering.",
        why: "This is a browser runtime failure, not a problem with your data. Nothing was sent to the cloud.",
      },
      TIMEOUT: {
        title: "The on-device model did not answer in time",
        what: "Gemini Nano did not respond within 90 s and its answer was discarded.",
        why: "Nothing was sent to the cloud. The deterministic profile is unaffected.",
      },
      MODEL_UNAVAILABLE: {
        title: "On-device AI is not available in this browser",
        what: "Chrome did not report a ready Gemini Nano model (missing Prompt API, download not finished, or unsupported hardware).",
        why: "The app never substitutes the cloud for on-device work. Profiling and the twin remain fully deterministic.",
      },
      NOT_CONFIGURED: {
        title: "On-device AI is not configured in this build",
        what: "This build has on-device inference disabled.",
        why: "Profiling and the twin remain deterministic and complete; only the optional role suggestions are missing.",
      },
    };
    const text = onDevice[category] ?? {
      title: "On-device interpretation failed",
      what: "The on-device step did not produce a usable answer.",
      why: "Nothing was sent to the cloud. The deterministic profile is unaffected.",
    };
    const retry = category === "ON_DEVICE_RUNTIME" || category === "TIMEOUT" || input.code === "SDK_INIT_FAILED";
    return {
      ...base,
      ...text,
      next: [
        ...(retry ? ["Retry once: Chrome restarts its model service on the next session. There is no automatic retry."] : []),
        "Continue without on-device suggestions: the twin and every later step work, labeled deterministic.",
      ],
      actions: retry ? ["RETRY_ON_DEVICE_ONCE", "CONTINUE_DETERMINISTIC"] : ["CONTINUE_DETERMINISTIC", "CHECK_RUNTIME"],
    };
  }

  const what = input.stage === "cloud-revision" ? "revision" : "mapping";
  switch (category) {
    case "TIMEOUT":
      return {
        ...base,
        title: `Gemini did not answer in time`,
        what: `No ${what} arrived within the 45 s limit.${usedApproval}`,
        why: "The request may still finish at the provider; any late answer is discarded. Long waits usually mean provider load, not a problem with your twin.",
        ...cloudNext(input.stage, true),
      };
    case "PROVIDER_OVERLOADED":
      return {
        ...base,
        title: "Gemini is overloaded right now",
        what: `The provider answered with a server error (high demand).${usedApproval}`,
        why: "This is on the provider's side and usually temporary. Nothing about your data or disclosure caused it.",
        ...(input.stage === "cloud-mapping"
          ? { next: ["Wait a minute, then prepare a fresh request; you review and approve it again before anything is sent.", ...cloudNext(input.stage, false).next], actions: ["WAIT_AND_TRY_LATER", "FRESH_CLOUD_REQUEST", "MANUAL_CONTRACT"] as RecoveryAction[] }
          : cloudNext(input.stage, true)),
      };
    case "RATE_LIMITED":
      return {
        ...base,
        title: "The project hit a rate or quota limit",
        what: `The provider refused the request because of a rate or quota limit.${usedApproval}`,
        why: "Requests are refused until the limit resets. Retrying immediately would fail the same way.",
        ...(input.stage === "cloud-mapping"
          ? { next: ["Wait for the limit to reset (the project owner can check Firebase AI Logic quotas), then prepare a fresh request; you approve it again before anything is sent.", ...cloudNext(input.stage, false).next], actions: ["WAIT_AND_TRY_LATER", "FRESH_CLOUD_REQUEST", "MANUAL_CONTRACT"] as RecoveryAction[] }
          : cloudNext(input.stage, true)),
      };
    case "APP_CHECK_REJECTED":
      return {
        ...base,
        title: "App Check refused this app",
        what: `Firebase App Check did not attest this page, so the request was refused.${usedApproval}`,
        why: "The project accepts cloud requests only from an attested app on an approved domain. This protects the project from misuse; it is not disabled to make a request pass.",
        next: [
          "Open the app from its approved domain in a normal Chrome window (automated browsers score low).",
          "On localhost, a registered App Check debug token is required (see docs/setup/app-check.md).",
          ...cloudNext(input.stage, false).next,
        ],
        actions: ["CHECK_RUNTIME", "MANUAL_CONTRACT"],
      };
    case "INVALID_MODEL_RESPONSE":
      return {
        ...base,
        title: `Gemini's answer was not a valid ${what}`,
        what: `The response failed the strict response check and was rejected. It was not repaired.${usedApproval}`,
        why: "Only declarative operations from the eight-operation allowlist can run. Invalid or executable output is never executed or fixed silently.",
        ...cloudNext(input.stage, true),
      };
    case "MODEL_UNAVAILABLE":
      return {
        ...base,
        title: "The cloud model is unavailable",
        what: `The configured Gemini model could not be used.${usedApproval}`,
        why: "No other model is substituted automatically.",
        ...cloudNext(input.stage, true),
      };
    case "NOT_CONFIGURED":
      return {
        ...base,
        title: "Cloud Gemini is not configured in this build",
        what: "This build has no usable cloud inference configuration, so nothing was sent.",
        why: "Missing configuration never triggers a request. Your approval was not used.",
        next: ["Continue with a hand-written contract (labeled manual), or run a build with Firebase configured."],
        actions: ["MANUAL_CONTRACT"],
      };
    case "NETWORK":
      return {
        ...base,
        title: "The connection to the provider failed",
        what: `The request did not complete because of a network error.${usedApproval}`,
        why: "The request may or may not have reached the provider; any answer is discarded.",
        ...cloudNext(input.stage, true),
      };
    case "CANCELLED":
      return {
        ...base,
        title: "You stopped waiting",
        what: `The app stopped waiting for this ${what}.${usedApproval}`,
        why: "The provider may still finish the request; its answer will be discarded and never shown as a result.",
        ...cloudNext(input.stage, true),
      };
    case "IN_FLIGHT":
      return {
        ...base,
        title: "A previous request is still running",
        what: "The app is still waiting for an earlier cloud request, so this one was not sent.",
        why: "One cloud request at a time keeps approvals and results unambiguous.",
        next: ["Wait for the earlier request to finish or time out (at most 45 s), then try again."],
        actions: ["WAIT_AND_TRY_LATER"],
      };
    case "APPROVAL_INVALID":
      return {
        ...base,
        title: "The approval no longer matches the request",
        what: "The disclosure gate refused the request: the approval was stale, already used, or bound to a different prompt.",
        why: "Approval is single-use and bound to the exact prompt and destination. Nothing was sent.",
        ...(input.stage === "cloud-revision"
          ? cloudNext(input.stage, false)
          : { next: ["Go back to Disclosure Review, rebuild the preview and approve it again."], actions: ["FRESH_CLOUD_REQUEST"] as RecoveryAction[] }),
      };
    case "PROVENANCE_UNVERIFIED":
      return {
        ...base,
        title: "The answer's origin could not be verified",
        what: `The response did not prove it came from the cloud model, so it was discarded.${usedApproval}`,
        why: "The app never presents output as Gemini's unless the provider reports it.",
        ...cloudNext(input.stage, true),
      };
    default:
      return {
        ...base,
        title: "The cloud request failed",
        what: `The request did not produce a ${what}.${usedApproval}`,
        why: "The failure is not one of the known provider conditions. Nothing was retried.",
        ...cloudNext(input.stage, true),
      };
  }
}
