#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

def test_font_tokens():
    tokens_path = REPO_ROOT / "docs" / "tokens.css"
    content = tokens_path.read_text(encoding="utf-8")
    assert '--font-display: "Space Grotesk"' in content, "Space Grotesk not found in tokens.css display font"
    assert '--font-body:    "Inter"' in content, "Inter not found in tokens.css body font"
    assert "Cantarell" not in content, "Cantarell should not be in tokens.css"
    print("PASS: test_font_tokens")

def test_font_html():
    html_path = REPO_ROOT / "docs" / "index.html"
    content = html_path.read_text(encoding="utf-8")
    assert "Space+Grotesk" in content, "Space Grotesk not in Google Fonts link"
    assert "Inter:wght@" in content, "Inter not in Google Fonts link"
    assert "Cantarell" not in content, "Cantarell should not be in Google Fonts link"
    print("PASS: test_font_html")

def test_generic_code_icon():
    html_path = REPO_ROOT / "docs" / "index.html"
    css_path = REPO_ROOT / "docs" / "styles.css"
    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")

    # Ensure VS Code trademark icon path is removed
    assert "#007ACC" not in html_content, "VS Code trademark color fill found in index.html"
    assert "M17.6 1.3 7.8 8.9" not in html_content, "VS Code logo path found in index.html"

    # Ensure generic code icon is present inside active app pill
    pill_match = re.search(r'<div class="gnome-app-pill">(.*?)</div>', html_content, re.DOTALL)
    assert pill_match, "gnome-app-pill not found in index.html"
    pill_html = pill_match.group(1)
    assert 'class="app-icon"' in pill_html, "app-icon class not found inside gnome-app-pill"
    assert '<span>Code</span>' in pill_html or '<span>Editor</span>' in pill_html, "Code/Editor label not found"

    # Ensure CSS defines .app-icon
    assert ".app-icon" in css_content, ".app-icon not styled in styles.css"
    print("PASS: test_generic_code_icon")

def test_hero_cta_gnome_extension():
    html_path = REPO_ROOT / "docs" / "index.html"
    css_path = REPO_ROOT / "docs" / "styles.css"
    js_path = REPO_ROOT / "docs" / "app.js"

    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    js_content = js_path.read_text(encoding="utf-8")

    # 1. HTML checks
    assert 'id="ego-trigger"' in html_content, "ego-trigger button missing in index.html"
    assert 'View on GNOME Extension' in html_content, "View on GNOME Extension text missing"
    assert 'In Review' in html_content, "In Review badge missing"
    assert 'id="ego-popover"' in html_content, "ego-popover missing in index.html"
    assert 'id="ego-close"' in html_content, "ego-close button missing in index.html"
    assert 'href="#install"' in html_content, "install action link missing"

    # Check GNOME footprint SVG path
    assert "M13.136 0c-3.328" in html_content, "GNOME footprint SVG path missing"

    # 2. CSS checks
    assert ".btn--ego" in css_content, ".btn--ego missing in styles.css"
    assert ".btn-badge--pending" in css_content, ".btn-badge--pending missing in styles.css"
    assert ".ego-popover" in css_content, ".ego-popover missing in styles.css"
    assert ".ego-status-dot" in css_content, ".ego-status-dot missing in styles.css"
    assert "@keyframes popoverFadeIn" in css_content, "popoverFadeIn animation missing in styles.css"
    assert ".hero__cta .ego-btn-wrap" in css_content, "responsive ego-btn-wrap rule missing in styles.css"

    # 3. JS checks
    assert "egoTrigger" in js_content, "egoTrigger logic missing in app.js"
    assert "egoPopover" in js_content, "egoPopover logic missing in app.js"
    assert "openEgoPopover" in js_content, "openEgoPopover function missing in app.js"
    assert "closeEgoPopover" in js_content, "closeEgoPopover function missing in app.js"
    print("PASS: test_hero_cta_gnome_extension")

def test_js_syntax():
    res = subprocess.run(["node", "-c", str(REPO_ROOT / "docs" / "app.js")], capture_output=True, text=True)
    assert res.returncode == 0, f"JS syntax check failed: {res.stderr}"
    print("PASS: test_js_syntax")

def test_existing_suite():
    res1 = subprocess.run(["gjs", str(REPO_ROOT / "tests" / "test_buttonPool_logic.js")], capture_output=True, text=True)
    assert res1.returncode == 0, f"Button pool test failed: {res1.stderr}"

    res2 = subprocess.run(["gjs", "-m", str(REPO_ROOT / "tests" / "test_hoverSubMenu_logic.js")], capture_output=True, text=True)
    assert res2.returncode == 0, f"Hover sub menu test failed: {res2.stderr}"

    print("PASS: test_existing_suite")

