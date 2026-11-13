/**
 * Fictional evaluation scenarios (Sprint 7, Workstream G; Sprint 8 v2.0.0).
 *
 * Each scenario has four disjoint case sets:
 *   imported          profiled, used to build the Phantom Twin and disclosure
 *   revisionFeedback  reserved; run by the local Reality Check (and the semantic
 *                     verifier) to produce feedback
 *   development       Sprint 7's holdout. Its results were inspected in Sprint 7,
 *                     so it is development data now: debugging only, never
 *                     feedback, never reported as independent
 *   holdout           Sprint 8 final independent evaluation, written and frozen
 *                     before any Sprint 8 model run; never profiled, disclosed,
 *                     used for feedback or semantic evidence, or run before the
 *                     mapping is final
 *
 * `semanticSpec.declared` holds fictional owner declarations (trusted
 * user-declared constraints). They are written from the scenario's documented
 * meaning, never from ground truth or model output.
 *
 * Ground truth (`expected`) exists only for these fixtures. All data is fictional.
 */
import crmEu from "../examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import support from "../examples/scenarios/support-tickets.json" with { type: "json" };
import billing from "../examples/scenarios/billing-subscriptions.json" with { type: "json" };
import crmNl from "../examples/scenarios/crm-nl-relations.json" with { type: "json" };
import type { TwinFieldOverride } from "../phantom/generate.ts";
import type { SemanticConstraint } from "../semantics/contract.ts";
import { validateAcceptancePolicy, type AcceptancePolicy, type ExpectedOutcome } from "../verification/outcomes.ts";

export interface ScenarioCase {
  record: Record<string, unknown>;
  expected: ExpectedOutcome;
}

export interface EvaluationScenario {
  scenarioId: string;
  scenarioVersion: string;
  title: string;
  summary: string;
  difficulty: string[];
  fictional: true;
  localOnly: true;
  canaries: string[];
  datasetLabel: string;
  twinOverrides: Record<string, TwinFieldOverride>;
  destinationSchema: Record<string, unknown>;
  policy: AcceptancePolicy;
  semanticSpec: { specVersion: "1.0.0"; note: string; declared: SemanticConstraint[] };
  imported: ScenarioCase[];
  revisionFeedback: ScenarioCase[];
  /** Sprint 7 holdout, inspected; development data only. */
  development: ScenarioCase[];
  holdout: ScenarioCase[];
}

export const EVALUATION_SCENARIOS: readonly EvaluationScenario[] = [
  crmEu as unknown as EvaluationScenario,
  support as unknown as EvaluationScenario,
  billing as unknown as EvaluationScenario,
];

/**
 * Sprint 12 Nano-value experiment scenario(s). Kept out of
 * EVALUATION_SCENARIOS so the frozen Sprint 8 benchmark set and its replay
 * (EVAL-081) stay exactly as recorded. Frozen separately in
 * docs/evidence/sprint-12/nano-value-freeze.json.
 */
export const EXPERIMENT_SCENARIOS: readonly EvaluationScenario[] = [crmNl as unknown as EvaluationScenario];

/** Every fictional scenario the Source step offers. */
export const PICKER_SCENARIOS: readonly EvaluationScenario[] = [...EVALUATION_SCENARIOS, ...EXPERIMENT_SCENARIOS];

export function scenarioById(id: string): EvaluationScenario | undefined {
  return PICKER_SCENARIOS.find((scenario) => scenario.scenarioId === id);
}

/** Structural checks a scenario must pass before it can be evaluated. */
export function validateScenario(scenario: EvaluationScenario): string[] {
  const issues = [...validateAcceptancePolicy(scenario.policy)];
  if (!scenario.fictional || !scenario.localOnly) issues.push("Scenarios must be fictional and local-only.");
  if (scenario.imported.length < 2) issues.push("At least two imported records are required.");
  if (scenario.revisionFeedback.length === 0) issues.push("At least one revision-feedback case is required.");
  if (scenario.holdout.length === 0) issues.push("At least one holdout case is required.");
  const key = (item: ScenarioCase) => JSON.stringify(item.record);
  const sets = [scenario.imported, scenario.revisionFeedback, scenario.development ?? [], scenario.holdout].map((cases) => new Set(cases.map(key)));
  const [imported, feedback, development, holdout] = sets as [Set<string>, Set<string>, Set<string>, Set<string>];
  for (const item of holdout) {
    if (imported.has(item) || feedback.has(item) || development.has(item)) issues.push("A holdout case also appears in another set.");
  }
  for (const item of development) {
    if (imported.has(item) || feedback.has(item)) issues.push("A development case also appears in the imported or revision-feedback set.");
  }
  for (const item of feedback) {
    if (imported.has(item)) issues.push("A revision-feedback case also appears in the imported set.");
  }
  return issues;
}
