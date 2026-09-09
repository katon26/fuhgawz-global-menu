# Changelog

All notable changes to the **FUHGAWZ Global Menu** GNOME Shell extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-09

### Major Architectural Highlights

* **Universal 6-Tier Fallback Architecture**:
  Provides a robust, unified global menu across Wayland and XWayland desktops without compromising performance:
  1. *Tier 1 (Native GTK4 / GIO Actions)*: Direct D-Bus menu extraction via `org.gtk.Actions` and `Gio.DBusMenuModel`.
  2. *Tier 2 (Canonical DBusMenu)*: Standard `com.canonical.dbusmenu` protocol support for traditional desktop applications.
  3. *Tier 3 (Declarative Profiles)*: Zero-overhead JSON profiles providing instant menubars with `{{appName}}` dynamic templating.
  4. *Tier 4 (Compositor Virtual Keyboard)*: Mutter synthetic key injection via `Clutter.VirtualInputDevice` for instant shortcut dispatch.
  5. *Tier 5 (Restricted AT-SPI Scanner)*: Accessibility tree probing with strict 50ms timeouts and domain blacklisting.
  6. *Tier 6 (XWayland Hybrid Mode)*: Dynamic menubar integration for Electron and Chromium apps via `./patch-launcher.sh`.

* **Redesigned 3-Page Libadwaita Preferences (`prefs.js`)**:
  A complete overhaul of the extension configuration window built with modern Libadwaita components:
  * **About Page**: Centered branding header with SVG logo (`src/fuhgawz-logo.svg`), version badge, project links, and an integrated support/donation card with high-res QR code (`src/qr-code-fuhg.svg`).
  * **Global Menu Page**: Behavioral switches, Wayland fallback toggles, hover delay adjustments, and button horizontal padding spin-row.
  * **System Menu Page**: System branding menu toggles, custom desktop icon selector (Fedora, Arch, Debian, Ubuntu, macOS, etc.), and submenu toggles.
  * **Custom Styling (`prefs.css`)**: Dynamic CSS provider injection for polished typography, badges, and card spacing.

* **macOS-Style Hover Flyout Submenus (`src/hoverSubMenu.js`)**:
  Replaces standard GNOME Shell vertical accordion submenus with true horizontal flyout menus:
  * Built with triangular cursor velocity tracking (`PointerState.BRIDGE`) to prevent accidental submenu dismissal during diagonal mouse movement.
  * Supports recursive multi-level nesting (Level 1 to Level 2 to Level 3).
  * Dynamic screen-edge detection automatically flips menus to the left when near display boundaries.

---

### Added

* **Declarative App Profiles (`profiles/*.json`)**:
  * **Browsers**: Google Chrome and Brave Browser with dynamic bookmarks bar integration.
  * **Development**: Visual Studio Code, Google Antigravity, and Zed Editor.
  * **Productivity & Office**: LibreOffice Suite (Writer, Calc, Impress) and ONLYOFFICE Desktop Editors.
  * **System & Utilities**: GNOME Calculator, GNOME Text Editor, and Warp Terminal.
* **Dynamic Bookmarks Bar Expansion**:
  * Asynchronous background parsing of browser bookmarks (`loadBrowserBookmarksAsync`).
  * In-memory cache with filesystem `mtime` invalidation to prevent disk I/O on menu open.
  * 50-item safety cap per folder with automatic "Open Bookmarks Manager" fallback item.
* **Integrated System Logo Menu**:
  * Top-left branding menu inspired by classic macOS system menus.
  * Distro-specific symbolic icons (Fedora, Arch, Debian, Ubuntu, openSUSE, Bazzite, Nobara, Windows, macOS).
  * Recent Items submenu with direct document launch.
  * Native Force Quit process selector and User Switcher service.
* **Comprehensive Automated Test Suite (`tests/`)**:
  * Validates 309+ keyboard shortcuts and JSON schemas across all app profiles.
  * Unit tests for hover submenu lifecycles, modal grab order, and click routing.
  * Unit tests for panel button recycling pool and safe DING filtering.
  * Native GJS test runner executable via `gjs -m tests/...`.

---

### Performance & Reliability

* **True Lazy Dropdown Population**:
  * Overrode GNOME Shell's `isEmpty()` check on menu buttons so buttons instantiate empty with zero actor overhead.
  * Dropdown and submenu actors are constructed on-demand only when first opened by user click or keyboard navigation.
  * Completely eliminates window focus freezes and dropped frames during rapid window switching.
* **Panel Button Recycling Pool**:
  * Introduced reusable panel slot IDs (`fuhgawz-menu-slot-N`) and pooled button allocation.
  * Avoids continuous destroying and re-instantiating of Clutter actors on each window change, drastically reducing garbage collection overhead.
* **Window Focus Race Guards**:
  * Added monotonic `updateCycleId` and active window verification before committing top-bar UI updates.
  * Prevents ghost buttons and race conditions when rapidly Alt-Tabbing across applications.
* **Decoupled Window Tracking**:
  * Decoupled profile discovery from window map/unmap signals to eliminate 200–500ms main loop blocking.
* **Safe Desktop Icons NG (DING) Filtering**:
  * Safely identifies and ignores DING desktop worker windows to prevent registering ghost application menus.

---

### Fixed

* **Firefox Wayland Menubar**:
  * Fixed an early unconditioned `return` in `_probeMenubarPath` that prevented Firefox from falling through to the declarative menubar profile.
* **Unclickable Flyout Submenus**:
  * Resolved event interception issues by enforcing strict LIFO modal grab dismissals and routing background clicks through `topMenu.actor.contains` delegation.
* **Startup Ghost Popups**:
  * Fixed bug where secondary popup actors rendered at `(0, 0)` on startup by enforcing explicit hiding on instantiation and attaching to `Main.layoutManager.addTopChrome()` on `open()`.
* **Non-GTK About Dialog**:
  * Replaced deprecated GNOME Shell `Main.notify` calls with a native `ModalDialog.ModalDialog` displaying app icon, version, and desktop info.
* **Wayland Sandboxed App ID Matching**:
  * Added `WindowTracker` bidirectional fallback and support for bare app IDs (e.g. `dev.zed.Zed` without `.desktop` suffix) under Flatpak environments.

---

### Packaging, CI & Compatibility

* **Automated GitHub Release Workflow (`.github/workflows/release.yml`)**:
  * Compiles GSettings schemas and packages extension with `gnome-extensions pack`.
  * Verifies inclusion of all runtime directories (`src/`, `profiles/`, `icons/`, `sysmenu/`, `app/`, `prefs.css`, `stylesheet.css`, `schemas/`).
  * Generates SHA-256 checksums and publishes release assets on tag push.
* **GNOME Shell Version Compatibility**:
  * Officially validated for **GNOME Shell 45, 46, 47, 48, 49, and 50**.
