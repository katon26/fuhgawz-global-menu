import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Applications known to have massive DOM accessibility trees (Chromium, Electron)
 * or non-standard accessibility bridges that freeze GNOME Shell if scanned.
 */
export const ATSPI_BLACKLIST = new Set([
    'chrome',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'brave',
    'brave-browser',
    'electron',
    'code',
    'com.visualstudio.code',
    'vscodium',
    'antigravity',
    'slack',
    'discord',
    'spotify',
    'steam',
]);

/**
 * Restricted, safe AT-SPI accessibility menu scanner.
 * Targets legacy applications with standard menubars (GIMP, LibreOffice, Inkscape).
 *
 * Atspi.init() is deliberately LAZY: calling it inside gnome-shell registers
 * a11y cache listeners in the compositor process, and when an application's
 * cache object is unavailable every libatspi call degenerates into blocking
 * D-Bus round trips — freezing the whole screen. Initialization therefore
 * only happens on first actual use, and the file-operations progress probe
 * runs exclusively inside bin/gm-fileops-probe, never in-shell.
 */
export class AtspiScanner {
    constructor() {
        this._atspiAvailable = false;
        this._atspiModule = null;
        this._pendingCalls = new Set();
        this._atspiLoading = null;
    }

    /**
     * Loads and initializes Atspi at most once, on first real use.
     *
     * @returns {Promise<boolean>} true when Atspi is usable
     */
    waitForAtspi() {
        if (this._atspiLoading)
            return this._atspiLoading;
        this._atspiLoading = new Promise(resolve => {
            try {
                import('gi://Atspi').then(mod => {
                    this._atspiModule = mod.default || mod;
                    if (typeof this._atspiModule.init === 'function') {
                        this._atspiModule.init();
                        this._atspiAvailable = true;
                    }
                    resolve(this._atspiAvailable);
                }).catch(() => {
                    this._atspiAvailable = false;
                    resolve(false);
                });
            } catch (e) {
                this._atspiAvailable = false;
                resolve(false);
            }
        });
        return this._atspiLoading;
    }

