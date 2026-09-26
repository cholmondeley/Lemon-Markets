# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy"]
# ///
"""Aggregates from the Dating Calculator's synthetic population (ACS-based, NHANES-imputed
bodies) for the dating page. Writes src/data/dating/pools.json.

The parquet holds up to 8 imputation draws per person; PWGTP is already split across draws, so
weighted sums give US adult counts directly (~262M). Run:
    uv run scripts/dating/pools.py [path/to/dcalc_app_v2.parquet]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = Path.home() / "Desktop/Lemon dating/Dating app calculator data/dcalc_app_v2.parquet"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
OUT = ROOT / "src/data/dating/pools.json"

# ACS codes as used by the calculator: married 1 married, 2 widowed, 3 divorced,
# 4 separated, 5 never married. educ 1 <HS, 2 HS, 3 some college, 4 associate, 5 BA, 6 grad.
BA = 5
COLS = ["PWGTP", "sex", "age", "married", "single", "whr", "waist_circumference", "educ",
        "earnings", "real_income", "net_worth", "height_inches", "fit", "abs", "obese",
        "overweight", "is_smoker", "has_kids", "p_blue_eyes", "p_trust_fund", "cbsa_id"]


def wavg(x, w):
    return float(np.average(x, weights=w)) if len(w) else float("nan")


def wquant(x, w, qs):
    o = np.argsort(x)
    x, w = np.asarray(x)[o], np.asarray(w)[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return [float(np.interp(q, c, x)) for q in qs]


def by_age(df):
    rows = []
    for sex, name in [(1, "men"), (2, "women")]:
        s = df[df.sex == sex]
        for age in range(18, 71):
            a = s[s.age == age]
            w = a.PWGTP
            row = {"sex": name, "age": age, "pop": float(w.sum()),
                   "single": wavg(a.single, w), "never_married": wavg(a.married == 5, w),
                   # Single and never married vs single after a marriage (divorced, separated, widowed).
                   "single_never": wavg(a.single & (a.married == 5), w),
                   "single_prev": wavg(a.single & a.married.isin([2, 3, 4]), w),
                   "ba_plus": wavg(a.educ >= BA, w), "obese": wavg(a.obese, w)}
            if sex == 2:
                q = wquant(a.whr, w, [0.1, 0.25, 0.5, 0.75, 0.9])
                row.update(whr_p10=q[0], whr_p25=q[1], whr_p50=q[2], whr_p75=q[3], whr_p90=q[4],
                           whr_le_074=wavg(a.whr <= 0.74, w), whr_lt_080=wavg(a.whr < 0.80, w),
                           whr_ge_085=wavg(a.whr >= 0.85, w))
            rows.append(row)
    return rows


def marriage_by_earnings(df):
    """Ever-married share by personal-earnings quintile, within an age band (so age is held fixed)."""
    out = {}
    for sex, name in [(1, "men"), (2, "women")]:
        for lo, hi in [(30, 39), (40, 49), (50, 59)]:
            s = df[(df.sex == sex) & df.age.between(lo, hi)]
            # Weighted quintile cut points; ties at $0 earnings stay together in the bottom group.
            cuts = wquant(s.earnings, s.PWGTP, [0.2, 0.4, 0.6, 0.8])
            q = np.searchsorted(cuts, s.earnings, side="right")
            res = []
            for k in range(5):
                g = s[q == k]
                res.append({"quintile": k + 1, "share_pop": float(g.PWGTP.sum() / s.PWGTP.sum()),
                            "ever_married": wavg(g.married != 5, g.PWGTP),
                            "currently_married": wavg(g.married == 1, g.PWGTP),
                            "median_earnings": wquant(g.earnings, g.PWGTP, [0.5])[0]})
            out[f"{name}_{lo}_{hi}"] = {"cuts": cuts, "quintiles": res}
    return out


def never_married_profile(df):
    """How never-married men and women at 40-49 differ from the ever-married (selection)."""
    out = {}
    for sex, name in [(1, "men"), (2, "women")]:
        s = df[(df.sex == sex) & df.age.between(40, 49)]
        for label, g in [("never", s[s.married == 5]), ("ever", s[s.married != 5])]:
            w = g.PWGTP
            out[f"{name}_{label}"] = {
                "share": float(w.sum() / s.PWGTP.sum()),
                "median_earnings": wquant(g.earnings, w, [0.5])[0],
                "median_net_worth": wquant(g.net_worth, w, [0.5])[0],
                "ba_plus": wavg(g.educ >= BA, w), "obese": wavg(g.obese, w),
                "smoker": wavg(g.is_smoker > 0, w),
                "earn_100k": wavg(g.earnings >= 100_000, w),
            }
    return out


def rarity(df):
    """Incidence of the page's example standards within single, in-band pools (national)."""
    m = df[(df.sex == 1) & df.age.between(25, 35) & df.single]
    w = m.PWGTP
    tall, rich, fit = m.height_inches >= 72, m.earnings >= 100_000, m.fit
    base = tall & rich & fit
    men = {
        "pool": float(w.sum()),
        "six_ft": wavg(tall, w), "earn_100k": wavg(rich, w), "fit": wavg(fit, w), "abs": wavg(m["abs"], w),
        "six_six_six": wavg(tall & rich & m["abs"], w),
        "tall_rich_fit": wavg(base, w),
        "tall_rich_fit_ba": wavg(base & (m.educ >= BA), w),
        # Blue eyes and a trust fund are probabilities per person, so their expected incidence is
        # the weighted mean of the product.
        "finance_meme": wavg(base * m.p_blue_eyes * m.p_trust_fund, w),
    }
    f = df[(df.sex == 2) & df.age.between(22, 27) & df.single]
    w = f.PWGTP
    good_whr, ba = f.whr <= 0.74, f.educ >= BA
    women = {
        "pool": float(w.sum()),
        "whr_le_074": wavg(good_whr, w), "ba_plus": wavg(ba, w),
        "not_overweight": wavg(~(f.obese | f.overweight), w),
        "whr_ba": wavg(good_whr & ba, w),
        "whr_ba_nonsmoker_nokids": wavg(good_whr & ba & (f.is_smoker == 0) & (f.has_kids == 0), w),
        "whr_ba_earn_100k": wavg(good_whr & ba & (f.earnings >= 100_000), w),
    }
    return {"men_single_25_35": men, "women_single_22_27": women}


