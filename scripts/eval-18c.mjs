#!/usr/bin/env node
/**
 * Sprint 18C frozen scorer runner (docs/evaluation/sprint-18c-reliability.md).
 *
 *   node scripts/eval-18c.mjs --rehearse   zero requests: builds every holdout scenario for P0 and P1, proves prompt
 *                                          reconstruction, pre-scans privacy, checks the author's samples; counts only (EVAL-208)
 *   node scripts/eval-18c.mjs              scores docs/evidence/sprint-18c/reliability-live.json and writes aggregates,
 *                                          per-index rows and the Gate C verdict to reliability-live-summary.json (EVAL-209)
 *
 * Nothing holdout-specific (names, ids, fields, values) is printed or written.
 */
import { spawnSync } from "node:child_process";

const rehearse = process.argv.includes("--rehearse");
const result = spawnSync("pnpm", ["-s", "vitest", "run", "tests/evaluation/eval-18c.test.ts", "-t", rehearse ? "EVAL-208" : "EVAL-209", "--silent=false"], {
  stdio: "inherit",
  env: { ...process.env, ...(rehearse ? { EYES_EVAL_18C_REHEARSE: "1" } : { EYES_EVAL_18C_LIVE: "1" }) },
});
process.exit(result.status ?? 1);
