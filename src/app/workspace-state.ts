import destinationSchema from "../examples/crm/destination.schema.json" with { type: "json" };
import mappingContract from "../examples/crm/mapping-contract.json" with { type: "json" };
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../phantom/generate.ts";
import type { DisclosureApproval, DisclosurePreview } from "../twin/authorization.ts";
import type { InferenceProvenance } from "../inference/types.ts";
import type { ProposalOrigin } from "../proposal/convert.ts";
import type { AcceptProposalResult } from "../workflow/pipeline.ts";
import type { RealityCheckReport } from "../verification/reality-check.ts";
import type { ImportedSource } from "./source-import.ts";
import type { BlindRevisionFeedback } from "../domain/contracts/types.ts";
import type { ExcludedIssue } from "../revision/feedback.ts";
import type { RevisionBlockCode, RevisionPhase } from "../revision/run.ts";
import type { MappingEvaluation } from "../evaluation/evaluate.ts";
import type { AcceptancePolicy, ExpectedOutcome } from "../verification/outcomes.ts";
import type { SemanticConstraint } from "../semantics/contract.ts";
import type { DateInputFormat } from "../domain/profile/profile.ts";
import type { RevisionDecision } from "../revision/decision.ts";
import type { SemanticWithheld } from "../revision/semantic-feedback.ts";
import { isLocalMapping, type CategoryMeaning, type FieldMatch } from "./guided/field-plan.ts";
import { summarizeDestination } from "./guided/destinations.ts";

export interface ReviewState {
  preview: DisclosurePreview;
  approval: DisclosureApproval | null;
  status: "pending" | "approved" | "rejected" | "sent";
  /** Display notes about the destination description (e.g. dropped keywords). Local only. */
  targetNotes?: string[];
}

export interface ProposalState {
  origin: ProposalOrigin;
  /** Text exactly as received from the adapter (or as edited locally). */
  text: string;
  provenance: InferenceProvenance | null;
  requestId: string;
  result: AcceptProposalResult;
}

export type MappingChoice = "proposal" | "manual";

/**
 * Local-only evaluation context of a loaded fictional scenario: its acceptance
 * policy, ground truth for imported + revision-feedback cases, and the final
 * holdout cases. Never profiled, disclosed, or used to build feedback.
 */
export interface ScenarioContext {
  id: string;
  title: string;
  policy: AcceptancePolicy;
  /** Ground truth aligned with [imported..., revision-feedback...]. */
  expected: ExpectedOutcome[];
  holdout: Array<{ record: Record<string, unknown>; expected: ExpectedOutcome }>;
  /** Fictional owner declarations (trusted, user-declared). Local only. */
  semanticDeclared: SemanticConstraint[];
}

/** One bounded blind revision run (src/revision/run.ts). Active run state only; never persisted. */
export interface RevisionRunState {
  runId: string;
  phase: RevisionPhase;
  history: RevisionPhase[];
  /** The proposal this run started from. A different workspace.proposal makes the run stale. */
  initialProposal: ProposalState;
  initialContractHash: string;
  basePayloadHash: string;
  initialEvaluation: MappingEvaluation;
  feedback: { value: BlindRevisionFeedback; newInformation: string[]; excluded: ExcludedIssue[]; semanticWithheld: SemanticWithheld[] } | null;
  preview: DisclosurePreview | null;
  revised: ProposalState | null;
  revisedEvaluation: MappingEvaluation | null;
  holdout: { initial: MappingEvaluation; revised: MappingEvaluation | null } | null;
  /** failureCode/detail: the classified provider failure and its raw local-only text (Sprint 9). */
  blocked: { code: RevisionBlockCode; message: string; failureCode?: string; detail?: string } | null;
  notice: string | null;
  /** Deterministic recommendation for the revised mapping (src/revision/decision.ts). Never auto-applied. */
  decision: RevisionDecision | null;
}

export interface WorkspaceState {
  source: ImportedSource | null;
  sourceError: string | null;
  /** Reserved hidden verification cases. Never profiled, never disclosed. */
  reservedRecords: Record<string, unknown>[] | null;
  seed: number;
  overrides: Record<string, TwinFieldOverride>;
  destinationText: string;
  review: ReviewState | null;
  proposal: ProposalState | null;
  /** Last cloud mapping failure: a classified code and the raw detail (local only, shown collapsed). */
  cloudError: { code: string; detail: string } | null;
  /** Sprint 2 manual contract over local source field names. Never sent anywhere. */
  mappingText: string;
  mappingChoice: MappingChoice;
  report: RealityCheckReport | null;
  mappingRunError: string | null;
  scenario: ScenarioContext | null;
  revision: RevisionRunState | null;
  /**
   * Sprint 8: date orders the user confirmed for ambiguous fields, keyed by
   * local path. Local only; becomes a trusted user-declared constraint.
   */
  semanticConfirmations: Record<string, Extract<DateInputFormat, "MM/DD/YYYY" | "DD/MM/YYYY">>;
  /** Sprint 8: constraint ids the user authorized for disclosure in the revision request. */
  revisionConstraintIds: string[];
  /**
   * Sprint 15: destination field → local source path, set only by the user's
   * explicit choice in the guided flow. Local only; never part of a request.
   */
  fieldMatches: Record<string, FieldMatch>;
  /**
   * Sprint 15: destination enum field → the user's declared translation of a
   * source field's categories. Local only. It is both the on-device mapping
   * rule and a trusted user-declared enum-meaning constraint.
   */
  categoryMeanings: Record<string, CategoryMeaning>;
  /**
   * Sprint 15: source paths whose category names the user explicitly allowed
   * inside the downloaded integration package. Off by default; never sent.
   */
  packageLabelSources: string[];
}

