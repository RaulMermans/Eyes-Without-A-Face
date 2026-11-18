/**
 * Sprint 18D offline local-matching benchmark (DEV fixtures only).
 *
 * BENCH-18D-1  per destination field with a ground-truth source: top-1 / top-3
 *              recall of the Sprint 15/16B baseline `rankCandidates` and of
 *              `matchLocally`; per field without a source: the rate at which
 *              each ranker still offers a candidate. By split set, overall and
 *              by ground-truth transform.
 *
 * Reads only `tests/fixtures/eval-18{b,c,d}/dev/`. Never lists or opens a
 * holdout directory. With EYES_BENCH_WRITE=1 it writes aggregates (counts and
 * rates only, no field names or values) to docs/evidence/sprint-18d/.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rankCandidates } from "../../src/app/guided/field-plan.ts";
import type { GroundTruthEntry } from "../../src/evaluation/eval-18b.ts";
import { matchLocally } from "../../src/matching/local-matcher.ts";
import { MAX_LOCAL_CANDIDATES, type LocalTargetField } from "../../src/matching/types.ts";
import { DEFAULT_TWIN_SEED } from "../../src/phantom/generate.ts";
import { describeTargetSchema } from "../../src/twin/target-disclosure.ts";
import { prepareTwin } from "../../src/workflow/pipeline.ts";

const DEV_DIRS = ["tests/fixtures/eval-18b/dev", "tests/fixtures/eval-18c/dev", "tests/fixtures/eval-18d/dev"];
const OUT = "docs/evidence/sprint-18d/local-matcher-dev.json";

interface Fixture {
  scenarioId: string;
  records: Record<string, unknown>[];
  destination: Record<string, unknown>;
  groundTruth: Record<string, GroundTruthEntry>;
}

const fixtures = DEV_DIRS.flatMap((dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => ({ set: dir.split("/")[2] as string, fixture: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Fixture }))
    : [],
);

interface Tally {
  sourced: number;
  top1: number;
  top3: number;
  noSource: number;
  offered: number;
}
type RankerName = "baseline" | "baselineSuggested" | "local";
const empty = (): Tally => ({ sourced: 0, top1: 0, top3: 0, noSource: 0, offered: 0 });

interface Row {
  set: string;
  transform: string;
  valid: string[];
  ranked: Record<RankerName, string[]>;
  latencyMs: number;
}

function runFixture(set: string, fixture: Fixture): { rows: Row[]; localMs: number } {
  const prepared = prepareTwin({ records: fixture.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts: true });
  if (!prepared.ok) throw new Error(`${fixture.scenarioId}: twin not prepared`);
  const described = describeTargetSchema(fixture.destination);
  if (!described.ok) throw new Error(`${fixture.scenarioId}: destination not described`);
  const targets: LocalTargetField[] = described.value.target.fields.map((field) => ({ ...field, localDescription: described.value.localDescriptions[field.name] }));
  const conceptsByPath = Object.fromEntries(prepared.value.twin.fields.map((view) => [view.localPath, view.concept?.concept]));
  const t0 = performance.now();
  const local = matchLocally({ profile: prepared.value.profile, records: fixture.records, targets, conceptsByPath });
  const localMs = performance.now() - t0;
  const rows: Row[] = [];
  for (const [name, truth] of Object.entries(fixture.groundTruth)) {
    const target = targets.find((item) => item.name === name);
    if (!target) continue;
    const baseline = rankCandidates(prepared.value, fixture.records, target);
    rows.push({
      set,
      transform: truth.transform,
      valid: truth.sources ?? (truth.source ? [truth.source] : []),
      ranked: {
        baseline: baseline.slice(0, MAX_LOCAL_CANDIDATES).map((item) => item.path),
        // What the product offers as its one suggestion: the top candidate, only when it has specific evidence.
        baselineSuggested: baseline[0]?.specific ? [baseline[0].path] : [],
        local: (local.find((set) => set.target === name)?.candidates ?? []).map((item) => item.path),
      },
      latencyMs: localMs,
    });
  }
  return { rows, localMs };
}

function tally(rows: Row[], ranker: RankerName): Tally {
  const out = empty();
  for (const row of rows) {
    const ranked = row.ranked[ranker];
    if (row.valid.length === 0) {
      out.noSource += 1;
      if (ranked.length > 0) out.offered += 1;
    } else {
      out.sourced += 1;
      if (ranked[0] !== undefined && row.valid.includes(ranked[0])) out.top1 += 1;
      if (ranked.slice(0, 3).some((item) => row.valid.includes(item))) out.top3 += 1;
    }
  }
  return out;
}

const rate = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 1000) / 1000);
const summarize = (rows: Row[]) =>
  Object.fromEntries(
    (["baseline", "baselineSuggested", "local"] as const).map((ranker) => {
      const t = tally(rows, ranker);
      return [ranker, { ...t, top1Rate: rate(t.top1, t.sourced), top3Rate: rate(t.top3, t.sourced), falseOfferRate: rate(t.offered, t.noSource) }];
    }),
  );

describe("BENCH-18D-1 local matcher vs baseline on DEV fixtures", () => {
  const runs = fixtures.map(({ set, fixture }) => runFixture(set, fixture));
  const rows = runs.flatMap((run) => run.rows);

  it("reads at least the 18B and 18C dev splits and never a holdout", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(DEV_DIRS.every((dir) => dir.endsWith("/dev"))).toBe(true);
  });

  it("is at least as good as the baseline at top-3 overall, and writes aggregates on request", () => {
    const overall = summarize(rows);
    const bySet = Object.fromEntries([...new Set(rows.map((row) => row.set))].map((set) => [set, { scenarios: fixtures.filter((item) => item.set === set).length, ...summarize(rows.filter((row) => row.set === set)) }]));
    const byTransform = Object.fromEntries([...new Set(rows.map((row) => row.transform))].sort().map((transform) => [transform, summarize(rows.filter((row) => row.transform === transform))]));
    const latencies = runs.map((run) => run.localMs).sort((a, b) => a - b);
    const report = {
      generatedBy: "tests/evaluation/local-matcher-bench.test.ts",
      split: "dev",
      scoring:
        "top-1/top-3: a destination field with a ground-truth source (or any of `sources` for concat) is a hit when that path is the first / among the first three candidates. falseOfferRate: share of fields WITHOUT a ground-truth source for which the ranker offers any candidate. baseline = rankCandidates (all compatible fields, top 3 shown); baselineSuggested = the product's single suggestion (top candidate only when `specific`).",
      scenarios: fixtures.length,
      overall,
      bySet,
      byTransform,
      localMatcherLatencyMs: { scenarios: latencies.length, median: Math.round((latencies[Math.floor(latencies.length / 2)] ?? 0) * 100) / 100, max: Math.round((latencies.at(-1) ?? 0) * 100) / 100 },
    };
    const local = overall.local as Tally;
    const base = overall.baseline as Tally;
    expect(local.sourced).toBe(base.sourced);
    expect(local.top3).toBeGreaterThanOrEqual(base.top3);
    // The evidence carries counts and rates only: no field name, path or value.
    const text = JSON.stringify(report);
    for (const row of rows) for (const valid of row.valid) expect(text.includes(`"${valid}"`)).toBe(false);
    if (process.env.EYES_BENCH_WRITE === "1") {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(JSON.stringify({ overall, bySet: Object.fromEntries(Object.entries(bySet).map(([k, v]) => [k, { local: (v as Record<string, unknown>).local, baseline: (v as Record<string, unknown>).baseline }])) }, null, 1));
  });
});