def test_dynamic_indicator_and_release_flow():
    html_path = REPO_ROOT / "docs" / "index.html"
    css_path = REPO_ROOT / "docs" / "styles.css"
    js_path = REPO_ROOT / "docs" / "app.js"
    readme_path = REPO_ROOT / "README.md"

    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    js_content = js_path.read_text(encoding="utf-8")
    readme_content = readme_path.read_text(encoding="utf-8")

    # 1. Dynamic Indicator checks
    assert "gnome-live-pill" in html_content, "gnome-live-pill missing from index.html"
    assert "Dynamic Live Indicator" in html_content, "Dynamic Live Indicator card missing in index.html"
    assert "Music &middot; Gravity Chasm - Conan" in html_content, "Mockup live media indicator missing in index.html"
    assert ".gnome-live-pill" in css_content, ".gnome-live-pill missing in styles.css"
    assert ".live-pill__equalizer" in css_content, ".live-pill__equalizer missing in styles.css"
    assert ".live-pill__text" in css_content, ".live-pill__text missing in styles.css"
    assert "eqPulse" in css_content, "eqPulse animation missing in styles.css"

    # 2. Release Pill & Tabs checks
    assert "releases/latest/download/fuhgawzglbmenu@katon26.github.io.shell-extension.zip" in html_content, "Release download link missing in index.html"
    assert "tab-release" in html_content, "tab-release missing in index.html"
    assert "tab-source" in html_content, "tab-source missing in index.html"
    assert "headerbar-tab" in css_content, "headerbar-tab missing in styles.css"
    assert "installSnippets" in js_content, "installSnippets missing in app.js"
    assert "activateTab" in js_content, "activateTab missing in app.js"
    assert "ArrowRight" in js_content and "ArrowLeft" in js_content, "Tab keyboard navigation missing in app.js"

    # 3. Avoid-AI-writing checks
    assert "Not just a static menu bar" not in html_content, "AI negation pattern found in index.html"
    assert "dynamic live activity engine" not in html_content, "AI buzzword pattern found in index.html"

    # 4. README check
    assert "Dynamic Live Activity Indicator" in readme_content, "Dynamic Live Activity Indicator missing in README.md"
    assert "Method 1: Pre-built Package (Recommended)" in readme_content, "Pre-built package section missing in README.md"

    print("PASS: test_dynamic_indicator_and_release_flow")

def test_floating_media_card_and_marquee():
    html_path = REPO_ROOT / "docs" / "index.html"
    css_path = REPO_ROOT / "docs" / "styles.css"
    js_path = REPO_ROOT / "docs" / "app.js"

    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    js_content = js_path.read_text(encoding="utf-8")

    # 1. Trademark / user constraint safety checks
    assert "spotify" not in html_content.lower(), "Spotify trademark found in index.html"
    assert "bohemian" not in html_content.lower(), "Bohemian Rhapsody found in index.html"
    assert "spotify" not in js_content.lower(), "Spotify trademark found in app.js"

    # 2. HTML Floating Media Card checks
    assert 'id="gnome-live-pill"' in html_content, "gnome-live-pill ID missing in index.html"
    assert 'id="mockup-media-card"' in html_content, "mockup-media-card missing in index.html"
    assert 'mockup-media-card__art' in html_content, "Album artwork container missing in index.html"
    assert 'Gravity Chasm' in html_content, "Gravity Chasm track title missing in index.html"
    assert 'Conan · Blood Eagle' in html_content, "Conan · Blood Eagle artist missing in index.html"
    assert 'id="media-prev-btn"' in html_content, "Previous track button missing in index.html"
    assert 'id="media-play-btn"' in html_content, "Play/Pause button missing in index.html"
    assert 'id="media-next-btn"' in html_content, "Next track button missing in index.html"
    assert 'mockup-media-card__waveform' in html_content, "Cairo waveform area missing in index.html"
    assert 'Recently played' in html_content, "Recently played section heading missing in index.html"
    assert 'Hawk as Weapon' in html_content, "Hawk as Weapon missing in index.html"
    assert 'Levitation Hoax' in html_content, "Levitation Hoax missing in index.html"
    assert 'Unknown Title' in html_content, "Unknown Title missing in index.html"

    # 3. CSS styles and keyframes
    assert '.mockup-media-card' in css_content, ".mockup-media-card missing in styles.css"
    assert '.media-ctrl-btn--play' in css_content, ".media-ctrl-btn--play missing in styles.css"
    assert '.mockup-media-card__waveform' in css_content, ".mockup-media-card__waveform missing in styles.css"
    assert '.wave-bar' in css_content, ".wave-bar missing in styles.css"
    assert '@keyframes marqueeScroll' in css_content, "marqueeScroll animation missing in styles.css"
    assert 'mediaCardFadeIn' in css_content, "mediaCardFadeIn animation missing in styles.css"

    # 4. JS behavior and coordination
    assert 'livePill' in js_content, "livePill ref missing in app.js"
    assert 'mediaCard' in js_content, "mediaCard ref missing in app.js"
    assert 'closeMediaCard' in js_content, "closeMediaCard coordination missing in app.js"
    assert 'positionMediaCard' in js_content, "positionMediaCard missing in app.js"

    print("PASS: test_floating_media_card_and_marquee")

