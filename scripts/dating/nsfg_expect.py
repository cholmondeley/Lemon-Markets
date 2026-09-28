# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy"]
# ///
"""Who expects to marry: never-married women and men by age, NSFG 2017-2019 (the last wave that asked).
Writes src/data/dating/expect.json.

MARRCHANCE (women CD-16, men JG-9): "Looking to the future, do you think you will ever get married?"
Definitely / probably yes / probably no / definitely no. All never-married respondents (cohabiting
ones included), weighted (WGT2017_2019). The model's searchers are women who want to marry, so the
census marriage rate it is fitted to is divided by the share of never-married women who expect to.
Data: https://www.cdc.gov/nchs/nsfg/nsfg_2017_2019_puf.htm (fixed-width .dat with the .dct setup files)
Run: uv run scripts/dating/nsfg_expect.py [dir with 2017_2019_*Data.dat and *Setup.dct]
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data"
OUT = ROOT / "src/data/dating/expect.json"
WANT = {"ager", "evrmarry", "marrchance", "wgt2017_2019"}
AGES = [(18, 19), (20, 22), (23, 25), (26, 28), (29, 31), (32, 34), (35, 39), (40, 49)]


def load(stem):
    specs = {}
    for line in open(SRC / f"{stem}Setup.dct"):
        m = re.match(r"\s*_column\((\d+)\)\s+\S+\s+(\S+)\s+%(\d+)", line)
        if m and m.group(2).lower() in WANT:
            start = int(m.group(1)) - 1
            specs[m.group(2).lower()] = (start, start + int(m.group(3)))
    names = list(specs)
    return pd.read_fwf(SRC / f"{stem}Data.dat", colspecs=[specs[n] for n in names], names=names, header=None)


out = {"source": "NSFG 2017-2019, never-married respondents: share who think they will definitely or probably marry (MARRCHANCE), weighted.", "by_age": {}}
for sex, stem in [("women", "2017_2019_FemResp"), ("men", "2017_2019_Male")]:
    df = load(stem)
    df = df[(df.evrmarry == 0) & df.marrchance.between(1, 4)]
    rows = []
    for lo, hi in AGES:
        g = df[df.ager.between(lo, hi)]
        yes = float(np.average(g.marrchance <= 2, weights=g.wgt2017_2019))
        rows.append({"lo": lo, "hi": hi, "n": int(len(g)), "yes": round(yes, 4), "definitely": round(float(np.average(g.marrchance == 1, weights=g.wgt2017_2019)), 4)})
        print(f"{sex} {lo}-{hi}: n={len(g)} expect to marry {yes:.0%}")
    out["by_age"][sex] = rows
OUT.write_text(json.dumps(out, indent=1))
print(f"wrote {OUT.relative_to(ROOT)}")
