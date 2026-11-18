# Sprint 18D — Local schema matching: offline benchmark (DEV only)

Status: **offline evidence, dev split only.** Nothing here is wired into the app. No holdout was opened, listed or scored. Release status of this work: `CODE_READY` (nothing deployed).

## What was measured

For each destination field, a ranker returns up to three source fields. We score it against the scenario's `groundTruth`:

- **top-1 / top-3**: computed over destination fields that have a ground-truth source. For `concat`, any one of its `sources` counts. A hit means a correct path is first, or is among the first three.
- **false-offer rate**: computed over destination fields whose ground truth has **no** source. It is the share of those fields for which the ranker still offers a candidate.

Fixtures: `tests/fixtures/eval-18b/dev/` (4 scenarios) and `tests/fixtures/eval-18c/dev/` (4). `tests/fixtures/eval-18d/dev/` did not exist when these runs were made: only `eval-18d/author/` was present. Every script picks it up automatically once it exists. **N = 80 sourced destination fields** (42 in 18B, 38 in 18C) **and 9 no-source fields** (4 and 5).

| Ranker | Where | What it reads |
|---|---|---|
| Baseline | `rankCandidates` (`src/app/guided/field-plan.ts`, unchanged) | Profile, records, target. The top 3 of its list are scored. |
| Baseline suggestion | same | The product's single suggestion: the top candidate, only when it is `specific`. |
| **Local matcher** | `matchLocally` (`src/matching/local-matcher.ts`, `local-matcher-1`) | Profile, records, target, `localDescription`, twin concept ids. |
| Valentine | `scripts/bench/valentine/run_valentine.py` | Source DataFrame from the records. Destination DataFrame with the field names only and **zero rows**. |
| Embeddings | `scripts/bench/embeddings/run.mjs` | Source: name tokens + profiled type. Destination: name tokens + description. **No record values.** |
| Fusion | same | Reciprocal-rank fusion (k = 60, fixed) of the local matcher and embedding top-3. It abstains whenever the local matcher abstains. |

Evidence (aggregates only: counts, rates and timings, with no names or values):

- `docs/evidence/sprint-18d/local-matcher-dev.json`
- `docs/evidence/sprint-18d/valentine-dev.json`
- `docs/evidence/sprint-18d/embeddings-dev.json`

## Results (dev, N = 80 sourced / 9 no-source)

| Ranker | top-1 | top-3 | false-offer |
|---|---|---|---|
| Baseline `rankCandidates` (top 3 of its list) | 42 / 80 = **52.5 %** | 67 / 80 = 83.8 % | 9 / 9 = 100 % |
| Baseline single suggestion (`specific` only) | 32 / 80 = 40.0 % | — | 3 / 9 = 33 % |
| **Local matcher** | **67 / 80 = 83.8 %** | **75 / 80 = 93.8 %** | 4 / 9 = 44 % |
| Valentine Cupid (defaults) | 6 / 80 = 7.5 % | 6 / 80 = 7.5 % | 0 / 9 |
| Valentine SimilarityFlooding | 39 / 80 = 48.8 % | 53 / 80 = 66.3 % | 9 / 9 |
| Valentine COMA (schema only, Python port) | 36 / 80 = 45.0 % | 44 / 80 = 55.0 % | 1 / 9 |
| Valentine JaccardDistance (instance-based) | 0 / 80 | 0 / 80 | 0 / 9 |
| Embeddings, multilingual-e5-small q8 | 51 / 80 = 63.8 % | 66 / 80 = 82.5 % | 9 / 9 (no gate) |
| Embeddings, paraphrase-multilingual-MiniLM-L12-v2 q8 | 42 / 80 = 52.5 % | 57 / 80 = 71.3 % | 9 / 9 (no gate) |
| Fusion: local + e5-small | 60 / 80 = 75.0 % | 71 / 80 = 88.8 % | 4 / 9 |
| Fusion: local + MiniLM-L12 | 52 / 80 = 65.0 % | 73 / 80 = 91.3 % | 4 / 9 |

### By set (top-1 / top-3 / sourced; false offers / no-source)

| Set | Baseline | Local matcher |
|---|---|---|
| eval-18b dev | 18 / 32 / 42; 4 / 4 | 35 / 40 / 42; 0 / 4 |
| eval-18c dev | 24 / 35 / 38; 5 / 5 | 32 / 35 / 38; 4 / 5 |

### By ground-truth transform (top-1 / top-3 of sourced)

