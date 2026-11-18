"""Writes eval-18d scenario files from the hand-written specs. Usage: python3 build.py"""
import json
import os

from lib import build
from specs_dev import SPECS as DEV
from specs_holdout_general import SPECS as HG
from specs_holdout_wedge import SPECS as HW

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for spec in DEV + HW + HG:
    out = build(spec)
    d = os.path.join(ROOT, spec["split"])
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, spec["id"] + ".json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
print("built", len(DEV + HW + HG), "scenarios")