def test_dual_theme_bento_and_distro_marks():
    tokens_path = REPO_ROOT / "docs" / "tokens.css"
    html_path = REPO_ROOT / "docs" / "index.html"
    css_path = REPO_ROOT / "docs" / "styles.css"
    js_path = REPO_ROOT / "docs" / "app.js"

    tokens_content = tokens_path.read_text(encoding="utf-8")
    html_content = html_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")
    js_content = js_path.read_text(encoding="utf-8")

    # 1. Palette: light default, explicit dark block, and a no-JS mirror kept in sync
    assert "color-scheme: light;" in tokens_content, "light color-scheme missing in tokens.css"
    assert ':root[data-theme="dark"]' in tokens_content, "explicit dark palette missing in tokens.css"
    assert "@media (prefers-color-scheme: dark)" in tokens_content, "no-JS dark mirror missing in tokens.css"
    assert ':root:not([data-theme="light"])' in tokens_content, "no-JS dark mirror selector missing in tokens.css"
    assert tokens_content.count("color-scheme: dark;") == 2, "color-scheme must ship in both dark blocks"
    for token in ("--color-accent-text:", "--color-live:", "--color-live-text:"):
        assert tokens_content.count(token) == 3, f"{token} must exist in light, dark, and mirrored blocks"
    assert "--radius-md: 12px;" in tokens_content, "--radius-md should be raised to 12px"

    # 2. Pre-paint bootstrap, cycling toggle, and the palette command
    assert "fuhgawz-theme" in html_content, "theme storage key missing in index.html bootstrap"
    assert "root.dataset.themePreference" in html_content, "bootstrap must stamp the resolved preference"
    assert 'id="theme-toggle"' in html_content, "theme toggle button missing in index.html"
    assert html_content.count('class="theme-toggle__icon"') == 3, "expected system/light/dark toggle icons"
    assert 'data-custom="theme"' in html_content, "palette theme command missing in index.html"
    assert "Switch theme (system / light / dark)" in html_content, "palette theme label missing in index.html"
    assert "THEME_KEY = 'fuhgawz-theme'" in js_content, "app.js storage key is out of sync with the bootstrap"
    assert "function applyTheme(" in js_content, "applyTheme missing in app.js"
    assert "function cycleTheme(" in js_content, "cycleTheme missing in app.js"
    assert "localStorage.setItem(THEME_KEY" in js_content, "theme preference is not persisted"
    assert "prefers-color-scheme" in js_content, "system theme listener missing in app.js"
    assert 'meta[name="theme-color"]' in js_content, "theme-color meta sync missing in app.js"
    assert "dataset.custom === 'theme'" in js_content, "palette command is not wired to cycleTheme"

    # 3. Bento: six-column track so every row fills edge to edge
    assert "grid-template-columns: repeat(6, minmax(0, 1fr))" in css_content, "spec grid is not a six-column bento track"
    assert ".spec-card--featured" in css_content, "featured bento card span rule missing in styles.css"
    assert "grid-column: span 2" in css_content, "base bento card span missing in styles.css"
    assert "grid-column: span 4" in css_content, "wide bento card span missing in styles.css"

    # 4. Distro row: the four major distributions, each drawn as its own mark
    assert 'class="distro-pills"' in html_content, "distro pill row missing in index.html"
    assert html_content.count('class="distro-pill"') == 4, "expected exactly four distribution pills"
    for name in ("Fedora", "Arch Linux", "Ubuntu", "Debian"):
        assert f">{name}</span>" in html_content, f"{name} pill label missing in index.html"
    assert html_content.count('class="distro-pill__icon"') == 4, "each pill needs its own inline mark"
    assert 'aria-label="Supported Linux distributions"' in html_content, "distro row needs a labelled list"
    assert "distro-pill__dot" not in html_content, "dead dot markup should be removed"
    assert "distro-pill__dot" not in css_content, "dead dot styles should be removed"

    print("PASS: test_dual_theme_bento_and_distro_marks")