    /**
     * Test whether a window is blacklisted from AT-SPI scanning.
     *
     * @param {Meta.Window} metaWindow
     * @returns {boolean}
     */
    isBlacklisted(metaWindow) {
        if (!metaWindow) return true;

        const identifiers = [];

        try {
            if (typeof metaWindow.get_wm_class === 'function') {
                const cls = metaWindow.get_wm_class();
                if (cls) identifiers.push(cls.toLowerCase());
            }
            if (typeof metaWindow.get_wm_class_instance === 'function') {
                const inst = metaWindow.get_wm_class_instance();
                if (inst) identifiers.push(inst.toLowerCase());
            }
            if (typeof metaWindow.get_gtk_application_id === 'function') {
                const appId = metaWindow.get_gtk_application_id();
                if (appId) identifiers.push(appId.toLowerCase());
            }
            if (typeof metaWindow.get_sandboxed_app_id === 'function') {
                const sandboxed = metaWindow.get_sandboxed_app_id();
                if (sandboxed) identifiers.push(sandboxed.toLowerCase());
            }
        } catch (e) {}

        for (const id of identifiers) {
            for (const blacklisted of ATSPI_BLACKLIST) {
                if (id.includes(blacklisted)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Safely search for an ATSPI_ROLE_MENU_BAR for the target window.
     * Returns a promise that resolves to menu structure or null, strictly bounded by timeoutMs.
     *
     * @param {Meta.Window} metaWindow
     * @param {number} [timeoutMs=50]
     * @returns {Promise<Object|null>}
     */
    async getMenuBar(metaWindow, timeoutMs = 50) {
        if (!this._atspiLoading)
            this.waitForAtspi();
        if (!this._atspiAvailable || !this._atspiModule || !metaWindow) {
            return null;
        }

        if (this.isBlacklisted(metaWindow)) {
            console.debug('[FUHGAWZ] Window is blacklisted from AT-SPI scanner');
            return null;
        }

        // Bounded async execution
        return new Promise((resolve) => {
            let resolved = false;

            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                if (!resolved) {
                    resolved = true;
                    this._pendingCalls.delete(timeoutId);
                    resolve(null);
                }
                return GLib.SOURCE_REMOVE;
            });
            this._pendingCalls.add(timeoutId);

            try {
                // Query desktop root
                const desktop = this._atspiModule.get_desktop(0);
                if (!desktop) {
                    cleanup();
                    return resolve(null);
                }

                // Look for PID or window title match among top-level apps
                const targetPid = typeof metaWindow.get_pid === 'function' ? metaWindow.get_pid() : 0;
                const count = desktop.get_child_count();
                let targetApp = null;

                for (let i = 0; i < count; i++) {
                    const child = desktop.get_child_at_index(i);
                    if (!child) continue;

                    // Match by process ID if available
                    try {
                        const pid = child.get_process_id ? child.get_process_id() : 0;
                        if (targetPid > 0 && pid === targetPid) {
                            targetApp = child;
                            break;
                        }
                    } catch (err) {}
                }

                if (!targetApp) {
                    cleanup();
                    return resolve(null);
                }

                // Find menu bar within target application (depth limit 2)
                const menuBar = this._findRole(targetApp, this._atspiModule.Role.MENU_BAR, 2);
                cleanup();
                resolve(menuBar ? { accessible: menuBar } : null);
            } catch (err) {
                console.debug(`[FUHGAWZ] AT-SPI scan error: ${err.message}`);
                cleanup();
                resolve(null);
            }

            function cleanup() {
                if (!resolved) {
                    resolved = true;
                    GLib.Source.remove(timeoutId);
                }
            }
        });
    }

    _findRole(accessible, role, maxDepth = 2) {
        if (!accessible || maxDepth < 0) return null;

        try {
            if (accessible.get_role() === role) {
                return accessible;
            }

            const count = accessible.get_child_count();
            for (let i = 0; i < count; i++) {
                const child = accessible.get_child_at_index(i);
                const found = this._findRole(child, role, maxDepth - 1);
                if (found) return found;
            }
        } catch (e) {}

        return null;
    }

    /**
     * Bounded walk of one application's accessibility tree collecting the
     * progress-related strings Nautilus renders ("3.7 GB / 5.5 GB",
     * "6 seconds left", …) and any progress-bar values.
     *
     * The walk is capped by node count and depth so a folder window with
     * thousands of icon children can never stall the shell; AT-SPI's
     * per-application cache serves roles and names locally after the first
     * population, which keeps the recurring probe cheap.
     *
     * @param {number[]} pids - process IDs of the target application
     * @param {object} [options] - {maxNodes, maxDepth, maxTexts}
     * @returns {{texts: string[], progressValues: number[]}|null}
     */
    findProgressText(pids, options = {}) {
        if (!this._atspiLoading)
            this.waitForAtspi();
        if (!this._atspiAvailable || !this._atspiModule)
            return null;
        if (!Array.isArray(pids) || pids.length === 0)
            return null;

        try {
            const desktop = this._atspiModule.get_desktop(0);
            if (!desktop) return null;

            const pidSet = new Set(pids);
            const count = desktop.get_child_count();
            let app = null;

            for (let i = 0; i < count; i++) {
                const child = desktop.get_child_at_index(i);
                if (!child) continue;
                try {
                    const pid = child.get_process_id ? child.get_process_id() : 0;
                    if (pidSet.has(pid)) {
                        app = child;
                        break;
                    }
                } catch (err) {}
            }

            if (!app) return null;

            const bounds = {
                maxNodes: options.maxNodes ?? 300,
                maxDepth: options.maxDepth ?? 10,
                maxTexts: options.maxTexts ?? 60,
                visited: 0,
            };
            const result = {texts: [], progressValues: []};
            this._collectProgressAccessible(app, 0, bounds, result);
            return (result.texts.length > 0 || result.progressValues.length > 0) ? result : null;
        } catch (err) {
            console.debug(`[FUHGAWZ] AT-SPI progress scan error: ${err.message}`);
            return null;
        }
    }

    _collectProgressAccessible(accessible, depth, bounds, out) {
        if (!accessible || depth > bounds.maxDepth)
            return;
        if (bounds.visited >= bounds.maxNodes)
            return;
        if (out.texts.length >= bounds.maxTexts)
            return;
        bounds.visited++;

        try {
            const role = accessible.get_role();
            if (role === this._atspiModule.Role.LABEL) {
                let text = null;
                try {
                    text = accessible.get_name();
                } catch (err) {}
                if (!text) {
                    try {
                        const textIface = accessible.query_text ? accessible.query_text() : null;
                        if (textIface)
                            text = textIface.get_text(0, -1);
                    } catch (err) {}
                }
                if (typeof text === 'string' && text.trim())
                    out.texts.push(text.trim());
            } else if (role === this._atspiModule.Role.PROGRESS_BAR) {
                try {
                    const valueIface = accessible.query_value ? accessible.query_value() : null;
                    const value = valueIface ? valueIface.get_current_value() : null;
                    if (Number.isFinite(value) && value > 0)
                        out.progressValues.push(value);
                } catch (err) {}
            }
        } catch (err) {}

        try {
            const childCount = accessible.get_child_count();
            for (let i = 0; i < childCount; i++) {
                if (bounds.visited >= bounds.maxNodes || out.texts.length >= bounds.maxTexts)
                    break;
                const child = accessible.get_child_at_index(i);
                this._collectProgressAccessible(child, depth + 1, bounds, out);
            }
        } catch (err) {}
    }

    /**
     * Release all resources and cancel pending timeouts.
     */
    destroy() {
        for (const id of this._pendingCalls) {
            GLib.Source.remove(id);
        }
        this._pendingCalls.clear();
        this._atspiModule = null;
        this._atspiAvailable = false;
    }
}
