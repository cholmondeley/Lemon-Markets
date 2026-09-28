# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "pyreadstat"]
# ///
"""Ever married by interviewer-rated attractiveness, men and women: Add Health public use (ICPSR 21600).

Add Health's conditions of use bar AI tools from processing individual-level data, public-use files
included. This script was written from the codebooks alone and never run by one. Run it yourself and
share only what it prints: weighted group shares, with any group under 10 people suppressed (Add
Health's disclosure rule).

Attractiveness: at waves I-IV the interviewer rated each respondent 1-5 ("How physically attractive is
the respondent?", H1IR1-H4IR1). Each wave's rating is standardized within sex and the available ones
averaged (at least two), so no single interviewer's taste decides; a second version uses the adult
waves (III and IV) only. Groups are percentiles of that score within sex.
Outcome: ever married (currently married, widowed, divorced or separated) at wave IV, V and VI, with
each wave's cross-sectional weight.
Run: uv run scripts/dating/addhealth.py [path/to/Add Health - ICPSR_21600]
"""
import io
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import pyreadstat

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "src/revimg/notebooks/us_public_data/Add Health - ICPSR_21600")
MIN_N = 10
BINS = [(0, 0.2, "Bottom 20%"), (0.2, 0.5, "20-50th"), (0.5, 0.75, "50-75th"), (0.75, 0.9, "75-90th"), (0.9, 1.01, "Top 10%")]


def upper(df):
    df.columns = [c.upper() for c in df.columns]
    if "AID" in df.columns:
        df["AID"] = df["AID"].astype(str).str.strip()
    return df


def dta(part, cols):
    path = str(ROOT / f"DS{part}" / f"21600-{part}-Data.dta")
    _, meta = pyreadstat.read_dta(path, metadataonly=True)
    names = {c.upper(): c for c in meta.column_names}
    missing = [c for c in cols if c not in names]
    if missing:
        print(f"note: DS{part} has no {missing}")
    df, _ = pyreadstat.read_dta(path, usecols=[names[c] for c in cols if c in names])
    return upper(df)


def zipped_sas(part, member, cols):
    with zipfile.ZipFile(ROOT / f"DS{part}" / f"21600-{part}-Zipped_package-MULTI.zip") as z:
        df = upper(pd.read_sas(io.BytesIO(z.read(member)), format="sas7bdat", encoding="latin1"))
    missing = [c for c in cols if c not in df.columns]
    if missing:
        print(f"note: {member} has no {missing}")
    return df[[c for c in cols if c in df.columns]]


w1 = dta("0001", ["AID", "BIO_SEX", "H1IR1"])
w2 = dta("0005", ["AID", "H2IR1"])
w3 = dta("0008", ["AID", "H3IR1"])
w4 = dta("0022", ["AID", "H4IR1", "H4TR1", "H4OD1Y", "IYEAR4"]).merge(dta("0031", ["AID", "GSWGT4_2"]), on="AID", how="left")
w5 = dta("0032", ["AID", "H5HR1", "H5OD1Y", "IYEAR5"]).merge(zipped_sas("0043", "p5weight.sas7bdat", ["AID", "GSW5"]), on="AID", how="left")
w6 = zipped_sas("0043", "pwave6.sas7bdat", ["AID", "H6HR1", "H6OD1Y", "IYEAR6"]).merge(zipped_sas("0043", "p6weight.sas7bdat", ["AID", "GSW6"]), on="AID", how="left")

df = w1.merge(w2, on="AID", how="left").merge(w3, on="AID", how="left").merge(w4, on="AID", how="left").merge(w5, on="AID", how="left").merge(w6, on="AID", how="left")
df = df[df.BIO_SEX.isin([1, 2])].copy()
df["sex"] = np.where(df.BIO_SEX == 2, "Women", "Men")

# Ratings: valid 1-5 only (6, 8, 9 and 99x are refused / don't know / not asked).
RATINGS = ["H1IR1", "H2IR1", "H3IR1", "H4IR1"]
for c in RATINGS:
    df[c] = pd.to_numeric(df[c], errors="coerce").where(lambda s: s.between(1, 5))
    df["z_" + c] = df.groupby("sex")[c].transform(lambda s: (s - s.mean()) / s.std())


