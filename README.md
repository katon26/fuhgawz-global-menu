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

## Known Technical Limitations

Modern Linux desktops (specifically Wayland and GTK 4) have heavily deprecated the global menu paradigm. FUHGAWZ Global Menu does its absolute best to overcome these limitations, but please be aware of the following:

* **GTK 4 Window Actions:** Modern GNOME applications (e.g., Text Editor, GNOME Software) have completely removed the concept of menubars. While FUHGAWZ Global Menu can capture *application-level* actions (like `Preferences`, `About`, `New Window`), GTK 4 intentionally **does not export window-level actions** (like `Save`, `Zoom`, `Find`) over D-Bus. Consequently, FUHGAWZ Global Menu cannot display them.
* **Electron / Chromium / Custom UI Frameworks:** 
  * **Chromium/Brave:** Chromium developers removed all code for exporting global menus on Linux several years ago.
  * **VS Code / Electron:** Modern versions of Electron on Linux have broken or removed support for the `com.canonical.dbusmenu` protocol when running natively on Wayland.
  * **Zed Editor / Rust:** Custom frameworks like GPUI do not implement any Linux global menu protocols. 
  *(For these applications, the global menu will gracefully fall back to showing only the application name and basic window controls).*

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
