/**
 * Sprint 18E Phase 1 — Gemini vs local-matcher disagreement statistics (EXPLORATORY).
 * Recorded real Gemini answers only (src/evaluation/dev-corpus.ts); consumed holdouts are diagnosis data, never proof.
 * EYES_DIAG_18E=1 pnpm vitest run tests/evaluation/disagreement-18e.test.ts --silent=false   (aggregates only)
 */
import { describe, expect, it } from "vitest";
import { loadDevCorpus } from "../../src/evaluation/dev-corpus.ts";
import { ARMS_18D, localCandidates18d } from "../../src/evaluation/eval-18d.ts";
import { gtPaths } from "../../src/evaluation/eval-18b.ts";
import { parseIntentPlanText, validateIntentPlan } from "../../src/plan/validate.ts";

type Cell = { n: number; geminiRight: number; localRight: number; bothWrong: number };
const cell = (): Cell => ({ n: 0, geminiRight: 0, localRight: 0, bothWrong: 0 });

describe.runIf(process.env.EYES_DIAG_18E === "1")("DIAG-18E disagreement statistics", () => {
  it("agreement / disagreement by strength, confidence and target kind; no-source decisions", async () => {
    const { items, mismatched } = await loadDevCorpus();
    expect(mismatched).toBe(0);
    const table: Record<string, Cell> = {};
    const add = (key: string, geminiRight: boolean, localRight: boolean) => {
      const c = (table[key] ??= cell());
      c.n += 1;
      if (geminiRight) c.geminiRight += 1;
      if (localRight) c.localRight += 1;
      if (!geminiRight && !localRight) c.bothWrong += 1;
    };
    const noSource: Record<string, number> = {};
    let picks = 0;
    for (const item of items) {
      const arm = ARMS_18D[item.arm]!;
      const parsed = parseIntentPlanText(item.answer);
      const validation = parsed.ok ? validateIntentPlan(parsed.value, item.built.payload, { ranked: arm.planner === "intent-plan-2" }) : parsed;
      if (!validation.ok) continue;
      const sets = new Map(localCandidates18d(item.scenario, item.built.prepared).map((set) => [set.target, set]));
      for (const validated of validation.value.entries) {
        if (validated.verdict === "rejected") continue;
        const entry = validated.entry;
        const truthEntry = item.scenario.groundTruth[entry.target];
        if (!truthEntry || truthEntry.transform === "concat") continue;
        const truth = gtPaths(truthEntry)?.[0] ?? null;
        const set = sets.get(entry.target);
        const top = set?.candidates[0] ?? null;
        const second = set?.candidates[1] ?? null;
        if (entry.status === "no_source" || entry.from.length === 0) {
          // No-source decisions: Gemini says none.
          const key = `gemini-none:truth-${truth ? "has-source" : "none"}:local-${!top ? "none" : set!.uncertainty}${top && truth ? (top.path === truth ? "-right" : "-wrong") : ""}`;
          noSource[key] = (noSource[key] ?? 0) + 1;
          continue;
        }
        if (entry.from.length !== 1) continue;
        const pick = item.built.prepared.twin.bindings.resolve(entry.from[0]!);
        if (!pick) continue;
        picks += 1;
        const geminiRight = pick === truth;
        const localRight = top?.path === truth && truth !== null;
        const kind = truthEntry.transform === "map_enum" ? "category" : truthEntry.transform === "parse_date" ? "date" : truth === null ? "no-source-target" : "value";
        const listed = set?.candidates.findIndex((c) => c.path === pick) ?? -1;
        const contradicted = Boolean(set?.contradicted?.includes(pick));
        const relation = !top ? "local-none" : top.path === pick ? "agree" : "disagree";
        // Disagreement strength: local clear about another field and Gemini's pick not listed / listed lower / contradicted.
        const strength =
          relation !== "disagree"
            ? relation
            : contradicted
              ? "disagree:contradicted"
              : set!.uncertainty === "clear" && listed < 0
                ? "disagree:clear-unlisted"
                : set!.uncertainty === "clear"
                  ? "disagree:clear-listed"
                  : listed < 0
                    ? "disagree:ambiguous-unlisted"
                    : "disagree:ambiguous-listed";
        add(`strength|${strength}`, geminiRight, localRight);
        add(`conf|${entry.confidence}|${relation}`, geminiRight, localRight);
        add(`kind|${kind}|${relation}`, geminiRight, localRight);
        add(`all|${relation}`, geminiRight, localRight);
        if (relation === "disagree" && top && second) {
          const margin = top.score - second.score;
          add(`margin|${margin >= 4 ? ">=4" : margin >= 2 ? "2-4" : margin >= 1 ? "1-2" : "<1"}`, geminiRight, localRight);
        }
      }
    }
    const rows = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)).map(([key, c]) => [key, `n=${c.n} gemini=${c.geminiRight} local=${c.localRight} bothWrong=${c.bothWrong} geminiErr=${c.n ? (1 - c.geminiRight / c.n).toFixed(2) : "-"}`]));
    console.log(JSON.stringify({ items: items.length, picks, rows, noSource }, null, 1));
  }, 900_000);
});

