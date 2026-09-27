# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy"]
# ///
"""Men's status by age, and the scales the page's calculators read concrete answers on.
Writes src/data/dating/status.json. From the Dating Calculator's synthetic population (ACS-based).

  status_by_age   mean normal score of a man's earnings among all men 22-55, by age: how much a man's
                  status rises with age (his earnings rank climbs into his 40s);
  earnings        men's earnings quantiles by age band (a reader's income -> his percentile for his age);
  height          men's height quantiles (inches).
Run: uv run scripts/dating/status.py [path/to/dcalc_app_v2.parquet]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.stats import norm

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = Path.home() / "Desktop/Lemon dating/Dating app calculator data/dcalc_app_v2.parquet"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
OUT = ROOT / "src/data/dating/status.json"
QS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]


def wquant(x, w, qs):
    o = np.argsort(x)
    x, w = np.asarray(x)[o], np.asarray(w)[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return [float(np.interp(q, c, x)) for q in qs]


def main():
    df = pq.read_table(SRC, columns=["PWGTP", "sex", "age", "earnings", "height_inches"]).to_pandas()
    m = df[(df.sex == 1) & df.age.between(22, 55)].copy()
    # Weighted rank of earnings among all men 22-55 -> normal score (ties at $0 share the midpoint).
    o = np.argsort(m.earnings.values, kind="stable")
    e, w = m.earnings.values[o], m.PWGTP.values[o]
    cw = np.cumsum(w) / w.sum()
    s = pd.Series(cw - w / w.sum() / 2, index=m.index[o])
    ties = pd.DataFrame({"e": e, "p": s.values}).groupby("e").p.transform("mean").values
    m.loc[m.index[o], "z"] = norm.ppf(np.clip(ties, 1e-4, 1 - 1e-4))
    by_age = m.groupby("age").apply(lambda g: np.average(g.z, weights=g.PWGTP), include_groups=False)
    # How a man's rank for his age maps to his rank among all men: the pooled normal score at his
    # age's median (mu) and the spread of the top half (sigma, from the median to the 95th percentile),
    # so the top tail of status belongs mostly to older men.
    tail = {}
    for a, g in m.groupby("age"):
        q50, q90, q95 = wquant(g.z.values, g.PWGTP.values, [0.5, 0.9, 0.95])
        tail[int(a)] = {"mu": q50, "sigma": (q95 - q50) / 1.645, "z90": q90, "z95": q95}
    bands = {}
    for lo, hi in [(22, 26), (27, 31), (32, 36), (37, 41), (42, 46), (47, 55)]:
        g = m[m.age.between(lo, hi)]
        bands[f"{lo}-{hi}"] = {"lo": lo, "hi": hi, "q": QS, "earnings": wquant(g.earnings, g.PWGTP, QS)}
    h = df[(df.sex == 1) & df.age.between(22, 55)]
    out = {
        "source": "dcalc_app_v2.parquet (ACS-based synthetic US adults): men 22-55.",
        "status_by_age": {int(a): float(v) for a, v in by_age.items()},
        "status_tail": tail,
        "earnings": bands,
        "height": {"q": QS, "inches": wquant(h.height_inches, h.PWGTP, QS)},
    }
    OUT.write_text(json.dumps(out, indent=1))
    print("status shift by age:", {a: round(out["status_by_age"][a], 2) for a in (22, 25, 28, 30, 35, 40, 45, 50)})
    print("status mu/sigma:", {a: (round(tail[a]["mu"], 2), round(tail[a]["sigma"], 2)) for a in (22, 25, 28, 30, 35, 40, 45, 50)})
    print("earnings 27-31:", [round(x / 1e3) for x in bands["27-31"]["earnings"]])
    print("height:", [round(x, 1) for x in out["height"]["inches"]])
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
