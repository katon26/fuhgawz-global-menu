import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export function createForceQuitMenuItem(metaWindow) {
    const item = new PopupMenu.PopupMenuItem(_('Force Quit Applications…'));
    item.icon.gicon = Gio.Icon.new_for_string('process-stop-symbolic');

    item.connect('activate', () => {
        try {
            // Attempt to kill active focused app window or launch system monitor
            const tracker = Shell.WindowTracker.get_default();
            const focusedApp = tracker.focus_app;

            if (focusedApp && focusedApp.get_windows().length > 0) {
                for (const win of focusedApp.get_windows()) {
                    try {
                        win.kill();
                    } catch (e) {
                        console.error(`FUHGlobe: Failed to kill window: ${e}`);
                    }
                }
            } else {
                // Fallback to gnome-system-monitor
                Gio.Subprocess.new(
                    ['gnome-system-monitor', '-p'],
                    Gio.SubprocessFlags.NONE
                );
            }
        } catch (e) {
            console.error(`FUHGlobe: Failed to activate force quit: ${e}`);
        }
    });

    return item;
}
