#!/usr/bin/env node
/**
 * Sprint 18A AI-value experiment freeze (docs/evaluation/sprint-18a-ai-value.md).
 *
 * Written and committed BEFORE the Sprint 18A implementation is tuned and
 * before any model sees the evaluation set. Records SHA-256 hashes of the
 * independently authored evaluation set and of the pre-registration text
 * (everything above "## Results").
 *
 * The holdout is hashed as ONE digest over its sorted file hashes, with a
 * count: no holdout file name, id or content is written here, so reading this
 * manifest does not unblind the engineer.
 *
 * tests/evaluation/ai-value.test.ts (EVAL-180) fails if a frozen input changes.
 *
 * Usage: node scripts/freeze-ai-value.mjs [--amend "reason"]
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = "docs/evidence/sprint-18a/ai-value-freeze.json";
const root = "tests/fixtures/ai-value-18a";
const preregistration = "docs/evaluation/sprint-18a-ai-value.md";

const sha = (data) => createHash("sha256").update(data).digest("hex");
const list = (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(root, dir, name));

export function holdoutDigest() {
  const files = list("holdout");
  return { count: files.length, sha256: sha(files.map((file) => sha(fs.readFileSync(file))).join("\n")) };
}

export function preregistrationDigest() {
  const text = fs.readFileSync(preregistration, "utf8");
  const cut = text.indexOf("\n## Results");
  return sha(cut >= 0 ? text.slice(0, cut) : text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const amendIndex = process.argv.indexOf("--amend");
  const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  if (previous && amendIndex < 0) {
    console.error('A freeze manifest already exists. Use --amend "reason" to record a documented post-freeze change.');
    process.exit(1);
  }
  const manifest = {
    manifestVersion: "1.0.0",
    experiment: "sprint-18a-ai-value",
    frozenAt: previous?.frozenAt ?? new Date().toISOString(),
    frozenFromCommit: previous?.frozenFromCommit ?? execSync("git rev-parse HEAD").toString().trim(),
    statement:
      "Frozen before the Sprint 18A concept lexicon was tuned and before any model saw this evaluation set. The set was written by an independent author without access to the implementation. The holdout is never opened by the engineer; scripts/eval-ai-value.mjs prints aggregates only.",
    preregistration: { path: preregistration, sha256AboveResults: preregistrationDigest() },
    files: Object.fromEntries([path.join(root, "README.md"), ...list("dev")].map((file) => [file, sha(fs.readFileSync(file))])),
    holdout: holdoutDigest(),
    amendments: [...(previous?.amendments ?? [])],
  };
  if (amendIndex >= 0) manifest.amendments.push({ at: new Date().toISOString(), reason: process.argv[amendIndex + 1] ?? "unspecified" });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`freeze-ai-value: wrote ${out} (${Object.keys(manifest.files).length} dev files, holdout ${manifest.holdout.count})`);
}
