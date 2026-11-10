import { parseAppConfig, type AppConfig } from "./env.ts";

export function loadAppConfig(
  env: Record<string, string | undefined> = import.meta.env as Record<
    string,
    string | undefined
  >,
): AppConfig {
  return parseAppConfig(env);
}

export function requireFirebaseConfig(config: AppConfig): asserts config is AppConfig & {
  firebase: NonNullable<AppConfig["firebase"]>;
} {
  if (!config.firebase) {
    throw new Error(
      `Firebase is not configured. Missing ${config.missingFirebaseKeys.join(", ")}. Local development does not require credentials.`,
    );
  }
}