/** Decisions that belong to one source. A new source starts without them. */
export function freshSourceDecisions(): Pick<WorkspaceState, "overrides" | "semanticConfirmations" | "fieldMatches" | "categoryMeanings" | "packageLabelSources"> {
  return { overrides: {}, semanticConfirmations: {}, fieldMatches: {}, categoryMeanings: {}, packageLabelSources: [] };
}

export function initialWorkspaceState(): WorkspaceState {
  return {
    source: null,
    sourceError: null,
    reservedRecords: null,
    seed: DEFAULT_TWIN_SEED,
    overrides: {},
    destinationText: JSON.stringify(destinationSchema, null, 2),
    review: null,
    proposal: null,
    cloudError: null,
    mappingText: JSON.stringify(mappingContract, null, 2),
    mappingChoice: "proposal",
    report: null,
    mappingRunError: null,
    scenario: null,
    revision: null,
    semanticConfirmations: {},
    revisionConstraintIds: [],
    fieldMatches: {},
    categoryMeanings: {},
    packageLabelSources: [],
  };
}

/**
 * Any change to the source, seed, field decisions, or destination invalidates
 * the disclosure review, the approval, the proposal, the last run, and any
 * blind revision run (its approval, feedback and results).
 */
export function invalidateDownstream(state: WorkspaceState): WorkspaceState {
  return { ...state, review: null, proposal: null, cloudError: null, report: null, mappingRunError: null, revision: null, revisionConstraintIds: [] };
}

/**
 * Change one field decision of the twin (role, descriptor, date order, …).
 * Always invalidates downstream: an approval prepared for the old twin must
 * never be reused (Sprint 11, C4).
 */
export function applyTwinOverride(state: WorkspaceState, path: string, patch: Record<string, unknown>): WorkspaceState {
  const current = state.overrides[path] ?? {};
  return invalidateDownstream({ ...state, overrides: { ...state.overrides, [path]: { ...current, ...patch } } });
}

/**
 * Sprint 15 (B5): a guided field decision changed. A cloud request that was
 * already prepared or approved is never rewritten (the decision is not part of
 * it). What depended on the decision is cleared: a mapping built on this
 * device from the old decisions and its result, and any blind revision run
 * (its evaluations used the old semantic context).
 */
export function applyFieldDecision(state: WorkspaceState, patch: Partial<Pick<WorkspaceState, "fieldMatches" | "categoryMeanings" | "semanticConfirmations">>): WorkspaceState {
  const next = { ...state, ...patch, revision: null, revisionConstraintIds: [] };
  if (state.mappingChoice === "manual" && isLocalMapping(state.mappingText)) return { ...next, report: null, mappingRunError: null };
  return next;
}

/**
 * Sprint 16B (D2): a new destination. Field decisions (source choices,
 * explicit "no field", category translations) are kept only for destination
 * fields whose definition — name, type, format, allowed values, required — is
 * unchanged; any other decision is dropped, so a confirmation never carries
 * over to a different field that happens to share a name. Everything
 * downstream is invalidated as before.
 */
export function withDestination(state: WorkspaceState, destinationText: string): WorkspaceState {
  const signatures = (text: string): Map<string, string> => {
    const summary = summarizeDestination(text);
    if (!summary.ok) return new Map();
    return new Map(summary.fields.map((field) => [field.name, JSON.stringify([field.type, field.format ?? null, field.enumValues ?? null, field.required])]));
  };
  const before = signatures(state.destinationText);
  const after = signatures(destinationText);
  const same = (name: string) => before.has(name) && before.get(name) === after.get(name);
  const fieldMatches = Object.fromEntries(Object.entries(state.fieldMatches).filter(([name]) => same(name)));
  const categoryMeanings = Object.fromEntries(Object.entries(state.categoryMeanings).filter(([name]) => same(name)));
  return invalidateDownstream({ ...state, destinationText, fieldMatches, categoryMeanings });
}
