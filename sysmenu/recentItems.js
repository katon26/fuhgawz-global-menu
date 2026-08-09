import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const RecentItemsSubmenu = GObject.registerClass(
class RecentItemsSubmenu extends PopupMenu.PopupSubMenuMenuItem {
    _init(label = _('Recent Items')) {
        super._init(label, true);

        this.icon.gicon = Gio.Icon.new_for_string('document-open-recent-symbolic');

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._populateRecentItems();
            }
        });
    }

    _populateRecentItems() {
        this.menu.removeAll();

        let items = [];
        try {
            const recentManager = Gtk.RecentManager.get_default();
            items = recentManager.get_items() || [];
        } catch (e) {
            console.error(`FUHGlobe: Error loading recent items: ${e}`);
        }

        // Sort by last visited timestamp (most recent first)
        items.sort((a, b) => b.get_visited() - a.get_visited());
        const recentFiles = items.slice(0, 10);

        if (recentFiles.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(_('No Recent Items'));
            emptyItem.setSensitive(false);
            this.menu.addMenuItem(emptyItem);
            return;
        }

        for (const fileInfo of recentFiles) {
            const uri = fileInfo.get_uri();
            let displayName = fileInfo.get_display_name() || uri;
            if (displayName.length > 35) {
                displayName = displayName.substring(0, 32) + '…';
            }

            const item = new PopupMenu.PopupMenuItem(displayName);

            const iconName = fileInfo.get_gicon();
            if (iconName) {
                item.icon.gicon = iconName;
            } else {
                item.icon.gicon = Gio.Icon.new_for_string('text-x-generic-symbolic');
            }

            item.connect('activate', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_src, res) => {
                        try {
                            Gio.AppInfo.launch_default_for_uri_finish(res);
                        } catch (err) {
                            console.error(`FUHGlobe: Failed to open recent item ${uri}: ${err}`);
                        }
                    });
                } catch (e) {
                    console.error(`FUHGlobe: Error launching recent item: ${e}`);
                }
            });

            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const clearItem = new PopupMenu.PopupMenuItem(_('Clear Recent History…'));
        clearItem.connect('activate', () => {
            try {
                const recentManager = Gtk.RecentManager.get_default();
                recentManager.purge_items();
                this._populateRecentItems();
            } catch (e) {
                console.error(`FUHGlobe: Error purging recent items: ${e}`);
            }
        });
        this.menu.addMenuItem(clearItem);
    }
});
