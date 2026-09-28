# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Render the social preview cards (1200 x 630) to public/og/{root,hiring,dating}.png, with the
installed Google Chrome (no browser download). Run: uv run scripts/og/render.py"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CARD = (ROOT / "scripts/og/card.html").as_uri()
OUT = ROOT / "public/og"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1, color_scheme="light")
    OUT.mkdir(parents=True, exist_ok=True)
    for essay in ("root", "hiring", "dating"):
        page.goto(f"{CARD}?essay={essay}")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / f"{essay}.png"))
        print("wrote", (OUT / f"{essay}.png").relative_to(ROOT))
    browser.close()