/* Phase 3 — counterfactual replay of the recorded answers: base (18C rule) vs local (18E agreement classes). EXPLORATORY. */
import { compileIntentPlan } from "../../src/plan/compile.ts";
import { POLICIES_18D, scorePlan18d, summarize18d, type Score18d } from "../../src/evaluation/eval-18d.ts";

describe.runIf(process.env.EYES_DIAG_18E === "1")("DIAG-18E counterfactual replay", () => {
  it("interceptions, unnecessary questions and end-to-end outcomes", async () => {
    const { items } = await loadDevCorpus();
    const counts = { geminiExecutedBase: 0, interceptedWrong: 0, questionedRight: 0, newlyAskedNoSourceRight: 0, newlyAskedNoSourceWrongTruthNone: 0 };
    const scores: Record<string, Score18d[]> = {};
    for (const item of items) {
      const arm = ARMS_18D[item.arm]!;
      for (const policy of [POLICIES_18D.base!, POLICIES_18D.local!]) {
        const score = scorePlan18d(item.scenario, item.built, item.answer, { arm, policy, trial: item.trial, index: item.index });
        for (const key of [`${policy.id}|ALL`, `${policy.id}|${item.set}`, `${policy.id}|track:${item.scenario.track ?? "general"}`]) (scores[key] ??= []).push(score);
      }
      const parsed = parseIntentPlanText(item.answer);
      const validation = parsed.ok ? validateIntentPlan(parsed.value, item.built.payload, { ranked: arm.planner === "intent-plan-2" }) : parsed;
      if (!validation.ok) continue;
      const base = { validated: validation.value, disclosure: item.built.payload, prepared: item.built.prepared, records: item.scenario.records, answers: { fieldMatches: {}, categoryMeanings: {}, semanticConfirmations: {} }, requestId: "cf000000" };
      const before = compileIntentPlan(base);
      const after = compileIntentPlan({ ...base, local: { localCandidates: localCandidates18d(item.scenario, item.built.prepared), askOnLocalEvidence: true } });
      for (const field of before.fields) {
        const truthEntry = item.scenario.groundTruth[field.target];
        if (!truthEntry) continue;
        const truth = gtPaths(truthEntry);
        const now = after.fields.find((candidate) => candidate.target === field.target)!;
        const corr = field.correspondence?.aliases.map((alias) => item.built.prepared.twin.bindings.resolve(alias)) ?? [];
        const right = truth !== null && corr.length === truth.length && corr.every((p) => truth.includes(p!));
        // An executed Gemini match (or one awaiting only a translation) in base that the new rule turns into a field question.
        const baseKeeps = field.operation !== null || (field.correspondence !== null && !field.missing.includes("field-meaning"));
        const nowAsks = now.operation === null && now.missing.includes("field-meaning");
        if (field.correspondence?.by === "gemini" && baseKeeps) {
          counts.geminiExecutedBase += 1;
          if (nowAsks && !right) counts.interceptedWrong += 1;
          if (nowAsks && right) counts.questionedRight += 1;
        }
        if (field.readiness === "no_source" && nowAsks) {
          if (truth !== null) counts.newlyAskedNoSourceRight += 1;
          else counts.newlyAskedNoSourceWrongTruthNone += 1;
        }
      }
    }
    const table = Object.fromEntries(
      Object.entries(scores).sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
        const s = summarize18d(list);
        return [key, `E1 ${s.e2eSuccess}/${s.completableSent} (${s.e2eRate}) E2 ${s.incorrectTransformed}/${s.transformed} (${s.incorrectRate}) S5 ${s.falseVerified} E3 ${s.falseComplete} inv ${s.invented} U1 ${s.manualOpsPerTrial} U2 ${s.answersPerTrial}/${s.baselineAnswersPerTrial} U3 ${s.unnecessaryPerTrial}`];
      }),
    );
    console.log(JSON.stringify({ counts, table }, null, 1));
  }, 900_000);
});