| Transform | n | Baseline | Local | SimFlooding | COMA | e5 | e5 fusion |
|---|---|---|---|---|---|---|---|
| copy | 31 | 13 / 24 | 28 / 31 | 17 / 23 | 16 / 18 | 16 / 24 | 23 / 29 |
| map_enum | 18 | 9 / 14 | 14 / 15 | 10 / 12 | 7 / 10 | 12 / 15 | 12 / 15 |
| parse_date | 13 | 7 / 13 | 9 / 13 | 3 / 3 | 5 / 5 | 7 / 10 | 9 / 11 |
| normalize_email | 8 | 8 / 8 | 8 / 8 | 6 / 7 | 7 / 7 | 8 / 8 | 8 / 8 |
| trim | 8 | 4 / 6 | 6 / 6 | 2 / 6 | 1 / 2 | 6 / 7 | 6 / 6 |
| concat | 2 | 1 / 2 | 2 / 2 | 1 / 2 | 0 / 2 | 2 / 2 | 2 / 2 |

The local matcher's gain is mostly on `copy` (identifiers and names) and `map_enum`, which is where name translation and label overlap matter. Its main weakness is false offers on the 18C no-source fields (4 / 5): something compatible and similarly named exists but has a different meaning, for example a practice phone offered for an owner phone. The local matcher's uncertainty flag is the only guard there.

## Latency and size

| Option | Latency | Size / footprint |
|---|---|---|
| Local matcher | median 1.2 ms per scenario, max 4.4 ms (vitest, Node, all destination fields) | Two TS modules, no dependency. The lexicon is about 120 concept groups. |
| Valentine (Python 3.12.16) | COMA median 11 ms, SimilarityFlooding 328 ms, Cupid 178 ms (max 4.9 s) per scenario | venv ~1.0 GB: pandas, numpy, scipy, networkx, nltk, POT, PuLP + CBC binary (`cbcbox`, EPL-2.0), pydantic |
| Transformers.js 4.3.2, Node CPU (onnxruntime-node 1.30) | Cold first load **~30 s** (download + init, first run). Warm load ~1.1–1.3 s. Per-scenario embedding 80–100 ms median, 138 ms max. | `node_modules` 742 MB (onnxruntime-node, onnxruntime-web, sharp). Each q8 model is 135 MB on disk (ONNX file 118 MB + tokenizer). |

Browser WebGPU/WASM behaviour was **not measured in a browser**. All embedding numbers come from Node on CPU. A browser would download the same about 118 MB of weights per model, plus the onnxruntime-web WASM.

## Licenses

- Valentine 1.1.1: Apache-2.0. Dependencies: BSD-3 (pandas, numpy, networkx), MIT (POT, PuLP, pydantic), Apache-2.0 (nltk), **EPL-2.0 (cbcbox / CBC solver binary)**.
- `@huggingface/transformers` 4.3.2: Apache-2.0. The model weights carry their own model-card licenses, which were not reviewed for redistribution here.
- The local matcher is repository code (Apache-2.0).

## Environment notes

- Valentine was installed with `uv` into a Python 3.12.16 venv in the session scratchpad. It also installs and imports on the system Python 3.14.4; the benchmark was run on 3.12.
- **COMA**: valentine 1.1.1 ships a pure-Python COMA (`Coma(use_schema=True, use_instances=False)`), so it ran **without Java**. This is not the original Java COMA 3.0, so its numbers may differ from published COMA results.
- **JaccardDistance** and DistributionBased are instance matchers. The destination has no instances, so Jaccard returns nothing (shown as 0). DistributionBased was not run for the same reason. Feeding `expectedSamples` or ground truth as destination instances would leak the answer, so it was not done.
- Cupid at its default thresholds keeps only pairs above `th_accept = 0.7`. Hence it returns very few matches and has no false offers. No thresholds were tuned for any matcher.
- Embedding models were downloaded from the Hugging Face CDN into the scratchpad cache. No source data was sent.

## Privacy review

| Option | Remote inference | Network | Data exposure |
|---|---|---|---|
| Local matcher | none | none | Reads the profile and records in memory. Its output is paths, ordinal scores and fixed codes. LM-7 proves that no record value appears in the output. `types.ts` makes the output LOCAL ONLY: it never enters a cloud payload, log, telemetry or export. |
| Valentine | none | `pip` install only (offline benchmark) | It would need a Python runtime in the browser (Pyodide), and it reads full DataFrames. It is not usable in a client-only web app without a large runtime. |
| Transformers.js | none: inference is local ONNX | **Model download from a CDN.** This is a network fetch of public weights, but it reveals to the CDN that the app loaded a model (IP, timing). It needs a CSP and connect-src change, or self-hosting the weights on the app's origin. | The embedded text in this prototype is names and descriptions only, and it stays in memory. |

## Decision

