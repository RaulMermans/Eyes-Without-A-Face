#!/usr/bin/env node
/**
 * Sprint 18D scorer runner (docs/evaluation/sprint-18d-semantic-intelligence.md).
 *
 *   node scripts/eval-18d.mjs --rehearse   zero requests: every arm builds every holdout scenario, privacy pre-scan,
 *                                          author sample check; counts only (EVAL-306)
 *
 * Nothing holdout-specific (names, ids, fields, values) is printed or written.
 */
import { spawnSync } from "node:child_process";

if (!process.argv.includes("--rehearse")) {
  console.error("Only --rehearse exists before a live stage is approved.");
  process.exit(1);
}
const result = spawnSync("pnpm", ["-s", "vitest", "run", "tests/evaluation/eval-18d.test.ts", "-t", "EVAL-306", "--silent=false"], {
  stdio: "inherit",
  env: { ...process.env, EYES_EVAL_18D_REHEARSE: "1" },
});
process.exit(result.status ?? 1);
