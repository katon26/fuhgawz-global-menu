/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * systemMenu.js - Implements the main macOS-style system menu.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { ForceQuitService } from './forceQuitService.js';
import { RecentItemsSubmenu } from './recentItemsSubmenu.js';
import { createCustomMenuItem, runCustomMenuCommand } from './customMenuItem.js';

Gio._promisify(Gio.File.prototype, 'load_bytes_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');

// Maps action tokens to SystemActions method names.
const SYSTEM_ACTIONS = new Map([
  ['lock-screen', 'activateLockScreen'],
  ['suspend', 'activateSuspend'],
  ['restart', 'activateRestart'],
  ['power-off', 'activatePowerOff'],
  ['logout', 'activateLogout'],
]);

const DEFAULT_LAYOUT = [
  {
    type: 'menu',
    title: 'About This PC…',
    cmds: ['about-this-pc'],
    icon: 'dialog-information-symbolic',
  },
  {
    type: 'separator',
  },
  {
    type: 'menu',
    title: 'System Settings…',
    cmds: ['gnome-control-center'],
    icon: 'preferences-system-symbolic',
    accelKey: 'control-center',
  },
  {
    type: 'menu',
    title: 'App Store…',
    cmds: ['gnome-software'],
    commandSettingKey: 'app-store-command',
    icon: 'system-software-install-symbolic',
  },
  {
    type: 'separator',
  },
  {
    type: 'recent-items',
    title: 'Recent Items',
    icon: 'document-open-recent-symbolic',
  },
  {
    type: 'separator',
  },
  {
    type: 'menu',
    title: 'Force Quit Applications…',
    cmds: ['force-quit'],
    icon: 'process-stop-symbolic',
  },
  {
    type: 'separator',
  },
  {
    type: 'menu',
    title: 'Sleep',
    cmds: ['suspend'],
    icon: 'weather-clear-night-symbolic',
  },
  {
    type: 'menu',
    title: 'Restart…',
    cmds: ['restart'],
    icon: 'system-reboot-symbolic',
  },
  {
    type: 'menu',
    title: 'Shut Down…',
    cmds: ['power-off'],
    icon: 'system-shutdown-symbolic',
  },
  {
    type: 'separator',
  },
  {
    type: 'menu',
    title: 'Lock Screen',
    cmds: ['lock-screen'],
    icon: 'system-lock-screen-symbolic',
    accelKey: 'screensaver',
  },
  {
    type: 'menu',
    title: 'Log Out…',
    cmds: ['logout'],
    icon: 'system-log-out-symbolic',
    accelKey: 'logout',
  },
];

async function loadJsonFileAsync(basePath, segments, cancellable) {
  if (!basePath) return [];
  const filePath = GLib.build_filenamev([basePath, ...segments]);

  try {
    const file = Gio.File.new_for_path(filePath);
    const [bytes] = await file.load_bytes_async(cancellable);
    const parsed = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
      return [];
    }
    return [];
  }
}

