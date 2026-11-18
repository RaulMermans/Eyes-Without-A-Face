/**
 * Sprint 18D failure dissection over the development corpus (recorded real Gemini answers, replayed offline).
 * EYES_DIAGNOSE=1 pnpm vitest run tests/evaluation/diagnose-18d.test.ts --silent=false
 * Optional: EYES_DIAGNOSE_POLICY=base|rank|local (default local). Aggregates only.
 */
import { describe, expect, it } from "vitest";
import { loadDevCorpus } from "../../src/evaluation/dev-corpus.ts";
import { ARMS_18D, localCandidates18d, POLICIES_18D, runOracle18d, scorePlan18d, summarize18d, type Score18d } from "../../src/evaluation/eval-18d.ts";

import { gtPaths } from "../../src/evaluation/eval-18b.ts";
import { parseIntentPlanText, validateIntentPlan } from "../../src/plan/validate.ts";

describe.runIf(process.env.EYES_DIAGNOSE === "1")("DIAG-18D failure dissection", () => {
  it("per-field causes and single-fix counterfactuals", async () => {
    const { items, mismatched } = await loadDevCorpus();
    expect(mismatched).toBe(0);
    const policy = POLICIES_18D[process.env.EYES_DIAGNOSE_POLICY ?? "local"]!;
    const bySet: Record<string, Score18d[]> = {};
    const fields: Record<string, number> = {};
    const fixAlone: Record<string, number> = {};
    let failed = 0;
    for (const item of items) {
      const arm = ARMS_18D[item.arm]!;
      const score = scorePlan18d(item.scenario, item.built, item.answer, { arm, policy, trial: item.trial, index: item.index });
      (bySet[`${item.set}/${item.arm}`] ??= []).push(score);
      (bySet[`ALL/${item.arm}`] ??= []).push(score);
      if (!item.scenario.completable || score.e2eSuccess) continue;
      failed += 1;
      const parsed = parseIntentPlanText(item.answer);
      const validation = parsed.ok ? validateIntentPlan(parsed.value, item.built.payload, { ranked: arm.planner === "intent-plan-2" }) : parsed;
      if (!validation.ok) {
        fixAlone["plan-rejected"] = (fixAlone["plan-rejected"] ?? 0) + 1;
        continue;
      }
      const sets = localCandidates18d(item.scenario, item.built.prepared);
      const oracle = runOracle18d(
        { validated: validation.value, disclosure: item.built.payload, prepared: item.built.prepared, records: item.scenario.records, requestId: "diag0000", ...(policy.local ? { local: { localCandidates: sets, askOnLocalEvidence: policy.askOnLocalEvidence } } : {}) },
        item.scenario,
      );
      const asked = new Map(oracle.asked.map((question) => [question.target, question.kind]));
      const causes = new Set<string>();
      for (const field of oracle.compiled.fields) {
        const truthEntry = item.scenario.groundTruth[field.target];
        if (!truthEntry) continue;
        const truth = gtPaths(truthEntry);
        const set = sets.find((candidate) => candidate.target === field.target);
        const local = !truth ? "" : set?.candidates[0]?.path === truth[0] ? (set?.uncertainty === "clear" ? "L1clear" : "L1amb") : set?.candidates.some((c) => c.path === truth[0]) ? "L3" : "Lmiss";
        const kind = truthEntry.transform === "map_enum" ? "category" : truthEntry.transform === "parse_date" ? "date" : truthEntry.transform === "concat" ? "concat" : "value";
        const from = field.operation ? (field.operation.op === "concat" ? field.operation.from : [(field.operation as { from: string }).from]).map((alias) => item.built.prepared.twin.bindings.resolve(alias)) : null;
        let cause = "";
        if (truth === null) cause = field.operation ? "filled-no-source" : "";
        else if (!field.operation) cause = `unfilled:${kind}:${field.required ? "req" : "opt"}:${asked.get(field.target) ?? "not-asked"}:${local}`;
        else if (JSON.stringify([...from!].sort()) !== JSON.stringify([...truth].sort())) cause = `wrong-source:${kind}:${asked.has(field.target) ? "asked" : "silent"}:${local}`;
        else if (field.operation.op !== truthEntry.transform && !(truthEntry.transform === "copy" && field.operation.op === "trim")) cause = `wrong-op:${truthEntry.transform}->${field.operation.op}`;
        if (!cause) continue;
        fields[cause] = (fields[cause] ?? 0) + 1;
        causes.add(cause.split(":").slice(0, 2).join(":"));
      }
      if (causes.size === 1) {
        const [only] = [...causes];
        fixAlone[only!] = (fixAlone[only!] ?? 0) + 1;
      } else fixAlone[`multi(${causes.size})`] = (fixAlone[`multi(${causes.size})`] ?? 0) + 1;
    }
    const table = Object.fromEntries(
      Object.entries(bySet).map(([key, scores]) => {
        const s = summarize18d(scores);
        return [key, { E1: `${s.e2eSuccess}/${s.completableSent}`, E2: s.incorrectRate, S5: s.falseVerified, E3: s.falseComplete, U2: `${s.answersPerTrial}/${s.baselineAnswersPerTrial}`, gT1: s.geminiTop1, lT1: s.localTop1 }];
      }),
    );
    const sorted = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]));
    console.log(JSON.stringify({ policy: policy.id, items: items.length, failed, table, singleCauseFailures: sorted(fixAlone), fieldCauses: sorted(fields) }, null, 1));
  }, 900_000);
});
