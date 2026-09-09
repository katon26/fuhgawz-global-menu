# FUHGAWZ Global Menu v1.0.0

[![GNOME Shell 45-50](https://img.shields.io/badge/GNOME%20Shell-45%20%7C%2046%20%7C%2047%20%7C%2048%20%7C%2049%20%7C%2050-blue.svg)](https://extensions.gnome.org)
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green.svg)](LICENSE)
[![Release: v1.0.0](https://img.shields.io/badge/Release-v1.0.0-brightgreen.svg)](https://github.com/katon26/fuhgawz-global-menu/releases/tag/v1.0.0)

We are pleased to announce the official **v1.0.0 release of FUHGAWZ Global Menu**.

This milestone release brings a completely redesigned native Libadwaita Preferences experience, macOS-style horizontal hover flyouts, a universal 6-tier fallback engine for full Wayland compatibility, and critical performance optimizations eliminating window-focus latency.

---

## Major Highlights

### 1. Universal 6-Tier Fallback Chain
Linux desktops on Wayland feature diverse window toolkits (GTK4, Electron, Chromium, Firefox, GPUI) with divergent D-Bus export support. FUHGAWZ v1.0.0 bridges this gap with an intelligent 6-tier fallback engine:
* **Tier 1 (GTK4 / GIO Actions)**: Instant native extraction via `org.gtk.Actions` and `Gio.DBusMenuModel`.
* **Tier 2 (Canonical DBusMenu)**: Standard `com.canonical.dbusmenu` support for apps with dynamic global menus.
* **Tier 3 (Declarative App Profiles)**: Zero-overhead JSON profiles with `{{appName}}` dynamic templating for apps like Brave, Chrome, VS Code, Antigravity, LibreOffice, and ONLYOFFICE.
* **Tier 4 (Compositor Virtual Keyboard)**: Synthetic key injection via `Clutter.VirtualInputDevice` for instant shortcut dispatch.
* **Tier 5 (Restricted AT-SPI Scanner)**: Safe accessibility probing with strict 50ms timeouts and domain blacklisting.
* **Tier 6 (XWayland Hybrid Mode)**: Seamless dynamic menubar integration for Chromium and Electron via `./patch-launcher.sh`.

### 2. Redesigned 3-Page Libadwaita Preferences Window
The extension settings have been rewritten from the ground up using native Libadwaita components:
* **About Page**: Clean branding view featuring custom SVG logo, version badge, direct links, and a support/donation card with QR code.
* **Global Menu Page**: Toggles for Wayland fallback profiles, hover flyouts, debug logging, and button padding adjustment.
* **System Menu Page**: Top-left branding menu toggles, custom desktop distro icon picker (Fedora, Arch, Debian, Ubuntu, macOS, etc.), Recent Items, and Force Quit.

### 3. macOS-Style Horizontal Hover Flyouts
Submenus now open as smooth, horizontal flyout menus instead of vertical GNOME accordions:
* **Triangular Velocity Bridge**: Moving diagonally toward a submenu will not accidentally close it.
* **Multi-Level Hierarchy**: Smooth navigation through nested menus (Level 1 to Level 2 to Level 3).
* **Boundary Edge Detection**: Flyouts automatically flip to the left when near the display right margin.

### 4. Zero-Overhead Performance & Stutter-Free Navigation
* **True Lazy Loading**: Dropdown menus instantiate empty (`isEmpty()` override) and build items on-demand, eliminating dropped frames when opening or Alt-Tabbing across heavy apps (Nautilus, IDEs).
* **Button Recycling Pool**: Reuses top-bar button actors (`fuhgawz-menu-slot-N`), drastically reducing garbage collection spikes.
* **Ghost Menu Guards**: Added monotonic `updateCycleId` and active window verification to guarantee menus never glitch during rapid window switching.
* **Asynchronous Bookmarks with In-Memory Caching**: Dynamic Chrome/Brave bookmarks are loaded asynchronously and cached with filesystem `mtime` verification, capped at 50 items per folder.

---

## What's Changed in v1.0.0

<details>
<summary><strong>Click to expand full changelog</strong></summary>

### Features & Integrations
* Built-in profiles for **Google Chrome**, **Brave**, **VS Code**, **Antigravity**, **Zed Editor**, **LibreOffice**, **ONLYOFFICE**, **GNOME Calculator**, **GNOME Text Editor**, and **Warp Terminal**.
* Top-left System Logo Menu with distro-specific icons, Recent Items submenu, Force Quit killer, and User Switcher.
* Dynamic Chrome & Brave Bookmarks Bar expansion with file monitor.
* Native metadata modal dialog for non-GTK applications replacing deprecated `Main.notify`.

### Bug Fixes & Stability
* Fixed premature return in `_probeMenubarPath` restoring menubars for Mozilla Firefox on Wayland.
* Fixed event grab order and outside click propagation in hover submenus (LIFO dismissal).
* Fixed startup ghost popups by ensuring actors hide upon creation and attach to top chrome only on `open()`.
* Added safe filtering for Desktop Icons NG (DING) background desktop workers.
* Added Flatpak bare app ID matching and `WindowTracker` bidirectional fallback.

### Verification & Testing
* Automated test suite validating 309+ shortcuts and JSON schemas across all app profiles.
* Multi-level submenu and hover grab unit tests.
* Panel button pooling and safe DING filter unit tests.
</details>

---

## Installation & Verification

### Quick Install from GitHub Release
```bash
# 1. Download the release archive
wget https://github.com/katon26/fuhgawz-global-menu/releases/download/v1.0.0/fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 2. Install using GNOME Extensions CLI
gnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip

# 3. Enable the extension
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```
*(On Wayland, log out and log back in, or restart GNOME Shell to reload).*

---

## Verification & Checksums

| Asset | SHA-256 Checksum |
| :--- | :--- |
| `fuhgawzglbmenu@katon26.github.io.shell-extension.zip` | *(Generated automatically by release workflow)* |

---

**Full Changelog**: https://github.com/katon26/fuhgawz-global-menu/commits/v1.0.0
