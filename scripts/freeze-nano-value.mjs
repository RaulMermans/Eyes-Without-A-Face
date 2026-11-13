#!/usr/bin/env node
/**
 * Sprint 12 Nano-value experiment freeze (Workstream C2).
 *
 * Written and committed BEFORE any model (Gemini Nano or Gemini Cloud) sees the
 * experiment scenario. Records SHA-256 hashes of every input that can change a
 * reported result, the predeclared hypotheses, budget and stop rule.
 * tests/evaluation/nano-value.test.ts (EVAL-120) fails if a frozen file changes.
 *
 * Usage: node scripts/freeze-nano-value.mjs [--amend "reason"]
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const out = "docs/evidence/sprint-12/nano-value-freeze.json";

const FROZEN_FILES = [
  "src/examples/scenarios/crm-nl-relations.json",
  "src/inference/prompts.ts",
  "src/inference/firebase-api.ts",
  "src/private-semantics/semantics.ts",
  "src/phantom/roles.ts",
  "src/phantom/generate.ts",
  "src/proposal/convert.ts",
  "src/proposal/resolve.ts",
  "src/semantics/contract.ts",
  "src/semantics/observe.ts",
  "src/semantics/verify.ts",
  "src/verification/outcomes.ts",
  "src/evaluation/evaluate.ts",
  "src/evaluation/benchmark.ts",
  "src/evaluation/aggregate.ts",
  "tests/live/semantic-benchmark.spec.ts",
];

const sha = (path) => createHash("sha256").update(fs.readFileSync(path)).digest("hex");

const amendIndex = process.argv.indexOf("--amend");
const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
if (previous && amendIndex < 0) {
  console.error('A freeze manifest already exists. Use --amend "reason" to record a documented post-freeze change.');
  process.exit(1);
}

const manifest = {
  manifestVersion: "1.0.0",
  experiment: "sprint-12-nano-value",
  frozenAt: previous?.frozenAt ?? new Date().toISOString(),
  frozenFromCommit: previous?.frozenFromCommit ?? execSync("git rev-parse HEAD").toString().trim(),
  statement:
    "Frozen before any model run on crm-nl-relations. Ground truth (`expected`) was written from the scenario's documented business meaning (a Dutch CRM; 'bedrijf' = company, 'contactpersoon' = contact person, 'sinds' = customer-since date, day-first) before any Nano or Gemini output on this scenario existed. The holdout is never profiled, disclosed, used for feedback or used to change a prompt.",
  scenario: "crm-nl-relations@1.0.0",
  configurations: {
    A: "Deterministic profiling only (no model). Roles and date order from the deterministic profile. Computed offline.",
    B: "A + real Gemini Nano (ONLY_ON_DEVICE) reading bounded private context; only validated suggestions, applied by the user, change the twin.",
    C: "Real Gemini Cloud initial mapping from the deterministic twin (harness check S8-B). No Nano, no revision.",
    D: "Real Gemini Cloud initial mapping from the twin with B's applied suggestions (harness check S8-CD with EYES_LIVE_NO_REVISION=1). No revision.",
  },
  comparisons: { local: "B vs A", downstream: "D vs C, paired by trial" },
  groundTruthSemantics: {
    relatienr: { role: "identifier" },
    mailadres: { role: "email" },
    fase: { role: "status" },
    sinds: { role: "date", dateOrder: "DD/MM/YYYY" },
    bedrijf: { role: "organization" },
    contactpersoon: { role: "person-name" },
    opmerking: { role: "free-text", note: "withheld from the cloud (shareable: false)" },
  },
  hypotheses: {
    H1: "A (deterministic) cannot establish the meaning of 'bedrijf' and 'contactpersoon' (generic role) nor the day/month order of 'sinds' (unproven).",
    H2: "B: Nano yields at least one validated, applicable suggestion that matches the ground-truth semantics of 'bedrijf', 'contactpersoon' or 'sinds' in at least 2 of 3 trials, with no applicable suggestion that contradicts the ground truth.",
    H3: "D beats C on holdout correct transformations (paired by trial) in at least 2 of the valid pairs, with no pair where D is worse.",
    outcomes: "Positive (H2 and H3 hold), neutral (H2 holds, H3 does not), negative (Nano adds wrong applicable suggestions, or D is worse than C). All three are reportable.",
  },
  budget: {
    model: "gemini-3.5-flash-lite (Firebase AI Logic, ONLY_IN_CLOUD) and Gemini Nano (ONLY_ON_DEVICE)",
    trials: [1, 2, 3],
    cloudRequestsPerTrial: { C: 1, D: 1 },
    maxCloudRequests: 6,
    nanoRunsPerTrial: 1,
    revisions: "none (EYES_LIVE_NO_REVISION=1)",
    retries: "none: a provider failure is recorded as a failure and is not repeated or replaced",
    stopRule: "Stop when trials 1–3 are complete or 6 cloud requests were sent, whichever comes first. No trial is discarded.",
    authorization: "Each request goes through the in-app approval gate; the live spec approves exactly what it previews.",
    environment: "Local dev server with the registered App Check debug token and the dedicated Nano Chrome profile.",
  },
  metrics: [
    "Nano suggestions: consistent / applicable / rejected; applied; matches ground-truth semantics",
    "Disclosure changed by applied suggestions",
    "Initial mapping differs between C and D",
    "Holdout and feedback-set correct transformations, incorrect, quarantined (replayed by src/evaluation/aggregate.ts)",
    "Field-level holdout errors: organization/contactName swapped, customerSince day/month swapped",
    "Schema-valid semantic errors (semantic verifier)",
    "Latency: Nano ms, cloud ms",
    "Cloud request count, human interventions, private terms in request bodies, model/provider failures",
  ],
  files: Object.fromEntries(FROZEN_FILES.map((path) => [path, sha(path)])),
  amendments: [...(previous?.amendments ?? [])],
};
if (amendIndex >= 0) manifest.amendments.push({ at: new Date().toISOString(), reason: process.argv[amendIndex + 1] ?? "unspecified" });

fs.mkdirSync("docs/evidence/sprint-12", { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`freeze-nano-value: wrote ${out} (${FROZEN_FILES.length} files)`);