def test_hero_stage_follows_theme():
    """The .mockup-stage ground must track the active theme instead of staying graphite.

    Regression guard for the bug where a light-theme visitor still saw a black hero
    band: --color-stage has to be overridden in BOTH dark blocks (the explicit
    data-theme one and the no-JS prefers-color-scheme mirror), and every hero-copy
    colour has to ride an on-stage token rather than a hardcoded white.
    """
    tokens_path = REPO_ROOT / "docs" / "tokens.css"
    css_path = REPO_ROOT / "docs" / "styles.css"

    tokens_content = tokens_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")

    # 1. Every stage token must ship in all three blocks: light, dark, and the mirror
    for token in (
        "--color-stage:",
        "--color-on-stage:",
        "--color-on-stage-2:",
        "--color-on-stage-3:",
        "--color-stage-rule:",
        "--color-stage-fill:",
        "--color-accent-on-stage:",
    ):
        assert tokens_content.count(token) == 3, f"{token} must exist in light, dark, and mirrored blocks"

    # 2. The light half must define a genuinely light plinth, not the graphite value
    light_root = tokens_content.split(":root {", 1)[1].split("\n}", 1)[0]
    light_stage = next(
        line for line in light_root.splitlines() if line.strip().startswith("--color-stage:")
    )
    stage_value = light_stage.split(":", 1)[1].strip()
    assert "graphite" not in stage_value, (
        "--color-stage must not alias graphite in the light half; the hero band stayed black in light mode"
    )
    lightness = float(stage_value.split()[0].removeprefix("oklch(").rstrip("%"))
    assert lightness > 80, f"light --color-stage must be a lit tone, got {stage_value}"

    # 3. The stage background and its bottom fade must both be token-driven
    assert "background: var(--color-stage);" in css_content, "hero ground is not driven by --color-stage"
    assert css_content.count("var(--color-stage)") >= 4, (
        "the mockup bottom fade must dissolve into --color-stage too, or the laptop will sit on a hard seam"
    )

    # 4. Hero copy must never hardcode white; it rides the on-stage ramp.
    #    Anchor on the section comment: an earlier ".hero-copy" mention sits in
    #    the mockup-wrap comment, and the mockup HUD below is a *photographed*
    #    GNOME desktop that is meant to stay dark in both themes.
    hero_copy = css_content.split("Hero copy renders on", 1)[1].split("Showcase Section", 1)[0]
    for banned in ("#fff", "#ffffff", "255, 255, 255", "oklch(100%"):
        assert banned not in hero_copy, f"hardcoded {banned} found in .hero-copy; use an on-stage token"
    assert hero_copy.count("var(--color-on-stage") >= 5, "hero copy is not fully token-driven"

    # 5. The hero copy sits ON the mocked GNOME screen (the laptop artboard is
    #    118% wide at scale(1.15) and .hero-content stacks above it), and that
    #    screen is dark in BOTH themes. So every on-stage ink must be a LIGHT
    #    tone in BOTH the light and the dark block. The bug this guards: the
    #    light half shipped 24%/36% greys, which render as unreadable grey
    #    text on the dark screen. Assert the ramp, not just presence.
    def _on_stage_lightness(block: str, token: str) -> float:
        line = next(
            ln for ln in block.splitlines() if ln.strip().startswith(f"{token}:")
        )
        return float(line.split(":", 1)[1].strip().split()[0].removeprefix("oklch(").rstrip("%"))

    dark_block = tokens_content.split(':root[data-theme="dark"]', 1)[1].split("\n}\n", 1)[0]
    for block_name, block in (("light", light_root), ("dark", dark_block)):
        for token in ("--color-on-stage", "--color-on-stage-2", "--color-on-stage-3"):
            lightness = _on_stage_lightness(block, token)
            assert lightness >= 68, (
                f"{token} in the {block_name} half is {lightness}% — the hero copy renders on the "
                "dark mocked GNOME screen, so on-stage inks must stay light in both themes"
            )

    print("PASS: test_hero_stage_follows_theme")

def main():
    test_font_tokens()
    test_font_html()
    test_generic_code_icon()
    test_hero_cta_gnome_extension()
    test_dynamic_indicator_and_release_flow()
    test_floating_media_card_and_marquee()
    test_dual_theme_bento_and_distro_marks()
    test_hero_stage_follows_theme()
    test_js_syntax()
    test_existing_suite()
    print("\nAll landing page and repository tests passed!")

if __name__ == "__main__":
    main()
