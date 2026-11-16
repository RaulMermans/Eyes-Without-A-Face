/**
 * Deterministic Intent Plan compiler (ADR 0018). OWNER: Worker B.
 *
 * ValidatedIntentPlan + the user's answers → CompiledIntegration.
 * Gemini-authored operations are compiled into a Mapping Proposal and passed
 * through the UNCHANGED `convertProposal` gate. User-declared operations come
 * only from the user's explicit answers. No default is ever filled, no label
 * is ever translated by similarity, and no second engine exists: execution is
 * `resolveAliases` → `executeMapping` as today.
 */
import type { CloudDisclosurePayload } from "../domain/contracts/types.ts";
import type { AcceptProposalResult, PreparedTwin } from "../workflow/pipeline.ts";
import type { CompiledIntegration, PlanAnswers, ValidatedIntentPlan } from "./types.ts";

export interface CompileInput {
  validated: ValidatedIntentPlan;
  /** The approved 1.1.0 disclosure the plan answered. */
  disclosure: CloudDisclosurePayload;
  prepared: PreparedTwin;
  /** Imported records (local only), for label lists and evidence. */
  records: readonly unknown[];
  answers: PlanAnswers;
  requestId: string;
}

export function compileIntentPlan(input: CompileInput): CompiledIntegration {
  void input;
  throw new Error("compileIntentPlan: not implemented (Worker B)");
}

/**
 * The acceptance record stored as `ProposalState.result` for a plan: ok with
 * converted (alias contract) + resolved (executable) when at least one field
 * is executable; otherwise a `stage: "plan"` refusal that names why. Never
 * calls a planning artifact an integration.
 */
export function acceptCompiledPlan(compiled: CompiledIntegration, input: CompileInput): AcceptProposalResult {
  void compiled;
  void input;
  throw new Error("acceptCompiledPlan: not implemented (Worker B)");
}
