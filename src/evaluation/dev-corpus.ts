/**
 * Sprint 18D development corpus: every RECORDED real Gemini answer that still
 * replays byte-identically against today's prompt reconstruction.
 *
 * Inspected holdouts (18C, 18D) are DEVELOPMENT data from here on: they can
 * never again support a success claim. A claim needs a new independent holdout.
 *
 * Pure and offline: reads fixtures and evidence files, sends nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { ARMS_18D, buildScenario18d, type Eval18dScenario } from "./eval-18d.ts";
import type { Built18b } from "./eval-18b.ts";

export interface CorpusItem {
  set: "18c-holdout" | "18d-dev" | "18d-holdout";
  arm: string;
  trial: number;
  index: number;
  scenario: Eval18dScenario;
  built: Built18b;
  answer: string;
}

const list = (dir: string) => fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(dir, name));
const load = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Eval18dScenario;

interface Entry {
  config: string;
  trial: number;
  index: number;
  attempt?: number;
  httpStatus: number[];
  answers: string[];
  promptSha256: string[];
}

/** The last answered attempt per (config, trial, index), HTTP 200 only. */
function finalAnswers(entries: Entry[]): Entry[] {
  const out = new Map<string, Entry>();
  for (const entry of entries) {
    const key = `${entry.config}:${entry.trial}:${entry.index}`;
    const previous = out.get(key);
    if (!previous || (entry.attempt ?? 1) >= (previous.attempt ?? 1)) out.set(key, entry);
  }
  return [...out.values()].filter((entry) => entry.httpStatus.at(-1) === 200 && (entry.answers.at(-1) ?? "").length > 0);
}

/** Every replayable recorded answer. `mismatched` counts answers whose prompt no longer reconstructs (excluded). */
export async function loadDevCorpus(): Promise<{ items: CorpusItem[]; mismatched: number }> {
  const items: CorpusItem[] = [];
  let mismatched = 0;
  const add = async (set: CorpusItem["set"], files: string[], entries: Entry[], armOf: (config: string) => string | null) => {
    for (const entry of finalAnswers(entries)) {
      const arm = armOf(entry.config);
      const file = files[entry.index];
      if (!arm || !file) continue;
      const scenario = load(file);
      const built = await buildScenario18d(scenario, ARMS_18D[arm]!);
      if (!built || built.promptSha256 !== entry.promptSha256.at(-1)) {
        mismatched += 1;
        continue;
      }
      items.push({ set, arm, trial: entry.trial, index: entry.index, scenario, built, answer: entry.answers.at(-1)! });
    }
  };
  const read = (file: string) => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Entry[]) : []);
  // 18C P1 = arm A exactly (proved by prompt hash).
  await add("18c-holdout", list("tests/fixtures/eval-18c/holdout"), read("docs/evidence/sprint-18c/reliability-live.json"), (config) => (config === "P1" ? "A" : null));
  await add("18d-dev", ["tests/fixtures/eval-18b/dev", "tests/fixtures/eval-18c/dev", "tests/fixtures/eval-18d/dev"].flatMap(list), read("docs/evidence/sprint-18d/stage1-live.json"), (config) => (ARMS_18D[config] ? config : null));
  await add("18d-holdout", list("tests/fixtures/eval-18d/holdout"), read("docs/evidence/sprint-18d/stage2-live.json"), (config) => (ARMS_18D[config] ? config : null));
  return { items, mismatched };
}
