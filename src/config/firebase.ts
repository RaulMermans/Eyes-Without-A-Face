import { parseAppConfig, type AppConfig } from "./env.ts";
import { EXPECTED_FIREBASE_WEB_APP } from "./expected-firebase.ts";

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

export function assertExpectedFirebaseIdentity(config: AppConfig): void {
  requireFirebaseConfig(config);
  const mismatches: string[] = [];
  if (config.firebase.projectId !== EXPECTED_FIREBASE_WEB_APP.projectId) {
    mismatches.push(
      `projectId ${config.firebase.projectId} != ${EXPECTED_FIREBASE_WEB_APP.projectId}`,
    );
  }
  if (config.firebase.appId !== EXPECTED_FIREBASE_WEB_APP.appId) {
    mismatches.push(`appId ${config.firebase.appId} != ${EXPECTED_FIREBASE_WEB_APP.appId}`);
  }
  if (config.firebase.authDomain !== EXPECTED_FIREBASE_WEB_APP.authDomain) {
    mismatches.push(
      `authDomain ${config.firebase.authDomain} != ${EXPECTED_FIREBASE_WEB_APP.authDomain}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Firebase web config does not match the registered Eyes Without a Face app: ${mismatches.join("; ")}`,
    );
  }
}
