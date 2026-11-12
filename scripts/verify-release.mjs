#!/usr/bin/env node
// Verifies a production `dist/` before it may be deployed to Firebase Hosting.
// Prints findings only; never prints secret values.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dist = process.argv[2] ?? "dist";
const failures = [];
const notes = [];
const fail = (message) => failures.push(message);

const EXPECTED = {
  VITE_FIREBASE_PROJECT_ID: "eyes-without-a-face-b7281",
  VITE_FIREBASE_APP_ID: "1:507051460368:web:086c755a2c003fb30b4795",
  VITE_FIREBASE_AUTH_DOMAIN: "eyes-without-a-face-b7281.firebaseapp.com",
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error(`verify-release: ${dist}/index.html missing. Run pnpm build:release.`);
  process.exit(1);
}

const files = walk(dist);
const textFiles = files.filter((file) => /\.(js|css|html|json|svg|txt|webmanifest)$/.test(file));

for (const file of files) {
  const base = path.basename(file);
  if (base.endsWith(".map")) fail(`source map shipped: ${file}`);
  if (/^\.env/.test(base) || base.endsWith(".local")) fail(`environment file shipped: ${file}`);
  if (/trace|\.har$|\.zip$/.test(base)) fail(`trace/archive artifact shipped: ${file}`);
}

// The inlined import.meta.env object of the production bundle.
const bundle = textFiles.filter((file) => file.endsWith(".js")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
const envMatch = /\{BASE_URL:`\/`,[^}]*\}/.exec(bundle);
if (!envMatch) {
  fail("could not locate the inlined import.meta.env object");
} else {
  const env = Object.fromEntries(
    [...envMatch[0].matchAll(/([A-Z_]+):(?:`([^`]*)`|(!0|!1))/g)].map((m) => [m[1], m[2] ?? (m[3] === "!0" ? "true" : "false")]),
  );
  if (env.MODE !== "production" || env.PROD !== "true") fail(`not a production build (MODE=${env.MODE}, PROD=${env.PROD})`);
  if (env.VITE_APP_CHECK_DEBUG === "true") fail("VITE_APP_CHECK_DEBUG=true is baked into the bundle");
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (env[key] !== value) fail(`${key} is ${env[key] ? "different from" : "missing; expected"} the registered web app`);
  }
  if (!/^6L[0-9A-Za-z_-]{30,}$/.test(env.VITE_FIREBASE_APP_CHECK_SITE_KEY ?? "")) fail("reCAPTCHA Enterprise site key missing or malformed");
  if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(env.VITE_FIREBASE_API_KEY ?? "")) fail("Firebase web API key missing or malformed");
  if (env.VITE_ENABLE_CLOUD_INFERENCE !== "true") fail("cloud inference flag is off");
  if (env.VITE_ENABLE_ON_DEVICE_INFERENCE !== "true") fail("on-device inference flag is off");
  const allowed = new Set([
    "BASE_URL", "DEV", "MODE", "PROD", "SSR",
    "VITE_APP_CHECK_DEBUG", "VITE_BUILD_SHA", "VITE_ENABLE_CLOUD_INFERENCE", "VITE_ENABLE_ON_DEVICE_INFERENCE",
    "VITE_FIREBASE_API_KEY", "VITE_FIREBASE_APP_CHECK_SITE_KEY", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_MEASUREMENT_ID", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET",
  ]);
  for (const key of Object.keys(env)) if (!allowed.has(key)) fail(`unexpected inlined variable ${key}`);
  notes.push(`build sha: ${env.VITE_BUILD_SHA ?? "(not stamped)"}`);
}

// No literal debug token assignment, and never the locally stored token value.
if (/FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*[`'"][0-9a-f-]{20,}/i.test(bundle)) fail("a literal App Check debug token is assigned in the bundle");
const tokenFile = path.join(os.homedir(), ".config", "eyes-without-a-face", "appcheck-debug-token");
if (fs.existsSync(tokenFile)) {
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (token.length >= 16 && textFiles.some((file) => fs.readFileSync(file, "utf8").includes(token))) {
    fail("the local App Check debug token value appears in dist (value not printed)");
  }
  notes.push("local debug token value: absent from dist");
}

// Credentials that must never ship.
const forbidden = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/"type"\s*:\s*"service_account"/, "service-account JSON"],
  [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/ya29\.[0-9A-Za-z_-]{20,}/, "Google OAuth access token"],
  [/1\/\/0[0-9A-Za-z_-]{30,}/, "Google OAuth refresh token"],
];
for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of forbidden) if (pattern.test(text)) fail(`${label} found in ${file}`);
}

const buildInfo = path.join(dist, "build-info.json");
if (fs.existsSync(buildInfo)) {
  const info = JSON.parse(fs.readFileSync(buildInfo, "utf8"));
  if (info.dirty) notes.push("WARNING: built from a dirty tree — not deployable");
  notes.push(`build-info gitSha: ${info.gitSha}`);
}

const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
notes.push(`${files.length} files, ${(bytes / 1024).toFixed(0)} KiB`);

for (const note of notes) console.log(`verify-release: ${note}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`verify-release: FAIL ${message}`);
  process.exit(1);
}
console.log("verify-release: PASS");
