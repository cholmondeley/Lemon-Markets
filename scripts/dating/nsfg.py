# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy"]
# ///
"""Backward funnel from the National Survey of Family Growth: who had sex in the past year with
someone they first met online, and how concentrated sex partners are among single young adults.
Both waves: 2017-2019 (the author's chart) and 2022-2023 (latest). Writes src/data/dating/nsfg.json.

DATEAPP / dateapp: "had sex with anyone you first met on the internet (dating app or website) in the
past 12 months" (1 yes, 5 no; asked of people with a partner in the past year, so not-asked = no).
OPPYEARNUM: opposite-sex partners in the past 12 months (>= 995 are non-answers; missing = never had
sex, counted as 0).
RMARITAL: 1 married, 2 cohabiting, 3 widowed, 4 divorced, 5 separated, 6 never married.
Run: uv run scripts/dating/nsfg.py [us_public_data dir]
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data"
OUT = ROOT / "src/data/dating/nsfg.json"


def read_dct(dat, dct, want):
    """Fixed-width 2017-2019 files: take positions and widths for the wanted variables from the .dct."""
    specs, names = [], []
    for line in open(DATA / dct, encoding="latin1"):
        m = re.match(r"\s*_column\((\d+)\)\s+\w+\s+(\w+)\s+%(\d+)", line)
        if m and m.group(2).lower() in want:
            start, width = int(m.group(1)) - 1, int(m.group(3))
            specs.append((start, start + width))
            names.append(m.group(2).lower())
    return pd.read_fwf(DATA / dat, colspecs=specs, names=names, header=None)


def load(wave, sex):
    if wave == "2017-2019":
        base = {"men": ("2017_2019_MaleData.dat", "2017_2019_MaleSetup.dct"),
                "women": ("2017_2019_FemRespData.dat", "2017_2019_FemRespSetup.dct")}[sex]
        want = {"age_r", "dateapp", "orient_a", "orient_b", "rmarital", "oppyearnum", "wgt2017_2019"}
        df = read_dct(*base, want)
        # Orientation was asked in two randomized forms; 1 = heterosexual in both.
        straight = (df.orient_a == 1) | (df.orient_b == 1)
        return pd.DataFrame({"age": df.age_r, "dateapp": df.dateapp, "straight": straight,
                             "marital": df.rmarital, "partners": df.oppyearnum, "w": df.wgt2017_2019})
    f = {"men": "NSFG-2022-2023-MaleRespPUFData.sas7bdat", "women": "NSFG-2022-2023-FemRespPUFData.sas7bdat"}[sex]
    df = pd.read_sas(DATA / "nsfg" / f)
    # 2022-2023 codes orientation 1 gay/lesbian, 2 straight, 3 bisexual, 4 something else.
    return pd.DataFrame({"age": df.AGE_R, "dateapp": df.DATEAPP, "straight": df.ORIENT == 2,
                         "marital": df.RMARITAL, "partners": df.OPPYEARNUM, "w": df.WGT2022_2023})


def summarize(df, lo, hi):
    d = df[df.straight & df.age.between(lo, hi)].copy()
    d["app"] = (d.dateapp == 1).astype(float)
    # Not asked (never had sex) counts as 0 partners; codes >= 995 are non-answers.
    d["p"] = d.partners.fillna(0).where(d.partners.fillna(0) < 995)
    single = d[~d.marital.isin([1, 2])]
    s = single[single.p.notna()]
    w = s.w
    srt = s.sort_values("p", ascending=False)
    cw, cp = srt.w.cumsum() / srt.w.sum(), (srt.p * srt.w).cumsum() / max((srt.p * srt.w).sum(), 1e-9)
    bands = {"0": s.p == 0, "1": s.p == 1, "2": s.p == 2, "3-4": s.p.between(3, 4), "5+": s.p >= 5}
    app = s[s.app == 1]
    return {
        "n": int(len(d)), "n_single": int(len(single)),
        "app_sex_all": float(np.average(d.app, weights=d.w)),
        "app_sex_single": float(np.average(single.app, weights=single.w)),
        "single_share": float(single.w.sum() / d.w.sum()),
        "single_partners_share": {k: float(np.average(m, weights=w)) for k, m in bands.items()},
        "single_mean_partners": float(np.average(s.p, weights=w)),
        "single_top10_share_of_partners": float(np.interp(0.10, cw, cp)),
        "single_top20_share_of_partners": float(np.interp(0.20, cw, cp)),
        "app_sex_mean_partners": float(np.average(app.p, weights=app.w)) if len(app) else None,
        "no_app_sex_mean_partners": float(np.average(s[s.app == 0].p, weights=s[s.app == 0].w)),
    }


def main():
    out = {"source": "National Survey of Family Growth, 2017-2019 and 2022-2023 public-use files; "
                     "straight respondents, weighted."}
    for wave in ["2017-2019", "2022-2023"]:
        for sex in ["men", "women"]:
            df = load(wave, sex)
            out[f"{wave}_{sex}"] = {"18_35": summarize(df, 18, 35), "18_29": summarize(df, 18, 29)}
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
