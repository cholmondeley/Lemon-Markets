# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyreadstat", "numpy"]
# ///
"""Cheating and partner-count tables from the General Social Survey (1972-2024, release 3a), for
the dating page. Reproduces the headline cuts from the author's "Cheating Analysis" notebook.
Writes src/data/dating/gss.json.

evstray: "Have you ever had sex with someone other than your husband or wife while you were
married?" (asked of the ever-married; 1 yes, 2 no). numwomen / nummen: number of female / male sex
partners since age 18 (codes >= 989 are non-numeric answers and are dropped).
Run: uv run scripts/dating/gss.py [path/to/gss7224_r3a.dta]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = Path.home() / "src/revimg/notebooks/us_public_data/GSS_stata/gss7224_r3a.dta"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
OUT = ROOT / "src/data/dating/gss.json"
COLS = ["year", "sex", "age", "marital", "evstray", "numwomen", "nummen", "degree",
        "conrinc", "prestg10", "wrkstat", "wtssall", "wtssps"]
SINCE = 2000


def rate(g):
    w = g.w
    return {"cheated": float(np.average(g.cheated, weights=w)) if len(g) else None, "n": int(len(g))}


def pct_rank(s):
    return s.rank(pct=True)


def main():
    df, _ = pyreadstat.read_dta(str(SRC), usecols=COLS, encoding="latin1",
                                apply_value_formats=False, user_missing=False)
    # Missing-value codes come through as strings; everything used here is numeric.
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df[df.year >= SINCE].copy()
    # Post-stratified weight where the release has it, else the older all-years weight.
    df["w"] = df.wtssps.fillna(df.wtssall).fillna(1.0)
    out = {"source": f"GSS 1972-2024 R3a, survey years {SINCE}+ (weighted, wtssps else wtssall)"}

    for sex, name, partners in [(1, "men", "numwomen"), (2, "women", "nummen")]:
        s = df[df.sex == sex].copy()
        s["bc"] = s[partners].where(s[partners] < 989)
        s["cheated"] = (s.evstray == 1).astype(float)
        em = s[s.evstray.isin([1, 2]) & s.bc.notna()].copy()
        # Body-count quintiles among the ever-married who answered both questions.
        em["bcq"] = pd.qcut(em.bc.rank(method="first"), 5, labels=False) + 1
        by_q = []
        for q, g in em.groupby("bcq"):
            by_q.append({"quintile": int(q), "median_partners": float(g.bc.median()),
                         "min": float(g.bc.min()), "max": float(g.bc.max()), **rate(g)})
        bands = [(0, 1), (2, 4), (5, 9), (10, 19), (20, 39), (40, 10_000)]
        by_band = [{"lo": lo, "hi": hi, **rate(em[em.bc.between(lo, hi)])} for lo, hi in bands]

        # Income and prestige, ranked within survey year among this sex's ever-married answerers.
        ev = s[s.evstray.isin([1, 2])].copy()
        ev["inc_rank"] = ev.groupby("year").conrinc.transform(pct_rank)
        ev["pres_rank"] = ev.groupby("year").prestg10.transform(pct_rank)
        ev["inc_decile"] = np.minimum((ev.inc_rank * 10).fillna(-1).astype(int), 9)
        by_inc = [{"decile": d + 1, **rate(ev[ev.inc_decile == d])} for d in range(10)]
        col = ev.degree >= 3
        hi = (ev.inc_rank >= 0.8) & (ev.pres_rank >= 0.8)
        tiers = {
            "all": rate(ev),
            "college_all": rate(ev[col]),
            "college_high_income_prestige": rate(ev[col & hi]),
            "noncollege_all": rate(ev[~col]),
            "noncollege_high_income_prestige": rate(ev[~col & hi]),
        }

        # Concentration of partners: share of all reported partners held by the top x% of people
        # aged 25-45 (the "who is having the fun" question, independent of apps).
        a = s[s.age.between(25, 45) & s.bc.notna()].sort_values("bc", ascending=False)
        cw = a.w.cumsum() / a.w.sum()
        cp = (a.bc * a.w).cumsum() / (a.bc * a.w).sum()
        conc = {f"top_{int(p * 100)}": float(np.interp(p, cw, cp)) for p in (0.01, 0.05, 0.10, 0.20)}
        conc["median_partners"] = float(a.bc.median())
        conc["n"] = int(len(a))

        # The author's "Infidelity Tier List" (Cheating Analysis.ipynb, cells 407-410), reproduced
        # exactly: ages 20-60, cut points pooled over all years for this sex (missing income and
        # prestige filled with 0), top decile of both; unweighted, with a weighted column alongside.
        t = s[s.age.between(20, 60)].copy()
        inc, pre = t.conrinc.fillna(0), t.prestg10.fillna(0)
        col_t, keep = t.degree.fillna(0) >= 3, t.evstray.isin([1, 2])
        top = (inc >= inc.quantile(0.9)) & (pre >= pre.quantile(0.9))
        nc_top = (inc >= inc.quantile(0.9)) & (pre >= pre.quantile(0.7 if sex == 1 else 0.0)) & \
            (pre <= pre.quantile(1.0 if sex == 1 else 0.4))
        cohorts = {"noncollege_high_income_prestige": ~col_t & nc_top, "noncollege_all": ~col_t,
                   "homemaker_all": (t.wrkstat == 7) & (t.marital != 5), "college_all": col_t,
                   "college_homemaker": col_t & (t.wrkstat == 7), "college_high_income_prestige": col_t & top}
        notebook = {}
        for k, m in cohorts.items():
            g = t[m & keep]
            notebook[k] = {"unweighted": float(g.cheated.mean()), "weighted": float(np.average(g.cheated, weights=g.w)),
                           "n": int(len(g))}

        out[name] = {"notebook_tiers": notebook,"by_partner_quintile": by_q, "by_partner_band": by_band,
                     "by_income_decile": by_inc, "tiers": tiers, "partner_concentration_25_45": conc}

    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
