# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "pyreadstat"]
# ///
"""What GLP-1s and glute training can do to a young woman's waist-to-hip ratio, from NHANES microdata.
Writes src/data/dating/glp1.json.

Women 20-29, not pregnant, NHANES 2017-Mar 2020 and Aug 2021-Aug 2023 (measured waist, hip, BMI; MEC
weights). Each woman gets simulated responses (500 draws each):
  weight loss   the trial mean and spread (semaglutide 2.4 mg, STEP 1: -14.9%, SD ~11 points;
                tirzepatide 15 mg, SURMOUNT-1: -20.9%, SD ~10), scaled by how much fat she has to lose:
                the trials enrolled women around BMI 38, and a leaner woman loses proportionally less
                (scale = (BMI - 20) / (38 - 20), clipped to 0..1). Floor: BMI 18.5.
  waist         falls 0.84x as fast as weight in log terms (SURMOUNT-1: waist -17.5% for weight -20.9%;
                STEP 1: -11.8% for -14.9%);
  hips          follow the waist at the between-person log-log slope b = 0.657 (the author's WHR
                notebook, NHANES), so WHR moves only (1 - b) as far as the waist;
  glutes        optional +1 inch (2.54 cm) of hip, a year of hard training.
Qualifying = WHR <= 0.74 (the "rich enough" cutoff). Reported by starting WHR percentile band (lower
WHR = better), before and after, plus each band's new WHR percentile (against today's women 20-29).
Run: uv run scripts/dating/glp1.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

ROOT = Path(__file__).resolve().parents[2]
NH = Path.home() / "src/revimg/notebooks/us_public_data/nhanes"
OUT = ROOT / "src/data/dating/glp1.json"
CUT, B, WAIST_PER_WEIGHT, TRIAL_BMI = 0.74, 0.657, 0.84, 38.0
DRUGS = {"semaglutide": (0.149, 0.11), "tirzepatide": (0.209, 0.10)}
BANDS = [(0, 0.05), (0.05, 0.10), (0.10, 0.25), (0.25, 0.50), (0.50, 0.75), (0.75, 1.0)]


def load():
    out = []
    for bmx, demo, wt in [("P_BMX.XPT", "P_DEMO.XPT", "WTMECPRP"), ("BMX_L.xpt", "DEMO_L.xpt", "WTMEC2YR")]:
        b, _ = pyreadstat.read_xport(str(NH / bmx), encoding="latin1")
        d, _ = pyreadstat.read_xport(str(NH / demo), encoding="latin1")
        m = b.merge(d, on="SEQN")
        m = m[(m.RIAGENDR == 2) & m.RIDAGEYR.between(20, 29) & (m.RIDEXPRG != 1)]
        m = m.dropna(subset=["BMXWAIST", "BMXHIP", "BMXBMI", wt])
        out.append(pd.DataFrame({"waist": m.BMXWAIST, "hip": m.BMXHIP, "bmi": m.BMXBMI, "w": m[wt] / m[wt].sum()}))
    df = pd.concat(out, ignore_index=True)
    df["w"] /= df.w.sum()
    df["whr"] = df.waist / df.hip
    return df


def wpct(values, ref, w):
    """Share of today's women (weights w) with a WHR at or above each value: percentile, higher = better."""
    order = np.argsort(ref)
    r, cw = ref[order], np.cumsum(w[order])
    return 1 - np.interp(values, r, cw, left=0, right=1)


def main():
    df = load()
    print(f"women 20-29: n={len(df)}, WHR <= {CUT}: {np.average(df.whr <= CUT, weights=df.w):.1%}, median WHR {np.median(df.whr):.3f}")
    rng = np.random.default_rng(11)
    D = 500
    whr, w = df.whr.values, df.w.values
    df["pct"] = wpct(whr, whr, w)
    results = {}
    for drug, (mu, sd) in DRUGS.items():
        scale = np.clip((df.bmi.values - 20) / (TRIAL_BMI - 20), 0, 1)
        loss = np.clip(rng.normal(mu, sd, (len(df), D)), 0, 0.45) * scale[:, None]
        loss = np.minimum(loss, np.clip(1 - 18.5 / df.bmi.values, 0, None)[:, None])   # BMI floor 18.5
        dlw = WAIST_PER_WEIGHT * np.log(1 - loss)                                         # log waist change
        waist = df.waist.values[:, None] * np.exp(dlw)
        hip = df.hip.values[:, None] * np.exp(B * dlw)
        for glute in (0, 1):
            new = waist / (hip + 2.54 * glute)
            results[(drug, glute)] = new
    rows = []
    for lo, hi in BANDS:
        sel = (df.pct.values <= 1 - lo) & (df.pct.values > 1 - hi)
        ws = w[sel] / w[sel].sum()
        row = {"band": [lo, hi], "n": int(sel.sum()), "whr_median": float(np.median(whr[sel])),
               "qualify_now": float(np.sum(ws * (whr[sel] <= CUT)))}
        for (drug, glute), new in results.items():
            q = (new[sel] <= CUT).mean(axis=1)
            key = f"{drug}{'_glutes' if glute else ''}"
            row[f"qualify_{key}"] = float(np.sum(ws * q))
            row[f"pct_{key}"] = float(np.sum(ws * wpct(new[sel], whr, w).mean(axis=1)))
        for glute, key in [(0, "glp1"), (1, "glp1_glutes")]:
            a, b_ = results[("semaglutide", glute)][sel], results[("tirzepatide", glute)][sel]
            both = np.concatenate([a, b_], axis=1)
            row[f"qualify_{key}"] = float(np.sum(ws * (both <= CUT).mean(axis=1)))
            row[f"pct_{key}"] = float(np.sum(ws * wpct(both, whr, w).mean(axis=1)))
            # Spread of where she lands (percentile quantiles across women in the band and draws).
            p = wpct(both, whr, w)
            row[f"pct_q_{key}"] = [float(np.quantile(p, q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9)]
        rows.append(row)
        print(f"  top {lo:.0%}-{hi:.0%} (WHR ~{row['whr_median']:.3f}, n={row['n']}): qualify {row['qualify_now']:.1%} -> GLP-1 {row['qualify_glp1']:.1%}, + glutes {row['qualify_glp1_glutes']:.1%};"
              f" percentile {1 - (lo + hi) / 2:.0%} -> {row['pct_glp1']:.0%} / {row['pct_glp1_glutes']:.0%}")
    out = {"source": "NHANES 2017-Mar 2020 and 2021-23, women 20-29 (not pregnant), measured; simulated GLP-1 and glute responses.",
           "assumptions": {"cut": CUT, "hip_slope": B, "waist_per_weight": WAIST_PER_WEIGHT, "trial_bmi": TRIAL_BMI, "drugs": DRUGS, "glute_cm": 2.54},
           "n": int(len(df)), "qualify_all": float(np.average(df.whr <= CUT, weights=df.w)), "bands": rows}
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
