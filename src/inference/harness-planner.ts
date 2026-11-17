import { INITIAL_PLANNER, type InitialPlanner } from "./planner-selection.ts";

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
  env: { dev: boolean; harness: { initialPlanner?: unknown } | null | undefined } = currentEnv(),
): InitialPlanner {
  if (!env.dev || !env.harness) return INITIAL_PLANNER;
  return env.harness.initialPlanner === "mapping-proposal-sprint3" ? "mapping-proposal-sprint3" : INITIAL_PLANNER;
}

function currentEnv(): { dev: boolean; harness: { initialPlanner?: unknown } | null } {
  const dev = Boolean(import.meta.env?.DEV);
  const harness = typeof window === "undefined" ? null : ((window as { __EYES_WITHOUT_A_FACE_TEST__?: { initialPlanner?: unknown } }).__EYES_WITHOUT_A_FACE_TEST__ ?? null);
  return { dev, harness };
}
