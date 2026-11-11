#!/usr/bin/env node
// Production release build for Firebase Hosting.
//
// Vite loads `.env.local` in every mode, so a developer machine with
// VITE_APP_CHECK_DEBUG=true would otherwise bake debug mode into a production
// bundle (and the app then refuses cloud inference). Process environment
// variables take precedence over .env files, so this script forces the
// release-only values, stamps the Git revision, builds, and verifies `dist/`.
//
//   pnpm build:release                # requires a clean working tree
//   pnpm build:release --allow-dirty  # local inspection only; not deployable
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const allowDirty = process.argv.includes("--allow-dirty");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const sha = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no").length > 0;
if (dirty && !allowDirty) {
  console.error("build:release refuses a dirty working tree: a deployed build must match a commit.");
  console.error("Commit your changes, or pass --allow-dirty for a local, non-deployable build.");
  process.exit(1);
}

const env = {
  ...process.env,
  VITE_APP_CHECK_DEBUG: "false",
  VITE_BUILD_SHA: dirty ? `${sha.slice(0, 12)}-dirty` : sha.slice(0, 12),
};

for (const [cmd, args] of [
  ["pnpm", ["exec", "tsc", "-b"]],
  ["pnpm", ["exec", "vite", "build", "--mode", "production"]],
]) {
  const result = spawnSync(cmd, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const info = {
  gitSha: sha,
  dirty,
  builtAt: new Date().toISOString(),
  mode: "production",
  appCheckDebug: false,
};
fs.writeFileSync(path.join("dist", "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);

const verify = spawnSync("node", ["scripts/verify-release.mjs"], { stdio: "inherit" });
process.exit(verify.status ?? 1);
