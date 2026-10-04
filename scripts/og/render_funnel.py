# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Render scripts/og/funnel.html (a year on the apps, single women 22-35) to a 2x PNG for Substack.
Run: uv run scripts/og/render_funnel.py [output dir]"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Desktop/Recent Projects/Lemon dating/Substack images").expanduser()
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1000, "height": 900}, device_scale_factor=2, color_scheme="light")
    page.goto((HERE / "funnel.html").as_uri(), wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(500)
    page.locator("#card").screenshot(path=str(OUT / "29-a-year-on-the-apps-women.png"))
    browser.close()
print("wrote", OUT / "29-a-year-on-the-apps-women.png")
