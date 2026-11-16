/**
 * Integration Intent Plan validator (ADR 0018). OWNER: Worker A.
 *
 * Judges a model plan against the approved 1.1.0 disclosure. Whole-plan
 * rejection only for structural problems (not JSON, schema-invalid,
 * executable content, prototype keys, wrong disclosure). Entry-level problems
 * reject or narrow only that entry (verdict per entry), so useful entries
 * survive. Nothing is repaired: an entry is never rewritten into a different
 * claim; a rejected translation leaves only the correspondence the model
 * stated, labelled `correspondence-only`.
 */
import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import type { PlanIssue, PlanValidation } from "./types.ts";

export const MAX_PLAN_TEXT_BYTES = 65_536;

export function parseIntentPlanText(text: string): { ok: true; value: unknown } | { ok: false; issues: PlanIssue[] } {
  void text;
  throw new Error("parseIntentPlanText: not implemented (Worker A)");
}

export function validateIntentPlan(raw: unknown, disclosure: CloudDisclosurePayload): PlanValidation {
  void raw;
  void disclosure;
  throw new Error("validateIntentPlan: not implemented (Worker A)");
}
