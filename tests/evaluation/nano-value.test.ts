/**
 * Sprint 12 Nano-value experiment (docs/evaluation/sprint-12-nano-value.md).
 *
 * EVAL-120 the experiment scenario is valid and its inputs are frozen.
 * EVAL-121 configuration A: what deterministic profiling alone establishes about
 *          the fields whose meaning the experiment asks about (no model).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EVALUATION_SCENARIOS, EXPERIMENT_SCENARIOS, scenarioById, validateScenario } from "../../src/evaluation/scenarios.ts";
import * as benchmark from "../../src/evaluation/benchmark.ts";
import { prepareScenario } from "./helpers.ts";

const freezePath = "docs/evidence/sprint-12/nano-value-freeze.json";
const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8")) as {
  files: Record<string, string>;
  budget: { maxCloudRequests: number; trials: number[]; retries: string };
  groundTruthSemantics: Record<string, { role: string; dateOrder?: string }>;
};

describe("EVAL-120 the Nano-value scenario is valid and frozen", () => {
  const scenario = scenarioById("crm-nl-relations")!;

  it("is valid, fictional, carries the canary and stays out of the Sprint 8 benchmark set", () => {
    expect(validateScenario(scenario)).toEqual([]);
    expect(JSON.stringify(scenario.imported)).toContain("PRIVATE_CANARY_PII_DO_NOT_SHARE");
    expect(EXPERIMENT_SCENARIOS.map((s) => s.scenarioId)).toEqual(["crm-nl-relations"]);
    expect(EVALUATION_SCENARIOS.map((s) => s.scenarioId)).not.toContain("crm-nl-relations");
  });

  it("every imported date is ambiguous; the hidden sets prove the day-first order", () => {
    const parts = (cases: typeof scenario.imported) => cases.map((c) => String(c.record.sinds).split("/").map(Number));
    expect(parts(scenario.imported).every(([a, b]) => a! <= 12 && b! <= 12)).toBe(true);
    expect(parts([...scenario.revisionFeedback, ...scenario.holdout]).some(([a]) => a! > 12)).toBe(true);
  });

  it.each(Object.entries(freeze.files))("%s matches the freeze manifest", (path, hash) => {
    expect(createHash("sha256").update(fs.readFileSync(path)).digest("hex")).toBe(hash);
  });

  it("declares a modest budget and no retries", () => {
    expect(freeze.budget.maxCloudRequests).toBe(6);
    expect(freeze.budget.trials).toEqual([1, 2, 3]);
    expect(freeze.budget.retries).toMatch(/^none/);
  });
});

describe("EVAL-121 configuration A: deterministic profiling alone", () => {
  it("records the role and date order the deterministic twin assigns, against the frozen ground truth", () => {
    const scenario = scenarioById("crm-nl-relations")!;
    const { prepared } = prepareScenario(scenario);
    const byPath = new Map(prepared.profile.fields.map((field) => [field.path, field]));
    const local = Object.fromEntries(
      prepared.twin.fields.map((field) => {
        const profile = byPath.get(field.localPath)!;
        return [field.localPath, { role: field.role, dateFormat: profile.dateFormat ?? null, dateOrderProven: profile.dateFormat ? !profile.dateFormatAmbiguous : null, descriptor: field.descriptor }];
      }),
    );
    // The deterministic result, pinned. H1 is about exactly these three fields.
    expect(local.bedrijf?.role).toBe("text");
    expect(local.contactpersoon?.role).toBe("text");
    expect(local.bedrijf?.descriptor).toBe(local.contactpersoon?.descriptor);
    expect(local.sinds).toMatchObject({ role: "date", dateFormat: "MM/DD/YYYY", dateOrderProven: false });
    const truth = freeze.groundTruthSemantics;
    const roleMatches = Object.entries(local).filter(([path, v]) => truth[path]?.role === v.role).map(([path]) => path).sort();
    expect(roleMatches).toEqual(["fase", "mailadres", "relatienr", "sinds"]);
  });
});

/**
 * EVAL-122 replay of the recorded real runs (alias-level model text and
 * browser-displayed counts only). Every number in nano-value-summary.json is
 * regenerated here by the deterministic pipeline.
 *   EYES_WRITE_NANO_VALUE=1 pnpm vitest run tests/evaluation/nano-value.test.ts
 */
const livePath = "docs/evidence/sprint-12/nano-value-live.json";
const summaryPath = "docs/evidence/sprint-12/nano-value-summary.json";

type Op = { op: string; from?: string; to: string; params?: { inputFormat?: string } };

