import AccountsService from 'gi://AccountsService';
import Clutter from 'gi://Clutter';
import Gdm from 'gi://Gdm';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const DEFAULT_BUTTON_ICON = 'system-users-symbolic';
const MINIMUM_VISIBLE_UID = 1000;

export class UserSwitcherController {
    constructor(extension) {
        this._extension = extension;
        this._userSwitcher = null;
        this._userManager = null;
        this._userManagerSignals = [];
        this._initUserManager();
    }

    destroy() {
        this._disconnectUserManagerSignals();
        if (this._userSwitcher) {
            this._userSwitcher.destroy();
            this._userSwitcher = null;
        }
        this._userManager = null;
        this._extension = null;
    }

    _initUserManager() {
        try {
            this._userManager = AccountsService.UserManager.get_default();
            if (!this._userManager) return;

            this._userManagerSignals = [
                this._userManager.connect('notify::is-loaded', () => this._updateVisibility()),
                this._userManager.connect('user-added', () => this._updateVisibility()),
                this._userManager.connect('user-removed', () => this._updateVisibility()),
            ];

            if (this._userManager.is_loaded) {
                this._updateVisibility();
            } else {
                this._userManager.list_users();
            }
        } catch (e) {
            console.error(`FUHGlobe: Could not initialize AccountsService: ${e}`);
        }
    }

    _disconnectUserManagerSignals() {
        if (!this._userManager || !this._userManagerSignals) return;
        this._userManagerSignals.filter(id => id > 0).forEach(id => {
            try { this._userManager.disconnect(id); } catch (e) {}
        });
        this._userManagerSignals = [];
    }

    _updateVisibility() {
        let count = 0;
        if (this._userManager && this._userManager.is_loaded) {
            const list = this._userManager.list_users() || [];
            count = list.filter(u => u && u.is_loaded && u.get_uid() >= MINIMUM_VISIBLE_UID && !u.system_account).length;
        }

        if (count > 1 && !this._userSwitcher) {
            this._userSwitcher = new UserSwitcherButton();
            Main.panel.addToStatusArea('FUHGlobeUserSwitcher', this._userSwitcher, 1, 'right');
        } else if (count <= 1 && this._userSwitcher) {
            this._userSwitcher.destroy();
            this._userSwitcher = null;
        }
    }
}

export const UserSwitcherButton = GObject.registerClass(
class UserSwitcherButton extends PanelMenu.Button {
    _init() {
        super._init(1.0, 'FUHGlobeUserSwitcher');
        this.accessible_name = _('User Switcher');
        this.add_style_class_name('fuhgawz-panel-button');

        this._icon = new St.Icon({
            icon_name: DEFAULT_BUTTON_ICON,
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._icon);

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._rebuildMenu();
            }
        });
    }

    _rebuildMenu() {
        this.menu.removeAll();

        let userManager = null;
        try { userManager = AccountsService.UserManager.get_default(); } catch (e) {}

        const currentUserName = GLib.get_user_name();
        let users = [];
        if (userManager && userManager.is_loaded) {
            users = (userManager.list_users() || []).filter(u => u && u.is_loaded && u.get_uid() >= MINIMUM_VISIBLE_UID && !u.system_account);
        }

        if (users.length === 0) {
            const placeholder = new PopupMenu.PopupMenuItem(_('User Accounts'));
            placeholder.setSensitive(false);
            this.menu.addMenuItem(placeholder);
        } else {
            for (const user of users) {
                const username = user.get_user_name() || '';
                const realName = user.get_real_name() || username;
                const isCurrent = username === currentUserName;

                const item = new PopupMenu.PopupMenuItem(isCurrent ? `${realName} (${_('Current')})` : realName);
                const userIcon = new St.Icon({
                    icon_name: isCurrent ? 'user-info-symbolic' : 'system-users-symbolic',
                    style_class: 'popup-menu-icon',
                });
                item.insert_child_at_index(userIcon, 0);

                if (!isCurrent) {
                    item.connect('activate', () => {
                        try {
                            this._switchUser();
                        } catch (e) {
                            console.error(`FUHGlobe: Failed to switch user: ${e}`);
                        }
                    });
                } else {
                    item.setSensitive(false);
                }

                this.menu.addMenuItem(item);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const loginWindowItem = new PopupMenu.PopupMenuItem(_('Login Screen…'));
        const loginIcon = new St.Icon({
            icon_name: 'system-log-out-symbolic',
            style_class: 'popup-menu-icon',
        });
        loginWindowItem.insert_child_at_index(loginIcon, 0);
        loginWindowItem.connect('activate', () => this._switchUser());
        this.menu.addMenuItem(loginWindowItem);

        const settingsItem = new PopupMenu.PopupMenuItem(_('Users Settings…'));
        const settingsIcon = new St.Icon({
            icon_name: 'preferences-system-symbolic',
            style_class: 'popup-menu-icon',
        });
        settingsItem.insert_child_at_index(settingsIcon, 0);
        settingsItem.connect('activate', () => {
            try {
                Gio.Subprocess.new(
                    ['gnome-control-center', 'user-accounts'],
                    Gio.SubprocessFlags.NONE
                );
            } catch (e) {
                try {
                    Gio.Subprocess.new(
                        ['gnome-control-center', 'system', 'users'],
                        Gio.SubprocessFlags.NONE
                    );
                } catch (err) {
                    console.error(`FUHGlobe: Failed to open user settings: ${err}`);
                }
            }
        });
        this.menu.addMenuItem(settingsItem);
    }

    _switchUser() {
        if (Main.screenShield) {
            Main.screenShield.lock(false);
        }
        Clutter.threads_add_repaint_func(Clutter.RepaintFlags.POST_PAINT, () => {
            try {
                Gdm.goto_login_session_sync(null);
            } catch (error) {
                console.error(`FUHGlobe: Failed Gdm goto_login_session: ${error}`);
            }
            return false;
        });
    }
});
