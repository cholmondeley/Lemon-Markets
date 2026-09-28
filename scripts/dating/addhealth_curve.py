# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy"]
# ///
"""Ever married by true appeal, from Add Health's group estimates: undoes the noise in interviewer ratings.
Writes src/data/dating/addhealth.json.

Input: the group shares scripts/dating/addhealth.py prints (weighted share ever married by percentile of an
interviewer-rated attractiveness score within sex; run by the author, since Add Health's terms bar AI
tools from individual-level data; group estimates are allowed). One interviewer's 1-5 rating is noisy:
ratings of the same person correlate 0.30 a year apart (waves I-II) and 0.14 in adulthood (III-IV), so
the averaged score correlates only about r = 0.6 with true appeal, and the measured gradient is flattened.
Model: P(married) = Phi(a + b y), y ~ N(0, 1) true appeal; groups are percentiles of s = r y + noise;
fit a, b to the five group shares (weighted by n), for r = 1 (no correction) to 0.5.
Run: uv run scripts/dating/addhealth_curve.py
"""
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/data/dating/addhealth.json"
GROUPS = [(0, .2), (.2, .5), (.5, .75), (.75, .9), (.9, 1)]
# Rated at 2+ of waves I-IV; (n, weighted share ever married) per group. Wave V: ages ~33-43 (mean 37);
# wave VI: ~42-47 (mean 44). Born ~1976-83.
MEASURED = {
    "women": {"w5": [(440, .67), (713, .71), (587, .75), (395, .81), (210, .85)], "w6": [(424, .72), (676, .78), (534, .82), (365, .85), (206, .85)]},
    "men": {"w5": [(282, .57), (545, .66), (456, .75), (264, .76), (163, .85)], "w6": [(281, .61), (507, .71), (441, .79), (259, .83), (159, .82)]},
}
R_MAIN = 0.6


def groups(a, b, r, m=200000):
    rng = np.random.default_rng(0)
    y = rng.standard_normal(m)
    s = r * y + np.sqrt(1 - r * r) * rng.standard_normal(m)
    p, q = norm.cdf(a + b * y), np.argsort(np.argsort(s)) / m
    return np.array([p[(q >= lo) & (q < hi)].mean() for lo, hi in GROUPS])


out = {"source": "Add Health public use (ICPSR 21600), group estimates by the author; ever married by interviewer-rated attractiveness, disattenuated.",
       "r_main": R_MAIN, "groups": GROUPS, "measured": MEASURED, "fits": {}}
for sex, waves in MEASURED.items():
    for wave, rows in waves.items():
        n, obs = np.array([x[0] for x in rows]), np.array([x[1] for x in rows])
        for r in (1.0, 0.7, 0.6, 0.5):
            a, b = minimize(lambda ab: np.sum(n * (groups(*ab, r) - obs) ** 2), [0.7, 0.2], method="Nelder-Mead", options={"xatol": 1e-4, "fatol": 1e-7}).x
            out["fits"][f"{sex}_{wave}_r{r}"] = {"a": round(float(a), 4), "b": round(float(b), 4)}
            curve = " ".join(f"{norm.cdf(a + b * norm.ppf(v)):.0%}" for v in (0.1, 0.5, 0.9, 0.99))
            print(f"{sex} {wave} r={r}: a {a:.3f} b {b:.3f} | true 10/50/90/99th: {curve}")
OUT.write_text(json.dumps(out, indent=1))
print(f"wrote {OUT.relative_to(ROOT)}")
