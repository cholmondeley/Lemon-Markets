# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Digitize the charts the dating models are calibrated to, into docs/dating/data/*.csv and
src/data/dating/digitized.json:

- the four bar histograms from Paul's "What really happens inside a dating app"
  (blog.luap.info, Jan 2025);
- OkCupid's "How a person's desirability changes with time" (Rudder, OkTrends / Dataclysm);
- Geruso et al. (2023) Appendix Figure A4, monthly probability of a pregnancy ending in birth.

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
    js = ROOT / "src/data/dating/digitized.json"
    js.write_text(json.dumps(data))
    print(f"wrote {js.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
