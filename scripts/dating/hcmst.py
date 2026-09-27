# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "pyreadstat"]
# ///
"""How couples met, by year met: HCMST 2017-2020-2022 (Rosenfeld; Stanford, public "small" file v2.2).
Writes src/data/dating/hcmst.json.

Every heterosexual relationship the panel records: the 2017 partner (wave 1) and new partners
reported in 2020 (wave 2) and 2022 (wave 3), each with the year the pair first met and how they met
(Rosenfeld's coded q24 flags). Weights: wave 1 combined weight for the 2017 partners, wave 2 and
wave 3 combined weights for the new ones. Shares by year met and by pooled periods, with the raw
counts, since the recent years rest on few couples.
Data: https://data.stanford.edu/hcmst2017 (HCMST 2017 to 2022 small public version 2.2.dta)
Run: uv run scripts/dating/hcmst.py [path/to/hcmst.dta]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data/hcmst/hcmst_2017_2022_v2.2.dta"
OUT = ROOT / "src/data/dating/hcmst.json"

CHANNELS = {
    "Online": ["met_online"],
    "Through friends": ["met_through_friend"],
    "Bar or restaurant": ["bar_restaurant"],
    "Coworkers": ["met_as_through_cowork"],
    "Family": ["met_through_family"],
    "School or college": ["school", "college"],
    "Church": ["church"],
}
PERIODS = [(1990, 1999), (2000, 2004), (2005, 2009), (2010, 2014), (2015, 2017), (2018, 2019), (2020, 2022)]


def rows(df):
    out = []
    # Wave 1: the 2017 partner. Heterosexual: not a same-sex couple.
    w1 = df[(df.w1_same_sex_couple != 1) & df.w1_q21a_year.notna()]
    for _, r in w1.iterrows():
        rec = {"wave": 1, "year": r.w1_q21a_year, "w": r.w1_weight_combo}
        for ch, cols in CHANNELS.items():
            rec[ch] = max((r.get(f"w1_q24_{c}", np.nan) == 1) for c in cols)
        out.append(rec)
    # Waves 2 and 3: new relationships.
    for wave, pre, year, w, same in [(2, "w2", "w2_q21a_year", "w2_combo_weight", "w2_same_sex_couple"),
                                     (3, "w3", "w3_Q21A_year", "w3_combo_weight", "w3_same_sex_couple")]:
        new = df[df[year].notna() & (df[same] != 1)]
        for _, r in new.iterrows():
            rec = {"wave": wave, "year": r[year], "w": r[w]}
            for ch, cols in CHANNELS.items():
                rec[ch] = max((r.get(f"{pre}_q24_{c}", np.nan) == 1) for c in cols)
            out.append(rec)
    return pd.DataFrame(out)


def main():
    df, _ = pyreadstat.read_dta(str(SRC), encoding="latin1")
    R = rows(df)
    R = R[R.w.notna() & (R.w > 0)]
    print(f"heterosexual relationships with a year met: {len(R):,} (by wave: {R.wave.value_counts().sort_index().to_dict()})")
    periods = []
    for lo, hi in PERIODS:
        g = R[R.year.between(lo, hi)]
        rec = {"from": lo, "to": hi, "n": int(len(g)), "n_online": int(g.Online.sum())}
        for ch in CHANNELS:
            p = float(np.average(g[ch], weights=g.w)) if len(g) else None
            rec[ch] = p
        # Standard error of the weighted share (Kish effective n).
        neff = g.w.sum() ** 2 / (g.w ** 2).sum() if len(g) else 0
        rec["online_se"] = float(np.sqrt(rec["Online"] * (1 - rec["Online"]) / neff)) if neff else None
        periods.append(rec)
        print(f"  met {lo}-{hi}: n={rec['n']:4d}  online {rec['Online']:.0%} (±{1.96 * rec['online_se']:.0%})  friends {rec['Through friends']:.0%}  bar {rec['Bar or restaurant']:.0%}  cowork {rec['Coworkers']:.0%}")
    by_year = []
    for y in range(2010, 2023):
        g = R[R.year == y]
        if len(g):
            by_year.append({"year": y, "n": int(len(g)), "online": float(np.average(g.Online, weights=g.w))})
    out = {"source": "HCMST 2017-2020-2022 (Rosenfeld), small public v2.2: heterosexual couples, year first met; weighted.",
           "periods": periods, "by_year": by_year, "channels": list(CHANNELS)}
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
