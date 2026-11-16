/**
 * Initial planner prompt v5: Integration Intent Plan (ADR 0018). OWNER: Worker A.
 *
 * Applies to initial (cloud-disclosure 1.1.0) requests only. The frozen
 * `prompts.ts` (`MAPPING_PROPOSAL_INSTRUCTIONS`, `buildCloudPromptText`) is
 * untouched so historical replays still rebuild their recorded prompts.
 */
export const INTENT_PLAN_PROMPT_VERSION = "5";

/** Fixed instruction text. Nothing is interpolated except the canonical payload. */
export const INTENT_PLAN_INSTRUCTIONS = "Approved disclosure payload:";

export function buildIntentPlanPromptText(canonicalDisclosureJson: string): string {
  return `${INTENT_PLAN_INSTRUCTIONS}\n${canonicalDisclosureJson}`;
}

/** True when an outbound application prompt was built by `buildIntentPlanPromptText`. */
export function isIntentPlanRequest(outboundPrompt: string): boolean {
  void outboundPrompt;
  throw new Error("isIntentPlanRequest: not implemented (Worker A)");
}
