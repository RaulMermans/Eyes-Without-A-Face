"""Deterministically rebuilds eval-18f/holdout/ from the sealed specs. Run: python3 build.py"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import apply, shuffle_keys  # noqa: E402
import specs_holdout_wedge  # noqa: E402
import specs_holdout_general  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "holdout")


def flat_keys(o, pre=""):
    for k, v in o.items():
        if isinstance(v, dict):
            yield from flat_keys(v, pre + k + ".")
        else:
            yield pre + k


def pick_samples(sid, outcomes):
    rng = random.Random(sid + ":samples")
    idx = list(range(len(outcomes)))
    rng.shuffle(idx)
    held = [i for i in idx if outcomes[i][0] == "held"]
    trans = [i for i in idx if outcomes[i][0] == "transformed"]
    chosen, seen = [], set()
    for i in trans:  # prefer records whose set of present output fields is new
        ks = frozenset(flat_keys(outcomes[i][1]))
        if ks not in seen:
            seen.add(ks)
            chosen.append(i)
        if len(chosen) == 3:
            break
    for i in trans:
        if len(chosen) == 3:
            break
        if i not in chosen:
            chosen.append(i)
    chosen.append(held[0])
    out = []
    for i in sorted(chosen):
        s = {"recordIndex": i, "outcome": outcomes[i][0]}
        if outcomes[i][0] == "transformed":
            s["output"] = outcomes[i][1]
        out.append(s)
    return out


def build(spec):
    rng = random.Random(spec["id"])
    recs = [shuffle_keys(rng, r) for r in spec["gen"](rng, spec["n"])]
    sc = {
        "scenarioId": spec["id"], "split": "holdout", "track": spec["track"], "industry": spec["industry"],
        "sourceLanguage": spec["lang"], "description": spec["desc"], "fictional": True, "completable": spec["completable"],
        "records": recs, "destination": spec["dest"], "groundTruth": spec["gt"], "confusablePairs": spec["pairs"],
        "sourceConcepts": spec["sc"], "destinationConcepts": spec["dc"],
    }
    if spec["completable"]:
        outcomes = [apply(r, spec["dest"], spec["gt"]) for r in recs]
        sc["expectedSamples"] = pick_samples(spec["id"], outcomes)
    return sc


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))
    specs = specs_holdout_wedge.SC + specs_holdout_general.SC
    assert len({s["id"] for s in specs}) == len(specs)
    for spec in specs:
        with open(os.path.join(OUT, spec["id"] + ".json"), "w", encoding="utf-8") as fh:
            json.dump(build(spec), fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    print(f"wrote {len(specs)} scenarios")


if __name__ == "__main__":
    main()
