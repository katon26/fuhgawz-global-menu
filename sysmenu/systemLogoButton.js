import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { RecentItemsSubmenu } from './recentItems.js';
import { createForceQuitMenuItem } from './forceQuit.js';

function _addIconToMenuItem(item, iconName) {
    try {
        const icon = new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.insert_child_at_index(icon, 0);
    } catch (e) {
        console.error(`FUHGlobe: Could not set icon ${iconName}: ${e}`);
    }
}

export const SystemLogoButton = GObject.registerClass(
class SystemLogoButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'FUHGlobeSystemLogoButton');
        this.add_style_class_name('fuhgawz-panel-button');
        this.accessible_name = _('System Menu');

        this._settings = settings;
        this._systemActions = SystemActions.getDefault();

        const iconName = this._settings ? this._settings.get_string('system-menu-icon') : 'emblem-system-symbolic';

        this._icon = new St.Icon({
            icon_name: iconName && iconName.trim() ? iconName : 'emblem-system-symbolic',
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        if (this._settings) {
            this._settingsSignalId = this._settings.connect('changed::system-menu-icon', () => {
                const updatedIcon = this._settings.get_string('system-menu-icon');
                this._icon.icon_name = updatedIcon && updatedIcon.trim() ? updatedIcon : 'emblem-system-symbolic';
            });
        }

        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();

        // 1. About This PC…
        const itemAboutPC = new PopupMenu.PopupMenuItem(_('About This PC…'));
        _addIconToMenuItem(itemAboutPC, 'dialog-information-symbolic');
        itemAboutPC.connect('activate', () => {
            try {
                Gio.Subprocess.new(
                    ['gnome-control-center', 'info-overview'],
                    Gio.SubprocessFlags.NONE
                );
            } catch (e) {
                console.error(`FUHGlobe: Failed to launch Settings info overview: ${e}`);
            }
        });
        this.menu.addMenuItem(itemAboutPC);

        // 2. System Settings…
        const itemSettings = new PopupMenu.PopupMenuItem(_('System Settings…'));
        _addIconToMenuItem(itemSettings, 'preferences-system-symbolic');
        itemSettings.connect('activate', () => {
            try {
                Gio.Subprocess.new(
                    ['gnome-control-center'],
                    Gio.SubprocessFlags.NONE
                );
            } catch (e) {
                console.error(`FUHGlobe: Failed to launch Settings: ${e}`);
            }
        });
        this.menu.addMenuItem(itemSettings);

        // 3. App Store…
        const itemAppStore = new PopupMenu.PopupMenuItem(_('App Store…'));
        _addIconToMenuItem(itemAppStore, 'system-software-install-symbolic');
        itemAppStore.connect('activate', () => {
            try {
                const storeCmd = (this._settings ? this._settings.get_string('app-store-command') : '') || 'gnome-software';
                Gio.Subprocess.new(
                    [storeCmd],
                    Gio.SubprocessFlags.NONE
                );
            } catch (e) {
                console.error(`FUHGlobe: Failed to launch App Store: ${e}`);
            }
        });
        this.menu.addMenuItem(itemAppStore);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Recent Items >
        if (!this._settings || this._settings.get_boolean('show-recent-items')) {
            const recentSubmenu = new RecentItemsSubmenu(_('Recent Items'));
            this.menu.addMenuItem(recentSubmenu);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // 5. Force Quit Applications…
        if (!this._settings || this._settings.get_boolean('show-force-quit')) {
            const itemForceQuit = createForceQuitMenuItem();
            this.menu.addMenuItem(itemForceQuit);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // 6. Session Actions
        const itemLock = new PopupMenu.PopupMenuItem(_('Lock Screen'));
        _addIconToMenuItem(itemLock, 'changes-prevent-symbolic');
        itemLock.connect('activate', () => {
            try { this._systemActions.activateLockScreen(); } catch (e) { /* error */ }
        });
        this.menu.addMenuItem(itemLock);

        const itemSuspend = new PopupMenu.PopupMenuItem(_('Suspend'));
        _addIconToMenuItem(itemSuspend, 'media-playback-pause-symbolic');
        itemSuspend.connect('activate', () => {
            try { this._systemActions.activateSuspend(); } catch (e) { /* error */ }
        });
        this.menu.addMenuItem(itemSuspend);

        const itemRestart = new PopupMenu.PopupMenuItem(_('Restart…'));
        _addIconToMenuItem(itemRestart, 'system-reboot-symbolic');
        itemRestart.connect('activate', () => {
            try { this._systemActions.activateRestart(); } catch (e) { /* error */ }
        });
        this.menu.addMenuItem(itemRestart);

        const itemPowerOff = new PopupMenu.PopupMenuItem(_('Shut Down…'));
        _addIconToMenuItem(itemPowerOff, 'system-shutdown-symbolic');
        itemPowerOff.connect('activate', () => {
            try { this._systemActions.activatePowerOff(); } catch (e) { /* error */ }
        });
        this.menu.addMenuItem(itemPowerOff);

        const itemLogOut = new PopupMenu.PopupMenuItem(_('Log Out…'));
        _addIconToMenuItem(itemLogOut, 'system-log-out-symbolic');
        itemLogOut.connect('activate', () => {
            try { this._systemActions.activateLogout(); } catch (e) { /* error */ }
        });
        this.menu.addMenuItem(itemLogOut);
    }

    destroy() {
        if (this._settings && this._settingsSignalId) {
            this._settings.disconnect(this._settingsSignalId);
            this._settingsSignalId = 0;
        }
        super.destroy();
    }
});