describe.skipIf(!fs.existsSync(livePath))("EVAL-122 the Nano-value runs replay deterministically", () => {
  it("regenerates the committed summary from the recorded real outputs", async () => {
    const { buildBenchmarkReport } = await import("../../src/evaluation/aggregate.ts");
    const raw = fs.readFileSync(livePath);
    const entries = JSON.parse(raw.toString("utf8")) as import("../../src/evaluation/aggregate.ts").LiveEntry[];
    const report = await buildBenchmarkReport(entries, EXPERIMENT_SCENARIOS, createHash("sha256").update(raw).digest("hex"));
    const scenario = scenarioById("crm-nl-relations")!;
    const { alias } = prepareScenario(scenario);
    const truthAlias = { organization: alias("bedrijf"), contactName: alias("contactpersoon"), customerSince: alias("sinds") };
    // Field-level reading of each real initial mapping: the three meanings the experiment asks about.
    const fieldChoices = entries.map((entry) => {
      const ops = ((JSON.parse(entry.initial?.text ?? "{}") as { operations?: Op[] }).operations ?? []) as Op[];
      const to = (target: string) => ops.find((op) => op.to === target);
      return {
        config: entry.check === "S8-B" ? "C (deterministic twin)" : "D (Nano-enriched twin)",
        trial: entry.trial,
        organizationFromBedrijf: to("organization")?.from === truthAlias.organization,
        contactNameFromContactpersoon: to("contactName")?.from === truthAlias.contactName,
        customerSinceInputFormat: to("customerSince")?.params?.inputFormat ?? null,
        customerSinceCorrectOrder: to("customerSince")?.params?.inputFormat === "DD/MM/YYYY",
      };
    });
    const nanoMatches = entries
      .filter((entry) => entry.check === "S8-CD")
      .map((entry) => {
        const truth = freeze.groundTruthSemantics;
        const rows = entry.nano ?? [];
        const applicable = rows.filter((row) => row.status === "applicable");
        const correct = applicable.filter((row) => row.localPath && row.check?.includes(`→ ${truth[row.localPath]?.role}`));
        return { trial: entry.trial, applicable: applicable.map((row) => row.localPath), applicableMatchingGroundTruth: correct.map((row) => row.localPath), resolvedDateOrder: applicable.some((row) => row.check?.includes("DD/MM/YYYY")) };
      });
    const summary = { experiment: "sprint-12-nano-value", evidence: report.evidence, totals: report.totals, nano: report.nano, nanoMatches, fieldChoices, records: report.records.filter((record) => record.config === "B" || record.config === "C") };
    if (process.env.EYES_WRITE_NANO_VALUE === "1") fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    expect(JSON.parse(fs.readFileSync(summaryPath, "utf8"))).toEqual(JSON.parse(JSON.stringify(summary)));
    expect(report.totals.replayMismatches).toBe(0);
    expect(report.totals.cloudRequests).toBeLessThanOrEqual(6);
    for (const record of summary.records) {
      expect(record.privacy.canaryPresent, record.runId).toBe(false);
      // Aggregator config "B" = experiment C (deterministic twin): nothing private in the prompt.
      if (record.config === "B") expect(record.privacy.promptPrivateMatches, record.runId).toBe(0);
    }
  });

  it("the only scanner match in a Nano-enriched prompt is a fictional example word, not a source value", () => {
    // Experiment D applies Nano's organization / person-name roles. The twin then draws
    // fictional organization examples, one of which ("Copperfield Partners") contains the
    // generic word "partner": a hidden-set `fase` value that the twin never reads.
    const scenario = scenarioById("crm-nl-relations")!;
    const { privateVocabulary } = benchmark;
    const terms = privateVocabulary(scenario);
    const matched = (extra: Parameters<typeof prepareScenario>[1]) => {
      const { payload } = prepareScenario(scenario, extra);
      const approved = new Set<string>([...(payload.target?.fields ?? []).flatMap((f) => [f.name, ...(f.enumValues ?? [])]), ...payload.fields.flatMap((f) => f.enumValues ?? [])].map((v) => v.toLowerCase()));
      let text = JSON.stringify(payload).toLowerCase();
      for (const term of [...approved].sort((a, b) => b.length - a.length)) text = text.split(`"${term}"`).join('" "');
      return { payload, terms: [...terms].filter((term) => text.includes(term)).sort() };
    };
    expect(matched({}).terms).toEqual([]);
    const d = matched({ bedrijf: { role: "organization" }, contactpersoon: { role: "person-name" } });
    expect(d.terms).toEqual(["partner"]);
    expect(JSON.stringify(d.payload.syntheticExamples)).toContain("Copperfield Partners");
    // The twin reads imported records only; none of them contains the word.
    expect(JSON.stringify(scenario.imported).toLowerCase()).not.toContain("partner");
  });
});