def metros(df, top=30):
    """Single, in-band people per 1,000 adults in the largest metros (channel volume inputs)."""
    g = df[df.cbsa_id > 0]
    adults = g.groupby("cbsa_id").PWGTP.sum().sort_values(ascending=False).head(top)
    sw = g[(g.sex == 2) & g.age.between(20, 29) & g.single].groupby("cbsa_id").PWGTP.sum()
    sm = g[(g.sex == 1) & g.age.between(25, 35) & g.single].groupby("cbsa_id").PWGTP.sum()
    names = {}
    lookup = Path.home() / "src/revimg/notebooks/us_public_data/cbsa_lookup.csv"
    if lookup.exists():
        names = pd.read_csv(lookup).drop_duplicates("cbsa_id").set_index("cbsa_id").cbsa_name.to_dict()
    rows = [{"cbsa_id": int(k), "name": names.get(k, str(k)), "adults": float(v),
             "single_women_20_29": float(sw.get(k, 0)), "single_men_25_35": float(sm.get(k, 0))}
            for k, v in adults.items()]
    nat = df.PWGTP.sum()
    rows.insert(0, {"cbsa_id": 0, "name": "United States", "adults": float(nat),
                    "single_women_20_29": float(df[(df.sex == 2) & df.age.between(20, 29) & df.single].PWGTP.sum()),
                    "single_men_25_35": float(df[(df.sex == 1) & df.age.between(25, 35) & df.single].PWGTP.sum())})
    return rows


def main():
    df = pd.read_parquet(SRC, columns=COLS)
    df = df[df.age >= 18]
    out = {
        "source": "Dating Calculator synthetic population (dcalc_app_v2.parquet): ACS persons with "
                  "NHANES-imputed body measures; weights sum to US adults.",
        "adults": float(df.PWGTP.sum()),
        "by_age": by_age(df),
        "marriage_by_earnings": marriage_by_earnings(df),
        "never_married_40_49": never_married_profile(df),
        "rarity": rarity(df),
        "metros": metros(df),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