def score(cols, min_k):
    z = df[["z_" + c for c in cols]]
    return z.mean(axis=1).where(z.notna().sum(axis=1) >= min_k)


df["score_all"] = score(RATINGS, 2)
df["score_adult"] = score(["H3IR1", "H4IR1"], 2)

# Ever married at each wave. Wave IV: number of people ever married (valid 0-5). Waves V and VI:
# current marital status (1 married, 2 widowed, 3 divorced, 4 separated, 5 never married).
tr4 = pd.to_numeric(df.H4TR1, errors="coerce")
df["em4"] = (tr4 > 0).astype(float).where(tr4.between(0, 5))
for w in (5, 6):
    hr = pd.to_numeric(df[f"H{w}HR1"], errors="coerce")
    df[f"em{w}"] = (hr <= 4).astype(float).where(hr.between(1, 5))
WAVES = [(4, "GSWGT4_2", "H4OD1Y", "IYEAR4"), (5, "GSW5", "H5OD1Y", "IYEAR5"), (6, "GSW6", "H6OD1Y", "IYEAR6")]


def share(g, wave, wcol):
    g = g[g[f"em{wave}"].notna()]
    w = pd.to_numeric(g[wcol], errors="coerce")
    g, w = g[w > 0], w[w > 0]
    if len(g) < MIN_N:
        return len(g), None, None
    return len(g), float(np.average(g[f"em{wave}"], weights=w)), float(g[f"em{wave}"].mean())


def cell(n, p):
    return f"{'<10':>5} {'':>6}" if p is None else f"{n:5d} {p:6.0%}"


print("Add Health public use: share ever married, by interviewer-rated attractiveness")
print(f"Cells: respondents with the outcome, then the weighted share ever married. Groups under {MIN_N} suppressed.\n")
for sex in ("Women", "Men"):
    s = df[df.sex == sex]
    ages = []
    for wave, wcol, by, iy in WAVES:
        a = pd.to_numeric(s[iy], errors="coerce") - pd.to_numeric(s[by], errors="coerce")
        a = a[(a > 10) & (a < 70) & s[f"em{wave}"].notna()]
        ages.append(f"wave {wave}: mean age {a.mean():.1f} ({a.quantile(0.1):.0f}-{a.quantile(0.9):.0f})" if len(a) >= MIN_N else f"wave {wave}: <10")
    print(f"== {sex}. " + "; ".join(ages))
    for key, label in [("score_all", "Rated at 2+ of waves I-IV"), ("score_adult", "Rated at both adult waves (III, IV)")]:
        t = s[s[key].notna()].copy()
        t["pct"] = t[key].rank(pct=True, method="average")
        print(f"  {label} (n={len(t)}):")
        print(f"    {'group':<12}{'share':>7} " + "".join(f"{'wave ' + str(w) + ': n  ever':>14}" for w, *_ in WAVES) + f"   {'unweighted w5':>14}")
        rows = [(lab, t[(t.pct > lo) & (t.pct <= hi)] if lo > 0 else t[t.pct <= hi]) for lo, hi, lab in BINS] + [("All", t)]
        for lab, g in rows:
            parts, unw = [], "      "
            for wave, wcol, *_ in WAVES:
                n, p, u = share(g, wave, wcol)
                parts.append(f"{cell(n, p):>14}")
                if wave == 5 and u is not None:
                    unw = f"{u:6.0%}"
            print(f"    {lab:<12}{len(g) / len(t):7.0%} " + "".join(parts) + f"   {unw:>14}")
    # The raw adult rating, for transparency: wave IV interviewer rating, 1-2 pooled.
    print("  By the wave IV rating alone:")
    r4 = s.H4IR1
    for lab, m in [("1-2 unattractive", r4 <= 2), ("3 about average", r4 == 3), ("4 attractive", r4 == 4), ("5 very attractive", r4 == 5)]:
        g = s[m]
        parts = [f"{cell(*share(g, wave, wcol)[:2]):>14}" for wave, wcol, *_ in WAVES]
        print(f"    {lab:<20}{m.sum():6d} " + "".join(parts))
    print()
