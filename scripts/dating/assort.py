# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "pyarrow", "scipy"]
# ///
"""How tightly couples sort on status, from the PSID (psid_slim.parquet; never the 7GB PSIDSHELF .dta).
Writes src/data/dating/assort.json.

1. The author's cascade (Castes notebook, "near-match" version), rebuilt: couple-years 2000+, the
   husband's current family income, net worth and education against his wife's father's peak (top
   three family-income years). A couple is "matched" if the husband's wealth tier is the father's or
   one below, else his income tier is, else the wife has at least his education ("Clark rescue").
   Prestige is left out (0.2% of the notebook's cascade; occupation codes cover under 12%).
2. The latent status correlation between the two families, two ways:
   a. Clark's method: every measure is a noisy reading of one latent status per family. Loadings come
      from how each family's own measures correlate with each other (one-factor model on normal
      scores); the cross-family correlations divided by the product of loadings give rho.
   b. Fitted to the cascade: simulate the same tiers from a latent pair at rho with those loadings and
      the observed tier shares, and pick the rho that reproduces the cascade's match rates.
   Plus the raw correlation of the two composites (what you'd see without correcting for noise).
Run: uv run scripts/dating/assort.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.stats import norm, rankdata

ROOT = Path(__file__).resolve().parents[2]
SRC = Path.home() / "src/revimg/notebooks/us_public_data/psid_slim.parquet"
OUT = ROOT / "src/data/dating/assort.json"
COLS = ["ID", "FUID", "REL", "YEAR", "FINC_TOT_RD", "EARN_TOT_RD_RP", "WLTH_TOT_NET_RD", "EDU_YEAR_RP", "EDU_YEAR_SP", "REL_PAR_BF_ID", "DEMO_SEX"]

WLT_BINS = [-np.inf, 0, 50_000, 250_000, 1_000_000, 3_000_000, np.inf]
INC_BINS = [-np.inf, 38000, 88100, 170000, 340000, 500000, np.inf]
EDU_BINS = [-np.inf, 11, 12, 15, 16, np.inf]


def tier(x, bins):
    return pd.cut(x, bins=bins, labels=False)


def nscore(x):
    """Normal scores (ties averaged); NaN stays NaN."""
    x = np.asarray(x, float)
    out = np.full(len(x), np.nan)
    ok = ~np.isnan(x)
    out[ok] = norm.ppf((rankdata(x[ok]) - 0.5) / ok.sum())
    return out


def load():
    df = pq.read_table(SRC, columns=COLS).to_pandas()
    df["EDU_YEAR_RP"] = df.EDU_YEAR_RP.where(df.EDU_YEAR_RP.between(0, 17))
    df["EDU_YEAR_SP"] = df.EDU_YEAR_SP.where(df.EDU_YEAR_SP.between(0, 17))
    return df


def build(df):
    # Fathers' peak: mean of each person's top three family-income years (as the notebook).
    d = df.dropna(subset=["FINC_TOT_RD"]).sort_values(["ID", "FINC_TOT_RD"], ascending=[True, False])
    top3 = d.groupby("ID").head(3)
    peak = top3.groupby("ID").agg(F_inc=("FINC_TOT_RD", "mean"), F_wlt=("WLTH_TOT_NET_RD", "mean"), F_edu=("EDU_YEAR_RP", "mean")).reset_index()
    heads = df[df.REL.isin([1, 10])]
    wives = df[df.REL.isin([2, 20, 22])][["FUID", "YEAR", "ID", "REL_PAR_BF_ID"]].rename(columns={"ID": "W_ID", "REL_PAR_BF_ID": "W_FATHER"})
    c = heads.merge(wives, on=["FUID", "YEAR"], how="inner")
    c = c[c.DEMO_SEX == 1]
    c = c.merge(peak.rename(columns={"ID": "W_FATHER"}), on="W_FATHER", how="inner")
    c = c[c.YEAR >= 2000].copy()
    c["H_inc"], c["H_wlt"], c["H_edu"], c["W_edu"] = c.FINC_TOT_RD, c.WLTH_TOT_NET_RD, c.EDU_YEAR_RP, c.EDU_YEAR_SP
    c["H_earn"] = c.EARN_TOT_RD_RP.where(c.EARN_TOT_RD_RP > 0)
    return c


def cascade(c):
    hi, fi = tier(c.H_inc, INC_BINS), tier(c.F_inc, INC_BINS)
    hw, fw = tier(c.H_wlt, WLT_BINS), tier(c.F_wlt, WLT_BINS)
    he, we = tier(c.H_edu, EDU_BINS), tier(c.W_edu, EDU_BINS)
    near = lambda h, f: ((h == f) | (h - f == -1)) & h.notna() & f.notna()
    wealth, income = near(hw, fw), near(hi, fi)
    rescue = (we >= he) & we.notna() & he.notna()
    matched = wealth | income | rescue
    return {
        "n": int(len(c)),
        "wealth_near": float(wealth.mean()), "income_near": float(income.mean()), "edu_rescue": float(rescue.mean()),
        "wealth_exact": float(((hw == fw) & hw.notna()).mean()), "income_exact": float((hi == fi).mean()),
        "cascade": {"wealth": float(wealth.mean()), "income": float((income & ~wealth).mean()),
                    "edu_rescue": float((rescue & ~wealth & ~income).mean()), "mismatch": float((~matched).mean())},
        "matched": float(matched.mean()),
    }


def one_factor(R):
    """Loadings of a one-factor model from a 3x3 correlation matrix (triad formula)."""
    r12, r13, r23 = R[0, 1], R[0, 2], R[1, 2]
    return np.sqrt(np.clip([r12 * r13 / r23, r12 * r23 / r13, r13 * r23 / r12], 0, 0.99))


def cfa(R, names, husband, family, extra=()):
    """Two correlated factors (husband's status, his wife's family's status), one loading per measure,
    fitted by least squares to the off-diagonal correlations. `extra`: pairs allowed a direct residual
    correlation (spouses sort on education itself, beyond status). Returns rho, loadings, residuals."""
    from scipy.optimize import least_squares
    ms = husband + family
    idx = [names.index(m) for m in ms]
    pairs = [(i, j) for i in range(len(ms)) for j in range(i + 1, len(ms))]
    ex = [(ms.index(a), ms.index(b)) for a, b in extra]

    def model(p):
        lam, rho, res = p[:len(ms)], p[len(ms)], p[len(ms) + 1:]
        out = []
        for i, j in pairs:
            same = (ms[i] in husband) == (ms[j] in husband)
            v = lam[i] * lam[j] * (1 if same else rho)
            for k, (a, b) in enumerate(ex):
                if {a, b} == {i, j}:
                    v += res[k]
            out.append(v)
        return np.array(out)

    target = np.array([R[idx[i], idx[j]] for i, j in pairs])
    x0 = np.r_[np.full(len(ms), 0.6), 0.6, np.zeros(len(ex))]
    lo = np.r_[np.full(len(ms), 0.05), -1, np.full(len(ex), -1)]
    hi = np.r_[np.full(len(ms), 0.99), 1, np.full(len(ex), 1)]
    f = least_squares(lambda p: model(p) - target, x0, bounds=(lo, hi))
    lam = dict(zip(ms, map(float, f.x[:len(ms)])))
    return {"rho": float(f.x[len(ms)]), "loadings": lam, "direct": {f"{a}~{b}": float(r) for (a, b), r in zip(extra, f.x[len(ms) + 1:])},
            "rmse": float(np.sqrt(np.mean(f.fun ** 2)))}


def main():
    df = load()
    c = build(df)
    obs = cascade(c)
    print(f"couple-years 2000+ with wife's father linked: {obs['n']:,}")
    print("cascade (rebuilt):", {k: round(v, 3) for k, v in obs["cascade"].items()}, "matched", round(obs["matched"], 3))

    # Normal scores within the analysis sample (one row per couple-year, as the cascade).
    Z = pd.DataFrame({k: nscore(c[k]) for k in ["H_inc", "H_wlt", "H_edu", "H_earn", "F_inc", "F_wlt", "F_edu", "W_edu"]})
    R = Z.corr().values
    names = list(Z.columns)
    ix = {n: i for i, n in enumerate(names)}
    sub = lambda a: R[np.ix_([ix[x] for x in a], [ix[x] for x in a])]
    lam_h = dict(zip(["H_inc", "H_wlt", "H_edu"], one_factor(sub(["H_inc", "H_wlt", "H_edu"]))))
    lam_f = dict(zip(["F_inc", "F_wlt", "F_edu"], one_factor(sub(["F_inc", "F_wlt", "F_edu"]))))
    # The wife's own education as a reading of her family's status: r(W_edu, F_x) = lam_W * lam_F_x.
    lam_f["W_edu"] = float(np.mean([R[ix["W_edu"], ix[k]] / lam_f[k] for k in ["F_inc", "F_wlt", "F_edu"]]))
    pairs = [(h, f) for h in lam_h for f in lam_f]
    clark = {f"{h}~{f}": float(R[ix[h], ix[f]] / (lam_h[h] * lam_f[f])) for h, f in pairs}
    rho_clark = float(np.median(list(clark.values())))
    raw = {f"{h}~{f}": float(R[ix[h], ix[f]]) for h, f in pairs}
    comp_h = Z[["H_inc", "H_wlt", "H_edu"]].mean(axis=1)
    comp_f = Z[["F_inc", "F_wlt", "F_edu", "W_edu"]].mean(axis=1)
    ok = comp_h.notna() & comp_f.notna()
    rho_composite = float(np.corrcoef(comp_h[ok], comp_f[ok])[0, 1])
    print("loadings husband", {k: round(v, 2) for k, v in lam_h.items()}, "wife's family", {k: round(v, 2) for k, v in lam_f.items()})
    print(f"rho: raw composite {rho_composite:.2f}, Clark median {rho_clark:.2f}", {k: round(v, 2) for k, v in clark.items()})

    # Confirmatory factor model on the cleanest measures: his own earnings and education (not family
    # income or wealth, which include the wife) against her father's peak income, wealth, education
    # and her own education; education allowed to match directly.
    cf = cfa(R, names, ["H_earn", "H_edu"], ["F_inc", "F_wlt", "F_edu", "W_edu"], extra=[("H_edu", "W_edu")])
    cf_all = cfa(R, names, ["H_earn", "H_inc", "H_wlt", "H_edu"], ["F_inc", "F_wlt", "F_edu", "W_edu"], extra=[("H_edu", "W_edu")])
    print(f"CFA latent rho: {cf['rho']:.2f} (his earnings + education; rmse {cf['rmse']:.3f}), {cf_all['rho']:.2f} (adding family income and wealth)")
    print("  loadings", {k: round(v, 2) for k, v in cf["loadings"].items()}, "direct education match", {k: round(v, 2) for k, v in cf["direct"].items()})

    # Simulate the cascade from a latent pair at rho, with each measure = lam L + noise, tiered to the
    # observed tier shares (so the tier cut points are exactly the data's, on the normal-score scale).
    rng = np.random.default_rng(7)
    N = 400_000
    E = {k: rng.standard_normal(N) for k in list(lam_h) + list(lam_f) + ["Lh", "Lf"]}
    shares = {}
    for k, bins in [("H_inc", INC_BINS), ("F_inc", INC_BINS), ("H_wlt", WLT_BINS), ("F_wlt", WLT_BINS), ("H_edu", EDU_BINS), ("W_edu", EDU_BINS)]:
        t = tier(c[k], bins).dropna()
        shares[k] = np.cumsum(np.bincount(t.astype(int), minlength=len(bins) - 1) / len(t))[:-1]

    def sim(rho):
        Lh = E["Lh"]
        Lf = rho * Lh + np.sqrt(1 - rho * rho) * E["Lf"]
        out = {}
        for k, lam in {**lam_h, **lam_f}.items():
            if k not in shares:
                continue
            L = Lh if k.startswith("H") else Lf
            x = lam * L + np.sqrt(1 - lam * lam) * E[k]
            out[k] = np.searchsorted(norm.ppf(shares[k]), x)
        near = lambda h, f: (h == f) | (h - f == -1)
        wealth, income = near(out["H_wlt"], out["F_wlt"]), near(out["H_inc"], out["F_inc"])
        rescue = out["W_edu"] >= out["H_edu"]
        return {"wealth_near": wealth.mean(), "income_near": income.mean(), "edu_rescue": rescue.mean(),
                "matched": (wealth | income | rescue).mean()}

    grid = np.round(np.arange(0.0, 1.0001, 0.02), 2)
    fits = []
    for rho in grid:
        s = sim(min(rho, 0.999))
        err = sum((s[k] - obs[k]) ** 2 for k in ["wealth_near", "income_near", "edu_rescue", "matched"])
        fits.append({"rho": float(rho), **{k: float(v) for k, v in s.items()}, "sse": float(err)})
    best = min(fits, key=lambda f: f["sse"])
    # Fit to the headline alone (the share matched on at least one dimension).
    best_matched = min(fits, key=lambda f: abs(f["matched"] - obs["matched"]))
    print(f"cascade fit: rho {best['rho']:.2f} (all four rates), rho {best_matched['rho']:.2f} (share matched alone)")
    print("  at best:", {k: round(best[k], 3) for k in ["wealth_near", "income_near", "edu_rescue", "matched"]})
    print("  observed:", {k: round(obs[k], 3) for k in ["wealth_near", "income_near", "edu_rescue", "matched"]})
    print("  independent (rho 0):", {k: round(fits[0][k], 3) for k in ["wealth_near", "income_near", "edu_rescue", "matched"]})

    out = {
        "source": "PSID 1968-2021 (psid_slim.parquet): couple-years 2000+, husband (head) vs his wife's father's peak (top three family-income years). Author's Castes notebook, near-match cascade, rebuilt without prestige.",
        "observed": obs,
        "loadings": {"husband": lam_h, "wife_family": lam_f},
        "rho_raw_pairs": raw, "rho_clark_pairs": clark,
        "rho_composite": rho_composite, "rho_clark": rho_clark, "cfa": cf, "cfa_all": cf_all,
        "rho_cascade": best["rho"], "rho_cascade_matched_only": best_matched["rho"],
        "fits": fits,
    }
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
