import { INITIAL_PLANNER, PRODUCT_INITIAL_PLANNER, type InitialPlanner } from "./planner-selection.ts";
import { evaluationHarness } from "./cloud-models.ts";

/**
 * LEGACY-PATH REGRESSION ONLY (Sprint 18B, lead-approved).
 *
 * The planner an initial (1.1.0) request uses. Always `INITIAL_PLANNER`,
 * except in a dev build driven by the E2E test harness
 * (`window.__EYES_WITHOUT_A_FACE_TEST__.initialPlanner =
 * "mapping-proposal-sprint3"`), so that technical-view tests whose subject
 * does not depend on the initial planner (phantom, ux, export, semantic
 * verification, blind-revision mechanics, experience) keep exercising the
 * unchanged Sprint 3 Mapping Proposal path. Production builds
 * (`import.meta.env.DEV === false`) never read the harness.
 */
export function effectiveInitialPlanner(
  env: { dev: boolean; app?: boolean; harness: { initialPlanner?: unknown } | null | undefined } = currentEnv(),
): InitialPlanner {
  // Outside the running app (scorers, replays, unit tests) the library default stays prompt v5.
  if (env.app === false) return INITIAL_PLANNER;
  if (!env.dev || !env.harness) return PRODUCT_INITIAL_PLANNER;
  const asked = env.harness.initialPlanner;
  return asked === "mapping-proposal-sprint3" || asked === "intent-plan-1" || asked === "intent-plan-2" ? asked : PRODUCT_INITIAL_PLANNER;
}

function currentEnv(): { dev: boolean; app: boolean; harness: { initialPlanner?: unknown } | null } {
  return { dev: Boolean(import.meta.env?.DEV), app: typeof window !== "undefined", harness: evaluationHarness() };
}
