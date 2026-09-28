# FUHGAWZ Global Menu

[![GNOME Shell 45-51](https://img.shields.io/badge/GNOME%20Shell-45%20%7C%2046%20%7C%2047%20%7C%2048%20%7C%2049%20%7C%2050%20%7C%2051-blue.svg)](https://extensions.gnome.org/)
[![Release](https://img.shields.io/badge/Release-v1.1.1-green.svg)](https://github.com/katon26/fuhgawz-global-menu/releases)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)
[![Session](https://img.shields.io/badge/Session-Wayland%20%26%20X11-orange.svg)](#overcoming-technical-limitations-the-6-tier-architecture)

FUHGAWZ Global Menu is a GNOME Shell extension designed to unify your desktop experience by centralizing application menus into the GNOME top bar.

I'm just trying to maximize workspace utilization, reclaim some vertical screen, reduce cognitive load, and keep application window interfaces clean and distraction-free. Just the target, not fully achieved yet, but I'm actively working on it. Any contributions are welcome!

## Features

- **Unified Top Bar Interface:** Brings File, Edit, View, and Help menus directly into the GNOME top bar for active applications with smooth horizontal flyout submenus.
- **Dynamic Live Activity & Media Indicator:** Monitors active Nautilus file copy telemetry and universal MPRIS media players with dedicated player priority (Spotify, VLC, browser tabs).
- **Interactive Waveform Scrubbing:** Real-time Cairo wave equalizer with direct seek scrubbing, elapsed/total playback time display, and album art caching.
- **Idle Global Menu Collapse:** Automatically collapses the application menu into the live indicator while idle, smoothly expanding on pointer hover without panel layout jitter (`menu-hide-when-idle`).
- **Keyboard Navigation & Floating Popover Pinning:** Inspect media and task status via floating cards with full keyboard shortcuts (`F10`, `Alt+F`, `Esc`).
- **Dynamic 6-Tier Architecture:** Overcomes modern Wayland and GTK 4 limitations through native GMenuModel, DBusMenu registrar, declarative JSON profiles with dynamic browser bookmark expansion, GTK 4 Action heuristics, and restricted AT-SPI scanning.
- **Native Libadwaita Preferences:** 3-page configuration dialog (*About*, *Global Menu*, *System Menu*) for animations, layout, visualizer styles, and custom branding.
- **Broad Compatibility:** Fully supported on GNOME 45 through 51 across both Wayland and X11 sessions.

## Keyboard Shortcuts & Mouse Controls

| Action | Shortcut / Trigger | Description |
| :--- | :--- | :--- |
| **Toggle / Pin Media Popover** | `F10` or `Alt+F` | Opens and pins the floating media card for keyboard and mouse interaction. |
| **Dismiss Media Popover** | `Escape` | Closes and unpins the floating media card, returning focus to the panel. |
| **Seek Playback Position** | Left-Click on Waveform | Instantly seeks the active MPRIS track to the clicked relative position. |
| **Inspect Live Indicator** | Hover over Indicator Chip | Displays the floating progress card with transfer telemetry or media metadata. |
| **Reveal Idle Menu** | Hover over Menu Zone | Expands the collapsed global menu when idle collapse mode is active. |
| **Force Quit Window** | `<Alt><Super>Escape` | Interactive application force-quit picker (configurable in preferences). |

## Installation

### Method 1: Pre-built Package (Recommended for Most Users)

Downloading the pre-built zip from the GitHub Releases page is the easiest and fastest way to get started. It requires no build tools, compilers, or setup scripts—just download, install, and enable in one step:

```bash
curl -sLO https://github.com/katon26/fuhgawz-global-menu/releases/latest/download/fuhgawzglbmenu@katon26.github.io.shell-extension.zip
gnome-extensions install --force fuhgawzglbmenu@katon26.github.io.shell-extension.zip
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```

> **Note on Pre-built Packages:** While this method is hassle-free for regular users, it installs a pre-packaged bundle. If you are a developer, power user, or contributor who wants to modify the source code, adjust schema definitions, or test internal scripts, use **Method 2** below instead.

### Method 2: Build from Source (For Builders & Contributors)

Building from source gives you full control to inspect, modify, and customize the extension, or compile the required GTK helper modules (for example, on Fedora where global menu libraries are not packaged by default):

#### 1. Configure the Environment
Clone the repository and run the setup script:

```bash
git clone https://github.com/katon26/fuhgawz-global-menu.git
cd fuhgawz-global-menu
./configure-global-menu.sh
```

#### 2. Install and Enable the Extension
Pack and install the extension:

```bash
./install.sh
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```

#### 3. Session Reload
Log out of your GNOME session and log back in so the environment variables (`UBUNTU_MENUPROXY=1`) and GTK modules load into the display server.

### Accessing Preferences

To open the preferences window after installation:

```bash
gnome-extensions prefs fuhgawzglbmenu@katon26.github.io
```

You can also launch settings directly from the GNOME **Extension Manager** application.

## Configuration & Settings

FUHGAWZ Global Menu provides a native 3-page Libadwaita settings dialog:

- **Global Menu**:
  - **GTK 4 Actions Probing**: Discover internal action maps for modern headerbar-driven applications.
  - **Declarative Profiles**: Enable Wayland fallback menus for unsupported browsers and editors.
  - **Flyout Submenus**: Toggle horizontal flyouts versus inline nested submenus.
  - **Idle Menu Collapse (`menu-hide-when-idle`)**: Collapse the app menu into the indicator when inactive to save panel space.
- **System Menu**:
  - **Branding Icon**: Customize the top-left system logo button.
  - **Recent Items Sync**: Sync recent desktop documents and completed file transfers.
  - **Custom Action**: Define a custom shell command, display label, and shortcut in the system menu.
- **Live Indicators**:
  - **MPRIS Media Player Tracking**: Toggle playback tracking and dedicated music player priority (Spotify, VLC).
  - **Visualizer Style**: Select between animated Cairo waveforms or clean progress bars.
  - **Reveal Animations**: Configure `slide-fade`, `fade`, or `none` transitions and duration (0–400ms).
  - **Reduced Motion**: Automatically respect system accessibility animation settings.

## Overcoming Technical Limitations: The 6-Tier Architecture

Modern Linux desktops (specifically Wayland and GTK 4) have heavily deprecated the traditional global menu paradigm. FUHGAWZ Global Menu implements an audited **6-Tier Fallback Chain** that overcomes these historical limitations:

```
Tier 1: Native GTK Menu Model (org.gtk.Menus / GMenuModel)
  └─ Native menubars exported by GTK 3/4 apps + standard path probing

Tier 2: DBusMenu Protocol (com.canonical.dbusmenu)
  └─ Registered via com.canonical.AppMenu.Registrar
  └─ Matched by PID (Wayland native, Qt 5/6, Zed PR #51321) or XID (XWayland, patched VS Code)

Tier 3: Declarative Application Profiles (JSON)
  └─ Curated profiles for Brave Browser, Google Chrome, VS Code, GNOME Text Editor, Calculator, LibreOffice
  └─ Dynamic bookmark integration with mtime caching and 50-item safety capping
  └─ Dispatches actions via Mutter Clutter virtual keyboard with focus restoration

Tier 4: GTK Actions (org.gtk.Actions.DescribeAll Heuristic)
  └─ For modern Libadwaita apps (Ptyxis, etc.) exporting action maps
  └─ Augmented with synthetic keystroke injection for unexported actions

Tier 5: Restricted AT-SPI Accessibility Scanner
  └─ Searches strictly for ATSPI_ROLE_MENU_BAR (legacy GIMP, LibreOffice)
  └─ Hardcoded blacklist for Chromium/Brave and Electron to prevent bus lockup
  └─ 50ms async timeout budget

Tier 6: Desktop & Window Controls Fallback
  └─ App launcher actions (Gio.DesktopAppInfo.list_actions()) + window management
```

### How Specific Limitations are Addressed:

* **GTK 4 Document & Window Actions (GNOME Text Editor, Loupe, Nautilus):**
  GTK 4 keeps document actions (`page.save`, `editor.zoom-in`) in local child widgets without exporting them over D-Bus. FUHGAWZ Global Menu bridges this gap using compositor-level synthetic input dispatching (`VirtualKeyboardDispatcher`), safely injecting shortcuts (`Ctrl+S`, `Ctrl++`) directly into the focused window after releasing the panel grab.
* **Brave & Chromium Browsers:**
  Chromium maintainers removed Linux menubar export code years ago, and scanning Chromium via AT-SPI freezes the GNOME Shell compositor loop. FUHGAWZ Global Menu solves this using **Declarative Application Profiles** (`profiles/brave-browser.json`), recreating a complete traditional application menu tree (`Brave`, `File`, `Edit`, `View`, `History`, `Bookmarks`) and routing commands directly to browser hotkeys with live bookmark synchronization.
* **VS Code & Electron on Wayland:**
  - **Native XWayland Menus**: Run `./patch-launcher.sh code` to automatically set `"window.titleBarStyle": "native"` in your VS Code settings and set `ELECTRON_OZONE_PLATFORM_HINT=x11`. VS Code will export its full live native menu over `com.canonical.dbusmenu`.
  - **Pure Wayland Fallback**: If running without XWayland, FUHGAWZ loads the built-in `profiles/com.visualstudio.code.json` profile.
* **Zed Editor & Custom Toolkits:**
  Upstream Zed PR [#51321](https://github.com/zed-industries/zed/pull/51321) implements `com.canonical.dbusmenu`. Because FUHGAWZ matches D-Bus menus by Process ID (`getEntryByPid`), Zed menus will work automatically without requiring changes. For custom builds, declarative profiles provide an instant bridge.

### Future Improvement: Custom User-Defined Profiles

A planned feature for upcoming releases is a dedicated custom profile manager. This will allow users to:
- Create and customize menu structures for any app based on personal preferences.
- Bind custom shortcuts or URL actions directly through the Libadwaita preferences UI.
- Import and export custom application profile JSON files without needing to modify extension source code.

## Running Tests

The extension includes standalone unit and logic test suites executable directly via GJS without restarting GNOME Shell:

```bash
# Test profile manager and browser bookmark caching
gjs -m tests/test_profileManager.js

# Test flyout submenus and coordinates
gjs -m tests/test_hoverSubMenu_logic.js

# Test virtual keyboard dispatcher and shortcut mapping
gjs -m tests/test_virtualKeyboard.js

# Test button pool allocation and menu lifecycle
gjs -m tests/test_buttonPool_logic.js

# Test live media manager and player heuristics
gjs -m tests/test_mediaManager.js
```

## Contributing

Contributions, pull requests, and bug reports are highly welcome since this was my first time to build GNOME Shell extension. 

If you want to help out—whether it's adding new app profiles in `profiles/`, tweaking visualizer styles, sharing feedback on Wayland quirks, or improving translations—feel free to open an issue or submit a pull request!

## Acknowledgments & References

Some architecture and ideas behind this extension were inspired by the following projects and resources:
- [Sinty's Global Menu Internals Documentation](https://sinty.dev/docs/global-menu-internals/)
- [Sinty's Global Menu Overview](https://sinty.dev/docs/global-menu/)
- [QuickBar by kevinbudz](https://github.com/kevinbudz/quickbar)
- [Fildem by gonzaarcr](https://github.com/gonzaarcr/Fildem) (A foundational project often referenced by the community)
- [Global Menu for GNOME by ShiroOSL](https://github.com/ShiroOSL/global-menu-for-gnome) ([GNOME Extensions](https://extensions.gnome.org/extension/10288/global-menu-for-gnome/))

## License

GNU General Public License v3.0 or later ([GPL-3.0-or-later](LICENSE)).
