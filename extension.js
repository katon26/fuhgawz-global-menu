import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { SystemMenu } from './src/systemMenu.js';
import { UserSwitcherController } from './src/userSwitcher.js';
import { QuickSettingsActionsController } from './src/quickSettingsHider.js';
import { VirtualKeyboardDispatcher } from './src/virtualKeyboard.js';
import { ProfileManager, expandDynamicProfileItems, getBookmarksCacheMtime, loadBrowserBookmarksAsync } from './src/profileManager.js';
import { AtspiScanner } from './src/atspiScanner.js';
import { HoverSubMenuMenuItem } from './src/hoverSubMenu.js';

// ── D-Bus Interface XML ──────────────────────────────────────────────────────

const DBusInterfaceXml = `
<node>
  <interface name="org.freedesktop.DBus">
    <method name="GetConnectionUnixProcessID">
      <arg name="connection_name" type="s" direction="in"/>
      <arg name="pid" type="u" direction="out"/>
    </method>
  </interface>
</node>`;

const RegistrarInterfaceXml = `
<node>
  <interface name="com.canonical.AppMenu.Registrar">
    <method name="RegisterWindow">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="o" direction="in" name="menuObjectPath"/>
    </method>
    <method name="UnregisterWindow">
      <arg type="u" direction="in" name="windowId"/>
    </method>
    <method name="GetMenuForWindow">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="s" direction="out" name="service"/>
      <arg type="o" direction="out" name="menuObjectPath"/>
    </method>
  </interface>
</node>`;

