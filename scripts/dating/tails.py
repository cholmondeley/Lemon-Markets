# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "scipy"]
# ///
"""Do good traits cluster in the tails more than a Gaussian copula says? Real joint tails from NLSY97
(measured, not imputed): AFQT percentile, height and weight (2011, age ~27-31), wage income (2021, or
2019), for men. Compares empirical joint-tail frequencies with independence, a Gaussian copula fitted
to the rank correlations, and t-copulas with the same correlations. Writes src/data/dating/tails.json.

The model works on percentiles throughout (normal scores), i.e. a Gaussian copula: marginals do not
matter, only how traits co-move, and a Gaussian copula has no tail dependence.
Run: uv run scripts/dating/tails.py [path/to/nlsy97_all_1997-2023.zip]
"""
import itertools
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data/nlsy/nlsy97_all_1997-2023.zip"
OUT = ROOT / "src/data/dating/tails.json"
VARS = {"R0536300": "sex", "R9829600": "afqt", "T7635600": "ht_ft", "T7635700": "ht_in", "T7635800": "wt",
        "U5753500": "inc21", "U4282300": "inc19"}


def load():
    with zipfile.ZipFile(SRC) as z, z.open("nlsy97_all_1997-2023.csv") as f:
        parts = [c for c in pd.read_csv(f, usecols=list(VARS), chunksize=2000)]
    df = pd.concat(parts).rename(columns=VARS)
    return df.where(df >= 0)   # negative codes are non-responses


def normal_scores(x):
    r = stats.rankdata(x) / (len(x) + 1)
    return stats.norm.ppf(r)


def main():
    df = load()
    m = df[df.sex == 1].copy()
    m["height"] = m.ht_ft * 12 + m.ht_in
    m["fit"] = -(703 * m.wt / m.height ** 2)            # lower BMI = fitter
    m["income"] = m.inc21.fillna(m.inc19)
    traits = ["afqt", "height", "income", "fit"]
    m = m.dropna(subset=traits)
    m = m[(m.height.between(58, 84)) & (m.income > 0)]
    Z = np.column_stack([normal_scores(m[t].values) for t in traits])
    U = stats.norm.cdf(Z)
    R = np.corrcoef(Z, rowvar=False)
    n = len(m)
    rng = np.random.default_rng(7)
    N = 2_000_000
    L = np.linalg.cholesky(R)
    G = rng.standard_normal((N, len(traits))) @ L.T
    sims = {"gaussian": stats.norm.cdf(G)}
    for nu in (4, 8):
        W = np.sqrt(rng.chisquare(nu, N) / nu)[:, None]
        sims[f"t{nu}"] = stats.t.cdf(G / W, nu)

    out = {"source": "NLSY97 men (AFQT, height and weight 2011, wage income 2021/2019); normal-score correlations.",
           "n": int(n), "traits": traits, "corr": [[round(float(v), 3) for v in row] for row in R], "pairs": [], "triples": []}
    # Pairs: chance both are in the top q, relative to independence (q^2).
    for i, j in itertools.combinations(range(len(traits)), 2):
        for q in (0.2, 0.1, 0.05):
            emp = np.mean((U[:, i] > 1 - q) & (U[:, j] > 1 - q))
            row = {"pair": f"{traits[i]}+{traits[j]}", "q": q, "empirical": float(emp), "count": int(round(emp * n)), "independent": q * q}
            for k, S in sims.items():
                row[k] = float(np.mean((S[:, i] > 1 - q) & (S[:, j] > 1 - q)))
            out["pairs"].append(row)
    # Triples and all four: chance all are in the top q.
    for size in (3, 4):
        for combo in itertools.combinations(range(len(traits)), size):
            for q in (0.25, 0.2, 0.1):
                sel = np.all(U[:, combo] > 1 - q, axis=1)
                row = {"traits": "+".join(traits[c] for c in combo), "q": q, "empirical": float(sel.mean()), "count": int(sel.sum()),
                       "independent": q ** size}
                for k, S in sims.items():
                    row[k] = float(np.mean(np.all(S[:, combo] > 1 - q, axis=1)))
                out["triples"].append(row)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}  n = {n}")
    print("normal-score correlations:", dict(zip(traits, [list(np.round(r, 2)) for r in R])))
    fmt = lambda r, key: f"{r[key] * 1000:.2f}"
    print("per 1,000 men: empirical (count) | independent | gaussian | t8 | t4")
    for r in out["pairs"]:
        if r["q"] == 0.1:
            print(f"  {r['pair']:<16} top10%: {fmt(r, 'empirical')} ({r['count']}) | {fmt(r, 'independent')} | {fmt(r, 'gaussian')} | {fmt(r, 't8')} | {fmt(r, 't4')}")
    for r in out["triples"]:
        if r["q"] in (0.2, 0.1):
            print(f"  {r['traits']:<24} top{int(r['q'] * 100)}%: {fmt(r, 'empirical')} ({r['count']}) | {fmt(r, 'independent')} | {fmt(r, 'gaussian')} | {fmt(r, 't8')} | {fmt(r, 't4')}")


if __name__ == "__main__":
    main()
