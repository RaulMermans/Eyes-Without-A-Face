/**
 * Allowlisted cloud model configurations (Sprint 18D, ADR 0021 §A).
 *
 * The product default is unchanged: `gemini-3.5-flash-lite` with the model's
 * default thinking. Other configurations exist for the pre-registered model
 * benchmark and are selectable ONLY in a dev build through the E2E/evaluation
 * harness (`window.__EYES_WITHOUT_A_FACE_TEST__.cloudModel`), exactly like
 * `effectiveInitialPlanner`. Production builds never read the harness.
 *
 * The model and thinking level are part of the approved destination
 * (`destinationKey`), so an approval for one configuration never authorizes
 * a request to another. There is no automatic fallback between models.
 *
 * Thinking levels per model: Firebase AI Logic "Thinking" docs, re-verified
 * 2026-11-17 against firebase 13.2.0 (`ThinkingLevel` MINIMAL/LOW/MEDIUM/HIGH).
 * Flash-Lite defaults to MINIMAL; 3.x Flash to MEDIUM; gemini-3.8-flash and
 * gemini-4-* reject MINIMAL (HTTP 400). XHIGH is not supported by the SDK.
 */
export type ThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export const CLOUD_MODELS = {
  "gemini-3.5-flash-lite": { thinking: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinking: "MINIMAL" },
  "gemini-3.6-flash": { thinking: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultThinking: "MEDIUM" },
  "gemini-3.8-flash": { thinking: ["LOW", "MEDIUM", "HIGH"], defaultThinking: "MEDIUM" },
  /** Diagnostic reference only (stronger model); never a product default without an ADR. */
  "gemini-4-hydrogen": { thinking: ["LOW", "MEDIUM", "HIGH"], defaultThinking: "HIGH" },
} as const satisfies Record<string, { thinking: readonly ThinkingLevel[]; defaultThinking: ThinkingLevel }>;

export type CloudModelId = keyof typeof CLOUD_MODELS;

export interface CloudModelConfig {
  model: CloudModelId;
  /** Absent: the model's own default (no thinkingConfig is sent). */
  thinkingLevel?: ThinkingLevel;
}

export const DEFAULT_CLOUD_MODEL_CONFIG: Readonly<CloudModelConfig> = Object.freeze({ model: "gemini-3.5-flash-lite" });

export function isAllowedCloudModelConfig(value: unknown): value is CloudModelConfig {
  if (!value || typeof value !== "object") return false;
  const { model, thinkingLevel } = value as { model?: unknown; thinkingLevel?: unknown };
  if (typeof model !== "string" || !Object.hasOwn(CLOUD_MODELS, model)) return false;
  if (thinkingLevel === undefined) return true;
  return (CLOUD_MODELS[model as CloudModelId].thinking as readonly string[]).includes(thinkingLevel as string);
}

/**
 * The configuration a new cloud request uses. Always the default, except in a
 * dev build whose harness names an allowlisted configuration.
 */
export function effectiveCloudModelConfig(
  env: { dev: boolean; harness: { cloudModel?: unknown } | null | undefined } = currentEnv(),
): CloudModelConfig {
  if (!env.dev || !env.harness) return { ...DEFAULT_CLOUD_MODEL_CONFIG };
  return isAllowedCloudModelConfig(env.harness.cloudModel) ? { ...env.harness.cloudModel } : { ...DEFAULT_CLOUD_MODEL_CONFIG };
}

type Harness = { cloudModel?: unknown; destinationSemantics?: unknown; initialPlanner?: unknown; localPolicy?: unknown };

/**
 * Dev builds only. `__EYES_EVAL_CONFIG__` selects an evaluation arm for LIVE
 * runs without switching to the simulated adapters (any
 * `__EYES_WITHOUT_A_FACE_TEST__` object does that); E2E tests may use either.
 */
export function evaluationHarness(): Harness | null {
  if (typeof window === "undefined") return null;
  const scope = window as { __EYES_EVAL_CONFIG__?: Harness; __EYES_WITHOUT_A_FACE_TEST__?: Harness };
  return scope.__EYES_EVAL_CONFIG__ ?? scope.__EYES_WITHOUT_A_FACE_TEST__ ?? null;
}

function currentEnv(): { dev: boolean; app: boolean; harness: Harness | null } {
  return { dev: Boolean(import.meta.env?.DEV), app: typeof window !== "undefined", harness: evaluationHarness() };
}

/**
 * Whether a new initial request carries sanitized destination descriptions (cloud-disclosure 1.4.0).
 * Sprint 18F release decision: ON in the product (confirmed with RB + local on the fresh eval-18f holdout).
 * A dev harness may turn it off explicitly (`destinationSemantics: false`) for historical paths.
 */
export function effectiveDestinationSemantics(
  env: { dev: boolean; app?: boolean; harness: { destinationSemantics?: unknown } | null | undefined } = currentEnv(),
): boolean {
  if (env.app === false) return false; // library default outside the running app (replays, scorers)
  const harness = env.dev ? (env.harness as { destinationSemantics?: unknown; initialPlanner?: unknown } | null | undefined) : null;
  // 1.4.0 is a plan request only (ADR 0021): never with the legacy Sprint 3 planner a dev harness may select.
  if (harness && (harness.destinationSemantics === false || harness.initialPlanner === "mapping-proposal-sprint3")) return false;
  return true;
}

/**
 * Plan-request output cap. Thinking tokens count against `maxOutputTokens`, so
 * the Sprint 18C cap (8192, Flash-Lite at its default MINIMAL thinking) would
 * truncate a plan from a model that thinks more and confound the benchmark.
 * shortcut: one higher cap for every thinking-heavy configuration; tune per model once live token use is measured.
 */
export function planMaxOutputTokens(config: CloudModelConfig, defaultCap: number): number {
  const thinking = config.thinkingLevel ?? CLOUD_MODELS[config.model].defaultThinking;
  return thinking === "MINIMAL" ? defaultCap : 24_576;
}

/**
 * Sprint 18D (ADR 0021 §D): the compile policy for plan answers. Null (the
 * Sprint 18C behaviour) in the product until the pre-registered comparison
 * selects a policy; a dev harness may set `localPolicy`.
 */
export function effectiveLocalPolicy(
  env: { dev: boolean; app?: boolean; harness: { localPolicy?: unknown } | null | undefined } = currentEnv(),
): { askOnLocalEvidence: boolean } | null {
  if (env.app === false) return null;
  // Sprint 18F release decision: local evidence asks in the product (ADR 0022, confirmed on eval-18f).
  // A dev harness may pass `localPolicy: false` (the Sprint 18C behaviour) or an explicit policy object.
  const value = env.dev && env.harness ? env.harness.localPolicy : undefined;
  if (value === false) return null;
  if (!value || typeof value !== "object") return { askOnLocalEvidence: true };
  return { askOnLocalEvidence: (value as Record<string, unknown>).askOnLocalEvidence === true };
}