**Build, do not integrate.** Keep the in-house local matcher (`local-matcher-1`) as the optional on-device ranking signal.

- **Valentine: do not integrate.** On these schema-only inputs, its best matcher is SimilarityFlooding (48.8 % top-1, 66.3 % top-3). That is below both the existing baseline and the local matcher. It is Python, with about 1 GB of dependencies and an EPL-2.0 solver binary. It cannot run client-only without Pyodide. Use it only as an offline reference benchmark.
- **Transformers.js: do not add it to the production bundle.**
  - Embeddings alone are worse than the local matcher: best is e5-small at −20.0 percentage points top-1 and −11.3 pp top-3.
  - Fusion with the local matcher is also worse than the local matcher alone:
    - e5-small fusion: −8.8 pp top-1 (60 vs 67 of 80) and −5.0 pp top-3 (71 vs 75).
    - MiniLM fusion: −18.8 pp top-1 and −2.5 pp top-3.
  - Fusion gives no false-offer gain either.
  - This is on dev only, with **N = 80 sourced and 9 no-source fields**. The sprint rule is "beat the simpler matcher by a meaningful margin", and the margin here is negative.
  - The cost is a 118 MB model per device, a CDN fetch and about 30 s for a cold first load.

## Threats to validity

- **Dev only, and not blind.** The local matcher was written after its author had looked at one dev fixture (eval-18c, vet scenario) to learn the fixture format.
- The lexicon was written from general business vocabulary, not from the fixtures. Dev fixtures use ordinary words, though, and some of those words are in the lexicon. Example: the Dutch "vervaldatum", which is the standard Dutch word for due date.
- No weight was changed after the benchmark ran. Even so, these dev numbers are optimistic. Any product claim needs a fresh, independently authored, pre-registered holdout. This sprint's holdout was not touched.
- The sample is small: 80 + 9 fields over 8 scenarios. One field is 1.25 pp of top-1.
- A ranker's top-3 hit is not a correct integration. The matcher ranks and never decides, and its output is never trusted semantic evidence.

## Reproduce

```bash
pnpm vitest run tests/evaluation/local-matcher-bench.test.ts                  # passes without writing
EYES_BENCH_WRITE=1 pnpm vitest run tests/evaluation/local-matcher-bench.test.ts
uv venv -p 3.12 $SCRATCH/v && VIRTUAL_ENV=$SCRATCH/v uv pip install -r scripts/bench/valentine/requirements.txt
$SCRATCH/v/bin/python -I scripts/bench/valentine/run_valentine.py --write
cp scripts/bench/embeddings/package.json $SCRATCH/emb/ && (cd $SCRATCH/emb && npm install)
EYES_EMB_DIR=$SCRATCH/emb node scripts/bench/embeddings/run.mjs --write          # Node ≥ 22.18 (type stripping)
```

## Addendum (orchestrator, 2026-11-18): full dev pool including the fresh 18D dev split

All benchmarks were rerun after the independent author delivered `tests/fixtures/eval-18d/dev/` (6 scenarios). The matcher author had not seen these when the matcher and its lexicon were written. Nothing was tuned afterwards.

Pool: 14 dev scenarios. 131 destination fields have a source and 16 have none.

| Ranker | Top-1 | Top-3 | False offers (no-source fields) |
| --- | --- | --- | --- |
| **`matchLocally`** | **0.817** | **0.931** | 7 / 16 |
| `rankCandidates` (existing) | 0.496 | 0.802 | — |
| Embeddings, multilingual-e5-small (q8) | 0.588 | 0.832 | 16 / 16 |
| Fusion, local + e5 (RRF, k = 60) | 0.748 | 0.901 | 7 / 16 |
| Embeddings, paraphrase-multilingual-MiniLM (q8) | 0.481 | 0.710 | 16 / 16 |
| Fusion, local + MiniLM | 0.618 | 0.901 | 7 / 16 |
| Valentine Similarity Flooding | 0.405 | 0.588 | 16 / 16 |
| Valentine COMA (schema, Python port) | 0.382 | 0.481 | 3 / 16 |
| Valentine Cupid | 0.061 | 0.061 | 0 / 16 |
| Valentine Jaccard | 0 | 0 | 0 / 16 |

**Fresh 18D dev split only:**

| Ranker | Top-1 | Top-3 |
| --- | --- | --- |
| `matchLocally` | 0.784 | 0.922 |
| `rankCandidates` | 0.451 | 0.745 |

**The decision stands: build, don't integrate.**
- Embeddings and Valentine are below the simple local matcher, alone and in fusion.
- They are not added to the app.
- The matcher's false-offer rate (7 / 16) is why it never executes anything and only orders questions or triggers one.
