import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

export function createCustomMenuItem(settings) {
    if (!settings) {
        return null;
    }

    let enabled = false;
    try {
        enabled = settings.get_boolean('custom-menu-enabled');
    } catch (e) {
        return null;
    }

    if (!enabled) {
        return null;
    }

    const label = (settings.get_string('custom-menu-label') || '').trim();
    const command = (settings.get_string('custom-menu-command') || '').trim();
    const iconPath = (settings.get_string('custom-menu-icon') || '').trim();

    if (label.length === 0 || command.length === 0) {
        return null;
    }

    const iconFile = iconPath.length > 0 ? Gio.File.new_for_path(iconPath) : null;
    const menuItem = (iconFile && iconFile.query_exists(null))
        ? new PopupMenu.PopupImageMenuItem(label, new Gio.FileIcon({ file: iconFile }))
        : new PopupMenu.PopupMenuItem(label);

    menuItem.connect('activate', () => runCustomMenuCommand(settings));

    return menuItem;
}

export function runCustomMenuCommand(settings) {
    if (!settings) return;
    
    let enabled = false;
    try {
        enabled = settings.get_boolean('custom-menu-enabled');
    } catch (e) {
        return;
    }
    if (!enabled) return;

    const command = (settings.get_string('custom-menu-command') || '').trim();
    if (command.length === 0) return;

    try {
        const shell = GLib.getenv('SHELL') || '/bin/bash';
        Util.spawn([shell, '-i', '-c', command]);
    } catch (error) {
        console.error(`FUHGlobe: Failed to execute custom menu command "${command}": ${error}`);
    }
}
