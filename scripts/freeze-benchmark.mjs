#!/usr/bin/env node
/**
 * Sprint 8 benchmark freeze (Workstream D4).
 *
 * Records SHA-256 hashes of every input that can change a reported result —
 * prompts, model id, schemas, policies and semantic specs (scenario files,
 * including the final holdout), the semantic verifier, the feedback
 * projection, the decision rule and the evaluator — together with the
 * predeclared run budget and hypotheses. It is written and committed BEFORE
 * any Sprint 8 live run. tests/evaluation/freeze-manifest.test.ts fails if a
 * frozen file changes afterwards, so a post-freeze change cannot go unnoticed.
 *
 * Usage: node scripts/freeze-benchmark.mjs [--amend "reason"]
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const out = "docs/evidence/sprint-8/freeze-manifest.json";

export const FROZEN_FILES = [
  "src/inference/prompts.ts",
  "src/inference/firebase-api.ts",
  "src/proposal/convert.ts",
  "src/proposal/resolve.ts",
  "src/semantics/contract.ts",
  "src/semantics/observe.ts",
  "src/semantics/verify.ts",
  "src/revision/feedback.ts",
  "src/revision/semantic-feedback.ts",
  "src/revision/revision-payload.ts",
  "src/revision/decision.ts",
  "src/verification/outcomes.ts",
  "src/evaluation/evaluate.ts",
  "src/evaluation/benchmark.ts",
  "src/domain/contracts/schemas/blind-revision-feedback.v1.schema.json",
  "src/domain/contracts/schemas/blind-revision-feedback.v1.1.schema.json",
  "src/domain/contracts/schemas/cloud-disclosure.v1.1.schema.json",
  "src/domain/contracts/schemas/cloud-disclosure.v1.2.schema.json",
  "src/domain/contracts/schemas/cloud-disclosure.v1.3.schema.json",
  "src/domain/contracts/schemas/semantic-verification.v1.schema.json",
  "src/examples/scenarios/crm-eu-accounts.json",
  "src/examples/scenarios/support-tickets.json",
  "src/examples/scenarios/billing-subscriptions.json",
];

const sha = (path) => createHash("sha256").update(fs.readFileSync(path)).digest("hex");

const amendIndex = process.argv.indexOf("--amend");
const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
if (previous && amendIndex < 0) {
  console.error("A freeze manifest already exists. Use --amend \"reason\" to record a documented post-freeze change.");
  process.exit(1);
}

const manifest = {
  manifestVersion: "1.0.0",
  frozenAt: previous?.frozenAt ?? new Date().toISOString(),
  frozenFromCommit: previous?.frozenFromCommit ?? execSync("git rev-parse HEAD").toString().trim(),
  statement:
    "Frozen before any Sprint 8 live model run. The Sprint 8 holdout (10 cases per scenario) was written from each scenario's documented meaning before any Sprint 8 model output existed and is never used for prompts, feedback, semantic evidence or tuning. Sprint 7's inspected holdout is kept as `development`.",
  budget: {
    model: "gemini-3.5-flash-lite (Firebase AI Logic, ONLY_IN_CLOUD) and Gemini Nano (ONLY_ON_DEVICE)",
    trials: [1, 2, 3, 4, 5],
    scenarios: ["crm-eu-accounts", "support-tickets", "billing-subscriptions"],
    cloudRequestsPerScenarioTrial: { B: 1, "C/D": 2 },
    maxCloudRequests: 60,
    retries: "none: a provider failure is recorded as a failure and is not repeated or replaced",
    stopRule: "Stop when trials 1–5 are complete or the request cap is reached, whichever comes first. No trial is discarded.",
    authorization: "Each request goes through the in-app approval gate; the live spec approves exactly what it previews.",
  },
  configurations: {
    A: "Deterministic test proposer over the approved disclosure. No model. Computed offline.",
    B: "Real Gemini proposal from the approved disclosure. No Nano, no revision.",
    C: "Real Gemini Nano private interpretation (validated suggestions applied by the user) + real Gemini proposal.",
    D: "C + one approved real Gemini revision with Blind Revision Feedback; every trusted constraint behind a semantic finding is authorized (recorded as a human intervention).",
  },
  hypotheses: {
    H1: "The semantic verifier flags the schema-valid-but-wrong holdout outputs of real Gemini mappings caused by date order and priority inversion, with no false alarms.",
    H2: "With approved semantic constraints, one real Gemini revision increases holdout correct transformations over C with zero holdout regressions in CRM and support.",
    H3: "Nano (C vs B) does not change holdout correctness on these fixtures (expected null result).",
    H4: "Codes-only semantic feedback (no constraint) is insufficient for a correction (tested offline with the simulated reviser only; not a live claim).",
  },
  primaryMetric: "Holdout correct transformations (ground-truth equal output, transformed or approved rule). Quarantine never counts.",
  files: Object.fromEntries(FROZEN_FILES.map((path) => [path, sha(path)])),
  amendments: [
    ...(previous?.amendments ?? []),
    ...(amendIndex >= 0 ? [{ at: new Date().toISOString(), reason: process.argv[amendIndex + 1] ?? "unspecified", commit: execSync("git rev-parse HEAD").toString().trim() }] : []),
  ],
};

fs.mkdirSync("docs/evidence/sprint-8", { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} (${FROZEN_FILES.length} files).`);
