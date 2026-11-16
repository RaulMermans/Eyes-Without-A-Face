/**
 * Failure classification and next actions (ADR 0018). OWNER: Worker D.
 */
import type { ClassifiedFailure, FailureCategory, NextAction, PlanIssue } from "./types.ts";

export function nextActionFor(category: FailureCategory): NextAction {
  void category;
  throw new Error("nextActionFor: not implemented (Worker D)");
}

export function classifyPlanIssue(issue: PlanIssue): ClassifiedFailure {
  void issue;
  throw new Error("classifyPlanIssue: not implemented (Worker D)");
}
