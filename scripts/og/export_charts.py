# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Export the dating page's figures as PNGs for a Substack post: light mode, 2x resolution, each figure
lifted out of the scrolling stage into a plain panel with its title, subtitle and source line.
Needs the page served (npm run dev, or npm run preview) and the installed Google Chrome.
Run: uv run scripts/og/export_charts.py [base url] [output dir]
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/dating/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path.home() / "Desktop/Lemon dating/Substack images").expanduser()

# (file name, CSS selector of the figure, reader: woman / man)
FIGURES = [
    ("01-marriage-by-cohort", '[data-fig="cohorts"]', "woman"),
    ("02-how-couples-met", '[data-fig="channels"]', "woman"),
    ("03a-standards-funnel-woman", '[data-fig="calc0"]', "woman"),
    ("03b-standards-funnel-man", '[data-fig="calc1"]', "man"),
    ("04-like-rates", '[data-fig="likeW"]', "woman"),
    ("05-likes-received-men", '[data-fig="recvM"]', "woman"),
    ("06-hinge-like-shares", '[data-fig="hinge"]', "woman"),
    ("07-top5-share-of-likes", '[data-fig="attention"]', "woman"),
    ("08-nsfg-single-men", '[data-fig="nsfg"]', "woman"),
    ("09-no-first-date", '[data-fig="noDate"]', "woman"),
    ("10-first-dates-by-appeal", '[data-fig="datesBand"]', "woman"),
    ("11-nyc-hinge-funnel", '[data-fig="lana"]', "woman"),
    ("12a-year-on-the-apps-woman", "#p3sankey", "woman"),
    ("12b-year-on-the-apps-man", "#p3sankey", "man"),
    ("13-casual-by-attractiveness", '[data-fig="intent"]', "woman"),
    ("14-will-he-commit", '[data-fig="commitBars"]', "woman"),
    ("15-still-single-after-n-dates", '[data-fig="stillSingle"]', "woman"),
    ("16-casual-share-of-men", '[data-fig="poolMix"]', "woman"),
    ("17-interest-by-age", '[data-fig="interest"]', "woman"),
    ("18-fecundity-and-whr", '[data-fig="body"]', "woman"),
    ("19-never-married-men", '[data-fig="nevermarried"]', "woman"),
    ("20-her-odds-by-age", '[data-fig="herAge"]', "woman"),
    ("21-search-odds", '[data-fig="searchOdds"]', "woman"),
    ("22-levers-women", '[data-fig="levers"]', "woman"),
    ("23-everything-together", '[data-fig="waterfall"]', "woman"),
    ("24-whr-exchange-rates", '[data-fig="exchange"]', "woman"),
    ("25-glp1-millionaire-odds", '[data-fig="glp"]', "woman"),
    ("26-age-gap-reach", '[data-fig="reach"]', "woman"),
    ("27-metros", '[data-fig="metrosW"]', "woman"),
    ("28-levers-men", '[data-fig="menLevers"]', "man"),
]

# Move the figure's panel (or stage layer) contents into a fixed-width box at the end of the page, so
# stage layout, scroll state and fade-ins don't matter; the charts redraw at the box's width.
LIFT = """(sel) => {
  const fig = document.querySelector(sel);
  const src = fig.closest('.layer') || fig.closest('.panel') || fig.parentElement;
  const box = document.createElement('div');
  box.id = 'export-box';
  box.className = 'panel layer';   // .layer: the page's figure title, subtitle and source styles
  box.style.cssText = 'width:860px;padding:24px 26px 20px;margin:40px;background:var(--surface);box-shadow:none;position:relative;z-index:100;';
  [...src.childNodes].forEach((n) => box.appendChild(n));
  box.querySelectorAll('.float-in').forEach((el) => el.classList.add('in'));
  // A still image can't be hovered.
  box.querySelectorAll('.sub').forEach((el) => { el.innerHTML = el.innerHTML.replace(/\s*Hover to compare( years)?\./, ''); });
  document.body.appendChild(box);
  window.dispatchEvent(new Event('resize'));
}"""

# Figures whose headings sit outside their panel on the page get one in the export.
TITLES = {
    "22-levers-women": ("What moves her odds", "A median woman, five years of searching; baseline: not looking till 27, open to men up to 2 years older."),
    "23-everything-together": ("Everything together: a top-20% woman going for a top-10% man", "Odds of a committed top-10% man within five years, each step added to the one before."),
    "24-whr-exchange-rates": ("What a waist-to-hip ratio can reach", "Single women 22-29 at each WHR tier, and the single men 28-42 who are as rare: by income or net worth."),
    "28-levers-men": ("What moves his odds", "A median man of 30 looking at women 22-30, five years, on the apps and approaching one woman a month in person."),
}

OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    for sex in ("woman", "man"):
        ctx = browser.new_context(viewport={"width": 1200, "height": 900}, device_scale_factor=2, color_scheme="light")
        ctx.add_init_script(f"try {{ localStorage.setItem('lemon-dating-sex', '{sex}'); }} catch (e) {{}}")
        page = ctx.new_page()
        for name, sel, who in FIGURES:
            if who != sex:
                continue
            page.goto(BASE, wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(600)
            page.evaluate(LIFT, sel)
            if name in TITLES:
                page.evaluate("""([t, sub]) => { const b = document.getElementById('export-box');
                  b.insertAdjacentHTML('afterbegin', `<h4>${t}</h4><p class="sub">${sub}</p>`); }""", list(TITLES[name]))
            page.wait_for_timeout(700)   # charts redraw on resize; bars animate in
            page.locator("#export-box").screenshot(path=str(OUT / f"{name}.png"))
            print("wrote", name)
        ctx.close()
    browser.close()
