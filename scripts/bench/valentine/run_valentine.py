"""Sprint 18D offline Valentine benchmark (DEV fixtures only).

Not part of the app. Run from the repository root with an isolated venv:

    python -I scripts/bench/valentine/run_valentine.py [--write]

Source DataFrame: the scenario's records, flattened to dot paths (what the
profile calls a field path). Destination DataFrame: the destination schema's
field names as columns with NO rows. The destination has no instances in the
product, and expectedSamples / groundTruth are never used as instances (that
would leak the answer). Ground truth is read only to score.

Scoring is identical to tests/evaluation/local-matcher-bench.test.ts: top-1 /
top-3 over fields with a ground-truth source (any of `sources` for concat),
false-offer rate over fields without one. Writes aggregates only.

Never lists or opens a holdout directory.
"""

import json
import os
import sys
import time
from collections import defaultdict

import pandas as pd
from valentine import valentine_match
from valentine.algorithms import Coma, Cupid, JaccardDistanceMatcher, SimilarityFlooding

DEV_DIRS = ["tests/fixtures/eval-18b/dev", "tests/fixtures/eval-18c/dev", "tests/fixtures/eval-18d/dev"]
OUT = "docs/evidence/sprint-18d/valentine-dev.json"


def flatten(record, prefix=""):
    out = {}
    for key, value in record.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, path + "."))
        elif not isinstance(value, list):
            out[path] = value
    return out


def destination_fields(schema, prefix=""):
    names = []
    for key, spec in (schema.get("properties") or {}).items():
        if isinstance(spec, dict) and spec.get("type") == "object" and "properties" in spec:
            names.extend(destination_fields(spec, prefix + key + "."))
        else:
            names.append(prefix + key)
    return names


def fixtures():
    for directory in DEV_DIRS:
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if name.endswith(".json"):
                with open(os.path.join(directory, name), encoding="utf-8") as handle:
                    yield directory.split("/")[2], json.load(handle)


def matchers():
    return {
        "Cupid": lambda: Cupid(),
        "SimilarityFlooding": lambda: SimilarityFlooding(),
        "ComaSchema": lambda: Coma(use_instances=False, use_schema=True),
        # Instance-based: the destination has no instances, so this measures the degenerate case.
        "JaccardDistance": lambda: JaccardDistanceMatcher(),
    }


def rank(results, target_columns):
    by_target = defaultdict(list)
    for pair, score in results.items():
        if pair.source_table == "source" and pair.target_table == "target":
            source, target = pair.source_column, pair.target_column
        elif pair.source_table == "target" and pair.target_table == "source":
            source, target = pair.target_column, pair.source_column
        else:
            continue
        if score > 0:
            by_target[target].append((-float(score), source))
    return {name: [source for _, source in sorted(by_target.get(name, []))[:3]] for name in target_columns}


def empty():
    return {"sourced": 0, "top1": 0, "top3": 0, "noSource": 0, "offered": 0}


def add(tally, valid, ranked):
    if not valid:
        tally["noSource"] += 1
        tally["offered"] += 1 if ranked else 0
    else:
        tally["sourced"] += 1
        tally["top1"] += 1 if ranked and ranked[0] in valid else 0
        tally["top3"] += 1 if any(item in valid for item in ranked[:3]) else 0


def rates(tally):
    r = lambda n, d: None if d == 0 else round(n / d, 3)
    return {**tally, "top1Rate": r(tally["top1"], tally["sourced"]), "top3Rate": r(tally["top3"], tally["sourced"]), "falseOfferRate": r(tally["offered"], tally["noSource"])}


def main():
    loaded = list(fixtures())
    report = {"generatedBy": "scripts/bench/valentine/run_valentine.py", "split": "dev", "scenarios": len(loaded), "python": sys.version.split()[0], "matchers": {}}
    for label, make in matchers().items():
        overall, by_set, by_transform = empty(), defaultdict(empty), defaultdict(empty)
        latencies, errors = [], 0
        for set_name, fixture in loaded:
            source = pd.DataFrame([flatten(record) for record in fixture["records"]])
            target_columns = destination_fields(fixture["destination"])
            target = pd.DataFrame(columns=target_columns)
            started = time.perf_counter()
            try:
                ranked = rank(valentine_match([source, target], make(), df_names=["source", "target"]), target_columns)
            except Exception:  # a matcher failure is counted, never hidden
                errors += 1
                ranked = {name: [] for name in target_columns}
            latencies.append((time.perf_counter() - started) * 1000)
            for name, truth in fixture["groundTruth"].items():
                if name not in ranked:
                    continue
                valid = truth.get("sources") or ([truth["source"]] if truth.get("source") else [])
                for tally in (overall, by_set[set_name], by_transform[truth["transform"]]):
                    add(tally, valid, ranked[name])
        latencies.sort()
        report["matchers"][label] = {
            "overall": rates(overall),
            "bySet": {key: rates(value) for key, value in sorted(by_set.items())},
            "byTransform": {key: rates(value) for key, value in sorted(by_transform.items())},
            "errors": errors,
            "latencyMs": {"median": round(latencies[len(latencies) // 2], 1), "max": round(latencies[-1], 1)},
        }
    text = json.dumps(report, indent=2)
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
