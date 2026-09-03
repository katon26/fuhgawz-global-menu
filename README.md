# FUH Global Menu

FUHGAWZ Global Menu is GNOME Shell extension designed to unify your desktop experience by centralizing application menus into the GNOME top bar. 

I just trying to maximize workspace utilization, try to reclaim some vertical screen, reduce cognitive load, and keep application window interfaces clean and distraction-free. Just the target, not fully achieve it yet. But I'm working on it. Any contribution are welcome.

## Features

- **Unified Interface:** Brings File, Edit, View, and Help menus directly into the GNOME top bar for active applications.
- **Dynamic GTK 4 Fallback:** Intelligently reads `org.gtk.Actions` from modern headerbar-driven GTK 4 apps and groups them logically.
- **Legacy GTK 3 Support:** Full integration with `appmenu-gtk-module` to restore traditional D-Bus menu exporting on modern systems.
- **D-Bus Menu Registrar:** Acts as a session-wide registrar for Qt and compatible applications exporting `com.canonical.dbusmenu`.
- **GNOME Shell Compatibility:** Supports GNOME 45 through 50.

## Installation

To get the full experience on distributions like Fedora (where global menu libraries are not packaged by default), this repository includes an automated setup script that compiles and configures the necessary GTK modules.

### 1. Configure the Environment
Clone the repository and run the setup script. This will compile `appmenu-gtk-module` from source, configure systemd environment variables (`UBUNTU_MENUPROXY=1`), and set up Flatpak overrides.

```bash
git clone https://github.com/katon26/fuhg-global-menu.git fuhgawz-global-menu
cd fuhgawz-global-menu
./configure-global-menu.sh
```

### 2. Install the Extension
Pack and install the extension into your local GNOME extensions directory:

```bash
# Rename the folder to match the new UUID if necessary, or just install via the CLI:
gnome-extensions pack --force
gnome-extensions install fuhgawzglbmenu@katon26.github.io.shell-extension.zip
```

### 3. Restart and Enable
**Important:** Log out of your GNOME session and log back in. This ensures the environment variables and the new GTK modules are loaded into the display server.

Once logged back in, enable the extension:
```bash
gnome-extensions enable fuhgawzglbmenu@katon26.github.io
```

## Overcoming Technical Limitations: The 6-Tier Architecture

Modern Linux desktops (specifically Wayland and GTK 4) have heavily deprecated the traditional global menu paradigm. FUHGAWZ Global Menu implements an audited **6-Tier Fallback Chain** that overcomes these historical limitations:

```
Tier 1: Native GTK Menu Model (org.gtk.Menus / GMenuModel)
  └─ Native menubars exported by GTK 3/4 apps + standard path probing

Tier 2: DBusMenu Protocol (com.canonical.dbusmenu)
  └─ Registered via com.canonical.AppMenu.Registrar
  └─ Matched by PID (Wayland native, Qt 5/6, Zed PR #51321) or XID (XWayland, patched VS Code)

Tier 3: Declarative Application Profiles (JSON)
  └─ Curated profiles for Brave Browser, Google Chrome, VS Code, GNOME Text Editor
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
  Chromium maintainers removed Linux menubar export code years ago, and scanning Chromium via AT-SPI freezes the GNOME Shell compositor loop. FUHGAWZ Global Menu solves this using **Declarative Application Profiles** (`profiles/brave-browser.json`), recreating the full native macOS-style menu tree (`Brave`, `File`, `Edit`, `View`, `History`, `Bookmarks`) and routing commands directly to browser hotkeys.
* **VS Code & Electron on Wayland:**
  - **Native XWayland Menus**: Run `./patch-launcher.sh code` to automatically set `"window.titleBarStyle": "native"` in your VS Code settings and set `ELECTRON_OZONE_PLATFORM_HINT=x11`. VS Code will export its full live native menu over `com.canonical.dbusmenu`.
  - **Pure Wayland Fallback**: If running without XWayland, FUHGAWZ loads the built-in `profiles/com.visualstudio.code.json` profile.
* **Zed Editor & Custom Toolkits:**
  Upstream Zed PR [#51321](https://github.com/zed-industries/zed/pull/51321) implements `com.canonical.dbusmenu`. Because FUHGAWZ matches D-Bus menus by Process ID (`getEntryByPid`), Zed menus will work automatically without requiring changes. For custom builds, declarative profiles provide an instant bridge.


## Contributing

Contributions, pull requests, and bug reports are highly welcome since this was my first time to build GNOME Shell extension.

## Acknowledgments & References

Some architecture or idea to build this extension were inspired by the following projects, resources, and articles:
- [Sinty's Global Menu Internals Documentation](https://sinty.dev/docs/global-menu-internals/)
- [Sinty's Global Menu Overview](https://sinty.dev/docs/global-menu/)
- [QuickBar by kevinbudz](https://github.com/kevinbudz/quickbar)
- [Fildem by gonzaarcr](https://github.com/gonzaarcr/Fildem) (A foundational but outdated project often forked by the community)
- [Global Menu for GNOME by ShiroOSL](https://github.com/ShiroOSL/global-menu-for-gnome) ([GNOME Extensions](https://extensions.gnome.org/extension/10288/global-menu-for-gnome/))

## License
MIT License.
