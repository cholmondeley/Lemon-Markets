# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Export the hiring page's figures as PNGs for a Substack post: light mode, 2x resolution.
Each act's scrolling stage is captured at every step (scroll the step to the middle of the screen,
let the animation settle, screenshot the stage), then the playground charts at their defaults.
Needs the page served (npm run dev, or npm run preview) and the installed Google Chrome.
Run: uv run scripts/og/export_hiring.py [base url] [output dir]
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/hiring/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path.home() / "Desktop/Lemon dating/Substack images/hiring").expanduser()

# Act 1's population simulation runs a live clock on some steps: give it time to settle.
SETTLE = {"act-1-story": 4000}
# (file name, panel selector, buttons to press first, settle ms)
PANELS = [
    ("act1-play-truth-ratio-pool", "#histCanvas", ["#ffBtn"], 1500),
    ("act1-play-truth-ratio-over-time", "#timeCanvas", ["#ffBtn"], 1500),
    ("act2-play-this-candidate", "#a2Band", ["#a2interview"] * 3, 800),
    ("act2-play-best-of-several", "#a2Best", [], 800),
    ("act3-play-sourcing-ladder", "#act-3-play .ladder-panel", [], 800),
    ("act4-play-counter-offers", "#a4chart", [], 800),
    ("act4-play-pipeline", "#act-4-play .a4-ladder", [], 800),
    ("act5-play-chance-of-top-hire", "#a5chart", [], 800),
]
# Panels whose heading sits outside them on the page get one in the export.
TITLES = {"act4-play-counter-offers": "What a countered candidate is worth"}

OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 1280, "height": 860}, device_scale_factor=2, color_scheme="light")
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(800)
    for act in range(1, 6):
        story = f"act-{act}-story"
        steps = page.locator(f"#{story} .step").count()
        for i in range(steps):
            page.evaluate("([s, i]) => document.querySelectorAll(`#${s} .step`)[i].scrollIntoView({ block: 'center' })", [story, i])
            page.wait_for_timeout(SETTLE.get(story, 1600))
            name = f"act{act}-step{i + 1:02d}"
            page.locator(f"#{story} .stage").screenshot(path=str(OUT / f"{name}.png"))
            print("wrote", name)
    # Still images: no play button, scrim or playback controls over the charts.
    page.add_style_tag(content="#playBtn, #histScrim { display: none !important; }")
    page.evaluate("document.getElementById('resetBtn')?.parentElement?.setAttribute('data-export-hide', '')")
    for name, sel, buttons, wait in PANELS:
        panel = page.locator(sel).first
        panel.scroll_into_view_if_needed()
        page.wait_for_timeout(600)
        for button in buttons:
            page.locator(button).evaluate("(b) => b.click()")   # works with the controls row hidden
            page.wait_for_timeout(400)
        page.wait_for_timeout(wait)
        page.add_style_tag(content="[data-export-hide] { display: none !important; }")
        page.wait_for_timeout(300)
        # The panel around the chart, so its title and controls come along.
        box = page.locator(sel).locator("xpath=ancestor-or-self::div[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]")
        if name in TITLES:
            box.evaluate("(b, t) => b.dataset.titled || (b.dataset.titled = 1, b.insertAdjacentHTML('afterbegin', `<h4 style=\"margin:0 0 12px\">${t}</h4>`))", TITLES[name])
        box.screenshot(path=str(OUT / f"{name}.png"))
        print("wrote", name)
    browser.close()