export const SystemMenu = GObject.registerClass(
  { GTypeName: 'FUHGlobeSystemMenuButton' },
  class SystemMenu extends PanelMenu.Button {
    _init(settings, extensionPath, extension) {
      super._init(0.0, 'FUHGlobeSystemMenu');
      this.add_style_class_name('fuhgawz-panel-button');
      this.accessible_name = this._gettext('System Menu');

      this._settings = settings;
      this._extensionPath = extensionPath;
      this._extension = extension;
      this._settingsSignalIds = [];
      this._menuOpenSignalId = 0;
      this._recentMenuManager = new PopupMenu.PopupMenuManager(this);
      this._cancellable = new Gio.Cancellable();
      this._isDestroyed = false;
      this._forceQuitService = new ForceQuitService();
      this._systemActions = SystemActions.getDefault();
      this._mediaKeysSettings = this._createMediaKeysSettings();

      this._icons = [];
      this._layout = DEFAULT_LAYOUT;

      if (this.menu?.actor) {
        this.menu.actor.add_style_class_name('fuhgawz-main-menu');
        if (typeof this.menu.setSourceAlignment === 'function') {
          this.menu.setSourceAlignment(0.0);
        }
      }

      this._icon = new St.Icon({
        icon_name: 'emblem-system-symbolic',
        style_class: 'system-status-icon',
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(this._icon);

      if (this._settings) {
        this._settingsSignalIds.push(
          this._settings.connect('changed::system-menu-icon', () => this._setIcon())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::icon', () => this._setIcon())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::show-recent-items', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::show-force-quit', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::app-store-command', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::custom-menu-enabled', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::custom-menu-label', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::custom-menu-command', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::custom-menu-icon', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::custom-menu-shortcut', () => this._renderPopupMenu())
        );
        this._settingsSignalIds.push(
          this._settings.connect('changed::macos-accelerators', () => this._renderPopupMenu())
        );

        Main.wm.addKeybinding(
          'force-quit-shortcut',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
          () => this._openForceQuitWindow()
        );

        Main.wm.addKeybinding(
          'custom-menu-shortcut',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
          () => runCustomMenuCommand(this._settings)
        );
      }

      this._setIcon();
      this._renderPopupMenu();

      this._loadDataAsync().catch((e) => {
        console.log(`FUHGlobe: Async data load note: ${e}`);
      });
    }

    async _loadDataAsync() {
      if (!this._extensionPath) return;

      try {
        const [icons, layout] = await Promise.all([
          loadJsonFileAsync(this._extensionPath, ['src', 'menu-icons.json'], this._cancellable),
          loadJsonFileAsync(this._extensionPath, ['src', 'menu-layout.json'], this._cancellable),
        ]);

        if (this._isDestroyed) return;

        if (icons && icons.length > 0) {
          this._icons = icons;
        }
        if (layout && layout.length > 0) {
          this._layout = layout;
        }

        this._setIcon();
        this._renderPopupMenu();
      } catch (error) {
        if (this._isDestroyed) return;
        console.log(`FUHGlobe: Non-fatal error loading system menu JSON: ${error}`);
      }
    }

    destroy() {
      this._isDestroyed = true;

      if (this._cancellable) {
        this._cancellable.cancel();
        this._cancellable = null;
      }

      if (this._settings) {
        this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
        this._settingsSignalIds = [];
        Main.wm.removeKeybinding('force-quit-shortcut');
        Main.wm.removeKeybinding('custom-menu-shortcut');
      }

      if (this._menuOpenSignalId !== 0) {
        this.menu.disconnect(this._menuOpenSignalId);
        this._menuOpenSignalId = 0;
      }

      if (this._forceQuitService) {
        this._forceQuitService.destroy();
        this._forceQuitService = null;
      }

      this._systemActions = null;
      this._mediaKeysSettings = null;
      this._settings = null;

      super.destroy();
    }

    _setIcon() {
      let iconName = '';
      if (this._settings) {
        try {
          iconName = this._settings.get_string('system-menu-icon');
        } catch (_e) { /* ignore */ }
      }

      if (!iconName || !iconName.trim() || iconName === 'emblem-system-symbolic') {
        let iconIndex = 0;
        if (this._settings) {
          try {
            iconIndex = this._settings.get_int('icon');
          } catch (_e) { /* ignore */ }
        }
        const iconInfo = (this._icons && this._icons.length > 0)
          ? (this._icons[iconIndex] ?? this._icons[0])
          : null;

        if (iconInfo && iconInfo.path && this._extensionPath) {
          const iconPath = `${this._extensionPath}${iconInfo.path}`;
          try {
            this._icon.gicon = Gio.icon_new_for_string(iconPath);
            return;
          } catch (_e) { /* fallback */ }
        }
      }

      const effectiveIcon = (iconName && iconName.trim()) ? iconName.trim() : 'emblem-system-symbolic';
      if (effectiveIcon.startsWith('/') || effectiveIcon.startsWith('.')) {
        try {
          this._icon.gicon = Gio.icon_new_for_string(effectiveIcon);
        } catch (_e) {
          this._icon.icon_name = 'emblem-system-symbolic';
        }
      } else {
        this._icon.icon_name = effectiveIcon;
      }
    }

    _gettext(text) {
      return this._extension?.gettext(text) ?? text;
    }

    _renderPopupMenu() {
      this.menu.removeAll();

      const layout = this._generateLayout();
      if (this._isDestroyed) return;

      let customMenuAdded = false;

      layout.forEach((item) => {
        switch (item.type) {
          case 'menu':
            // Check show-force-quit setting
            if (item.cmds?.includes('force-quit') && this._settings && !this._settings.get_boolean('show-force-quit')) {
              break;
            }

            this._makeMenu(item.title, item.cmds, item.icon, item.accel);

            // Add custom menu item right after App Store entry if enabled
            if (!customMenuAdded && item.commandSettingKey === 'app-store-command') {
              if (this._settings) {
                const customItem = createCustomMenuItem(this._settings, this._gettext.bind(this));
                if (customItem) {
                  const bindings = this._settings.get_strv('custom-menu-shortcut');
                  if (bindings.length > 0) {
                    this._attachAccelLabel(customItem, this._shortcutToLabel(bindings[0]));
                  }
                  this.menu.addMenuItem(customItem);
                }
              }
              customMenuAdded = true;
            }
            break;
          case 'recent-items':
            if (!this._settings || this._settings.get_boolean('show-recent-items')) {
              this._makeRecentItemsMenu(item.title, item.icon);
            }
            break;
          case 'separator':
            this._makeSeparator();
            break;
        }
      });
    }

    _generateLayout() {
      const fullName = GLib.get_real_name() || GLib.get_user_name() || '';
      const layoutSource = (this._layout && this._layout.length > 0) ? this._layout : DEFAULT_LAYOUT;
      const items = [];

      for (const item of layoutSource) {
        let translatedTitle = item.title ? this._gettext(item.title) : item.title;
        let cmds = item.cmds ? [...item.cmds] : undefined;

        if (item.type === 'menu' && item.commandSettingKey) {
          cmds = this._resolveCommandFromSettings(item.commandSettingKey, cmds);
        }

        let title = translatedTitle;
        if (item.type === 'menu' && cmds?.includes('logout')) {
          title = fullName
            ? this._gettext('Log Out %s…').replace('%s', fullName)
            : translatedTitle;
        }

        const outputItem = {
          ...item,
          title,
          cmds,
        };

        if (item.type === 'menu' && cmds?.includes('force-quit')) {
          const bindings = this._settings ? this._settings.get_strv('force-quit-shortcut') : [];
          outputItem.accel = bindings.length > 0
            ? this._shortcutToLabel(bindings[0])
            : undefined;
        } else if (item.type === 'menu' && item.accelKey) {
          outputItem.accel = this._resolveSystemAccel(item.accelKey);
        }

        items.push(outputItem);
      }

      return items;
    }

    _makeMenu(title, cmds, iconName, accel) {
      const menuItem = new PopupMenu.PopupMenuItem(title);
      if (iconName) {
        try {
          const icon = new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
          });
          menuItem.insert_child_at_index(icon, 0);
        } catch (_e) { /* ignore */ }
      }

      const singleCmd = Array.isArray(cmds) && cmds.length === 1 ? cmds[0] : null;
      const isForceQuit = singleCmd === 'force-quit';
      const isAboutThisPc = singleCmd === 'about-this-pc';
      const systemAction = SYSTEM_ACTIONS.get(singleCmd);

      menuItem.connect('activate', () => {
        this.menu.close(true);

        if (isForceQuit) {
          this._openForceQuitWindow();
          return;
        }

        if (isAboutThisPc) {
          this._openAboutWindow();
          return;
        }

        if (systemAction) {
          try {
            if (this._systemActions && typeof this._systemActions[systemAction] === 'function') {
              this._systemActions[systemAction]();
            } else {
              const sa = SystemActions.getDefault();
              if (sa && typeof sa[systemAction] === 'function') {
                sa[systemAction]();
              }
            }
          } catch (e) {
            console.error(`FUHGlobe: Failed to trigger system action ${systemAction}: ${e}`);
          }
          return;
        }

        if (Array.isArray(cmds) && cmds.length > 0) {
          try {
            Gio.Subprocess.new(cmds, Gio.SubprocessFlags.NONE);
          } catch (_e) {
            try {
              Util.spawn(cmds);
            } catch (err) {
              console.error(`FUHGlobe: Failed to execute [${cmds.join(' ')}]: ${err}`);
            }
          }
        }
      });

      this._attachAccelLabel(menuItem, accel);
      this.menu.addMenuItem(menuItem);
    }

    _attachAccelLabel(menuItem, accel) {
      if (!accel || !menuItem.label) {
        return;
      }

      menuItem.label.x_expand = true;
      const accelLabel = new St.Label({
        text: this._styleAccel(accel),
        style_class: 'fuhgawz-accel-label',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 140,
      });
      menuItem.add_child(accelLabel);
    }

    _createMediaKeysSettings() {
      try {
        return new Gio.Settings({
          schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
        });
      } catch (error) {
        return null;
      }
    }

    _resolveSystemAccel(mediaKey) {
      if (!this._mediaKeysSettings) {
        return undefined;
      }

      let bindings;
      try {
        bindings = this._mediaKeysSettings.get_strv(mediaKey);
      } catch (error) {
        return undefined;
      }

      const binding = bindings.find((value) => value && value.trim().length > 0);
      return binding ? this._shortcutToLabel(binding) : undefined;
    }

    _shortcutToLabel(accel) {
      return accel
        .replace(/<Super>/g, 'Super+')
        .replace(/<(Primary|Control|Ctrl)>/g, 'Ctrl+')
        .replace(/<Alt>/g, 'Alt+')
        .replace(/<Shift>/g, 'Shift+')
        .replace(/Escape/g, 'Esc')
        .replace(/Delete/g, 'Del')
        .replace(/Return/g, 'Enter');
    }

    _styleAccel(accel) {
      const upper = accel.replace(/\b[a-z]\b/g, (c) => c.toUpperCase());
      if (!this._settings || !this._settings.get_boolean('macos-accelerators')) {
        return upper;
      }
      return upper
        .replace(/Super/g, '⌘')
        .replace(/Shift/g, '⇧')
        .replace(/Ctrl/g, '⌃')
        .replace(/Alt/g, '⌥')
        .replace(/Esc/g, '⎋')
        .replace(/\+/g, ' ');
    }

    _makeRecentItemsMenu(title, iconName) {
      const submenuItem = new RecentItemsSubmenu(title, this.menu, this._recentMenuManager, this._extension, iconName);
      this.menu.addMenuItem(submenuItem);
    }

    _makeSeparator() {
      const separator = new PopupMenu.PopupSeparatorMenuItem();
      this.menu.addMenuItem(separator);
    }

    _openForceQuitWindow() {
      const script = this._extensionPath
        ? GLib.build_filenamev([this._extensionPath, 'app', 'forceQuitWindow.js'])
        : null;

      let launched = false;
      if (script && GLib.file_test(script, GLib.FileTest.EXISTS)) {
        try {
          Util.spawn(['gjs', '-m', script]);
          launched = true;
        } catch (error) {
          console.error(`FUHGlobe: Failed to launch Force Quit helper: ${error}`);
        }
      }

      if (!launched) {
        try {
          Util.spawn(['xkill']);
        } catch (_e) { /* ignore */ }
      }
    }

    _openAboutWindow() {
      const script = this._extensionPath
        ? GLib.build_filenamev([this._extensionPath, 'app', 'aboutWindow.js'])
        : null;

      let launched = false;
      if (script && GLib.file_test(script, GLib.FileTest.EXISTS)) {
        try {
          Util.spawn(['gjs', '-m', script]);
          launched = true;
        } catch (error) {
          console.error(`FUHGlobe: Failed to launch About This PC helper: ${error}`);
        }
      }

      if (!launched) {
        try {
          Gio.Subprocess.new(['gnome-control-center', 'system', 'about'], Gio.SubprocessFlags.NONE);
        } catch (_e1) {
          try {
            Gio.Subprocess.new(['gnome-control-center', 'info-overview'], Gio.SubprocessFlags.NONE);
          } catch (_e2) {
            try {
              Gio.Subprocess.new(['gnome-control-center'], Gio.SubprocessFlags.NONE);
            } catch (e3) {
              console.error(`FUHGlobe: Failed to launch GNOME Settings About panel: ${e3}`);
            }
          }
        }
      }
    }

    _resolveCommandFromSettings(settingKey, fallback = []) {
      if (!this._settings) {
        return fallback;
      }

      let commandString = '';
      try {
        commandString = this._settings.get_string(settingKey);
      } catch (error) {
        return fallback;
      }

      const trimmed = commandString ? commandString.trim() : '';
      if (trimmed.length === 0) {
        return fallback;
      }

      try {
        const [success, argv] = GLib.shell_parse_argv(trimmed);
        if (success && Array.isArray(argv) && argv.length > 0) {
          return argv;
        }
      } catch (error) {
        console.log(`FUHGlobe: Could not parse argv for setting ${settingKey}: ${trimmed}`);
      }

      return fallback;
    }
  }
);

