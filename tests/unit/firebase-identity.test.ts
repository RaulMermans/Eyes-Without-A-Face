import { describe, expect, it } from "vitest";
import { parseAppConfig } from "../../src/config/env.ts";
import { EXPECTED_FIREBASE_WEB_APP } from "../../src/config/expected-firebase.ts";
import { assertExpectedFirebaseIdentity } from "../../src/config/firebase.ts";

describe("registered Firebase identity", () => {
  it("accepts the owner-registered web app", () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: EXPECTED_FIREBASE_WEB_APP.authDomain,
      VITE_FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_WEB_APP.projectId,
      VITE_FIREBASE_APP_ID: EXPECTED_FIREBASE_WEB_APP.appId,
    });
    expect(() => assertExpectedFirebaseIdentity(config)).not.toThrow();
  });

  it("rejects a different project id", () => {
    const config = parseAppConfig({
      VITE_FIREBASE_API_KEY: "public-web-key",
      VITE_FIREBASE_AUTH_DOMAIN: EXPECTED_FIREBASE_WEB_APP.authDomain,
      VITE_FIREBASE_PROJECT_ID: "some-other-project",
      VITE_FIREBASE_APP_ID: EXPECTED_FIREBASE_WEB_APP.appId,
    });
    expect(() => assertExpectedFirebaseIdentity(config)).toThrow(/does not match/);
  });
});
