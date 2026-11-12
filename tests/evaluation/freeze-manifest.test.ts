/**
 * Sprint 8 freeze guard: every frozen benchmark input still has the hash
 * recorded before the live runs. A deliberate post-freeze change must be
 * recorded with `node scripts/freeze-benchmark.mjs --amend "reason"`, which
 * keeps the original freeze time and lists the amendment.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import manifestJson from "../../docs/evidence/sprint-8/freeze-manifest.json" with { type: "json" };

const manifest = manifestJson as unknown as { files: Record<string, string>; budget: { maxCloudRequests: number; trials: number[]; retries: string } };

describe("EVAL-080 benchmark inputs are frozen", () => {
  it.each(Object.entries(manifest.files))("%s matches the freeze manifest", (path, hash) => {
    expect(createHash("sha256").update(fs.readFileSync(path)).digest("hex")).toBe(hash);
  });

  it("declares the budget, the stop rule and no retries", () => {
    expect(manifest.budget.maxCloudRequests).toBe(60);
    expect(manifest.budget.trials).toEqual([1, 2, 3, 4, 5]);
    expect(manifest.budget.retries).toMatch(/^none/);
  });
});
