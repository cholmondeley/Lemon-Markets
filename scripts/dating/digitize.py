# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Digitize the charts the dating models are calibrated to, into docs/dating/data/*.csv and
src/data/dating/digitized.json:

- the four bar histograms from Paul's "What really happens inside a dating app"
  (blog.luap.info, Jan 2025);
- OkCupid's "How a person's desirability changes with time" (Rudder, OkTrends / Dataclysm);
- Geruso et al. (2023) Appendix Figure A4, monthly probability of a pregnancy ending in birth;
- the author's chart of the share of US women married by age, one line per decade of birth
  ("Marriage - 1 by cohort pure annotation.png": 1950 drawn by hand, 1960-2000 from real data);
- Rudder (2014), *Dataclysm*: messages received per week by attractiveness percentile, women and men
  (OkCupid; "Dating - messages per week by attractiveness and gender.png").

Bars are found by color; heights are in pixels (the y axis has no usable scale on two of the four
charts, so counts are relative). The chart library draws a 2 px stub for empty bins (every bin past
0.35 on the men's received chart, and the known-empty 0.29-0.30 bin), so heights <= 2 px are zero.
Run: uv run scripts/dating/digitize.py [charts dir]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CHARTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop/Lemon dating/Charts and cites"
OUT = ROOT / "docs/dating/data"

HISTOGRAMS = {
    # file in the charts folder -> (csv name, what it measures)
    "dating - like-to-pass ratio men.png": ("luap_received_ratio_men", "share of women shown a man who like him"),
    "dating - like-to-pass ratio women.png": ("luap_received_ratio_women", "share of men shown a woman who like her"),
    "dating - percent liked male distribution.png": ("luap_like_rate_men", "share of profiles a man likes"),
    "dating - percent liked female distribution.png": ("luap_like_rate_women", "share of profiles a woman likes"),
}


def bar_heights(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    blue = (b > 200) & (r < 90) & (g > 70) & (g < 130)
    xs = np.where(blue.sum(0) > 0)[0]
    groups, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x != prev + 1:
            groups.append((start, prev))
            start = x
        prev = x
    groups.append((start, prev))
    base = np.where(blue.any(1))[0].max()
    h = np.array([base - np.where(blue[:, a:c + 1].any(1))[0].min() + 1 for a, c in groups], float)
    if len(h) != 100:
        raise SystemExit(f"{path.name}: found {len(h)} bars, expected 100")
    h[h <= 2] = 0
    return h


def okcupid_age_curves():
    """Portion of the opposite-sex dating pool interested in a person (the chart's label), ages 18-48. Gridlines sit
    every 10% (100% at y=145.5, 0% at y=619.5); the plot spans ages 18-48 over x=288-938."""
    im = np.asarray(Image.open(CHARTS / "Dating - SMV graph.png").convert("RGB")).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    women = (r > 150) & (g < 70) & (b < 70)
    men = (abs(r - 49) < 20) & (abs(g - 88) < 20) & (abs(b - 102) < 20)
    for m in (women, men):
        m[626:] = False
        m[:, :280] = False
    rows = []
    for age in range(18, 49):
        x = int(round(288 + (age - 18) / 30 * 650))
        vals = [(619.5 - np.median(np.where(m[:, x - 1:x + 2].any(1))[0])) / 474 for m in (women, men)]
        rows.append((age, round(vals[0], 4), round(vals[1], 4)))
    return rows


def geruso_curve():
    """Monthly birth probability by age 15-49 from the dots (the legend dot is masked). Axis: age 15
    at x=204, 49 at x=733; 0 at y=529, 94 px per 0.02."""
    im = np.asarray(Image.open(CHARTS / "Combined Geruso fertility graph and table.png").convert("RGB")).astype(int)[:, :780]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    dots = (r > 100) & (g < 70) & (b < 70) & (r - g > 60)
    dots[140:205, 480:760] = False
    rows = []
    for age in range(15, 50):
        x = int(round(204 + (age - 15) * 529 / 34))
        ys = np.where(dots[:, x - 6:x + 7].any(1))[0]
        rows.append((age, round(max(0.0, (529 - np.median(ys)) / 94 * 0.02), 5)))
    return rows


# Cohort lines: core color of each line, sampled from the chart. Axes: age 15 at x = 172 px, 45 at
# 1468; 0% at y = 1008, 100% at 127. The 2000s line is near-black (stop at 24, before its label).
COHORT_COLORS = {1940: (190, 126, 126), 1950: (216, 219, 173), 1960: (163, 204, 162), 1970: (153, 197, 204),
                 1980: (130, 126, 190), 1990: (196, 136, 188), 2000: (45, 45, 45)}


def cohort_curves():
    im = np.asarray(Image.open(CHARTS / "Marriage - 1 by cohort pure annotation.png").convert("RGB")).astype(int)
    x_of = lambda age: 172 + (age - 15) / 30 * (1468 - 172)
    out = {}
    for cohort, rgb in COHORT_COLORS.items():
        dist = np.sqrt(((im - np.array(rgb)) ** 2).sum(-1))
        pts = []
        for age in np.arange(15, 45.01, 0.5):
            if cohort == 2000 and age > 24:
                break
            x = int(round(x_of(age)))
            ys = np.where(dist[130:1005, x - 1:x + 2].min(1) < (45 if cohort == 2000 else 16))[0] + 130
            if cohort == 2000:
                ys = ys[ys > 700]   # the black line only; the "2000" label sits right of age 24
            if len(ys) == 0:
                continue
            # The thick line's center: the median of its pixels (lines are 5-8 px thick).
            y = np.median(ys)
            pts.append((float(age), round((1008 - y) / (1008 - 127), 4)))
        out[cohort] = pts
        print(f"cohort {cohort}: {len(pts)} points, at 25 {dict(pts).get(25.0)}, at 30 {dict(pts).get(30.0)}")
    return out


# Messages a week: x = 390 + 9.81 * percentile px (0th to 90th ticks), y = 944 - 29.6 * messages px
# (0 and 30 ticks). Women: the red line. Men: the lowest dark line (the dotted "all" series is above it).
def okc_messages():
    im = np.asarray(Image.open(CHARTS / "Dating - messages per week by attractiveness and gender.png").convert("RGB")).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    red = (r - g > 40) & (r < 230)
    dark = (r < 120) & (g < 120) & (b < 120)
    rows = []
    for p in range(0, 100):
        x = int(round(390 + 9.81 * p))
        yw = np.where(red[100:945, x - 1:x + 2].any(1))[0] + 100
        yd = np.where(dark[100:942, x - 1:x + 2].any(1))[0] + 100
        if len(yw) == 0 or len(yd) == 0:
            continue
        # The men's line: the bottom run of dark pixels.
        bottom = yd.max()
        run = yd[yd >= bottom - 8]
        rows.append((p, round((944 - np.median(yw)) / 29.6, 3), round((944 - np.median(run)) / 29.6, 3)))
    return rows


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    for fname, (name, what) in HISTOGRAMS.items():
        h = bar_heights(CHARTS / fname)
        lines = [f"# {what}; bin = [lo, lo + 0.01); height in pixels (relative count)", "bin_lo,height"]
        lines += [f"{i / 100:.2f},{int(v)}" for i, v in enumerate(h)]
        (OUT / f"{name}.csv").write_text("\n".join(lines) + "\n")
        mid = (np.arange(100) + 0.5) / 100
        w = h / h.sum()
        med = mid[np.searchsorted(np.cumsum(w), 0.5)]
        print(f"{name}: median {med:.3f}, mean {np.sum(w * mid):.3f}")
        data[name] = [int(v) for v in h]

    ok = okcupid_age_curves()
    (OUT / "okcupid_desirability_by_age.csv").write_text(
        "# portion of the opposite-sex dating pool interested in the person (OkCupid chart label)\nage,women,men\n"
        + "".join(f"{a},{w},{m}\n" for a, w, m in ok))
    data["okcupid_age"] = {"age": [a for a, _, _ in ok], "women": [w for _, w, _ in ok], "men": [m for _, _, m in ok]}
    ge = geruso_curve()
    (OUT / "geruso_monthly_birth_prob.csv").write_text(
        "# Geruso et al. (2023) App. Fig. A4: monthly prob. a pregnancy ending in birth begins\nage,prob\n"
        + "".join(f"{a},{p}\n" for a, p in ge))
    data["geruso"] = {"age": [a for a, _ in ge], "monthly": [p for _, p in ge]}
    ms = okc_messages()
    (OUT / "okcupid_messages_per_week.csv").write_text(
        "# messages received per week by attractiveness percentile (Rudder 2014, Dataclysm; digitized)\npercentile,women,men\n"
        + "".join(f"{p},{w},{m}\n" for p, w, m in ms))
    data["okc_messages"] = {"pct": [p for p, _, _ in ms], "women": [w for _, w, _ in ms], "men": [m for _, _, m in ms]}
    print("messages/week women at 10/50/90/99:", [dict((p, w) for p, w, _ in ms).get(q) for q in (10, 50, 90, 99)],
          "men:", [dict((p, m) for p, _, m in ms).get(q) for q in (10, 50, 90, 99)])
    co = cohort_curves()
    (OUT / "married_by_age_cohort.csv").write_text(
        "# share of US women married, by age and decade of birth (author's chart, digitized)\ncohort,age,married\n"
        + "".join(f"{c},{a},{v}\n" for c, pts in co.items() for a, v in pts))
    data["cohorts"] = {str(c): pts for c, pts in co.items()}
    js = ROOT / "src/data/dating/digitized.json"
    js.write_text(json.dumps(data))
    print(f"wrote {js.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
