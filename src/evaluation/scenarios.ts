/**
 * Fictional evaluation scenarios (Sprint 7, Workstream G).
 *
 * Each scenario has three disjoint case sets:
 *   imported          profiled, used to build the Phantom Twin and disclosure
 *   revisionFeedback  reserved; run by the local Reality Check to produce feedback
 *   holdout           final independent evaluation; never profiled, disclosed,
 *                     used for feedback, or run before the mapping is final
 *
 * Ground truth (`expected`) exists only for these fixtures. All data is fictional.
 */
import crmEu from "../examples/scenarios/crm-eu-accounts.json" with { type: "json" };
import support from "../examples/scenarios/support-tickets.json" with { type: "json" };
import billing from "../examples/scenarios/billing-subscriptions.json" with { type: "json" };
import type { TwinFieldOverride } from "../phantom/generate.ts";
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
  imported: ScenarioCase[];
  revisionFeedback: ScenarioCase[];
  holdout: ScenarioCase[];
}

export const EVALUATION_SCENARIOS: readonly EvaluationScenario[] = [
  crmEu as unknown as EvaluationScenario,
  support as unknown as EvaluationScenario,
  billing as unknown as EvaluationScenario,
];

export function scenarioById(id: string): EvaluationScenario | undefined {
  return EVALUATION_SCENARIOS.find((scenario) => scenario.scenarioId === id);
}

/** Structural checks a scenario must pass before it can be evaluated. */
export function validateScenario(scenario: EvaluationScenario): string[] {
  const issues = [...validateAcceptancePolicy(scenario.policy)];
  if (!scenario.fictional || !scenario.localOnly) issues.push("Scenarios must be fictional and local-only.");
  if (scenario.imported.length < 2) issues.push("At least two imported records are required.");
  if (scenario.revisionFeedback.length === 0) issues.push("At least one revision-feedback case is required.");
  if (scenario.holdout.length === 0) issues.push("At least one holdout case is required.");
  const key = (item: ScenarioCase) => JSON.stringify(item.record);
  const sets = [scenario.imported, scenario.revisionFeedback, scenario.holdout].map((cases) => new Set(cases.map(key)));
  const [imported, feedback, holdout] = sets as [Set<string>, Set<string>, Set<string>];
  for (const item of holdout) {
    if (imported.has(item) || feedback.has(item)) issues.push("A holdout case also appears in another set.");
  }
  for (const item of feedback) {
    if (imported.has(item)) issues.push("A revision-feedback case also appears in the imported set.");
  }
  return issues;
}
