#!/usr/bin/env node
/**
 * Sprint 18A AI-value experiment — offline holdout scoring (O1–O5).
 *
 * Runs EVAL-182 once with EYES_AI_VALUE_HOLDOUT=1. It writes and prints the
 * T0/T1 AGGREGATES only (docs/evidence/sprint-18a/ai-value-offline-holdout.json).
 * No per-scenario or per-field holdout detail is computed into the output.
 *
 * Run this once, after the implementation is committed. A rerun after any
 * implementation change needs a fresh holdout (AGENTS.md, Sprint 8 rules).
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["-s", "vitest", "run", "tests/evaluation/ai-value.test.ts", "-t", "EVAL-182", "--silent=false"], {
  stdio: "inherit",
  env: { ...process.env, EYES_AI_VALUE_HOLDOUT: "1", EYES_AI_VALUE_DETAIL: "0" },
});
process.exit(result.status ?? 1);