const DBusMenuInterfaceXml = `
<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="Status" type="s" access="read"/>
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
    <signal name="LayoutUpdated">
      <arg name="revision" type="u"/>
      <arg name="parentId" type="i"/>
    </signal>
  </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusInterfaceXml);
const DBusMenuProxy = Gio.DBusProxy.makeProxyWrapper(DBusMenuInterfaceXml);

// ── Action → Human Label mapping ─────────────────────────────────────────────
//
// Maps known GAction names to human-readable labels. This is how Singularity OS
// handles libadwaita apps that export actions but no menubar: it calls DescribeAll
// and arranges the known actions into logical menu groups.

const ACTION_LABELS = {
    // File-category actions
    'new-window':         'New Window',
    'new-tab':            'New Tab',
    'new':                'New',
    'open':               'Open…',
    'open-file':          'Open File…',
    'open-folder':        'Open Folder…',
    'save':               'Save',
    'save-as':            'Save As…',
    'save-all':           'Save All',
    'print':              'Print…',
    'close':              'Close',
    'close-tab':          'Close Tab',
    'close-window':       'Close Window',
    'close-other-pages':  'Close Other Pages',
    'close-current-page': 'Close Current Page',
    'quit':               'Quit',
    'revert':             'Revert',
    'discard-changes':    'Discard Changes',

    // Edit-category actions
    'undo':               'Undo',
    'redo':               'Redo',
    'cut':                'Cut',
    'copy':               'Copy',
    'paste':              'Paste',
    'select-all':         'Select All',
    'find':               'Find…',
    'find-replace':       'Find and Replace…',
    'preferences':        'Preferences',
    'prefs':              'Preferences',
    'edit-profile':       'Edit Profile…',
    'clear-history':      'Clear Recent Files',
    'show-preferences':   'Preferences',

    // View-category actions
    'fullscreen':         'Fullscreen',
    'zoom-in':            'Zoom In',
    'zoom-out':           'Zoom Out',
    'zoom-default':       'Reset Zoom',
    'zoom-normal':        'Reset Zoom',
    'show-sidebar':       'Show Sidebar',
    'toggle-sidebar':     'Toggle Sidebar',
    'show-overview':      'Show Overview',
    'show-open-tabs':     'Show Open Tabs',
    'interface-style':    'Appearance',
    'tab.read-only':      'Read-Only Mode',
    'toggle-controls':    'Toggle Controls',
    'show-line-numbers':  'Show Line Numbers',
    'show-right-margin':  'Show Right Margin',
    'highlight-syntax':   'Highlight Syntax',
    'word-wrap':          'Word Wrap',

    // Navigate-category actions
    'go-back':            'Back',
    'go-forward':         'Forward',
    'go-home':            'Home',
    'go-up':              'Up',
    'reload':             'Reload',
    'refresh':            'Refresh',

    // Help-category actions
    'about':              'About',
    'help':               'Help',
    'shortcuts':          'Keyboard Shortcuts',
    'keyboard-shortcuts': 'Keyboard Shortcuts',

    // Software Center
    'sources':            'Software Sources',
    'autoupdate':         'Auto-Update',
    'check-for-updates':  'Check for Updates',
    'update':             'Update',
    'install':            'Install',
    'uninstall':          'Uninstall',

    // Media actions (Celluloid, etc.)
    'save-playlist':      'Save Playlist',
    'toggle-fullscreen':  'Toggle Fullscreen',

    // Internal / dangerous actions to HIDE (set to null)
    'focus-tab-by-uuid':  null,
    'make-default':       null,  // disabled on most systems, not useful
    'nop':                null,  // no-op internal action
    'verbose':            null,  // debug action
    'restart':            null,  // internal gnome-software restart
    'shutdown':           null,  // dangerous — no confirmation dialog
    'reboot':             null,  // dangerous — no confirmation dialog
    'reboot-and-install': null,  // dangerous — no confirmation dialog
    'show-offline-update-error': null,  // internal
};

// Groups define which menu a given action belongs to.
const ACTION_GROUPS = [
    {
        label: 'File',
        actions: [
            'new', 'new-window', 'new-tab', 'open', 'open-file', 'open-folder',
            'save', 'save-as', 'save-all', 'print',
            'close', 'close-tab', 'close-window', 'close-other-pages', 'close-current-page',
            'quit', 'revert', 'discard-changes',
        ],
    },
    {
        label: 'Edit',
        actions: [
            'undo', 'redo', 'cut', 'copy', 'paste', 'select-all',
            'find', 'find-replace', 'preferences', 'prefs', 'edit-profile',
            'clear-history', 'show-preferences',
        ],
    },
    {
        label: 'View',
        actions: [
            'fullscreen', 'zoom-in', 'zoom-out', 'zoom-default', 'zoom-normal',
            'show-sidebar', 'toggle-sidebar', 'show-overview', 'show-open-tabs',
            'interface-style', 'tab.read-only', 'toggle-controls',
            'show-line-numbers', 'show-right-margin', 'highlight-syntax', 'word-wrap',
        ],
    },
    {
        label: 'Go',
        actions: [
            'go-back', 'go-forward', 'go-home', 'go-up', 'reload', 'refresh',
        ],
    },
    {
        label: 'Media',
        actions: [
            'save-playlist', 'toggle-fullscreen',
        ],
    },
    {
        label: 'Tools',
        actions: [
            'sources', 'autoupdate', 'check-for-updates', 'update',
            'install', 'uninstall',
        ],
    },
    {
        label: 'Help',
        actions: [
            'about', 'help', 'shortcuts', 'keyboard-shortcuts',
        ],
    },
];

// ── D-Bus Menu Registrar Service ─────────────────────────────────────────────
//
// Owns com.canonical.AppMenu.Registrar on the session bus.
// GTK3 apps (via appmenu-gtk-module) and Electron apps call RegisterWindow()
// to hand us their menu object path.

class DBusMenuRegistrar {
    constructor(onUpdate) {
        this._onUpdate = onUpdate;
        this._registry = new Map();
        this._pidRegistry = new Map();

        this._dbusProxy = new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus'
        );

        this._dbusObjId = 0;
        this._ownNameId = 0;
        this._initDBus();
    }

    _initDBus() {
        const nodeInfo = Gio.DBusNodeInfo.new_for_xml(RegistrarInterfaceXml);

        this._dbusObjId = Gio.DBus.session.register_object(
            '/com/canonical/AppMenu/Registrar',
            nodeInfo.interfaces[0],
            this._handleMethodCall.bind(this),
            null,
            null
        );
        console.log('FUHGlobe: Registered D-Bus object /com/canonical/AppMenu/Registrar');

        this._ownNameId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            'com.canonical.AppMenu.Registrar',
            Gio.BusNameOwnerFlags.NONE,
            null,
            (_conn, name) => {
                console.log(`FUHGlobe: Successfully acquired bus name ${name}`);
            },
            (_conn, name) => {
                console.error(`FUHGlobe: Failed to acquire bus name ${name}`);
            }
        );
    }

    _handleMethodCall(connection, sender, objectPath, interfaceName, methodName, parameters, invocation) {
        const args = parameters.deepUnpack();

        if (methodName === 'RegisterWindow') {
            const [windowId, menuObjectPath] = args;
            console.log(`FUHGlobe: RegisterWindow windowId=${windowId} path=${menuObjectPath} sender=${sender}`);

            this._dbusProxy.GetConnectionUnixProcessIDRemote(sender, (res, err) => {
                let pid = 0;
                if (!err && res) {
                    pid = res[0];
                }
                console.log(`FUHGlobe: RegisterWindow resolved PID=${pid} for sender=${sender}`);

                const entry = { service: sender, path: menuObjectPath, pid, windowId };
                this._registry.set(windowId, entry);
                if (pid > 0) {
                    this._pidRegistry.set(pid, entry);
                }

                this._onUpdate();
            });

            invocation.return_value(null);

        } else if (methodName === 'UnregisterWindow') {
            const [windowId] = args;
            console.log(`FUHGlobe: UnregisterWindow windowId=${windowId}`);

            const entry = this._registry.get(windowId);
            if (entry) {
                if (entry.pid > 0) {
                    this._pidRegistry.delete(entry.pid);
                }
                this._registry.delete(windowId);
            }
            this._onUpdate();
            invocation.return_value(null);

        } else if (methodName === 'GetMenuForWindow') {
            const [windowId] = args;
            const entry = this._registry.get(windowId);
            if (entry) {
                invocation.return_value(
                    GLib.Variant.new('(so)', [entry.service, entry.path])
                );
            } else {
                invocation.return_dbus_error(
                    'org.freedesktop.DBus.Error.Failed',
                    'Window not registered'
                );
            }
        }
    }

    getEntryByWindowId(windowId) {
        return this._registry.get(windowId) || null;
    }

    getEntryByPid(pid) {
        return this._pidRegistry.get(pid) || null;
    }

    destroy() {
        if (this._ownNameId) {
            Gio.bus_unown_name(this._ownNameId);
            this._ownNameId = 0;
        }
        if (this._dbusObjId) {
            Gio.DBus.session.unregister_object(this._dbusObjId);
            this._dbusObjId = 0;
        }
        this._registry.clear();
        this._pidRegistry.clear();
        console.log('FUHGlobe: Registrar destroyed');
    }
}

// ── Utility: clean mnemonic underscores from menu labels ─────────────────────

function _cleanLabel(raw) {
    if (!raw) return '';
    return raw.replace(/_([a-zA-Z0-9])/g, '$1');
}

// ── Application Menu Button (position 0, left box) ──────────────────────────
//
// Shows app icon + bold name. Dropdown: About / Hide / Maximize|Restore / Quit.

const AppMenuButton = GObject.registerClass(
class AppMenuButton extends PanelMenu.Button {
    _init(metaWindow, profile = null, dispatcher = null) {
        super._init(0.0, 'FUHGlobeAppMenuButton');
        this.add_style_class_name('fuhgawz-panel-button');

        this._window = metaWindow;
        this._profile = profile;
        this._dispatcher = dispatcher;

        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box fuhgawz-menu-box',
        });

        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.focus_app;

        if (app) {
            try {
                const icon = app.create_icon_texture(16);
                if (icon) box.add_child(icon);
            } catch (e) {
                console.log(`FUHGlobe: Could not create app icon: ${e}`);
            }
        }

        let appLabel = _('Desktop');
        const wmClass = metaWindow && metaWindow.get_wm_class ? (metaWindow.get_wm_class() || '') : '';
        const wmInstance = metaWindow && metaWindow.get_wm_class_instance ? (metaWindow.get_wm_class_instance() || '') : '';
        if (wmClass.toLowerCase().includes('antigravity') || wmInstance.toLowerCase().includes('antigravity')) {
            appLabel = 'Antigravity';
        } else if (profile && profile.app_menu && profile.app_menu.label) {
            appLabel = profile.app_menu.label;
        } else if (app) {
            appLabel = app.get_name() || _('Application');
        } else if (metaWindow) {
            appLabel = metaWindow.get_title() || _('Window');
        }

        this.accessible_name = appLabel || _('Application Menu');

        this._label = new St.Label({
            text: appLabel,
            style_class: 'fuhgawz-app-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        this.add_child(box);

        this._buildMenu(appLabel);
    }

    _triggerAboutAction(appLabel) {
        _triggerAboutAction(this._window, this._dispatcher, appLabel);
    }

    _buildMenu(appLabel) {
        if (!this._window) {
            const itemAbout = new PopupMenu.PopupMenuItem(_('About GNOME…'));
            itemAbout.connect('activate', () => {
                this.menu.close(BoxPointer.PopupAnimation.NONE);
                try {
                    Gio.Subprocess.new(
                        ['gnome-control-center', 'info-overview'],
                        Gio.SubprocessFlags.NONE
                    );
                } catch (e) {
                    console.error(`FUHGlobe: Failed to launch gnome-control-center: ${e}`);
                }
            });
            this.menu.addMenuItem(itemAbout);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const itemSettings = new PopupMenu.PopupMenuItem(_('Preferences…'));
            itemSettings.connect('activate', () => {
                this.menu.close(BoxPointer.PopupAnimation.NONE);
                try {
                    Gio.Subprocess.new(
                        ['gnome-control-center'],
                        Gio.SubprocessFlags.NONE
                    );
                } catch (e) {
                    console.error(`FUHGlobe: Failed to launch settings: ${e}`);
                }
            });
            this.menu.addMenuItem(itemSettings);
            return;
        }

        // Check if profile defines an app_menu
        if (this._profile && this._profile.app_menu && Array.isArray(this._profile.app_menu.items)) {
            for (const item of this._profile.app_menu.items) {
                if (item.type === 'separator') {
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    continue;
                }

                let label = item.label || '';
                if (appLabel && appLabel !== 'Code' && appLabel !== 'Visual Studio Code') {
                    label = label
                        .replace(/Visual Studio Code/g, appLabel)
                        .replace(/\bCode\b/g, appLabel);
                }
                label = label.replace(/\{\{appName\}\}/g, appLabel);

                const menuItem = new PopupMenu.PopupMenuItem(label);

                if (item.shortcut) {
                    const shortcutLabel = new St.Label({
                        text: item.shortcut,
                        style_class: 'popup-inactive-menu-item',
                        x_align: Clutter.ActorAlign.END,
                        x_expand: true,
                    });
                    menuItem.add_child(shortcutLabel);
                }

                if (item.action === 'hide' || (item.label && item.label.toLowerCase().startsWith('hide'))) {
                    menuItem.connect('activate', () => {
                        this.menu.close(BoxPointer.PopupAnimation.NONE);
                        try {
                            if (this._window && typeof this._window.minimize === 'function') {
                                this._window.minimize();
                            }
                        } catch (e) {
                            console.warn(`FUHGlobe: Failed to minimize window: ${e}`);
                        }
                    });
                } else if (item.action === 'about' || (item.label && item.label.toLowerCase().startsWith('about'))) {
                    menuItem.connect('activate', () => {
                        this.menu.close(BoxPointer.PopupAnimation.NONE);
                        this._triggerAboutAction(appLabel);
                    });
                } else if (item.action === 'settings' || item.action === 'preferences' || (item.label && /^(settings|preferences)/i.test(item.label))) {
                    menuItem.connect('activate', () => {
                        this.menu.close(BoxPointer.PopupAnimation.NONE);
                        _triggerSettingsAction(this._window, this._dispatcher, appLabel);
                    });
                } else if (item.shortcut) {
                    menuItem.connect('activate', () => {
                        this.menu.close(BoxPointer.PopupAnimation.NONE);
                        if (this._dispatcher && this._window) {
                            this._dispatcher.dispatchAccelerator(this._window, item.shortcut);
                        }
                    });
                } else {
                    menuItem.connect('activate', () => {
                        this.menu.close(BoxPointer.PopupAnimation.NONE);
                        console.log(`FUHGlobe: App menu item activated: ${item.label}`);
                    });
                }

                this.menu.addMenuItem(menuItem);
            }
            return;
        }

        // Per-app dropdown
        const itemAbout = new PopupMenu.PopupMenuItem(_('About %s…').replace('%s', appLabel));
        itemAbout.connect('activate', () => {
            this.menu.close(BoxPointer.PopupAnimation.NONE);
            this._triggerAboutAction(appLabel);
        });
        this.menu.addMenuItem(itemAbout);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const itemHide = new PopupMenu.PopupMenuItem(_('Hide %s').replace('%s', appLabel));
        itemHide.connect('activate', () => {
            this.menu.close(BoxPointer.PopupAnimation.NONE);
            try { this._window.minimize(); } catch (e) { /* destroyed */ }
        });
        this.menu.addMenuItem(itemHide);

        let isMaximized = false;
        try {
            isMaximized = (typeof this._window.is_maximized === 'function')
                ? this._window.is_maximized()
                : this._window.get_maximized() === Meta.MaximizeFlags.BOTH;
        } catch (e) { /* ignore */ }

        const itemMaximize = new PopupMenu.PopupMenuItem(
            isMaximized ? _('Restore window') : _('Maximize window')
        );
        itemMaximize.connect('activate', () => {
            this.menu.close(BoxPointer.PopupAnimation.NONE);
            try {
                if (isMaximized) {
                    if (typeof this._window.is_maximized === 'function')
                        this._window.unmaximize();
                    else
                        this._window.unmaximize(Meta.MaximizeFlags.BOTH);
                } else {
                    if (typeof this._window.is_maximized === 'function')
                        this._window.maximize();
                    else
                        this._window.maximize(Meta.MaximizeFlags.BOTH);
                }
            } catch (e) { /* destroyed */ }
        });
        this.menu.addMenuItem(itemMaximize);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const itemQuit = new PopupMenu.PopupMenuItem(_('Quit %s').replace('%s', appLabel));
        itemQuit.connect('activate', () => {
            this.menu.close(BoxPointer.PopupAnimation.NONE);
            try { this._window.delete(global.get_current_time()); } catch (e) { /* destroyed */ }
        });
        this.menu.addMenuItem(itemQuit);
    }
});

function _navigateBrowserUrl(win, dispatcher, url, openNewTab = true) {
    if (!win || !url) return;

    try {
        if (typeof win.activate === 'function') {
            const time = (typeof global !== 'undefined' && global.get_current_time)
                ? global.get_current_time()
                : 0;
            win.activate(time);
        }
    } catch (e) {}

    if (!dispatcher || typeof dispatcher.dispatchAccelerator !== 'function') {
        const tracker = Shell ? Shell.WindowTracker.get_default() : null;
        const app = tracker ? tracker.get_window_app(win) : null;
        const appInfo = app ? app.get_app_info() : null;
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris([url], null);
                return;
            } catch (e) {}
        }
        return;
    }

    try {
        const clipboard = St.Clipboard.get_default();
        clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, originalText) => {
            clipboard.set_text(St.ClipboardType.CLIPBOARD, url);

            const timeoutIds = [];
            let unmanagedId = 0;
            let focusId = 0;
            let clipboardRestored = false;

            const cleanup = () => {
                for (const id of timeoutIds) {
                    GLib.source_remove(id);
                }
                timeoutIds.length = 0;

                if (unmanagedId !== 0 && win) {
                    try { win.disconnect(unmanagedId); } catch (e) {}
                    unmanagedId = 0;
                }
                if (focusId !== 0 && typeof global !== 'undefined' && global.display) {
                    try { global.display.disconnect(focusId); } catch (e) {}
                    focusId = 0;
                }
                if (!clipboardRestored && originalText !== null && originalText !== undefined) {
                    clipboardRestored = true;
                    try { clipboard.set_text(St.ClipboardType.CLIPBOARD, originalText); } catch (e) {}
                }
            };

            if (win && typeof win.connect === 'function') {
                unmanagedId = win.connect('unmanaged', () => cleanup());
            }
            if (typeof global !== 'undefined' && global.display) {
                focusId = global.display.connect('notify::focus-window', () => {
                    const currentFocus = typeof global.display.get_focus_window === 'function'
                        ? global.display.get_focus_window()
                        : global.display.focus_window;
                    if (currentFocus !== win) {
                        cleanup();
                    }
                });
            }

            const scheduleStep = (delay, callback) => {
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    const idx = timeoutIds.indexOf(id);
                    if (idx !== -1) timeoutIds.splice(idx, 1);
                    callback();
                    return GLib.SOURCE_REMOVE;
                });
                timeoutIds.push(id);
                return id;
            };

            // 1. Open new tab (Ctrl+T) or focus URL bar (Ctrl+L) after menu drops grab
            scheduleStep(80, () => {
                const navKey = openNewTab ? 'Ctrl+T' : 'Ctrl+L';
                dispatcher.dispatchAccelerator(win, navKey, 0);

                // 2. Paste the URL into the focused address bar
                scheduleStep(120, () => {
                    dispatcher.dispatchAccelerator(win, 'Ctrl+V', 0);

                    // 3. Press Return to navigate
                    scheduleStep(80, () => {
                        dispatcher.dispatchAccelerator(win, 'Return', 0);

                        // 4. Restore original clipboard content
                        scheduleStep(300, () => {
                            if (!clipboardRestored && originalText !== null && originalText !== undefined) {
                                clipboardRestored = true;
                                try { clipboard.set_text(St.ClipboardType.CLIPBOARD, originalText); } catch (e) {}
                            }
                            cleanup();
                        });
                    });
                });
            });
        });
    } catch (e) {
        console.warn(`FUHGlobe: Failed to navigate browser URL via clipboard: ${e}`);
    }
}

function _fallbackAboutAction(win, dispatcher, appLabel) {
    if (!win) return;

    const wmClass = (win.get_wm_class ? win.get_wm_class() : '') || '';
    const wmInstance = (win.get_wm_class_instance ? win.get_wm_class_instance() : '') || '';
    const wmClassLower = wmClass.toLowerCase();
    const wmInstanceLower = wmInstance.toLowerCase();

    const tracker = Shell.WindowTracker.get_default();
    const app = tracker ? tracker.get_window_app(win) : null;
    const appInfo = app ? app.get_app_info() : null;

    // 1. Brave Browser: open brave://settings/help in active window without new window
    if (wmClassLower.includes('brave') || wmInstanceLower.includes('brave')) {
        if (dispatcher) {
            _navigateBrowserUrl(win, dispatcher, 'brave://settings/help', true);
            return;
        }
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris(['brave://settings/help'], null);
                return;
            } catch (e) {}
        }
        for (const cmd of ['brave-browser', 'brave-browser-stable', 'brave']) {
            try {
                Gio.Subprocess.new([cmd, 'brave://settings/help'], Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {}
        }
    }

    // 2. Google Chrome / Chromium: open chrome://settings/help in active window
    if (wmClassLower.includes('chrome') || wmInstanceLower.includes('chrome') ||
        wmClassLower.includes('chromium') || wmInstanceLower.includes('chromium')) {
        if (dispatcher) {
            _navigateBrowserUrl(win, dispatcher, 'chrome://settings/help', true);
            return;
        }
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris(['chrome://settings/help'], null);
                return;
            } catch (e) {}
        }
        for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
            try {
                Gio.Subprocess.new([cmd, 'chrome://settings/help'], Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {}
        }
    }

    // 3. Other apps: show native About dialog with app metadata
    let cleanLabel = (appLabel || '').replace(/^about\s+/i, '').replace(/…|\.\.\.$/, '').trim();
    if (!cleanLabel && appInfo && typeof appInfo.get_name === 'function') {
        cleanLabel = appInfo.get_name();
    }
    if (!cleanLabel && wmClass) {
        cleanLabel = wmClass;
    }
    const infoTitle = cleanLabel ? _('About %s').replace('%s', cleanLabel) : _('About Application');
    let infoText = '';
    let desktopInfo = null;

    if (appInfo) {
        const name = appInfo.get_name() || cleanLabel || 'Application';
        const desc = appInfo.get_description() || appInfo.get_display_name() || '';
        const exec = appInfo.get_executable() || '';
        infoText = desc ? `${name}\n${desc}` : (exec ? `${name} (${exec})` : name);
    } else {
        const appId = (win.get_gtk_application_id ? win.get_gtk_application_id() : win.gtk_application_id) || '';
        if (appId) {
            try {
                desktopInfo = GioUnix.DesktopAppInfo.new(appId.endsWith('.desktop') ? appId : `${appId}.desktop`);
            } catch (e) {}
        }
        if (desktopInfo) {
            const name = desktopInfo.get_name() || cleanLabel || 'Application';
            const desc = desktopInfo.get_description() || '';
            infoText = desc ? `${name}\n${desc}` : name;
        } else {
            infoText = cleanLabel || wmClass || 'Application';
        }
    }

    try {
        const dialog = new ModalDialog.ModalDialog();
        const content = dialog.contentLayout;
        content.style_class = 'about-dialog-content';
        content.set_style('padding: 24px; spacing: 14px; min-width: 300px;');

        let iconActor = null;
        if (app && typeof app.create_icon_texture === 'function') {
            try {
                iconActor = app.create_icon_texture(64);
            } catch (e) {}
        }
        if (!iconActor) {
            const infoObj = appInfo || desktopInfo;
            const gicon = infoObj && typeof infoObj.get_icon === 'function' ? infoObj.get_icon() : null;
            if (gicon) {
                iconActor = new St.Icon({ gicon, icon_size: 64 });
            }
        }
        if (iconActor) {
            iconActor.x_align = Clutter.ActorAlign.CENTER;
            iconActor.y_align = Clutter.ActorAlign.CENTER;
            content.add_child(iconActor);
        }

        const titleLabel = new St.Label({
            text: cleanLabel || (appInfo ? appInfo.get_name() : null) || wmClass || _('Application'),
            style: 'font-weight: bold; font-size: 14pt;',
            x_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(titleLabel);

        const descText = (appInfo && (appInfo.get_description() || appInfo.get_display_name())) ||
                         (desktopInfo && desktopInfo.get_description()) ||
                         '';
        if (descText && descText !== titleLabel.text) {
            const descLabel = new St.Label({
                text: descText,
                style: 'font-size: 10pt; color: #888; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            content.add_child(descLabel);
        }

        dialog.addButton({
            label: _('OK'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
            isDefault: true,
        });
        dialog.open();
        return;
    } catch (e) {
        console.warn(`FUHGlobe: Could not show modal About dialog: ${e}`);
        if (typeof Main.notifyError === 'function') {
            Main.notifyError(infoTitle, infoText);
        } else {
            console.log(`FUHGlobe: ${infoTitle}: ${infoText}`);
        }
    }
}

function _triggerSettingsAction(win, dispatcher, appLabel) {
    if (!win) return;

    const wmClass = (win.get_wm_class ? win.get_wm_class() : '') || '';
    const wmInstance = (win.get_wm_class_instance ? win.get_wm_class_instance() : '') || '';
    const wmClassLower = wmClass.toLowerCase();
    const wmInstanceLower = wmInstance.toLowerCase();

    const tracker = Shell.WindowTracker.get_default();
    const app = tracker ? tracker.get_window_app(win) : null;
    const appInfo = app ? app.get_app_info() : null;

    // 1. Brave Browser: open brave://settings/ in active window without new window
    if (wmClassLower.includes('brave') || wmInstanceLower.includes('brave')) {
        if (dispatcher) {
            _navigateBrowserUrl(win, dispatcher, 'brave://settings/', true);
            return;
        }
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris(['brave://settings/'], null);
                return;
            } catch (e) {}
        }
        for (const cmd of ['brave-browser', 'brave-browser-stable', 'brave']) {
            try {
                Gio.Subprocess.new([cmd, 'brave://settings/'], Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {}
        }
    }

    // 2. Google Chrome / Chromium: open chrome://settings/ in active window
    if (wmClassLower.includes('chrome') || wmInstanceLower.includes('chrome') ||
        wmClassLower.includes('chromium') || wmInstanceLower.includes('chromium')) {
        if (dispatcher) {
            _navigateBrowserUrl(win, dispatcher, 'chrome://settings/', true);
            return;
        }
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris(['chrome://settings/'], null);
                return;
            } catch (e) {}
        }
        for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
            try {
                Gio.Subprocess.new([cmd, 'chrome://settings/'], Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {}
        }
    }

    // 3. Firefox: open about:preferences
    if (wmClassLower.includes('firefox') || wmInstanceLower.includes('firefox')) {
        if (appInfo && typeof appInfo.launch_uris === 'function') {
            try {
                appInfo.launch_uris(['about:preferences'], null);
                return;
            } catch (e) {}
        }
        for (const cmd of ['firefox', 'firefox-esr']) {
            try {
                Gio.Subprocess.new([cmd, 'about:preferences'], Gio.SubprocessFlags.NONE);
                return;
            } catch (e) {}
        }
    }

    // 4. GTK / Libadwaita preferences actions
    try {
        const busName = win.gtk_unique_bus_name || '';
        const appId = win.gtk_application_id || '';
        const winPath = win.gtk_window_object_path || '';
        const appObjPath = appId ? '/' + appId.replace(/\./g, '/') : '';
        if (busName) {
            const tryPaths = [appObjPath, winPath].filter(p => p);
            for (const objPath of tryPaths) {
                for (const actionName of ['preferences', 'settings']) {
                    Gio.DBus.session.call(
                        busName,
                        objPath,
                        'org.gtk.Actions',
                        'Activate',
                        GLib.Variant.new('(sava{sv})', [actionName, [], {}]),
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        null
                    );
                }
            }
            return;
        }
    } catch (e) {}

    // 5. Fallback shortcut if available
    if (dispatcher && typeof dispatcher.dispatchAccelerator === 'function') {
        dispatcher.dispatchAccelerator(win, 'Ctrl+,');
    }
}

function _triggerAboutAction(win, dispatcher, appLabel) {
    if (!win) return;

    try {
        const busName = win.gtk_unique_bus_name || '';
        const appId = win.gtk_application_id || '';
        const winPath = win.gtk_window_object_path || '';
        const appObjPath = appId ? '/' + appId.replace(/\./g, '/') : '';

        if (busName) {
            const tryPaths = [appObjPath, winPath].filter(p => p);
            let tried = 0;

            const tryNext = () => {
                if (tried >= tryPaths.length) {
                    _fallbackAboutAction(win, dispatcher, appLabel);
                    return;
                }
                const objPath = tryPaths[tried++];
                Gio.DBus.session.call(
                    busName,
                    objPath,
                    'org.gtk.Actions',
                    'Activate',
                    GLib.Variant.new('(sava{sv})', ['about', [], {}]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (_conn, res) => {
                        try {
                            Gio.DBus.session.call_finish(res);
                        } catch (e) {
                            tryNext();
                        }
                    }
                );
            };

            tryNext();
            return;
        }

        _fallbackAboutAction(win, dispatcher, appLabel);
    } catch (e) {
        console.error(`FUHGlobe: Failed to show about dialog: ${e}`);
        _fallbackAboutAction(win, dispatcher, appLabel);
    }
}

// ── DBusMenu Button (com.canonical.dbusmenu menus) ──────────────────────────

const DBusMenuButton = GObject.registerClass(
class DBusMenuButton extends PanelMenu.Button {
    _init(label, children, proxy, useHoverSubmenus = true) {
        super._init(0.0, `FUHGlobeDBusMenu-${label}`);
        this.add_style_class_name('fuhgawz-panel-button');
        this.accessible_name = label;
        this._useHoverSubmenus = useHoverSubmenus;

        const labelWidget = new St.Label({
            text: _cleanLabel(label),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(labelWidget);

        this._buildSubmenu(this.menu, children, proxy);
    }

    _buildSubmenu(popupMenu, items, proxy) {
        for (const item of items) {
            const props = item.properties || {};
            const label = _cleanLabel(props.label || '');

            if (props.type === 'separator') {
                popupMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            } else if (item.children && item.children.length > 0) {
                const subItem = this._useHoverSubmenus
                    ? new HoverSubMenuMenuItem(label, popupMenu)
                    : new PopupMenu.PopupSubMenuMenuItem(label);
                this._buildSubmenu(subItem.menu, item.children, proxy);
                popupMenu.addMenuItem(subItem);
            } else {
                const menuItem = new PopupMenu.PopupMenuItem(label);

                if (props.enabled === false) {
                    menuItem.setSensitive(false);
                }

                if (props['toggle-type'] === 'checkmark' || props['toggle-type'] === 'radio') {
                    if (props['toggle-state'] === 1) {
                        menuItem.label.text = `✓ ${label}`;
                    }
                }

                const itemId = item.id;
                menuItem.connect('activate', () => {
                    try {
                        const time = global.display.get_current_time_roundtrip();
                        proxy.EventRemote(
                            itemId,
                            'clicked',
                            GLib.Variant.new_string(''),
                            time,
                            (_res, err) => {
                                if (err) {
                                    console.error(`FUHGlobe: DBusMenu Event error for id=${itemId}: ${err}`);
                                }
                            }
                        );
                    } catch (e) {
                        console.error(`FUHGlobe: Failed to send DBusMenu Event: ${e}`);
                    }
                });
                popupMenu.addMenuItem(menuItem);
            }
        }
    }
});

// ── Actions Menu Button (org.gtk.Actions-backed) ────────────────────────────
//
// For apps that export actions but no menubar (most libadwaita apps).
// Calls DescribeAll, groups actions into File/Edit/View/Go/Help, and
// dispatches via org.gtk.Actions.Activate.

const ActionsMenuButton = GObject.registerClass(
class ActionsMenuButton extends PanelMenu.Button {
    _init(groupLabel, actionItems, busName, appObjectPath, winObjectPath, metaWindow = null, dispatcher = null) {
        super._init(0.0, `FUHGlobeActionsMenu-${groupLabel}`);
        this.add_style_class_name('fuhgawz-panel-button');
        this.accessible_name = groupLabel;

        const labelWidget = new St.Label({
            text: groupLabel,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(labelWidget);

        this._busName = busName;
        this._appObjectPath = appObjectPath;
        this._winObjectPath = winObjectPath;
        this._metaWindow = metaWindow;
        this._dispatcher = dispatcher;

        this._buildItems(actionItems);
    }

    _buildItems(actionItems) {
        const standardShortcuts = {
            'save': 'Ctrl+S',
            'save-as': 'Ctrl+Shift+S',
            'new': 'Ctrl+N',
            'open': 'Ctrl+O',
            'open-file': 'Ctrl+O',
            'undo': 'Ctrl+Z',
            'redo': 'Ctrl+Shift+Z',
            'cut': 'Ctrl+X',
            'copy': 'Ctrl+C',
            'paste': 'Ctrl+V',
            'select-all': 'Ctrl+A',
            'find': 'Ctrl+F',
            'zoom-in': 'Ctrl++',
            'zoom-out': 'Ctrl+-',
            'zoom-default': 'Ctrl+0',
            'zoom-normal': 'Ctrl+0',
            'fullscreen': 'F11',
        };

        for (const item of actionItems) {
            const menuItem = new PopupMenu.PopupMenuItem(item.label);

            if (!item.enabled) {
                menuItem.setSensitive(false);
            }

            // Show toggle state if applicable
            if (item.state !== null && item.state !== undefined) {
                if (typeof item.state === 'boolean') {
                    menuItem.label.text = (item.state ? '✓ ' : '   ') + item.label;
                }
            }

            menuItem.connect('activate', () => {
                const fallbackShortcut = standardShortcuts[item.actionName];

                try {
                    // Determine which D-Bus path to call Activate on
                    const objPath = item.isWinAction
                        ? this._winObjectPath
                        : this._appObjectPath;
                    if (!objPath) {
                        if (fallbackShortcut && this._dispatcher && this._metaWindow) {
                            console.log(`FUHGlobe: No object path for action ${item.actionName}, falling back to virtual shortcut ${fallbackShortcut}`);
                            this._dispatcher.dispatchAccelerator(this._metaWindow, fallbackShortcut);
                            return;
                        }
                        console.log(`FUHGlobe: No object path for action ${item.actionName}`);
                        return;
                    }
                    console.log(`FUHGlobe: Activating action "${item.actionName}" on ${this._busName} ${objPath}`);

                    Gio.DBus.session.call(
                        this._busName,
                        objPath,
                        'org.gtk.Actions',
                        'Activate',
                        GLib.Variant.new('(sava{sv})', [
                            item.actionName,
                            [],
                            {},
                        ]),
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_conn, res) => {
                            try {
                                Gio.DBus.session.call_finish(res);
                            } catch (e) {
                                console.error(`FUHGlobe: Activate error for ${item.actionName}: ${e}`);
                                if (fallbackShortcut && this._dispatcher && this._metaWindow) {
                                    console.log(`FUHGlobe: D-Bus action activation failed, using virtual shortcut ${fallbackShortcut}`);
                                    this._dispatcher.dispatchAccelerator(this._metaWindow, fallbackShortcut);
                                }
                            }
                        }
                    );
                } catch (e) {
                    console.error(`FUHGlobe: Failed to activate action ${item.actionName}: ${e}`);
                    if (fallbackShortcut && this._dispatcher && this._metaWindow) {
                        this._dispatcher.dispatchAccelerator(this._metaWindow, fallbackShortcut);
                    }
                }
            });
            this.menu.addMenuItem(menuItem);
        }
    }
});

// ── Declarative Menu Button (JSON Profile backed) ───────────────────────────

const DeclarativeMenuButton = GObject.registerClass(
class DeclarativeMenuButton extends PanelMenu.Button {
    _init(groupLabel, items, metaWindow, dispatcher, useHoverSubmenus = true, profile = null) {
        super._init(0.0, `FUHGlobeDeclarativeMenu-${groupLabel}`);
        this.add_style_class_name('fuhgawz-panel-button');
        this.accessible_name = groupLabel;
        this._useHoverSubmenus = useHoverSubmenus;

        const labelWidget = new St.Label({
            text: groupLabel,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(labelWidget);

        this._metaWindow = metaWindow;
        this._dispatcher = dispatcher;
        this._profile = profile;
        this._rawItems = items;
        this._itemsBuilt = false;
        this._lastMtime = 0;

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen) return;

            const isDynamic = this._profile && (
                this.accessible_name === 'Bookmarks' ||
                this._rawItems.some(i => i.dynamic || (Array.isArray(i.items) && i.items.some(si => si.dynamic)))
            );

            if (!this._itemsBuilt) {
                this._itemsBuilt = true;
                this._buildCurrentItems();
            } else if (isDynamic) {
                const currentMtime = typeof getBookmarksCacheMtime === 'function'
                    ? getBookmarksCacheMtime(this._profile.id)
                    : 0;
                if (currentMtime && currentMtime !== this._lastMtime) {
                    this._buildCurrentItems();
                }
            }
        });
    }

    _buildCurrentItems() {
        if (typeof this.menu.removeAll === 'function') {
            this.menu.removeAll();
        }
        let itemsToBuild = this._rawItems;
        if (this._profile && typeof expandDynamicProfileItems === 'function') {
            const expanded = expandDynamicProfileItems({
                id: this._profile.id,
                menus: [{ label: this.accessible_name, items: this._rawItems }],
            });
            if (expanded && Array.isArray(expanded.menus) && expanded.menus[0]?.items) {
                itemsToBuild = expanded.menus[0].items;
            }
            if (typeof getBookmarksCacheMtime === 'function') {
                this._lastMtime = getBookmarksCacheMtime(this._profile.id);
            }
        }
        this._buildItems(itemsToBuild);
    }

    _buildItems(items, targetMenu = this.menu) {
        if (!Array.isArray(items)) return;

        for (const item of items) {
            if (item.type === 'separator') {
                targetMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }

            const subItems = item.items || item.submenu || item.children;
            if (Array.isArray(subItems) && subItems.length > 0) {
                if (this._useHoverSubmenus) {
                    const subMenu = new HoverSubMenuMenuItem(item.label || '', targetMenu);
                    subMenu.setLazyPopulate(childMenu => {
                        this._buildItems(subItems, childMenu);
                    });
                    targetMenu.addMenuItem(subMenu);
                } else {
                    const subMenu = new PopupMenu.PopupSubMenuMenuItem(item.label || '');
                    let subBuilt = false;
                    subMenu.menu.connect('open-state-changed', (_menu, isOpen) => {
                        if (isOpen && !subBuilt) {
                            subBuilt = true;
                            this._buildItems(subItems, subMenu.menu);
                        }
                    });
                    targetMenu.addMenuItem(subMenu);
                }
                continue;
            }

            const menuItem = new PopupMenu.PopupMenuItem(item.label || '');

            if (item.sensitive === false || item.enabled === false) {
                menuItem.setSensitive(false);
            }

            if (item.shortcut) {
                const shortcutLabel = new St.Label({
                    text: item.shortcut,
                    style_class: 'popup-inactive-menu-item',
                    x_align: Clutter.ActorAlign.END,
                    x_expand: true,
                });
                menuItem.add_child(shortcutLabel);
            }

            if (item.action === 'hide' || (item.label && item.label.toLowerCase().startsWith('hide'))) {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    try {
                        if (this._metaWindow && typeof this._metaWindow.minimize === 'function') {
                            this._metaWindow.minimize();
                        }
                    } catch (e) {
                        console.warn(`FUHGlobe: Failed to minimize window: ${e}`);
                    }
                });
            } else if (item.action === 'about' || (item.label && item.label.toLowerCase().startsWith('about'))) {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    _triggerAboutAction(this._metaWindow, this._dispatcher, item.label || 'Application');
                });
            } else if (item.action === 'settings' || item.action === 'preferences' || (item.label && /^(settings|preferences)/i.test(item.label))) {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    _triggerSettingsAction(this._metaWindow, this._dispatcher, item.label || 'Application');
                });
            } else if (item.url) {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    _navigateBrowserUrl(this._metaWindow, this._dispatcher, item.url, true);
                });
            } else if (item.shortcut) {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    if (this._dispatcher && this._metaWindow) {
                        this._dispatcher.dispatchAccelerator(this._metaWindow, item.shortcut);
                    }
                });
            } else {
                menuItem.connect('activate', () => {
                    this.menu.close(BoxPointer.PopupAnimation.NONE);
                    console.log(`FUHGlobe: Declarative profile item activated: ${item.label}`);
                });
            }

            targetMenu.addMenuItem(menuItem);
        }
    }
});

// ── GTK Menu Model Button (GMenuModel-backed) ───────────────────────────────

const GtkMenuButton = GObject.registerClass(
class GtkMenuButton extends PanelMenu.Button {
    _init(label, menuModel, actionDispatcher, useHoverSubmenus = true) {
        super._init(0.0, `FUHGlobeGtkMenu-${label}`);
        this.add_style_class_name('fuhgawz-panel-button');
        this.accessible_name = label;
        this._useHoverSubmenus = useHoverSubmenus;

        const labelWidget = new St.Label({
            text: _cleanLabel(label),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(labelWidget);

        this._buildSubmenu(this.menu, menuModel, actionDispatcher);
    }

    _buildSubmenu(popupMenu, model, actionDispatcher) {
        let nItems;
        try {
            nItems = model.get_n_items();
        } catch (e) {
            console.log(`FUHGlobe: GtkMenuButton could not get_n_items: ${e}`);
            return;
        }

        for (let i = 0; i < nItems; i++) {
            const section = model.get_item_link(i, Gio.MENU_LINK_SECTION);
            const submenu = model.get_item_link(i, Gio.MENU_LINK_SUBMENU);

            const labelVal = model.get_item_attribute_value(i, Gio.MENU_ATTRIBUTE_LABEL, null);
            const label = _cleanLabel(labelVal ? labelVal.unpack() : '');

            if (section) {
                this._buildSubmenu(popupMenu, section, actionDispatcher);
                if (i < nItems - 1) {
                    popupMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                }
            } else if (submenu) {
                const subItem = this._useHoverSubmenus
                    ? new HoverSubMenuMenuItem(label, popupMenu)
                    : new PopupMenu.PopupSubMenuMenuItem(label);
                this._buildSubmenu(subItem.menu, submenu, actionDispatcher);
                popupMenu.addMenuItem(subItem);
            } else {
                const menuItem = new PopupMenu.PopupMenuItem(label);

                const actionVal = model.get_item_attribute_value(i, Gio.MENU_ATTRIBUTE_ACTION, null);
                const actionName = actionVal ? actionVal.unpack() : null;

                const targetVal = model.get_item_attribute_value(i, Gio.MENU_ATTRIBUTE_TARGET, null);

                if (actionName && actionDispatcher) {
                    try {
                        const enabled = actionDispatcher.getActionEnabled(actionName);
                        if (!enabled) {
                            menuItem.setSensitive(false);
                        }
                    } catch (e) {
                        // Action might not exist yet
                    }

                    menuItem.connect('activate', () => {
                        try {
                            actionDispatcher.activateAction(actionName, targetVal || null);
                        } catch (e) {
                            console.error(`FUHGlobe: Failed to activate action ${actionName}: ${e}`);
                        }
                    });
                }
                popupMenu.addMenuItem(menuItem);
            }
        }
    }
});

// ── Action Dispatcher ────────────────────────────────────────────────────────
//
// Splits prefixed action names (app.*, win.*, unity.*, etc.) and dispatches
// to the correct Gio.DBusActionGroup.

class ActionDispatcher {
    constructor(appActionGroup, winActionGroup) {
        this._appActionGroup = appActionGroup;
        this._winActionGroup = winActionGroup;
    }

    _resolve(fullName) {
        if (fullName.startsWith('app.') && this._appActionGroup) {
            return [this._appActionGroup, fullName.substring(4)];
        } else if (fullName.startsWith('win.') && this._winActionGroup) {
            return [this._winActionGroup, fullName.substring(4)];
        } else if (fullName.startsWith('unity.') && this._appActionGroup) {
            return [this._appActionGroup, fullName.substring(6)];
        }
        if (this._appActionGroup) return [this._appActionGroup, fullName];
        return [null, fullName];
    }

    getActionEnabled(fullName) {
        const [group, name] = this._resolve(fullName);
        if (!group) return true;
        try {
            return group.get_action_enabled(name);
        } catch (e) {
            return true;
        }
    }

    activateAction(fullName, target) {
        const [group, name] = this._resolve(fullName);
        if (!group) {
            console.log(`FUHGlobe: No action group for ${fullName}`);
            return;
        }
        console.log(`FUHGlobe: Activating action ${name} on ${fullName.split('.')[0]} group`);
        group.activate_action(name, target);
    }
}

// ── Main Global Menu Manager ─────────────────────────────────────────────────

class FUHGlobeGlobalMenu {
    constructor(settings = null, extensionPath = null, extension = null) {
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._extension = extension;

        // Monotonically increasing counter for unique status area names
        this._nextId = 0;

        // Currently displayed buttons
        this._menuButtons = [];

        // Active DBusMenu proxy + signal
        this._activeProxy = null;
        this._layoutUpdatedId = 0;

        // Active GTK menu model state
        this._gtkMenuModel = null;
        this._gtkMenuModelChangedId = 0;
        this._appActionGroup = null;
        this._winActionGroup = null;

        // Debounce timer for _updateMenu
        this._updatePendingId = 0;

        // Start the registrar service
        this._registrar = new DBusMenuRegistrar(() => this._scheduleUpdate());

        // Connect focus tracking
        this._focusWindowId = global.display.connect(
            'notify::focus-window',
            () => this._scheduleUpdate()
        );

        // System menu (macOS style) + companion controllers
        this._userSwitcherController = new UserSwitcherController(this._extension);
        this._quickSettingsController = new QuickSettingsActionsController(this._settings);

        this._systemMenu = null;
        this._sysMenuSignalId = 0;
        if (this._settings) {
            this._sysMenuSignalId = this._settings.connect(
                'changed::enable-system-menu',
                () => this._updateSystemMenu()
            );
        }
        // Fallback chain helpers
        this._virtualKeyboard = new VirtualKeyboardDispatcher();
        this._profileManager = new ProfileManager(this._extensionPath, Shell.WindowTracker.get_default());
        this._profileManager.loadProfiles();
        this._atspiScanner = new AtspiScanner();
        this._updateSystemMenu();

        this._log('FUHGlobeGlobalMenu initialized');
        this._updateMenu();
    }

    _updateSystemMenu() {
        const enabled = this._settings ? this._settings.get_boolean('enable-system-menu') : true;

        if (enabled && !this._systemMenu) {
            this._systemMenu = new SystemMenu(this._settings, this._extensionPath, this._extension);
            Main.panel.addToStatusArea('FUHGlobeSystemMenuButton', this._systemMenu, 0, 'left');
        } else if (!enabled && this._systemMenu) {
            this._systemMenu.destroy();
            this._systemMenu = null;
        }
    }

    _log(msg) {
        if (this._settings && this._settings.get_boolean('debug-logging')) {
            console.log(`FUHGlobe: ${msg}`);
        }
    }

    // Debounce rapid focus changes (e.g. alt-tab, overview)
    _scheduleUpdate() {
        if (this._updatePendingId) {
            GLib.source_remove(this._updatePendingId);
            this._updatePendingId = 0;
        }
        this._updatePendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._updatePendingId = 0;
            this._updateMenu();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Cleanup helpers ──────────────────────────────────────────────────

    _clearButtons() {
        for (const btn of this._menuButtons) {
            try {
                if (btn && !btn._destroyed) {
                    btn.destroy();
                }
            } catch (e) {
                // GObject already finalized
            }
        }
        this._menuButtons = [];
        this._nextId = 0;
    }

    _disconnectSources() {
        if (this._activeProxy && this._layoutUpdatedId) {
            try {
                this._activeProxy.disconnectSignal(this._layoutUpdatedId);
            } catch (e) { /* proxy may be dead */ }
        }
        this._activeProxy = null;
        this._layoutUpdatedId = 0;

        if (this._gtkMenuModel && this._gtkMenuModelChangedId) {
            try {
                this._gtkMenuModel.disconnect(this._gtkMenuModelChangedId);
            } catch (e) { /* model may be dead */ }
        }
        this._gtkMenuModel = null;
        this._gtkMenuModelChangedId = 0;
        this._appActionGroup = null;
        this._winActionGroup = null;
    }

    // ── Helper: detect desktop overlay windows (DING, etc.) ──────────────

    _isDesktopOverlayWindow(win) {
        if (!win) return false;

        const title = win.get_title() || '';
        const appId = win.gtk_application_id || '';
        const wmClass = win.get_wm_class() || '';
        const busName = win.gtk_unique_bus_name || '';

        this._log(`Checking window: title="${title}" app="${appId}" wmclass="${wmClass}" bus="${busName}"`);

        // Desktop Icons NG (DING) detection — check title first (most reliable)
        const titleLower = title.toLowerCase();
        if (titleLower.includes('desktop icon') || titleLower.includes('ding')) {
            this._log('Detected desktop overlay by title');
            return true;
        }

        // Check app ID and WM class for desktop-related patterns
        const combined = (appId + ' ' + wmClass).toLowerCase();
        if (combined.includes('desktopicon') || combined.includes('ding') ||
            combined.includes('desktop-icons') || combined.includes('rastersoft')) {
            this._log('Detected desktop overlay by app/wmclass');
            return true;
        }

        // Check for windows that claim to be the desktop
        try {
            const windowType = win.get_window_type();
            if (windowType === Meta.WindowType.DESKTOP) {
                this._log('Detected desktop overlay by window type');
                return true;
            }
        } catch (e) { /* get_window_type may not exist */ }

        // If the window has NO gtk_unique_bus_name, it's not a regular GTK app
        // that would export menus. Skip it to avoid showing "Desktop Icon" etc.
        if (!busName && !appId) {
            // No bus name AND no app ID — very unlikely to have menus
            // Check if it's a full-screen overlay (typical for desktop icons)
            try {
                const frame = win.get_frame_rect();
                const monitor = win.get_monitor();
                if (monitor >= 0) {
                    const monitorGeometry = global.display.get_monitor_geometry(monitor);
                    if (frame.x <= 0 && frame.y <= 0 &&
                        frame.width >= monitorGeometry.width - 10 &&
                        frame.height >= monitorGeometry.height - 10) {
                        this._log('Detected desktop overlay by geometry (no bus/app)');
                        return true;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        return false;
    }

    // ── Core update logic: implements Singularity OS fallback chain ──────

    _updateMenu() {
        // 1. Tear down everything from the previous cycle
        this._clearButtons();
        this._disconnectSources();

        const win = global.display.get_focus_window();

        // Diagnostic info
        if (win) {
            const pid = win.get_pid();
            const busName = win.gtk_unique_bus_name || '';
            const menuBarPath = win.gtk_menubar_object_path || '';
            const appMenuPath = win.gtk_app_menu_object_path || '';
            const winPath = win.gtk_window_object_path || '';
            const appId = win.gtk_application_id || '';
            this._log(
                `Focus → "${win.get_title()}" pid=${pid} ` +
                `bus=${busName} menubar=${menuBarPath} ` +
                `appmenu=${appMenuPath} winpath=${winPath} appid=${appId}`
            );
        } else {
            this._log('Focus → Desktop (no window)');
        }

        // 2. If no focused window (desktop), show nothing
        if (!win) {
            this._log('No focused window — hiding global menu');
            return;
        }

        // 3. Filter out desktop overlay windows (DING, etc.)
        if (this._isDesktopOverlayWindow(win)) {
            this._log(`Skipping desktop overlay window "${win.get_title()}"`);
            return;
        }

        // 3. Match declarative profile if available
        const profile = this._profileManager ? this._profileManager.getProfileForWindow(win) : null;
        if (profile) {
            this._log(`Matched Declarative Profile "${profile.id}" for window "${win.get_title()}"`);
        }

        // 4. Add the App Menu Button after the Activities button (position 1)
        const appMenuBtn = new AppMenuButton(win, profile, this._virtualKeyboard);
        const appMenuId = 'fuhgawz-app-menu';
        this._menuButtons.push(appMenuBtn);
        try {
            Main.panel.addToStatusArea(appMenuId, appMenuBtn, 1, 'left');
        } catch (e) {
            console.error(`FUHGlobe: Failed to add AppMenuButton: ${e}`);
        }

        // ── Fallback 1: GTK menu model (org.gtk.Menus) ──────────────────
        const busName = win.gtk_unique_bus_name || '';
        const menuBarPath = win.gtk_menubar_object_path || '';
        const appMenuPath = win.gtk_app_menu_object_path || '';

        if (busName && (menuBarPath || appMenuPath)) {
            const menuPath = menuBarPath || appMenuPath;
            this._log(`Trying GTK menu model: bus=${busName} path=${menuPath}`);
            this._loadGtkMenu(busName, menuPath, win);
            return;
        }

        // ── Fallback 1b: Probe standard GTK 4 menubar path ─────────────
        const appId = win.gtk_application_id || '';
        if (busName && appId) {
            const appObjPath = '/' + appId.replace(/\./g, '/');
            const standardMenubarPath = `${appObjPath}/menus/menubar`;
            this._log(`Probing standard GTK 4 menubar at ${standardMenubarPath}`);
            if (this._probeMenubarPath(busName, standardMenubarPath, win)) {
                return;
            }
        }

        // ── Fallback 2: DBusMenu (com.canonical.dbusmenu) ───────────────
        let entry = null;

        // 2a. Match by PID (Wayland native, Qt 5/6, Zed PR #51321)
        const pid = win.get_pid();
        if (pid > 0) {
            entry = this._registrar.getEntryByPid(pid);
            if (entry) {
                this._log(`DBusMenu match by PID=${pid}: service=${entry.service} path=${entry.path}`);
            }
        }

        // 2b. Match by X11 window ID (XWayland apps, patched VS Code)
        if (!entry) {
            let xid = 0;
            try {
                if (typeof win.get_xwindow === 'function') {
                    xid = win.get_xwindow();
                }
                if (!xid) {
                    const desc = win.get_description();
                    if (desc) {
                        const match = desc.match(/0x[0-9a-fA-F]+/);
                        if (match) xid = parseInt(match[0], 16);
                    }
                }
            } catch (e) { /* purely native Wayland — no xid */ }

            if (xid > 0) {
                entry = this._registrar.getEntryByWindowId(xid);
                if (entry) {
                    this._log(`DBusMenu match by XID=0x${xid.toString(16)}: service=${entry.service} path=${entry.path}`);
                }
            }
        }

        if (entry) {
            this._loadDBusMenu(entry.service, entry.path);
            return;
        }

        // ── Fallback 3: Declarative Application Profiles (JSON) ─────────
        const enableDeclarative = !this._settings || this._settings.get_boolean('enable-declarative-profiles');
        if (enableDeclarative && profile) {
            this._log(`Rendering Declarative Profile: ${profile.id} for "${win.get_title()}"`);
            if (this._loadDeclarativeProfile(profile, win)) {
                return;
            }
        }

        // ── Fallback 4: GTK Actions (org.gtk.Actions.DescribeAll) ───────
        // For modern libadwaita apps that export actions without traditional menubar
        const enableGtkActions = !this._settings || this._settings.get_boolean('enable-gtk-actions');
        if (enableGtkActions && (appId || busName)) {
            const effectiveBus = appId || busName;
            const appObjPath = appId ? '/' + appId.replace(/\./g, '/') : '';
            if (appObjPath) {
                this._log(`Trying GTK Actions fallback: bus=${effectiveBus} appObj=${appObjPath}`);
                this._loadGtkActions(effectiveBus, appObjPath, win, profile);
                return;
            }
        }

        // ── Fallback 5: Restricted AT-SPI Accessibility Scanner ─────────
        if (this._atspiScanner && !this._atspiScanner.isBlacklisted(win)) {
            this._log(`Attempting restricted AT-SPI query for "${win.get_title()}"`);
            this._atspiScanner.getMenuBar(win).then(atspiBar => {
                if (atspiBar && this._menuButtons.length <= 1) {
                    this._log('Found legacy AT-SPI menu bar');
                }
            }).catch(() => {});
        }

        // ── Fallback 6: built-in (app name + basic controls) ────────────
        this._log('Using built-in fallback menu (no GTK model, DBusMenu, profile, or GTK actions found)');
    }

    // ── Load Declarative Menu Profile ──────────────────────────────────────────

    _loadDeclarativeProfile(profile, win) {
        if (!profile || !Array.isArray(profile.menus)) return false;

        // Pre-warm bookmarks cache asynchronously in background for browser profiles
        if (profile.id) {
            const pid = profile.id.toLowerCase();
            if (pid.includes('brave') || pid.includes('chrome') || pid.includes('chromium')) {
                loadBrowserBookmarksAsync(pid).catch(() => {});
            }
        }

        const useHover = !this._settings || this._settings.get_boolean('enable-hover-submenus');
        let addedAny = false;
        let position = 2; // after Activities(0) and AppMenu(1)
        for (const menuDef of profile.menus) {
            if (!menuDef.label || !Array.isArray(menuDef.items) || menuDef.items.length === 0) {
                continue;
            }
            const btn = new DeclarativeMenuButton(
                menuDef.label,
                menuDef.items,
                win,
                this._virtualKeyboard,
                useHover,
                profile
            );
            const btnId = `fuhgawz-menu-slot-${this._nextId++}`;
            this._menuButtons.push(btn);
            try {
                Main.panel.addToStatusArea(btnId, btn, position++, 'left');
                addedAny = true;
            } catch (e) {
                console.error(`FUHGlobe: Failed to add DeclarativeMenuButton "${menuDef.label}": ${e}`);
            }
        }
        return addedAny;
    }

    // ── Probe a standard menubar path for GMenuModel ────────────────────────

    _probeMenubarPath(busName, menuPath, win) {
        try {
            const model = Gio.DBusMenuModel.get(
                Gio.DBus.session, busName, menuPath
            );

            // Check if the model has any items
            const nItems = model.get_n_items();
            if (nItems > 0) {
                console.log(`FUHGlobe: Found GMenuModel at ${menuPath} with ${nItems} items`);
                // Successfully found a menu model — load it
                this._loadGtkMenu(busName, menuPath, win);
                return true;
            }
            console.log(`FUHGlobe: GMenuModel at ${menuPath} has no items`);
            return false;
        } catch (e) {
            console.log(`FUHGlobe: Failed to probe menubar at ${menuPath}: ${e}`);
            return false;
        }
    }

    // ── GTK Menu Model loading ───────────────────────────────────────────

    _loadGtkMenu(busName, menuPath, win) {
        try {
            this._gtkMenuModel = Gio.DBusMenuModel.get(
                Gio.DBus.session, busName, menuPath
            );

            let appObjectPath = '/org/gtk/Application/anonymous';
            if (win.gtk_application_id) {
                const candidatePath = '/' + win.gtk_application_id.replace(/\./g, '/');
                appObjectPath = candidatePath;
            }

            this._appActionGroup = Gio.DBusActionGroup.get(
                Gio.DBus.session, busName, appObjectPath
            );
            console.log(`FUHGlobe: GTK app action group at ${appObjectPath}`);

            if (win.gtk_window_object_path) {
                this._winActionGroup = Gio.DBusActionGroup.get(
                    Gio.DBus.session, busName, win.gtk_window_object_path
                );
                console.log(`FUHGlobe: GTK win action group at ${win.gtk_window_object_path}`);
            }

            this._gtkMenuModelChangedId = this._gtkMenuModel.connect(
                'items-changed',
                () => {
                    console.log('FUHGlobe: GTK menu model items-changed, reloading');
                    this._reloadGtkMenu();
                }
            );

            this._reloadGtkMenu();
        } catch (e) {
            console.error(`FUHGlobe: Error loading GTK menu model: ${e}`);
        }
    }

    _reloadGtkMenu() {
        if (!this._gtkMenuModel) return;

        this._removeMenuItemButtons();

        const nItems = this._gtkMenuModel.get_n_items();
        console.log(`FUHGlobe: GTK menu model has ${nItems} top-level items`);

        const actionDispatcher = new ActionDispatcher(
            this._appActionGroup,
            this._winActionGroup
        );

        let position = 2;  // Start after Activities(0) + AppMenu(1)
        for (let i = 0; i < nItems; i++) {
            const submenu = this._gtkMenuModel.get_item_link(i, Gio.MENU_LINK_SUBMENU);
            const labelVal = this._gtkMenuModel.get_item_attribute_value(
                i, Gio.MENU_ATTRIBUTE_LABEL, null
            );
            const label = labelVal ? labelVal.unpack() : '';

            if (label && submenu) {
                const useHover = !this._settings || this._settings.get_boolean('enable-hover-submenus');
                const btn = new GtkMenuButton(label, submenu, actionDispatcher, useHover);
                const btnId = `fuhgawz-menu-slot-${this._nextId++}`;
                this._menuButtons.push(btn);
                try {
                    Main.panel.addToStatusArea(btnId, btn, position++, 'left');
                } catch (e) {
                    console.error(`FUHGlobe: Failed to add GTK menu button "${label}": ${e}`);
                }
            }
        }

        console.log(`FUHGlobe: Added ${position - 1} GTK menu buttons`);
    }

    // ── GTK Actions loading (org.gtk.Actions.DescribeAll) ────────────────
    //
    // For apps that export actions but no menubar (most libadwaita apps).
    // We call DescribeAll on both the app and window objects, then group the
    // discovered actions into logical menu categories.

    _loadGtkActions(busName, appObjectPath, win, profile = null) {
        // Determine the window's D-Bus object path
        let winObjectPath = win.gtk_window_object_path || '';

        console.log(`FUHGlobe: Loading GTK Actions from bus=${busName} app=${appObjectPath} win=${winObjectPath}`);

        // Call DescribeAll on the app object
        Gio.DBus.session.call(
            busName,
            appObjectPath,
            'org.gtk.Actions',
            'DescribeAll',
            null,
            GLib.VariantType.new('(a{s(bgav)})'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, appResult) => {
                let appActions = {};
                try {
                    const result = Gio.DBus.session.call_finish(appResult);
                    appActions = result.deepUnpack()[0] || {};
                } catch (e) {
                    console.log(`FUHGlobe: DescribeAll on app path failed: ${e}`);
                }

                // Now try window-level actions if we have a path
                if (winObjectPath) {
                    Gio.DBus.session.call(
                        busName,
                        winObjectPath,
                        'org.gtk.Actions',
                        'DescribeAll',
                        null,
                        GLib.VariantType.new('(a{s(bgav)})'),
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (_conn2, winResult) => {
                            let winActions = {};
                            try {
                                const result2 = Gio.DBus.session.call_finish(winResult);
                                winActions = result2.deepUnpack()[0] || {};
                            } catch (e) {
                                console.log(`FUHGlobe: DescribeAll on win path failed: ${e}`);
                            }
                            this._buildActionsMenu(appActions, winActions, busName, appObjectPath, winObjectPath, win, profile);
                        }
                    );
                } else {
                    // Try to discover window object path by introspecting
                    this._discoverWindowPath(busName, appObjectPath, (discoveredWinPath) => {
                        if (discoveredWinPath) {
                            console.log(`FUHGlobe: Discovered window path: ${discoveredWinPath}`);
                            Gio.DBus.session.call(
                                busName,
                                discoveredWinPath,
                                'org.gtk.Actions',
                                'DescribeAll',
                                null,
                                GLib.VariantType.new('(a{s(bgav)})'),
                                Gio.DBusCallFlags.NONE,
                                -1,
                                null,
                                (_conn3, winResult2) => {
                                    let winActions = {};
                                    try {
                                        const result3 = Gio.DBus.session.call_finish(winResult2);
                                        winActions = result3.deepUnpack()[0] || {};
                                    } catch (e) {
                                        console.log(`FUHGlobe: DescribeAll on discovered win path failed: ${e}`);
                                    }
                                    this._buildActionsMenu(appActions, winActions, busName, appObjectPath, discoveredWinPath, win, profile);
                                }
                            );
                        } else {
                            // No window path found — build with app actions only
                            console.log('FUHGlobe: No window path found, using app actions only');
                            this._buildActionsMenu(appActions, {}, busName, appObjectPath, '', win, profile);
                        }
                    });
                }
            }
        );
    }

    // Discover window child nodes under /app/path/window/
    _discoverWindowPath(busName, appObjectPath, callback) {
        const windowBasePath = appObjectPath + '/window';

        // First, try to introspect the /window base path to find child nodes
        Gio.DBus.session.call(
            busName,
            windowBasePath,
            'org.freedesktop.DBus.Introspectable',
            'Introspect',
            null,
            GLib.VariantType.new('(s)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, result) => {
                try {
                    const xmlStr = Gio.DBus.session.call_finish(result).deepUnpack()[0];
                    // Parse out <node name="N"/> entries
                    const nodeMatches = xmlStr.match(/node\s+name="(\d+)"/g);
                    if (nodeMatches && nodeMatches.length > 0) {
                        // Get the first (or most recent) window number
                        const nums = nodeMatches.map(m => {
                            const n = m.match(/name="(\d+)"/);
                            return n ? parseInt(n[1]) : 0;
                        }).sort((a, b) => b - a); // Highest number = most recent
                        callback(`${windowBasePath}/${nums[0]}`);
                    } else {
                        // No child nodes found — try /window/0 directly as fallback
                        this._tryWindowPath(busName, `${windowBasePath}/0`, callback);
                    }
                } catch (e) {
                    console.log(`FUHGlobe: Introspect on ${windowBasePath} failed: ${e}, trying /window/0`);
                    // Introspection failed — try /window/0 directly
                    this._tryWindowPath(busName, `${windowBasePath}/0`, callback);
                }
            }
        );
    }

    // Probe a specific window path to check if it exports actions
    _tryWindowPath(busName, windowPath, callback) {
        Gio.DBus.session.call(
            busName,
            windowPath,
            'org.gtk.Actions',
            'DescribeAll',
            null,
            GLib.VariantType.new('(a{s(bgav)})'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, result) => {
                try {
                    Gio.DBus.session.call_finish(result);
                    // Path exists and has actions — use it
                    console.log(`FUHGlobe: Window path ${windowPath} has actions`);
                    callback(windowPath);
                } catch (e) {
                    // Path doesn't exist or has no actions
                    console.log(`FUHGlobe: Window path ${windowPath} has no actions: ${e}`);
                    callback(null);
                }
            }
        );
    }

    _buildActionsMenu(appActions, winActions, busName, appObjectPath, winObjectPath, win = null, profile = null) {
        console.log(`FUHGlobe: Building actions menu — app actions: ${Object.keys(appActions).length}, win actions: ${Object.keys(winActions).length}`);

        // Merge all actions with metadata
        const allActions = [];

        for (const [name, desc] of Object.entries(appActions)) {
            const unpacked = desc.deepUnpack ? desc.deepUnpack() : desc;
            // desc is (bgav): (enabled, paramType, state)
            const enabled = unpacked[0];
            const paramType = unpacked[1]; // parameter signature string
            let state = null;
            if (unpacked[2] && unpacked[2].length > 0) {
                try {
                    const stateVariant = unpacked[2][0];
                    state = stateVariant.deepUnpack ? stateVariant.deepUnpack() : stateVariant;
                } catch (e) { /* ignore */ }
            }
            // Skip actions that require complex parameters (we can't provide them from a menu click)
            // Allow simple string parameters (s) as they often have sensible defaults
            if (paramType && paramType !== '' && paramType !== 's') {
                console.log(`FUHGlobe: Skipping parameterized app action "${name}" (param=${paramType})`);
                continue;
            }
            allActions.push({ actionName: name, enabled, state, isWinAction: false });
        }

        for (const [name, desc] of Object.entries(winActions)) {
            const unpacked = desc.deepUnpack ? desc.deepUnpack() : desc;
            const enabled = unpacked[0];
            const paramType = unpacked[1];
            let state = null;
            if (unpacked[2] && unpacked[2].length > 0) {
                try {
                    const stateVariant = unpacked[2][0];
                    state = stateVariant.deepUnpack ? stateVariant.deepUnpack() : stateVariant;
                } catch (e) { /* ignore */ }
            }
            if (paramType && paramType !== '' && paramType !== 's') {
                console.log(`FUHGlobe: Skipping parameterized win action "${name}" (param=${paramType})`);
                continue;
            }
            allActions.push({ actionName: name, enabled, state, isWinAction: true });
        }

        // Classify each action into a group
        const grouped = {};
        const ungrouped = [];

        for (const action of allActions) {
            // Check if this action should be hidden
            if (ACTION_LABELS.hasOwnProperty(action.actionName) && ACTION_LABELS[action.actionName] === null) {
                continue;
            }

            // Find which group this action belongs to
            let found = false;
            for (const group of ACTION_GROUPS) {
                if (group.actions.includes(action.actionName)) {
                    if (!grouped[group.label]) {
                        grouped[group.label] = [];
                    }
                    const label = ACTION_LABELS[action.actionName] || this._humanizeActionName(action.actionName);
                    grouped[group.label].push({ ...action, label });
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Try to categorize by action name heuristics
                const heuristicGroup = this._categorizeByHeuristic(action.actionName);
                if (heuristicGroup) {
                    if (!grouped[heuristicGroup]) {
                        grouped[heuristicGroup] = [];
                    }
                    const label = ACTION_LABELS[action.actionName] || this._humanizeActionName(action.actionName);
                    grouped[heuristicGroup].push({ ...action, label });
                } else {
                    // Put unknown actions into a generic "App" group
                    const label = ACTION_LABELS[action.actionName] || this._humanizeActionName(action.actionName);
                    if (label) {
                        ungrouped.push({ ...action, label });
                    }
                }
            }
        }

        // If there are ungrouped actions, add them to a generic menu
        if (ungrouped.length > 0) {
            if (!grouped['App']) {
                grouped['App'] = [];
            }
            grouped['App'].push(...ungrouped);
        }

        // Remove menu item buttons (keep app menu at index 0)
        this._removeMenuItemButtons();

        const groupOrder = ['File', 'Edit', 'View', 'Go', 'Media', 'Tools', 'App', 'Help'];
        let position = 2;  // Start after Activities(0) + AppMenu(1)
        let addedCount = 0;

        for (const groupName of groupOrder) {
            const items = grouped[groupName];
            if (!items || items.length === 0) continue;

            const btn = new ActionsMenuButton(
                groupName, items, busName, appObjectPath, winObjectPath, win, this._virtualKeyboard
            );
            const btnId = `fuhgawz-menu-slot-${this._nextId++}`;
            this._menuButtons.push(btn);
            try {
                Main.panel.addToStatusArea(btnId, btn, position++, 'left');
                addedCount++;
            } catch (e) {
                console.error(`FUHGlobe: Failed to add Actions menu button "${groupName}": ${e}`);
            }
        }

        console.log(`FUHGlobe: Added ${addedCount} action-based menu buttons`);
        if (addedCount === 0) {
            console.log('FUHGlobe: 0 GTK actions added, falling back to declarative profile');
            const enableDeclarative = !this._settings || this._settings.get_boolean('enable-declarative-profiles');
            if (enableDeclarative && profile) {
                this._loadDeclarativeProfile(profile, win);
            }
        }
    }

    // Categorize actions by heuristic name patterns
    _categorizeByHeuristic(actionName) {
        // Strip common prefixes (page., settings., etc.)
        const stripped = actionName.replace(/^[a-z]+\./, '');

        // File-like actions
        if (/^(save|open|new|close|print|revert|discard)/.test(stripped)) {
            return 'File';
        }
        // Edit-like actions
        if (/^(undo|redo|cut|copy|paste|select|find|replace)/.test(stripped)) {
            return 'Edit';
        }
        // View-like actions
        if (/^(zoom|show|hide|toggle|highlight|word-wrap|line-num)/.test(stripped)) {
            return 'View';
        }
        // Navigate-like actions
        if (/^(go-|back|forward|home|reload|refresh)/.test(stripped)) {
            return 'Go';
        }
        // Help-like actions
        if (/^(about|help|shortcuts|keyboard)/.test(stripped)) {
            return 'Help';
        }

        return null;
    }

    // Convert action names like "new-window" → "New Window"
    _humanizeActionName(name) {
        if (!name) return '';
        // Skip actions that look internal (contain dots but aren't in our known list)
        if (name.includes('.') && !ACTION_LABELS.hasOwnProperty(name)) {
            // Strip non-standard prefixes (page., settings., etc.) for display
            const stripped = name.replace(/^[a-z]+\./, '');
            if (stripped && !stripped.includes('.')) {
                return stripped
                    .replace(/[-_]/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());
            }
            return '';
        }
        return name
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    // ── DBusMenu loading ─────────────────────────────────────────────────

    _loadDBusMenu(service, path) {
        try {
            this._activeProxy = new DBusMenuProxy(Gio.DBus.session, service, path);

            this._layoutUpdatedId = this._activeProxy.connectSignal(
                'LayoutUpdated',
                (_proxy, _sender, _params) => {
                    console.log('FUHGlobe: DBusMenu LayoutUpdated signal received');
                    this._reloadDBusMenu();
                }
            );

            this._reloadDBusMenu();
        } catch (e) {
            console.error(`FUHGlobe: Error creating DBusMenu proxy: ${e}`);
        }
    }

    _reloadDBusMenu() {
        if (!this._activeProxy) return;

        this._activeProxy.GetLayoutRemote(0, -1, [], (result, error) => {
            if (error || !result) {
                console.error(`FUHGlobe: GetLayout error: ${error}`);
                return;
            }

            const [_revision, layoutVariant] = result;
            const root = this._parseLayout(layoutVariant);

            this._removeMenuItemButtons();

            if (!root || !root.children || root.children.length === 0) {
                console.log('FUHGlobe: DBusMenu layout is empty');
                return;
            }

            console.log(`FUHGlobe: DBusMenu root has ${root.children.length} top-level items`);

            let position = 2;  // Start after Activities(0) + AppMenu(1)
            for (const topItem of root.children) {
                const props = topItem.properties || {};
                const label = props.label || '';

                if (label && topItem.children && topItem.children.length > 0) {
                    const useHover = !this._settings || this._settings.get_boolean('enable-hover-submenus');
                    const btn = new DBusMenuButton(label, topItem.children, this._activeProxy, useHover);
                    const btnId = `fuhgawz-menu-slot-${this._nextId++}`;
                    this._menuButtons.push(btn);
                    try {
                        Main.panel.addToStatusArea(btnId, btn, position++, 'left');
                    } catch (e) {
                        console.error(`FUHGlobe: Failed to add DBusMenu button "${label}": ${e}`);
                    }
                }
            }

            console.log(`FUHGlobe: Added ${position - 1} DBusMenu buttons`);
        });
    }

    // ── DBusMenu layout parser ───────────────────────────────────────────

    _parseLayout(variant) {
        try {
            const unpacked = variant.recursiveUnpack();
            return this._parseLayoutNode(unpacked);
        } catch (e) {
            console.error(`FUHGlobe: _parseLayout recursiveUnpack failed, trying deepUnpack: ${e}`);
            try {
                const unpacked = variant.deepUnpack();
                return this._parseLayoutNodeDeep(unpacked);
            } catch (e2) {
                console.error(`FUHGlobe: _parseLayout deepUnpack also failed: ${e2}`);
                return null;
            }
        }
    }

    _parseLayoutNode(arr) {
        const id = arr[0];
        const rawProps = arr[1] || {};
        const rawChildren = arr[2] || [];

        const properties = {};
        for (const key in rawProps) {
            properties[key] = rawProps[key];
        }

        const children = [];
        for (const child of rawChildren) {
            children.push(this._parseLayoutNode(child));
        }

        return { id, properties, children };
    }

    _parseLayoutNodeDeep(val) {
        const id = val[0];
        const rawProps = val[1] || {};
        const rawChildren = val[2] || [];

        const properties = {};
        for (const key in rawProps) {
            const v = rawProps[key];
            try {
                properties[key] = (v && typeof v.deepUnpack === 'function')
                    ? v.deepUnpack()
                    : v;
            } catch (e) {
                properties[key] = v;
            }
        }

        const children = [];
        for (let child of rawChildren) {
            try {
                if (child && typeof child.deepUnpack === 'function') {
                    child = child.deepUnpack();
                }
            } catch (e) { /* use as-is */ }
            children.push(this._parseLayoutNodeDeep(child));
        }

        return { id, properties, children };
    }

    // ── Helper: remove menu-item buttons (keep app menu at index 0) ─────

    _removeMenuItemButtons() {
        for (let i = this._menuButtons.length - 1; i >= 1; i--) {
            try {
                const btn = this._menuButtons[i];
                if (btn) btn.destroy();
            } catch (e) {
                // already destroyed
            }
        }
        if (this._menuButtons.length > 0) {
            this._menuButtons = [this._menuButtons[0]];
        }
    }

    // ── Teardown ─────────────────────────────────────────────────────────

    destroy() {
        if (this._updatePendingId) {
            GLib.source_remove(this._updatePendingId);
            this._updatePendingId = 0;
        }

        this._clearButtons();
        this._disconnectSources();

        if (this._userSwitcherController) {
            this._userSwitcherController.destroy();
            this._userSwitcherController = null;
        }

        if (this._quickSettingsController) {
            this._quickSettingsController.destroy();
            this._quickSettingsController = null;
        }

        if (this._systemMenu) {
            this._systemMenu.destroy();
            this._systemMenu = null;
        }

        if (this._settings && this._sysMenuSignalId) {
            this._settings.disconnect(this._sysMenuSignalId);
            this._sysMenuSignalId = 0;
        }

        if (this._registrar) {
            this._registrar.destroy();
            this._registrar = null;
        }

        if (this._focusWindowId) {
            global.display.disconnect(this._focusWindowId);
            this._focusWindowId = 0;
        }

        if (this._virtualKeyboard) {
            this._virtualKeyboard.destroy();
            this._virtualKeyboard = null;
        }

        if (this._profileManager) {
            this._profileManager.destroy();
            this._profileManager = null;
        }

        if (this._atspiScanner) {
            this._atspiScanner.destroy();
            this._atspiScanner = null;
        }

        console.log('FUHGlobe: FUHGlobeGlobalMenu destroyed');
    }
}

// ── Extension Entry Point ────────────────────────────────────────────────────

export default class FUHGlobeGlobalMenuExtension extends Extension {
    enable() {
        console.log('FUHGlobe: Extension enabling');
        this._settings = this.getSettings();
        this._menu = new FUHGlobeGlobalMenu(this._settings, this.path, this);
    }

    disable() {
        console.log('FUHGlobe: Extension disabling');
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        this._settings = null;
    }
}
