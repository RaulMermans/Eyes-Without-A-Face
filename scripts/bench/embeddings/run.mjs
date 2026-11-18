/**
 * Sprint 18D offline embedding prototype (Node, CPU). NOT part of the app bundle.
 *
 *   EYES_EMB_DIR=<dir with node_modules from ./package.json> node scripts/bench/embeddings/run.mjs [--write]
 *
 * Model weights are downloaded once from the Hugging Face CDN (a network fetch
 * of PUBLIC weights; no data is sent) into $EYES_EMB_DIR/models.
 *
 * Embedded text (no record values, ever):
 *   source field       its name tokens (each path segment split) + its profiled type
 *   destination field  its name tokens + its schema description
 *
 * Rankers scored with the rules of tests/evaluation/local-matcher-bench.test.ts:
 *   embedding  cosine top-3 over every supported source field (no type gate, no abstention)
 *   fusion     reciprocal-rank fusion (k = 60, fixed, not tuned) of the local matcher's
 *              list and the embedding top-3; abstains whenever the local matcher abstains
 *   local      matchLocally alone (reference)
 * DEV fixtures only; never lists or opens a holdout directory. Writes aggregates only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { prepareTwin } from "../../../src/workflow/pipeline.ts";
import { describeTargetSchema } from "../../../src/twin/target-disclosure.ts";
import { DEFAULT_TWIN_SEED } from "../../../src/phantom/generate.ts";
import { matchLocally, splitName } from "../../../src/matching/local-matcher.ts";

const DEV_DIRS = ["tests/fixtures/eval-18b/dev", "tests/fixtures/eval-18c/dev", "tests/fixtures/eval-18d/dev"];
const OUT = "docs/evidence/sprint-18d/embeddings-dev.json";
const MODELS = [
  { id: "Xenova/multilingual-e5-small", prefix: "query: " },
  { id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", prefix: "" },
];
const RRF_K = 60;

const dir = process.env.EYES_EMB_DIR;
if (!dir) throw new Error("Set EYES_EMB_DIR to the directory where ./package.json was installed.");
const require = createRequire(path.join(dir, "package.json"));
const transformers = await import(pathToFileURL(require.resolve("@huggingface/transformers")).href);
const { pipeline, env } = transformers;
env.cacheDir = path.join(dir, "models");
env.allowLocalModels = false;

const fixtures = DEV_DIRS.flatMap((d) =>
  fs.existsSync(d)
    ? fs
        .readdirSync(d)
        .filter((n) => n.endsWith(".json"))
        .sort()
        .map((n) => ({ set: d.split("/")[2], fixture: JSON.parse(fs.readFileSync(path.join(d, n), "utf8")) }))
    : [],
);

const nameText = (p) => p.split(".").map((segment) => splitName(segment).join(" ")).join(" / ");
const cosine = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const empty = () => ({ sourced: 0, top1: 0, top3: 0, noSource: 0, offered: 0 });
const r3 = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);
const rates = (t) => ({ ...t, top1Rate: r3(t.top1, t.sourced), top3Rate: r3(t.top3, t.sourced), falseOfferRate: r3(t.offered, t.noSource) });
function add(t, valid, ranked) {
  if (valid.length === 0) {
    t.noSource += 1;
    if (ranked.length > 0) t.offered += 1;
  } else {
    t.sourced += 1;
    if (ranked[0] !== undefined && valid.includes(ranked[0])) t.top1 += 1;
    if (ranked.slice(0, 3).some((p) => valid.includes(p))) t.top3 += 1;
  }
}
const dirSize = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0) : 0);

const report = { generatedBy: "scripts/bench/embeddings/run.mjs", split: "dev", scenarios: fixtures.length, runtime: `node ${process.version} (onnxruntime-node, CPU)`, transformersVersion: transformers.env?.version ?? null, browserMeasured: false, models: {} };

for (const model of MODELS) {
  const cacheBefore = dirSize(path.join(env.cacheDir, model.id));
  const t0 = performance.now();
  const extract = await pipeline("feature-extraction", model.id, { dtype: "q8" });
  const loadMs = performance.now() - t0;
  const embed = async (texts) => (await extract(texts.map((t) => model.prefix + t), { pooling: "mean", normalize: true })).tolist();
  const rankers = { embedding: empty(), fusion: empty(), local: empty() };
  const bySet = {};
  const byTransform = {};
  const latencies = [];
  for (const { set, fixture } of fixtures) {
    const prepared = prepareTwin({ records: fixture.records, datasetLabel: "imported.json", seed: DEFAULT_TWIN_SEED, concepts: true });
    const described = describeTargetSchema(fixture.destination);
    if (!prepared.ok || !described.ok) throw new Error("fixture not buildable");
    const targets = described.value.target.fields.map((f) => ({ ...f, localDescription: described.value.localDescriptions[f.name] }));
    const fields = prepared.value.profile.fields.filter((f) => f.supported);
    const conceptsByPath = Object.fromEntries(prepared.value.twin.fields.map((v) => [v.localPath, v.concept?.concept]));
    const local = matchLocally({ profile: prepared.value.profile, records: fixture.records, targets, conceptsByPath });
    const s0 = performance.now();
    const sourceVecs = await embed(fields.map((f) => `${nameText(f.path)} (${f.type})`));
    const targetVecs = await embed(targets.map((t) => `${nameText(t.name)}${t.localDescription ? `: ${t.localDescription}` : ""}`));
    latencies.push(performance.now() - s0);
    targets.forEach((target, ti) => {
      const truth = fixture.groundTruth[target.name];
      if (!truth) return;
      const valid = truth.sources ?? (truth.source ? [truth.source] : []);
      const emb = fields
        .map((f, fi) => ({ path: f.path, s: cosine(targetVecs[ti], sourceVecs[fi]) }))
        .sort((a, b) => b.s - a.s || (a.path < b.path ? -1 : 1))
        .slice(0, 3)
        .map((x) => x.path);
      const loc = (local[ti]?.candidates ?? []).map((c) => c.path);
      const fused = new Map();
      loc.forEach((p, i) => fused.set(p, (fused.get(p) ?? 0) + 1 / (RRF_K + i + 1)));
      emb.forEach((p, i) => fused.set(p, (fused.get(p) ?? 0) + 1 / (RRF_K + i + 1)));
      const fusion = loc.length === 0 ? [] : [...fused.entries()].sort((a, b) => b[1] - a[1] || loc.indexOf(a[0]) - loc.indexOf(b[0]) || (a[0] < b[0] ? -1 : 1)).map(([p]) => p).slice(0, 3);
      for (const [name, ranked] of Object.entries({ embedding: emb, fusion, local: loc })) {
        add(rankers[name], valid, ranked);
        add(((bySet[set] ??= {})[name] ??= empty()), valid, ranked);
        add(((byTransform[truth.transform] ??= {})[name] ??= empty()), valid, ranked);
      }
    });
  }
  latencies.sort((a, b) => a - b);
  const map = (o) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, t]) => [n, rates(t)]))]));
  report.models[model.id] = {
    dtype: "q8",
    downloadBytes: dirSize(path.join(env.cacheDir, model.id)),
    downloadedThisRun: cacheBefore === 0,
    loadMs: Math.round(loadMs),
    perScenarioEmbedMs: { median: Math.round(latencies[Math.floor(latencies.length / 2)]), max: Math.round(latencies.at(-1)) },
    overall: Object.fromEntries(Object.entries(rankers).map(([n, t]) => [n, rates(t)])),
    bySet: map(bySet),
    byTransform: map(byTransform),
  };
  await extract.dispose?.();
}

const text = JSON.stringify(report, null, 2);
if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${text}\n`);
}
console.log(text);
