/**
 * Deterministic replay of the Sprint 7 live benchmark (run 3, final).
 *
 * The recorded REAL Gemini outputs (alias-level text) and the Nano suggestions
 * the user applied are fed back through the same pure pipeline. The counts the
 * browser displayed must be reproduced exactly: the evaluator, not the model,
 * owns every number in the report. Runs 1 and 2 used earlier prompt/validator
 * versions and are kept as historical evidence only.
 *
 * Sprint 8: the Sprint 7 holdout was inspected, so scenario v2.0.0 keeps it as
 * `development` and adds a fresh holdout. This replay evaluates the Sprint 7
 * holdout under its original role (`development`), without semantic feedback.
 */
import { describe, expect, it } from "vitest";
import run3 from "../../docs/evidence/sprint-7/live-blind-revision-run3.json" with { type: "json" };
import { scenarioById } from "../../src/evaluation/scenarios.ts";
import { runScenarioPipeline } from "../../src/evaluation/benchmark.ts";
import { DEFAULT_TWIN_SEED, type TwinFieldOverride } from "../../src/phantom/generate.ts";
import { isSemanticRole } from "../../src/phantom/roles.ts";
import type { OutcomeMetrics } from "../../src/verification/outcomes.ts";

interface Entry {
  check: string;
  scenarioId: string;
  initial: { text: string; origin: string };
  initialCounts?: string;
  holdoutCounts?: string;
  nano?: Array<{ alias: string; localPath: string; status: string; check: string }>;
  applied?: string[];
  revisedText?: string | null;
  revised?: { ok: string | null };
  revisionComparison?: { metrics: Record<string, [string, string]> | null };
  holdoutComparison?: { metrics: Record<string, [string, string]> | null };
  requests: { generateContent: number; leaks: string[] };
}

function counts(m: OutcomeMetrics): string {
  return `${m.transformedValid} transformed · ${m.handledByApprovedRule} by approved rule · ${m.quarantined} quarantined · ${m.unresolved} unresolved · ${m.rejectedByPolicy} rejected by policy · ${m.incorrect} incorrect · ${m.correctlyHandled}/${m.total} correctly handled`;
}

function table(before: OutcomeMetrics, after: OutcomeMetrics): Record<string, [string, string]> {
  const keys = ["transformedValid", "handledByApprovedRule", "quarantined", "unresolved", "rejectedByPolicy", "incorrect", "correctlyHandled"] as const;
  return Object.fromEntries(keys.map((key) => [key, [String(before[key]), String(after[key])]]));
}

/** Rebuild applied overrides from the fixed-vocabulary check line ("role text → organization"). */
function appliedOverrides(entry: Entry): Record<string, TwinFieldOverride> {
  const out: Record<string, TwinFieldOverride> = {};
  for (const alias of entry.applied ?? []) {
    const row = entry.nano?.find((item) => item.alias === alias);
    if (!row) continue;
    const role = /role \S+ → (\S+)/.exec(row.check)?.[1];
    const date = /date order \S+ → (MM\/DD\/YYYY|DD\/MM\/YYYY)/.exec(row.check)?.[1] as "MM/DD/YYYY" | "DD/MM/YYYY" | undefined;
    const override: TwinFieldOverride = {};
    if (role && isSemanticRole(role)) override.role = role;
    if (date) override.dateFormat = date;
    out[row.localPath] = override;
  }
  return out;
}

const entries = (run3 as unknown as { entries: Entry[] }).entries.filter((entry) => entry.initial?.origin === "Real Gemini output · IN_CLOUD");

describe("EVAL-010 live run 3 replays deterministically", () => {
  it("covers the recorded real runs and none leaked a private string", () => {
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const entry of entries) expect(entry.requests.leaks).toEqual([]);
  });

  it.each(entries.map((entry) => [`${entry.check} ${entry.scenarioId}`, entry] as const))("%s", async (_label, entry) => {
    const current = scenarioById(entry.scenarioId)!;
    const scenario = { ...current, holdout: current.development };
    const revise = entry.revisedText ? () => ({ text: entry.revisedText as string, origin: "gemini-cloud" as const }) : undefined;
    const run = await runScenarioPipeline({
      scenario,
      config: entry.check === "BENCH-B" ? "B-cloud" : "D-nano-cloud-revision",
      seed: DEFAULT_TWIN_SEED,
      semanticOverrides: appliedOverrides(entry),
      propose: () => ({ text: entry.initial.text, origin: "gemini-cloud" }),
      revise,
    });
    expect(run.initial.accepted).toBe(true);
    expect(counts(run.initial.evaluation!.metrics)).toBe(entry.initialCounts);
    if (entry.check === "BENCH-B") {
      expect(counts(run.initial.holdout!.metrics)).toBe(entry.holdoutCounts);
      return;
    }
    expect(run.revised?.accepted).toBe(entry.revised?.ok === "true");
    if (entry.revisionComparison?.metrics && run.revised?.evaluation) {
      expect(table(run.initial.evaluation!.metrics, run.revised.evaluation.metrics)).toEqual(entry.revisionComparison.metrics);
    }
    if (entry.holdoutComparison?.metrics && run.revised?.holdout) {
      expect(table(run.initial.holdout!.metrics, run.revised.holdout.metrics)).toEqual(entry.holdoutComparison.metrics);
    }
    expect(run.revisionPromptCheck ?? run.initialPromptCheck).toMatchObject({ canaryPresent: false, forbiddenKeys: [], privateMatches: 0 });
  });
});
