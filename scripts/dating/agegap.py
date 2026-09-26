# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy"]
# ///
"""Age gaps in recent marriages by the husband's income, from the ACS 2024 1-year person file.
Reproduces the author's chart: the share of recent marriages (married within ~5 years) where the
husband is 10+ years older, by his income percentile among all men 25-64. Writes
src/data/dating/agegap.json.

Couples: the reference person (RELSHIPP 20) and an opposite-sex spouse (21) in the same household.
MARHYP = year last married. Income = PINCP x ADJINC.
Run: uv run scripts/dating/agegap.py [path/to/acs2024_1yr_pus.zip]
"""
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data/acs2024/acs2024_1yr_pus.zip"
OUT = ROOT / "src/data/dating/agegap.json"
COLS = ["SERIALNO", "RELSHIPP", "AGEP", "SEX", "MARHYP", "PINCP", "ADJINC", "PWGTP", "SCHL"]
YEAR = 2024
BANDS = [(0, 50), (50, 75), (75, 90), (90, 95), (95, 99), (99, 100)]


def load():
    parts = []
    with zipfile.ZipFile(SRC) as z:
        for name in ["psam_pusa.csv", "psam_pusb.csv"]:
            with z.open(name) as f:
                for chunk in pd.read_csv(f, usecols=COLS, chunksize=1_000_000, dtype={"SERIALNO": str}):
                    parts.append(chunk)
    df = pd.concat(parts, ignore_index=True)
    df["inc"] = df.PINCP * df.ADJINC / 1e6
    return df


def wquant(x, w, qs):
    o = np.argsort(x.values)
    xs, ws = x.values[o], w.values[o]
    c = (np.cumsum(ws) - 0.5 * ws) / ws.sum()
    return np.interp(qs, c, xs)


def main():
    df = load()
    men = df[(df.SEX == 1) & df.AGEP.between(25, 64)]
    cuts = wquant(men.inc, men.PWGTP, [b[0] / 100 for b in BANDS[1:]])
    ref = df[df.RELSHIPP == 20].set_index("SERIALNO")
    sp = df[df.RELSHIPP == 21].drop_duplicates("SERIALNO").set_index("SERIALNO")
    pair = ref.join(sp, lsuffix="_r", rsuffix="_s", how="inner")
    pair = pair[pair.SEX_r != pair.SEX_s]
    husband_is_ref = pair.SEX_r == 1
    pick = lambda col: np.where(husband_is_ref, pair[f"{col}_r"], pair[f"{col}_s"])
    other = lambda col: np.where(husband_is_ref, pair[f"{col}_s"], pair[f"{col}_r"])
    c = pd.DataFrame({"h_age": pick("AGEP"), "w_age": other("AGEP"), "h_inc": pick("inc"), "w": pick("PWGTP"),
                      "married": pick("MARHYP"), "w_schl": other("SCHL")})
    c["gap"] = c.h_age - c.w_age
    c["band"] = np.searchsorted(cuts, c.h_inc, side="right")
    out = {"source": "ACS 2024 1-year PUMS, opposite-sex married couples (reference person + spouse).",
           "income_cuts_men_25_64": [float(x) for x in cuts]}
    # Husbands 30-45 in recent marriages: controls for rich husbands simply being older (remarriages).
    for label, sel in [("recent_5y", c.married >= YEAR - 5), ("recent_5y_husband_30_45", (c.married >= YEAR - 5) & c.h_age.between(30, 45)),
                       ("all", c.married.notna() | True)]:
        s = c[sel]
        tot10 = (s.w * (s.gap >= 10)).sum()
        rows = []
        for k, (lo, hi) in enumerate(BANDS):
            g = s[s.band == k]
            rows.append({"band": f"{lo}-{hi}", "n": int(len(g)), "gap10": float(np.average(g.gap >= 10, weights=g.w)),
                         "gap5": float(np.average(g.gap >= 5, weights=g.w)), "mean_gap": float(np.average(g.gap, weights=g.w)),
                         "share_of_all_gap10": float((g.w * (g.gap >= 10)).sum() / tot10),
                         "wife_ba_plus": float(np.average(g.w_schl >= 21, weights=g.w)),
                         "median_h_age": float(np.median(g.h_age))})
        out[label] = {"overall_gap10": float(np.average(s.gap >= 10, weights=s.w)), "bands": rows}
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")
    for label in ["recent_5y", "recent_5y_husband_30_45", "all"]:
        print(label, f"overall 10+: {out[label]['overall_gap10']:.1%}")
        for r in out[label]["bands"]:
            print(f"  {r['band']:>7}: 10+ gap {r['gap10']:.1%}  5+ {r['gap5']:.1%}  mean {r['mean_gap']:.1f}  share of all 10+ {r['share_of_all_gap10']:.0%}  wife BA+ {r['wife_ba_plus']:.0%}  husband median age {r['median_h_age']:.0f}  n={r['n']}")


if __name__ == "__main__":
    main()
