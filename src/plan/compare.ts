/**
 * Bounded plan repair: compare a revised plan with the accepted one (ADR 0018). OWNER: Worker D.
 * A revised plan never replaces a better one; equal is NOT_BETTER.
 */
import type { CompiledIntegration, PlanComparison } from "./types.ts";

export function comparePlans(before: CompiledIntegration, after: CompiledIntegration): PlanComparison {
  void before;
  void after;
  throw new Error("comparePlans: not implemented (Worker D)");
}
