/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * prefs.js - Implements the preferences UI for FUHGAWZ Global Menu.
 * Modern Libadwaita 3-page preferences: About, Global Menu, and System Menu.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function loadIconsMetadata(sourcePath) {
    const textDecoder = new TextDecoder();
    const filePath = GLib.build_filenamev([
        sourcePath,
        'src',
        'menu-icons.json',
    ]);

    try {
        const file = Gio.File.new_for_path(filePath);
        const [, contents] = file.load_contents(null);
        const data = JSON.parse(textDecoder.decode(contents));
        return Array.isArray(data) ? data : [];
    } catch (error) {
        logError(error, `Failed to load icons metadata from ${filePath}`);
        return [];
    }
}

function launchUri(window, url) {
    try {
        Gtk.show_uri(window, url, Gdk.CURRENT_TIME);
    } catch (error) {
        logError(error, `Failed to open URI ${url}`);
    }
}

function createLinkRow(window, title, url) {
    const row = new Adw.ActionRow({
        title,
        activatable: true,
    });

    row.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
    row.connect('activated', () => {
        launchUri(window, url);
    });

    return row;
}

function openLegalDialog(window, baseUrl, gettextFunc) {
    const dialog = new Adw.Dialog({
        content_width: 420,
        content_height: 560,
        presentation_mode: Adw.DialogPresentationMode.BOTTOM_SHEET,
    });

    const toolbarView = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
        show_title: true,
        title_widget: new Adw.WindowTitle({ title: gettextFunc('Legal') }),
    });
    toolbarView.add_top_bar(headerBar);

    const legalPage = new Adw.PreferencesPage();

    const licenseGroup = new Adw.PreferencesGroup({
        title: gettextFunc('License'),
        description: gettextFunc('FUHGAWZ Global Menu is free and open source software.'),
    });
    licenseGroup.add(
        createLinkRow(
            window,
            gettextFunc('GNU General Public License v3.0'),
            `${baseUrl}/blob/main/LICENSE`
        )
    );
    legalPage.add(licenseGroup);

    const copyrightGroup = new Adw.PreferencesGroup({
        title: gettextFunc('Copyright'),
        description: gettextFunc('Copyright © 2026 katon26. Licensed under the terms of the GNU General Public License version 3 or later.'),
    });
    legalPage.add(copyrightGroup);

    const scroller = new Gtk.ScrolledWindow({ vexpand: true, hexpand: true });
    scroller.set_child(legalPage);
    toolbarView.set_content(scroller);
    dialog.set_child(toolbarView);

    dialog.present(window);
}

function createLegalRow(window, baseUrl, gettextFunc) {
    const row = new Adw.ActionRow({
        title: gettextFunc('Legal'),
        activatable: true,
    });
    row.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
    row.connect('activated', () => {
        openLegalDialog(window, baseUrl, gettextFunc);
    });
    return row;
}

