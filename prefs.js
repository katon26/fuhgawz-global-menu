import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FUHGlobeExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // ── Main Page ────────────────────────────────────────────────────────
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ── Group 1: General Options ─────────────────────────────────────────
        const generalGroup = new Adw.PreferencesGroup({
            title: _('Behavior & Fallbacks'),
            description: _('Configure global menu detection features'),
        });
        page.add(generalGroup);

        // GTK 4 Actions Probe Switch
        const actionsRow = new Adw.SwitchRow({
            title: _('Enable GTK 4 Actions Probe'),
            subtitle: _('Enumerate org.gtk.Actions for modern Libadwaita apps'),
        });
        settings.bind(
            'enable-gtk-actions',
            actionsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        generalGroup.add(actionsRow);

        // Debug Logging Switch
        const debugRow = new Adw.SwitchRow({
            title: _('Enable Debug Logging'),
            subtitle: _('Print detailed troubleshooting logs to system journal (journalctl)'),
        });
        settings.bind(
            'debug-logging',
            debugRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        generalGroup.add(debugRow);

        // ── Group 2: Appearance ──────────────────────────────────────────────
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Customize panel menu button styling'),
        });
        page.add(appearanceGroup);

        // Menu Button Padding
        const paddingRow = new Adw.SpinRow({
            title: _('Button Horizontal Padding'),
            subtitle: _('Left and right inner padding for top bar menu items in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 24,
                step_increment: 2,
                page_increment: 4,
                value: settings.get_int('menu-padding'),
            }),
        });
        settings.bind(
            'menu-padding',
            paddingRow.adjustment,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        appearanceGroup.add(paddingRow);

        // ── Group 3: System Logo Menu ────────────────────────────────────────
        const sysMenuGroup = new Adw.PreferencesGroup({
            title: _('System Logo Menu'),
            description: _('Configure top-left system branding menu button'),
        });
        page.add(sysMenuGroup);

        // Enable System Menu Switch
        const sysMenuSwitchRow = new Adw.SwitchRow({
            title: _('Enable System Logo Menu'),
            subtitle: _('Display the top-left system branding menu button on the panel'),
        });
        settings.bind(
            'enable-system-menu',
            sysMenuSwitchRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        sysMenuGroup.add(sysMenuSwitchRow);

        // System Icon Entry Row
        const iconRow = new Adw.EntryRow({
            title: _('System Menu Icon Name'),
            text: settings.get_string('system-menu-icon'),
        });
        iconRow.connect('changed', (entry) => {
            const val = entry.get_text();
            if (val && val.trim().length > 0) {
                settings.set_string('system-menu-icon', val.trim());
            }
        });
        sysMenuGroup.add(iconRow);

        // Show Recent Items Switch
        const recentRow = new Adw.SwitchRow({
            title: _('Show Recent Items Submenu'),
            subtitle: _('Display recent documents and files in the system menu'),
        });
        settings.bind(
            'show-recent-items',
            recentRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        sysMenuGroup.add(recentRow);

        // Show Force Quit Switch
        const forceQuitRow = new Adw.SwitchRow({
            title: _('Show Force Quit Item'),
            subtitle: _('Display force quit application option in the system menu'),
        });
        settings.bind(
            'show-force-quit',
            forceQuitRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        sysMenuGroup.add(forceQuitRow);
    }
}

