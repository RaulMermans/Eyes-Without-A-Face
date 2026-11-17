#!/usr/bin/env node
/**
 * Sprint 18B frozen scorer runner (docs/evaluation/sprint-18b-intent-plan.md).
 *
 *   node scripts/eval-18b.mjs --rehearse   zero requests: builds every holdout scenario for P0 and P2,
 *                                          proves prompt reconstruction, pre-scans privacy; prints counts only (EVAL-196)
 *   node scripts/eval-18b.mjs              scores docs/evidence/sprint-18b/intent-plan-live.json against the holdout and
 *                                          writes aggregates, per-index rows and the Gate B-AI verdict to
 *                                          docs/evidence/sprint-18b/intent-plan-live-summary.json (EVAL-197)
 *
 * Nothing holdout-specific (names, ids, fields, values) is printed or written.
 */
import { spawnSync } from "node:child_process";

const rehearse = process.argv.includes("--rehearse");
const result = spawnSync("pnpm", ["-s", "vitest", "run", "tests/evaluation/eval-18b.test.ts", "-t", rehearse ? "EVAL-196" : "EVAL-197", "--silent=false"], {
  stdio: "inherit",
  env: { ...process.env, ...(rehearse ? { EYES_EVAL_18B_REHEARSE: "1" } : { EYES_EVAL_18B_LIVE: "1" }) },
});
process.exit(result.status ?? 1);
