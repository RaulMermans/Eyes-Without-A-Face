import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Sprint 5 (G3): the release verifier must refuse bundles that would ship
// App Check debug mode, a debug token, source maps, or environment files.
const ENV = {
  BASE_URL: "/",
  DEV: "!1",
  MODE: "production",
  PROD: "!0",
  SSR: "!1",
  VITE_APP_CHECK_DEBUG: "false",
  VITE_BUILD_SHA: "0123456789ab",
  VITE_ENABLE_CLOUD_INFERENCE: "true",
  VITE_ENABLE_ON_DEVICE_INFERENCE: "true",
  VITE_FIREBASE_API_KEY: `AIza${"x".repeat(35)}`,
  VITE_FIREBASE_APP_CHECK_SITE_KEY: `6L${"y".repeat(38)}`,
  VITE_FIREBASE_APP_ID: "1:507051460368:web:086c755a2c003fb30b4795",
  VITE_FIREBASE_AUTH_DOMAIN: "eyes-without-a-face-b7281.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "eyes-without-a-face-b7281",
} as Record<string, string>;

const dirs: string[] = [];

function makeDist(overrides: Record<string, string> = {}, extra: (dir: string) => void = () => {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyes-dist-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
  const env = { ...ENV, ...overrides };
  const literal = Object.entries(env)
    .map(([key, value]) => (value === "!0" || value === "!1" ? `${key}:${value}` : `${key}:\`${value}\``))
    .join(",");
  fs.writeFileSync(path.join(dir, "assets", "index-abc.js"), `var e={${literal}};console.log(e);`);
  extra(dir);
  return dir;
}

function verify(dir: string): { status: number; output: string } {
  const result = spawnSync("node", ["scripts/verify-release.mjs", dir], { encoding: "utf8", env: { ...process.env, HOME: os.tmpdir() } });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("release artifact verifier", () => {
  it("passes a correct production bundle", () => {
    const result = verify(makeDist());
    expect(result.output).toContain("verify-release: PASS");
    expect(result.status).toBe(0);
  });

  it("refuses App Check debug mode baked into the bundle", () => {
    const result = verify(makeDist({ VITE_APP_CHECK_DEBUG: "true" }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("VITE_APP_CHECK_DEBUG=true");
  });

  it("refuses a literal debug token assignment without printing it", () => {
    const token = "11111111-2222-4333-8444-555555555555";
    const result = verify(
      makeDist({}, (dir) => fs.appendFileSync(path.join(dir, "assets", "index-abc.js"), `self.FIREBASE_APPCHECK_DEBUG_TOKEN="${token}";`)),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("literal App Check debug token");
    expect(result.output).not.toContain(token);
  });

  it("refuses source maps and environment files", () => {
    const result = verify(
      makeDist({}, (dir) => {
        fs.writeFileSync(path.join(dir, "assets", "index-abc.js.map"), "{}");
        fs.writeFileSync(path.join(dir, ".env.local"), "X=1");
      }),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("source map shipped");
    expect(result.output).toContain("environment file shipped");
  });

  it("refuses a development build and a foreign Firebase project", () => {
    const result = verify(makeDist({ MODE: "development", PROD: "!1", VITE_FIREBASE_PROJECT_ID: "someone-else" }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("not a production build");
    expect(result.output).toContain("VITE_FIREBASE_PROJECT_ID");
  });
});
