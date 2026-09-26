# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy"]
# ///
"""Exchange rates between women's WHR and men's income and wealth, and what GLP-1s and the gym do to
WHR. From the Dating Calculator parquet (ACS with NHANES-imputed bodies). Writes
src/data/dating/exchange.json.

Exchange rate: the income (or net worth) threshold that as many single men 28-42 clear as single
women 22-29 clear a WHR threshold. Under assortative matching on market value, those are the men a
woman at that tier can expect to reach, and the women a man at that tier can expect to reach (the
author's "There's no such thing as rich enough"). It is a counting exercise, not a claim about any
one person's preferences.

GLP-1: waist falls by a share of baseline (semaglutide 2.4 mg, STEP 1: ~12% of a ~115 cm waist;
tirzepatide 15 mg, SURMOUNT-1: -19.9 cm, ~17%); hips fall by `hip_share` of the waist loss in cm
(assumed: gluteofemoral fat resists loss); glute training adds `glute_in` inches of hip.
Run: uv run scripts/dating/exchange.py [path/to/dcalc_app_v2.parquet]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop/Lemon dating/Dating app calculator data/dcalc_app_v2.parquet"
OUT = ROOT / "src/data/dating/exchange.json"
COLS = ["PWGTP", "sex", "age", "single", "whr", "waist_circumference", "earnings", "net_worth", "fit", "height_inches", "cbsa_id"]
WHR_TIERS = [0.80, 0.77, 0.74, 0.72, 0.70, 0.666]


def wthreshold(x, w, count):
    """Threshold t with weighted count(x >= t) = count."""
    o = np.argsort(-x)
    cw = np.cumsum(w[o])
    k = np.searchsorted(cw, count)
    return float(x[o][min(k, len(x) - 1)])


def wpct(x, w, v):
    return float(w[x <= v].sum() / w.sum())


def main():
    df = pd.read_parquet(SRC, columns=COLS)
    df["hip"] = df.waist_circumference / df.whr
    W = df[(df.sex == 2) & df.age.between(22, 29) & df.single].copy()
    M = df[(df.sex == 1) & df.age.between(28, 42) & df.single].copy()
    ww, mw = W.PWGTP.values, M.PWGTP.values
    inc, nw = M.earnings.values.astype(float), M.net_worth.values.astype(float)
    out = {"source": "dcalc_app_v2.parquet: single women 22-29, single men 28-42 (ACS weights; NHANES-imputed bodies).",
           "women": float(ww.sum()), "men": float(mw.sum()), "tiers": []}
    fit = M.fit.values.astype(bool)
    for t in WHR_TIERS:
        n = float(ww[W.whr.values <= t].sum())
        row = {"whr": t, "women": n, "share": float(n / ww.sum()),
               "income": wthreshold(inc, mw, n), "net_worth": wthreshold(nw, mw, n)}
        # The same count among fit men: how much less income a fit man needs.
        row["income_if_fit"] = wthreshold(inc[fit], mw[fit], n) if n < mw[fit].sum() else 0.0
        out["tiers"].append(row)
    # What abs are worth: a fit man earning I is as rare as any man earning I x multiple.
    rarity = lambda sel: mw[sel].sum() / mw.sum()
    abs_rows = []
    for I in [75_000, 100_000, 140_000, 200_000]:
        r = rarity(fit & (inc >= I))
        abs_rows.append({"income": I, "fit_share": float(r), "equivalent_income": wthreshold(inc, mw, r * mw.sum())})
    out["abs_worth"] = abs_rows
    out["men_counts"] = {
        "income_140k": float(mw[inc >= 140_000].sum()), "net_worth_1m": float(mw[nw >= 1_000_000].sum()),
        "net_worth_10m": float(mw[nw >= 10_000_000].sum()), "fit": float(mw[fit].sum()),
        "six_six_six": float(mw[fit & (inc >= 100_000) & (M.height_inches.values >= 72)].sum()),
    }
    # Metros: women at WHR <= 0.74 per man worth $1M+, among the largest metros.
    names = {}
    lookup = Path.home() / "src/revimg/notebooks/us_public_data/cbsa_lookup.csv"
    if lookup.exists():
        names = pd.read_csv(lookup).drop_duplicates("cbsa_id").set_index("cbsa_id").cbsa_name.to_dict()
    big = df[df.cbsa_id > 0].groupby("cbsa_id").PWGTP.sum().sort_values(ascending=False).head(30).index
    metros = []
    for cb in big:
        wn = W[(W.cbsa_id == cb) & (W.whr <= 0.74)].PWGTP.sum()
        mn = M[(M.cbsa_id == cb) & (M.net_worth >= 1_000_000)].PWGTP.sum()
        mi = M[(M.cbsa_id == cb) & (M.earnings >= 140_000)].PWGTP.sum()
        metros.append({"cbsa_id": int(cb), "name": names.get(cb, str(cb)), "women_whr74": float(wn),
                       "men_1m": float(mn), "men_140k": float(mi), "women_per_millionaire": float(wn / mn) if mn else None})
    out["metros"] = sorted(metros, key=lambda x: x["women_per_millionaire"] or 0)
    # GLP-1 and the gym: one woman at a given WHR percentile changes; her peers do not.
    whr, waist, hip = W.whr.values, W.waist_circumference.values, W.hip.values
    order = np.argsort(whr)
    cw = np.cumsum(ww[order]) / ww.sum()
    glp = []
    for q in (0.25, 0.5, 0.75, 0.9):
        i = order[np.searchsorted(cw, q)]
        # Percentile = share of women she beats on WHR (lower is better).
        base = {"start_pct": 1 - q, "whr": float(whr[i]), "waist": float(waist[i]), "hip": float(hip[i])}
        for label, cut in [("semaglutide", 0.12), ("tirzepatide", 0.17)]:
            for hip_share in (0.3, 0.5, 0.7):
                for glute_in in (0.0, 1.0):
                    dw = cut * waist[i]
                    new = (waist[i] - dw) / (hip[i] - hip_share * dw + glute_in)
                    glp.append({**base, "drug": label, "hip_share": hip_share, "glute_in": glute_in,
                                "new_whr": float(new), "new_pct": 1 - wpct(whr, ww, new),
                                "qualifies_074": bool(new <= 0.74)})
    out["glp1"] = glp
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"single women 22-29: {out['women'] / 1e6:.1f}M; single men 28-42: {out['men'] / 1e6:.1f}M")
    for r in out["tiers"]:
        print(f"  WHR <= {r['whr']}: {r['share']:.2%} of women ({r['women'] / 1e3:.0f}k) ~ men earning ${r['income'] / 1e3:.0f}k+ or worth ${r['net_worth'] / 1e6:.2f}M+ (fit men: ${r['income_if_fit'] / 1e3:.0f}k+)")
    for r in abs_rows:
        print(f"  abs: a fit man earning ${r['income'] / 1e3:.0f}k is as rare as any man earning ${r['equivalent_income'] / 1e3:.0f}k ({r['equivalent_income'] / r['income']:.1f}x)")
    print("  metros (women WHR<=.74 per $1M+ man):", [(m['name'][:18], round(m['women_per_millionaire'], 1)) for m in out["metros"][:5]], '...', [(m['name'][:18], round(m['women_per_millionaire'], 1)) for m in out["metros"][-5:]])
    for g in glp:
        if g["hip_share"] == 0.5:
            print(f"  from the {g['start_pct']:.0%} percentile (WHR {g['whr']:.3f}, waist {g['waist']:.1f}, hip {g['hip']:.1f}) {g['drug']:<11} glute +{g['glute_in']:.0f}in -> WHR {g['new_whr']:.3f}, {g['new_pct']:.1%} percentile")


if __name__ == "__main__":
    main()
