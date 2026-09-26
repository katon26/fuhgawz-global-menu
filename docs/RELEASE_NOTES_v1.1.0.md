# FUHGAWZ Global Menu v1.1.0

[![GNOME Shell 45-51](https://img.shields.io/badge/GNOME%20Shell-45%20%7C%2046%20%7C%2047%20%7C%2048%20%7C%2049%20%7C%2050%20%7C%2051-blue.svg)](https://extensions.gnome.org)
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green.svg)](LICENSE)
[![Release: v1.1.0](https://img.shields.io/badge/Release-v1.1.0-brightgreen.svg)](https://github.com/katon26/fuhgawz-global-menu/releases/tag/v1.1.0)

We are pleased to announce the **v1.1.0 release of FUHGAWZ Global Menu**!

This feature release introduces a **Dynamic Live Media Ingestion & MPRIS Engine**, an **Interactive Libadwaita Floating Media Popover**, **Unified Dynamic Task & Media Panel Arbitration**, expanded **GNOME Shell 45–51 compatibility**, and landing page UI redesigns.

---

## Major Highlights

### 1. Dynamic Live Media Ingestion & MPRIS Engine (`src/mediaManager.js`)
* **Headless D-Bus Listener**: Listens directly on session bus for `org.mpris.MediaPlayer2.*` endpoints.
* **Multi-Player Priority Arbitration**: Priority system favoring Spotify (`org.mpris.MediaPlayer2.spotify`) when multiple players are active.
* **Property Subscription & Track History**: Instant track metadata, position, and playback state tracking via `PropertiesChanged` signals, with a persistent 10-track FIFO history saved to `~/.cache/fuhgawz-global-menu/recent-tracks.json`.
* **Async Artwork Caching**: Asynchronous remote album artwork downloader caching images to `~/.cache/fuhgawz-global-menu/media-art/`.

### 2. Interactive Libadwaita Floating Media Popover (`src/mediaFloatingCard.js`)
* **Elevated Floating Card**: Anchored to top panel indicator on `Main.layoutManager.uiGroup`, automatically clamped within screen margins.
* **Cairo Wave Equalizer & Seek Bar**: Real-time animated Cairo wave visualizer with interactive seek scrubbing.
* **ATK Accessibility**: Full screen-reader support with `Atk.Role.SLIDER` and dynamic progress reporting.
* **Keyboard Navigation**: Full Tab navigation, Left/Right arrow key seeking (±5s), Home/End, Enter/Space, and Escape key focus return.
* **Collapsible Drawer**: Slide-out tray displaying recently played tracks.

### 3. Unified Dynamic Task & Media Arbitration (`src/taskIndicatorButton.js`)
* **Smart Panel Display**: Prioritizes active system operations (Nautilus transfers, downloads, package installs) and seamlessly transitions to live media (`[ 🎵 Spotify • ▶ Song - Artist ]`) when system tasks are idle.
* **Persistent Idle Option**: Configurable dim pill state keeping paused playback visible.
* **Panel Pill Direct Interaction**: Left-click raises active player window; middle-click toggles Play/Pause.

### 4. Preferences & Extended GNOME Shell Compatibility (`prefs.js`)
* **Media & Dynamic Indicators Settings Group**: Added Libadwaita controls for toggling live indicators, Spotify priority, visualizer style selection (`wave` / `bar`), persistent idle, and hover popover.
* **Expanded Compatibility**: Formally validated and supported on **GNOME Shell 45, 46, 47, 48, 49, 50, and 51**.

---

## What's Changed in v1.1.0

<details>
<summary><strong>Click to expand full changelog</strong></summary>

### Features & Architecture
* Live MPRIS media engine with D-Bus property monitoring and player priority queueing.
* Interactive Libadwaita media popover card with Cairo wave visualizer.
* Dynamic task & media panel display arbitration with clock collision guard.
* 5 new GSettings schema keys in `org.gnome.shell.extensions.fuhgawzglbmenu.gschema.xml`.
* Expanded GNOME Shell compatibility up to version 51.

### Documentation & Packaging
* Edge-to-edge landing hero redesign in `docs/index.html` with CodexBar stage and dark contrast fixes.
* Automated release packaging script [`scripts/package-release.sh`](file:///home/kaf/Projects/global-menu-extension/scripts/package-release.sh).

### Verification & Testing
* New test suites for media manager, floating card DOM, hover submenu, and landing page updates (`tests/test_mediaManager.js`, `tests/test_mediaFloatingCard.js`, `tests/test_media_card_dom.js`, `tests/test_hoverSubMenu.js`).
</details>

---

## Installation & Verification

### Quick Install from GitHub Release
```bash
# 1. Download the release archive
wget https://github.com/katon26/fuhgawz-global-menu/releases/download/v1.1.0/fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 2. Install using GNOME Extensions CLI
gnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 3. Enable the extension
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```

---

**Full Changelog**: https://github.com/katon26/fuhgawz-global-menu/commits/v1.1.0