// ── Page 1: About ─────────────────────────────────────────────────────────────
function createAboutPage(window, extensionPath, metadata, gettextFunc) {
    const aboutPage = new Adw.PreferencesPage({
        title: gettextFunc('About'),
        icon_name: 'help-about-symbolic',
        name: 'AboutPage',
    });

    const headerGroup = new Adw.PreferencesGroup();
    const headerBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 16,
        margin_bottom: 8,
        margin_start: 16,
        margin_end: 16,
        halign: Gtk.Align.CENTER,
    });

    // App Logo
    const logoCandidates = [
        GLib.build_filenamev([extensionPath ?? '.', 'src', 'fuhgawz-logo.svg']),
        GLib.build_filenamev([extensionPath ?? '.', 'icons', 'gnome-icon-symbolic.svg']),
    ];
    for (const candPath of logoCandidates) {
        const candFile = Gio.File.new_for_path(candPath);
        if (candFile.query_exists(null)) {
            const logoImage = new Gtk.Picture({
                file: candFile,
                width_request: 128,
                height_request: 128,
                content_fit: Gtk.ContentFit.CONTAIN,
                halign: Gtk.Align.CENTER,
            });
            headerBox.append(logoImage);
            break;
        }
    }

    const extensionName = metadata.name ?? 'FUHGAWZ Global Menu';
    headerBox.append(
        new Gtk.Label({
            label: `<span size="xx-large" weight="bold">${GLib.markup_escape_text(extensionName, -1)}</span>`,
            use_markup: true,
            halign: Gtk.Align.CENTER,
        })
    );

    headerBox.append(
        new Gtk.Label({
            label: 'Katon (katon26)',
            url: 'https://katon26.github.io',
            halign: Gtk.Align.CENTER,
        })
    );

    const rawVersionName = metadata['version-name'] ?? null;
    const versionNumber =
        metadata.version !== undefined && metadata.version !== null
            ? `${metadata.version}`
            : null;
    const versionLabel =
        rawVersionName && versionNumber
            ? `${rawVersionName} (${versionNumber})`
            : rawVersionName ?? versionNumber ?? '1.0.0';
    const releaseVersion = rawVersionName ?? versionNumber ?? '1.0.0';

    const versionButton = new Gtk.Button({
        label: versionLabel,
        halign: Gtk.Align.CENTER,
        margin_top: 4,
        tooltip_text: gettextFunc('Changelog & Releases'),
    });
    versionButton.add_css_class('pill');
    versionButton.add_css_class('fuhgawz-version-pill');

    const baseUrl = metadata.url ?? 'https://github.com/katon26/fuhgawz-global-menu';
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const releasesBaseUrl = normalizedBaseUrl.endsWith('/releases')
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/releases`;

    versionButton.connect('clicked', () => {
        let targetUrl = releasesBaseUrl;
        if (releaseVersion && releaseVersion !== 'Unknown') {
            const safeVersion = encodeURIComponent(releaseVersion.replace(/^v/, ''));
            targetUrl = `${releasesBaseUrl}/tag/v${safeVersion}`;
        }
        launchUri(window, targetUrl);
    });

    headerBox.append(versionButton);
    headerGroup.add(headerBox);
    aboutPage.add(headerGroup);

    // Two-column Content Box: Links (Left) and QR + Sponsor (Right)
    const contentGroup = new Adw.PreferencesGroup();
    const contentBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 24,
        margin_top: 8,
        margin_bottom: 16,
        margin_start: 16,
        margin_end: 16,
        hexpand: true,
        homogeneous: true,
    });

    const leftColumn = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        hexpand: true,
        halign: Gtk.Align.FILL,
    });

    const websiteCard = new Adw.PreferencesGroup();
    websiteCard.add(createLinkRow(window, gettextFunc('Website'), normalizedBaseUrl));
    leftColumn.append(websiteCard);

    const issueCard = new Adw.PreferencesGroup();
    issueCard.add(createLinkRow(window, gettextFunc('Report an Issue'), `${normalizedBaseUrl}/issues`));
    leftColumn.append(issueCard);

    const infoGroup = new Adw.PreferencesGroup();
    infoGroup.add(createLinkRow(window, gettextFunc('Credits'), `${normalizedBaseUrl}/graphs/contributors`));
    infoGroup.add(createLegalRow(window, normalizedBaseUrl, gettextFunc));
    leftColumn.append(infoGroup);

    contentBox.append(leftColumn);

    const rightColumn = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.START,
        margin_top: 35,
        hexpand: true,
    });

    // QR Code Button
    const qrButton = new Gtk.Button({
        halign: Gtk.Align.CENTER,
        tooltip_text: gettextFunc('Buy Me a Coffee'),
    });
    qrButton.add_css_class('flat');
    const qrImage = new Gtk.Image({
        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${extensionPath}/src/qr-code-fuhg.svg`) }),
        pixel_size: 128,
    });
    qrButton.set_child(qrImage);
    qrButton.connect('clicked', () => {
        launchUri(window, 'https://buymeacoffee.com/fuhg');
    });
    const qrBox = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_bottom: 12,
    });
    qrBox.append(qrButton);
    rightColumn.append(qrBox);

    // Sponsor Button
    const sponsorButton = new Gtk.Button({
        halign: Gtk.Align.CENTER,
        tooltip_text: gettextFunc('Become a sponsor on GitHub'),
    });
    sponsorButton.add_css_class('pill');
    sponsorButton.add_css_class('fuhgawz-coffee-button');

    const sponsorContent = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
    });
    sponsorContent.append(new Gtk.Image({
        gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${extensionPath}/src/github-symbolic.svg`) }),
    }));
    sponsorContent.append(new Gtk.Label({
        label: gettextFunc('Sponsor Me ♡'),
    }));
    sponsorButton.set_child(sponsorContent);
    sponsorButton.connect('clicked', () => {
        launchUri(window, 'https://github.com/sponsors/katon26');
    });
    rightColumn.append(sponsorButton);

    contentBox.append(rightColumn);
    contentGroup.add(contentBox);
    aboutPage.add(contentGroup);

    // Responsive breakpoint: stack columns vertically on narrow window widths
    const aboutBreakpoint = new Adw.Breakpoint({
        condition: Adw.BreakpointCondition.parse('max-width: 500sp'),
    });
    aboutBreakpoint.add_setter(contentBox, 'orientation', Gtk.Orientation.VERTICAL);
    aboutBreakpoint.add_setter(contentBox, 'homogeneous', false);
    aboutBreakpoint.add_setter(rightColumn, 'margin-top', 0);
    window.add_breakpoint(aboutBreakpoint);

    return aboutPage;
}

// ── Page 2: Global Menu ───────────────────────────────────────────────────────
function createGlobalMenuPage(settings, gettextFunc) {
    const page = new Adw.PreferencesPage({
        title: gettextFunc('Global Menu'),
        icon_name: 'preferences-system-symbolic',
        name: 'GlobalMenuPage',
    });

    // Group 1: Behavior & Fallbacks
    const generalGroup = new Adw.PreferencesGroup({
        title: gettextFunc('Behavior &amp; Fallbacks'),
        description: gettextFunc('Configure global application menu detection and Wayland fallbacks.'),
    });
    page.add(generalGroup);

    // Wayland Fallback Menus Switch
    const profilesRow = new Adw.SwitchRow({
        title: gettextFunc('Enable Wayland Fallback Menus'),
        subtitle: gettextFunc('Provide top-bar menus for apps like Brave, Firefox, Zed, and Antigravity.'),
    });
    settings.bind(
        'enable-declarative-profiles',
        profilesRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    generalGroup.add(profilesRow);

    // Hover Flyout Submenus Switch
    const hoverSubmenusRow = new Adw.SwitchRow({
        title: gettextFunc('Enable Hover Flyout Submenus'),
        subtitle: gettextFunc('Display nested submenus as macOS-style horizontal flyouts.'),
    });
    settings.bind(
        'enable-hover-submenus',
        hoverSubmenusRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    generalGroup.add(hoverSubmenusRow);

    // GTK 4 Actions Probe Switch
    const actionsRow = new Adw.SwitchRow({
        title: gettextFunc('Enable GTK 4 Actions Probe'),
        subtitle: gettextFunc('Enumerate org.gtk.Actions for modern Libadwaita applications.'),
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
        title: gettextFunc('Enable Debug Logging'),
        subtitle: gettextFunc('Print detailed troubleshooting logs to system journal (journalctl).'),
    });
    settings.bind(
        'debug-logging',
        debugRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    generalGroup.add(debugRow);

    // Group 2: Appearance
    const appearanceGroup = new Adw.PreferencesGroup({
        title: gettextFunc('Appearance'),
        description: gettextFunc('Customize panel menu item padding and styling.'),
    });
    page.add(appearanceGroup);

    const paddingRow = new Adw.SpinRow({
        title: gettextFunc('Button Horizontal Padding'),
        subtitle: gettextFunc('Left and right inner padding for top bar menu items in pixels.'),
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

    // Group 3: Live Dynamic Menus Info
    const compatGroup = new Adw.PreferencesGroup({
        title: gettextFunc('Live Dynamic Menus'),
        description: gettextFunc('Compatibility modes for native menubar export.'),
    });
    page.add(compatGroup);

    const xwaylandRow = new Adw.ActionRow({
        title: gettextFunc('Live Dynamic Menus (XWayland Mode)'),
        subtitle: gettextFunc('For native dynamic menus in Brave, Firefox, or VS Code, run ./patch-launcher.sh &lt;app&gt; or start the app in XWayland mode (GDK_BACKEND=x11).'),
    });
    compatGroup.add(xwaylandRow);

    return page;
}

// ── Page 3: System Menu ───────────────────────────────────────────────────────
const SystemMenuPage = GObject.registerClass(
    { GTypeName: 'FUHGAWZSystemMenuPage' },
    class SystemMenuPage extends Adw.PreferencesPage {
        constructor(settings, sourcePath, gettextFunc) {
            super({
                title: gettextFunc('System Menu'),
                icon_name: 'preferences-other-symbolic',
                name: 'SystemMenuPage',
            });

            this._settings = settings;
            this._ = gettextFunc;

            // ── Menu Group ───────────────────────────────────────────────────
            const menuGroup = new Adw.PreferencesGroup({
                title: this._('Menu'),
                description: this._('Adjust how the System Menu looks and behaves.'),
            });

            // Enable System Menu Switch
            const sysMenuSwitchRow = new Adw.SwitchRow({
                title: this._('Enable System Logo Menu'),
                subtitle: this._('Display the top-left system branding menu button on the panel.'),
            });
            this._settings.bind(
                'enable-system-menu',
                sysMenuSwitchRow,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            menuGroup.add(sysMenuSwitchRow);

            // Menu Icon Selector
            const icons = loadIconsMetadata(sourcePath);
            const iconsList = new Gtk.StringList();
            icons.forEach((icon) => iconsList.append(icon.title));

            const iconSelectorRow = new Adw.ComboRow({
                title: this._('Menu Icon'),
                subtitle: this._('Choose the icon to display in the panel.'),
                model: iconsList,
                selected: this._settings.get_int('icon'),
            });
            iconSelectorRow.connect('notify::selected', (widget) => {
                this._settings.set_int('icon', widget.selected);
            });
            this._settings.connect('changed::icon', () => {
                const current = this._settings.get_int('icon');
                if (iconSelectorRow.selected !== current)
                    iconSelectorRow.selected = current;
            });
            menuGroup.add(iconSelectorRow);

            // Show Recent Items Switch
            const recentRow = new Adw.SwitchRow({
                title: this._('Show Recent Items Submenu'),
                subtitle: this._('Display recent documents and files in the system menu.'),
            });
            this._settings.bind(
                'show-recent-items',
                recentRow,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            menuGroup.add(recentRow);

            // Show Force Quit Switch
            const forceQuitSwitchRow = new Adw.SwitchRow({
                title: this._('Show Force Quit Item'),
                subtitle: this._('Display force quit application option in the system menu.'),
            });
            this._settings.bind(
                'show-force-quit',
                forceQuitSwitchRow,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            menuGroup.add(forceQuitSwitchRow);

            // App Store Command Row
            const defaultAppStoreCommand = 'gnome-software';
            const appStoreCommandRow = new Adw.EntryRow({
                title: this._('App Store Command'),
            });
            appStoreCommandRow.set_text(this._settings.get_string('app-store-command'));

            const restoreButton = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                has_frame: false,
                tooltip_text: this._('Restore Default'),
                valign: Gtk.Align.CENTER,
            });
            restoreButton.add_css_class('circular');

            const acceptButton = new Gtk.Button({
                icon_name: 'object-select-symbolic',
                has_frame: false,
                tooltip_text: this._('Apply Changes'),
                valign: Gtk.Align.CENTER,
            });
            acceptButton.add_css_class('circular');
            acceptButton.set_visible(false);
            acceptButton.set_sensitive(false);

            appStoreCommandRow.add_suffix(acceptButton);
            appStoreCommandRow.add_suffix(restoreButton);

            const clearEntryFocus = (row) => {
                const root = row.get_root();
                if (root && typeof root.set_focus === 'function')
                    root.set_focus(null);
            };

            const updateRestoreButtonState = () => {
                const currentText = appStoreCommandRow.get_text
                    ? appStoreCommandRow.get_text()
                    : appStoreCommandRow.text ?? '';
                const isDefault = currentText.trim() === defaultAppStoreCommand;
                restoreButton.set_sensitive(!isDefault);
                restoreButton.set_visible(!isDefault);
                acceptButton.set_sensitive(!isDefault);
            };

            restoreButton.connect('clicked', () => {
                appStoreCommandRow.set_text(defaultAppStoreCommand);
                this._settings.set_string('app-store-command', defaultAppStoreCommand);
                clearEntryFocus(appStoreCommandRow);
            });

            acceptButton.connect('clicked', () => {
                const text = appStoreCommandRow.get_text ? appStoreCommandRow.get_text() : appStoreCommandRow.text ?? '';
                this._settings.set_string('app-store-command', text.trim());
                clearEntryFocus(appStoreCommandRow);
            });

            appStoreCommandRow.connect('notify::text', updateRestoreButtonState);
            updateRestoreButtonState();

            const appKeyController = new Gtk.EventControllerKey();
            appKeyController.connect('key-pressed', (controller, keyval) => {
                if (keyval === Gdk.KEY_Escape) {
                    clearEntryFocus(appStoreCommandRow);
                    return true;
                }
                return false;
            });
            appStoreCommandRow.add_controller(appKeyController);

            const appFocusController = new Gtk.EventControllerFocus();
            appFocusController.connect('enter', () => {
                acceptButton.set_visible(true);
            });
            appFocusController.connect('leave', () => {
                acceptButton.set_visible(false);
            });
            appStoreCommandRow.add_controller(appFocusController);

            this._settings.bind(
                'app-store-command',
                appStoreCommandRow,
                'text',
                Gio.SettingsBindFlags.DEFAULT
            );

            menuGroup.add(appStoreCommandRow);

            // Force Quit Shortcut Row
            const defaultForceQuitShortcut = '<Alt><Super>Escape';
            const forceQuitShortcutRow = new Adw.ActionRow({
                title: this._('Force Quit Shortcut'),
                subtitle: this._('Keyboard shortcut that opens the Force Quit window.'),
                activatable: true,
            });

            const forceQuitShortcutLabel = new Gtk.Label({
                valign: Gtk.Align.CENTER,
            });
            forceQuitShortcutLabel.add_css_class('dim-label');
            forceQuitShortcutRow.add_suffix(forceQuitShortcutLabel);

            const forceQuitRestoreButton = new Gtk.Button({
                icon_name: 'edit-undo-symbolic',
                has_frame: false,
                tooltip_text: this._('Restore Default'),
                valign: Gtk.Align.CENTER,
            });
            forceQuitRestoreButton.add_css_class('circular');
            forceQuitRestoreButton.set_visible(false);
            forceQuitShortcutRow.add_suffix(forceQuitRestoreButton);

            const forceQuitClearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                has_frame: false,
                tooltip_text: this._('Clear Shortcut'),
                valign: Gtk.Align.CENTER,
            });
            forceQuitClearButton.add_css_class('circular');
            forceQuitClearButton.set_visible(false);
            forceQuitShortcutRow.add_suffix(forceQuitClearButton);

            const updateForceQuitShortcut = () => {
                const bindings = this._settings.get_strv('force-quit-shortcut');
                const accel = bindings.length > 0 ? bindings[0] : '';
                const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
                forceQuitShortcutLabel.set_label(
                    accel && ok ? Gtk.accelerator_get_label(keyval, mods) : this._('Disabled')
                );

                forceQuitClearButton.set_visible(!!accel && ok);

                const [defOk, defKey, defMods] = Gtk.accelerator_parse(defaultForceQuitShortcut);
                const isDefault = ok && defOk && keyval === defKey && mods === defMods;
                forceQuitRestoreButton.set_visible(!isDefault);
                forceQuitRestoreButton.set_sensitive(!isDefault);
            };
            updateForceQuitShortcut();
            this._settings.connect('changed::force-quit-shortcut', updateForceQuitShortcut);

            forceQuitClearButton.connect('clicked', () => {
                this._settings.set_strv('force-quit-shortcut', []);
            });

            forceQuitRestoreButton.connect('clicked', () => {
                this._settings.set_strv('force-quit-shortcut', [defaultForceQuitShortcut]);
            });

            forceQuitShortcutRow.connect('activated', () => {
                this._captureShortcut('force-quit-shortcut', forceQuitShortcutRow);
            });

            menuGroup.add(forceQuitShortcutRow);

            // macOS Style Shortcuts Switch
            const macosAccelSwitch = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
                active: this._settings.get_boolean('macos-accelerators'),
            });
            const macosAccelRow = new Adw.ActionRow({
                title: this._('macOS Style Shortcuts'),
                subtitle: this._('Show accelerator hints using macOS symbols (⌘ ⌥ ⌃ ⇧).'),
                activatable_widget: macosAccelSwitch,
            });
            macosAccelRow.add_suffix(macosAccelSwitch);
            this._settings.bind(
                'macos-accelerators',
                macosAccelSwitch,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            menuGroup.add(macosAccelRow);

            // Custom Menu Item (ExpanderRow)
            const customMenuExpanderRow = new Adw.ExpanderRow({
                title: this._('Custom Menu Item'),
                subtitle: this._('Add a custom menu entry with your own label and command.'),
                show_enable_switch: true,
                enable_expansion: this._settings.get_boolean('custom-menu-enabled'),
            });

            // Label Entry
            const customMenuLabelRow = new Adw.EntryRow({
                title: this._('Menu Label'),
            });
            customMenuLabelRow.set_text(this._settings.get_string('custom-menu-label'));
            this._settings.bind(
                'custom-menu-label',
                customMenuLabelRow,
                'text',
                Gio.SettingsBindFlags.DEFAULT
            );
            customMenuExpanderRow.add_row(customMenuLabelRow);

            // Command Entry
            const customMenuCommandRow = new Adw.EntryRow({
                title: this._('Command'),
            });
            customMenuCommandRow.set_text(this._settings.get_string('custom-menu-command'));
            this._settings.bind(
                'custom-menu-command',
                customMenuCommandRow,
                'text',
                Gio.SettingsBindFlags.DEFAULT
            );
            customMenuExpanderRow.add_row(customMenuCommandRow);

            // Custom Menu Keyboard Shortcut
            const customShortcutRow = new Adw.ActionRow({
                title: this._('Keyboard Shortcut'),
                subtitle: this._('Shortcut that runs the custom command.'),
                activatable: true,
            });

            const customShortcutLabel = new Gtk.Label({
                valign: Gtk.Align.CENTER,
            });
            customShortcutLabel.add_css_class('dim-label');
            customShortcutRow.add_suffix(customShortcutLabel);

            const customShortcutClearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                has_frame: false,
                tooltip_text: this._('Clear Shortcut'),
                valign: Gtk.Align.CENTER,
            });
            customShortcutClearButton.add_css_class('circular');
            customShortcutClearButton.set_visible(false);
            customShortcutRow.add_suffix(customShortcutClearButton);

            const updateCustomShortcut = () => {
                const bindings = this._settings.get_strv('custom-menu-shortcut');
                const accel = bindings.length > 0 ? bindings[0] : '';
                const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
                customShortcutLabel.set_label(
                    accel && ok ? Gtk.accelerator_get_label(keyval, mods) : this._('Disabled')
                );
                customShortcutClearButton.set_visible(!!accel && ok);
            };
            updateCustomShortcut();
            this._settings.connect('changed::custom-menu-shortcut', updateCustomShortcut);

            customShortcutClearButton.connect('clicked', () => {
                this._settings.set_strv('custom-menu-shortcut', []);
            });

            customShortcutRow.connect('activated', () => {
                this._captureShortcut('custom-menu-shortcut', customShortcutRow);
            });
            customMenuExpanderRow.add_row(customShortcutRow);

            // Custom Menu Icon Chooser
            const defaultIconSubtitle = this._('Optional image shown next to the menu label.');
            const customMenuIconRow = new Adw.ActionRow({
                title: this._('Icon'),
                subtitle: defaultIconSubtitle,
            });

            const iconPreview = new Gtk.Image({
                pixel_size: 24,
                valign: Gtk.Align.CENTER,
            });

            const iconChooseButton = new Gtk.Button({
                icon_name: 'document-open-symbolic',
                has_frame: false,
                tooltip_text: this._('Choose Icon File'),
                valign: Gtk.Align.CENTER,
            });
            iconChooseButton.add_css_class('circular');

            const iconClearButton = new Gtk.Button({
                icon_name: 'edit-clear-symbolic',
                has_frame: false,
                tooltip_text: this._('Remove Icon'),
                valign: Gtk.Align.CENTER,
            });
            iconClearButton.add_css_class('circular');

            customMenuIconRow.add_suffix(iconPreview);
            customMenuIconRow.add_suffix(iconChooseButton);
            customMenuIconRow.add_suffix(iconClearButton);

            const updateIconRow = () => {
                const path = this._settings.get_string('custom-menu-icon')?.trim() ?? '';
                const hasIcon = path.length > 0;

                if (hasIcon) {
                    const file = Gio.File.new_for_path(path);
                    const exists = file.query_exists(null);
                    if (exists) {
                        iconPreview.set_from_gicon(new Gio.FileIcon({ file }));
                    } else {
                        iconPreview.clear();
                    }
                    iconPreview.set_visible(exists);
                    customMenuIconRow.set_subtitle(
                        exists ? file.get_basename() : this._('Selected file was not found.')
                    );
                } else {
                    iconPreview.clear();
                    iconPreview.set_visible(false);
                    customMenuIconRow.set_subtitle(defaultIconSubtitle);
                }

                iconClearButton.set_visible(hasIcon);
            };

            iconChooseButton.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({
                    title: this._('Select Custom Menu Icon'),
                    modal: true,
                });

                const filter = new Gtk.FileFilter();
                filter.set_name(this._('Images'));
                filter.add_pixbuf_formats();
                filter.add_mime_type('image/svg+xml');

                const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
                filters.append(filter);
                dialog.set_filters(filters);

                const currentPath = this._settings.get_string('custom-menu-icon')?.trim() ?? '';
                if (currentPath.length > 0) {
                    const currentFile = Gio.File.new_for_path(currentPath);
                    if (currentFile.query_exists(null))
                        dialog.set_initial_file(currentFile);
                }

                const root = customMenuIconRow.get_root();
                dialog.open(root, null, (source, result) => {
                    try {
                        const file = source.open_finish(result);
                        if (file)
                            this._settings.set_string('custom-menu-icon', file.get_path());
                    } catch (_err) {
                        // User dismissed the dialog.
                    }
                });
            });

            iconClearButton.connect('clicked', () => {
                this._settings.set_string('custom-menu-icon', '');
            });

            this._settings.connect('changed::custom-menu-icon', updateIconRow);
            updateIconRow();

            customMenuExpanderRow.add_row(customMenuIconRow);
            customMenuExpanderRow.connect('notify::enable-expansion', (widget) => {
                this._settings.set_boolean('custom-menu-enabled', widget.get_enable_expansion());
            });

            menuGroup.add(customMenuExpanderRow);
            this.add(menuGroup);

            // ── Panel Group ──────────────────────────────────────────────────
            const panelGroup = new Adw.PreferencesGroup({
                title: this._('Panel'),
                description: this._('Hide or show the Activities button from the top bar.'),
            });

            const activityMenuSwitch = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
                active: !this._settings.get_boolean('activity-menu-visibility'),
            });
            const activityMenuRow = new Adw.ActionRow({
                title: this._('Hide Activities Menu'),
                subtitle: this._('Display the Activities button in the top panel.'),
                activatable_widget: activityMenuSwitch,
            });
            activityMenuRow.add_suffix(activityMenuSwitch);
            activityMenuSwitch.connect('notify::active', (widget) => {
                this._settings.set_boolean('activity-menu-visibility', !widget.get_active());
            });
            this._settings.connect('changed::activity-menu-visibility', () => {
                const hidden = !this._settings.get_boolean('activity-menu-visibility');
                if (activityMenuSwitch.active !== hidden)
                    activityMenuSwitch.active = hidden;
            });
            panelGroup.add(activityMenuRow);
            this.add(panelGroup);

            // ── Quick Settings Group ─────────────────────────────────────────
            const quickSettingsGroup = new Adw.PreferencesGroup({
                title: this._('Quick Settings'),
                description: this._('Choose which default quick action buttons stay visible.'),
            });

            const quickActionToggles = [
                {
                    key: 'hide-lock-button',
                    title: this._('Hide Lock Screen Button'),
                    subtitle: this._('Remove the lock screen quick action button.'),
                },
                {
                    key: 'hide-power-button',
                    title: this._('Hide Power Button'),
                    subtitle: this._('Remove the power menu quick action button.'),
                },
                {
                    key: 'hide-settings-button',
                    title: this._('Hide Settings Button'),
                    subtitle: this._('Remove the settings shortcut quick action button.'),
                },
            ];

            quickActionToggles.forEach(({ key, title, subtitle }) => {
                const toggle = new Gtk.Switch({
                    valign: Gtk.Align.CENTER,
                    active: this._settings.get_boolean(key),
                });

                const row = new Adw.ActionRow({
                    title,
                    subtitle,
                    activatable_widget: toggle,
                });
                row.add_suffix(toggle);
                quickSettingsGroup.add(row);

                toggle.connect('notify::active', (widget) => {
                    this._settings.set_boolean(key, widget.get_active());
                });
                this._settings.connect(`changed::${key}`, () => {
                    const val = this._settings.get_boolean(key);
                    if (toggle.active !== val)
                        toggle.active = val;
                });
            });

            this.add(quickSettingsGroup);
        }

        _captureShortcut(settingKey, row) {
            const dialog = new Adw.Dialog({
                title: this._('Set Shortcut'),
                content_width: 420,
                content_height: 240,
            });

            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(new Adw.HeaderBar());

            const statusPage = new Adw.StatusPage({
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
                title: this._('Press a Shortcut'),
                description: this._('Esc to cancel · Backspace to disable'),
            });
            statusPage.add_css_class('compact');
            statusPage.add_css_class('fuhgawz-shortcut-status');
            toolbarView.set_content(statusPage);
            dialog.set_child(toolbarView);

            const keyController = new Gtk.EventControllerKey();
            keyController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
            keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
                let mask = state & Gtk.accelerator_get_default_mod_mask();
                mask &= ~Gdk.ModifierType.LOCK_MASK;

                if (keyval === Gdk.KEY_Escape && mask === 0) {
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                    this._settings.set_strv(settingKey, []);
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                if (mask === 0 || !Gtk.accelerator_valid(keyval, mask))
                    return Gdk.EVENT_STOP;

                const accel = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
                this._settings.set_strv(settingKey, [accel]);
                dialog.close();
                return Gdk.EVENT_STOP;
            });
            dialog.add_controller(keyController);

            dialog.present(row.get_root());
        }
    }
);

// ── Main Extension Preferences Class ──────────────────────────────────────────
export default class FUHGlobeExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.title = this.metadata.name ?? 'FUHGAWZ Global Menu';
        window.set_default_size(510, 710);
        window.set_size_request(360, 500);
        window.set_search_enabled(true);

        // Add custom icons paths to GTK icon theme search path
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (iconTheme) {
            iconTheme.add_search_path(GLib.build_filenamev([this.path, 'src']));
            iconTheme.add_search_path(GLib.build_filenamev([this.path, 'icons']));
        }

        this._ensureCustomCss(window);

        const gettextFunc = this.gettext ? this.gettext.bind(this) : _;

        const aboutPage = createAboutPage(window, this.path, this.metadata, gettextFunc);
        const globalMenuPage = createGlobalMenuPage(settings, gettextFunc);
        const systemMenuPage = new SystemMenuPage(settings, this.path, gettextFunc);

        window.add(aboutPage);
        window.add(globalMenuPage);
        window.add(systemMenuPage);
    }

    _ensureCustomCss(window) {
        if (window._fuhgawzVersionCssProvider)
            return;

        const cssProvider = new Gtk.CssProvider();
        const cssPath = GLib.build_filenamev([this.path, 'prefs.css']);
        const cssFile = Gio.File.new_for_path(cssPath);

        if (cssFile.query_exists(null)) {
            cssProvider.load_from_path(cssPath);
            const display = Gdk.Display.get_default();
            if (display) {
                Gtk.StyleContext.add_provider_for_display(
                    display,
                    cssProvider,
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
                );
            }
            window._fuhgawzVersionCssProvider = cssProvider;
        }
    }
}
