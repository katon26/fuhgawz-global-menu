import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

let Shell = null;
try {
    const mod = await import('gi://Shell');
    Shell = mod.default;
} catch (e) {
    // Standalone unit test environment where gi://Shell typelib is not in search path
}

/**
 * Replaces {{appName}} placeholders in profile labels and menu items.
 *
 * @param {Object} profile - The raw profile object.
 * @param {string} appName - The target application name.
 * @returns {Object} A cloned profile with templated labels.
 */
export function applyProfileTemplate(profile, appName) {
    if (!profile || !appName) return profile;

    const replaceStr = s => (typeof s === 'string' ? s.replace(/\{\{appName\}\}/g, appName) : s);

    const replaceItem = item => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };
        if (copy.label) copy.label = replaceStr(copy.label);
        const subItems = copy.items || copy.submenu || copy.children;
        if (Array.isArray(subItems)) {
            const mapped = subItems.map(replaceItem);
            if (copy.items) copy.items = mapped;
            if (copy.submenu) copy.submenu = mapped;
            if (copy.children) copy.children = mapped;
        }
        return copy;
    };

    const result = { ...profile };
    if (result.app_menu) {
        result.app_menu = { ...result.app_menu };
        if (result.app_menu.label) {
            result.app_menu.label = replaceStr(result.app_menu.label);
        }
        if (Array.isArray(result.app_menu.items)) {
            result.app_menu.items = result.app_menu.items.map(replaceItem);
        }
    }
    if (Array.isArray(result.menus)) {
        result.menus = result.menus.map(menu => ({
            ...menu,
            label: replaceStr(menu.label),
            items: Array.isArray(menu.items) ? menu.items.map(replaceItem) : []
        }));
    }
    return result;
}

/**
 * Manages discovery, loading, caching, and window matching for declarative menu profiles.
 */
export class ProfileManager {
    /**
     * @param {string} [extensionPath] - Base path of the extension directory.
     * @param {Shell.WindowTracker} [windowTracker] - Optional WindowTracker instance.
     */
    constructor(extensionPath = '', windowTracker = null) {
        this._extensionPath = extensionPath;
        this._windowTracker = windowTracker;
        this._profiles = new Map(); // id -> profile
        this._wmClassIndex = new Map(); // lowercase wm_class -> profile
        this._appIdIndex = new Map(); // lowercase app_id -> profile
    }

    /**
     * Load all JSON profiles from the built-in profiles directory and user overrides.
     */
    loadProfiles() {
        this._profiles.clear();
        this._wmClassIndex.clear();
        this._appIdIndex.clear();

        // 1. Built-in profiles from extension directory
        if (this._extensionPath) {
            const builtinPath = GLib.build_filenamev([this._extensionPath, 'profiles']);
            const builtinDir = Gio.File.new_for_path(builtinPath);
            this._loadProfilesFromDirectory(builtinDir);
        }

        // 2. User custom profiles in ~/.config/fuhgawzglbmenu/profiles/
        const userConfigPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'fuhgawzglbmenu', 'profiles']);
        const userDir = Gio.File.new_for_path(userConfigPath);
        this._loadProfilesFromDirectory(userDir);
    }

    _loadProfilesFromDirectory(dir) {
        if (!dir.query_exists(null)) return;

        try {
            const enumerator = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (!name.endsWith('.json')) continue;

                const file = dir.get_child(name);
                this._loadProfileFile(file);
            }
        } catch (e) {
            console.warn(`[FUHGAWZ] Error reading profiles directory ${dir.get_path()}: ${e.message}`);
        }
    }

    _loadProfileFile(file) {
        try {
            const [ok, bytes] = file.load_contents(null);
            if (!ok || !bytes) return;

            const content = new TextDecoder('utf-8').decode(bytes);
            const profile = JSON.parse(content);
            if (!profile || !profile.id) return;

            this.registerProfile(profile);
        } catch (e) {
            console.warn(`[FUHGAWZ] Error parsing profile ${file.get_basename()}: ${e.message}`);
        }
    }

    /**
     * Register a profile object and index its match rules.
     *
     * @param {Object} profile
     */
    registerProfile(profile) {
        if (!profile || !profile.id) return;

        this._profiles.set(profile.id, profile);

        if (profile.match) {
            if (Array.isArray(profile.match.wm_class)) {
                for (const cls of profile.match.wm_class) {
                    if (cls) this._wmClassIndex.set(cls.toLowerCase(), profile);
                }
            }
            if (Array.isArray(profile.match.app_id)) {
                for (const id of profile.match.app_id) {
                    if (id) this._appIdIndex.set(id.toLowerCase(), profile);
                }
            }
        }
    }

    /**
     * Look up a declarative profile matching the given MetaWindow.
     *
     * @param {Meta.Window} metaWindow
     * @param {string} [customAppName]
     * @param {Shell.WindowTracker} [customTracker]
     * @returns {Object|null} The matched profile or null.
     */
    getProfileForWindow(metaWindow, customAppName = null, customTracker = null) {
        if (!metaWindow) return null;

        const candidates = [];

        // 1. WM_CLASS
        try {
            if (typeof metaWindow.get_wm_class === 'function') {
                const wmClass = metaWindow.get_wm_class();
                if (wmClass) candidates.push({ type: 'wm_class', value: wmClass.toLowerCase() });
            }
            if (typeof metaWindow.get_wm_class_instance === 'function') {
                const inst = metaWindow.get_wm_class_instance();
                if (inst) candidates.push({ type: 'wm_class', value: inst.toLowerCase() });
            }
        } catch (e) {}

        // 2. GTK Application ID / Sandboxed App ID
        try {
            if (typeof metaWindow.get_gtk_application_id === 'function') {
                const appId = metaWindow.get_gtk_application_id();
                if (appId) candidates.push({ type: 'app_id', value: appId.toLowerCase() });
            }
            if (typeof metaWindow.get_sandboxed_app_id === 'function') {
                const sandboxedId = metaWindow.get_sandboxed_app_id();
                if (sandboxedId) candidates.push({ type: 'app_id', value: sandboxedId.toLowerCase() });
            }
        } catch (e) {}

        // 3. Shell.WindowTracker App ID
        let tracker = customTracker || this._windowTracker;
        try {
            if (!tracker) {
                if (Shell && Shell.WindowTracker) {
                    tracker = Shell.WindowTracker.get_default();
                } else if (typeof global !== 'undefined' && global.window_tracker) {
                    tracker = global.window_tracker;
                }
            }
            if (tracker && typeof tracker.get_window_app === 'function') {
                const app = tracker.get_window_app(metaWindow);
                if (app) {
                    const appId = app.get_id ? app.get_id() : null;
                    if (appId) {
                        candidates.push({ type: 'app_id', value: appId.toLowerCase() });
                        if (appId.endsWith('.desktop')) {
                            candidates.push({ type: 'app_id', value: appId.slice(0, -8).toLowerCase() });
                        }
                    }
                }
            }
        } catch (e) {}

        // Support direct tracker mock on window for tests
        try {
            if (typeof metaWindow.get_window_app === 'function') {
                const app = metaWindow.get_window_app();
                if (app) {
                    const appId = typeof app.get_id === 'function' ? app.get_id() : (app.id || app);
                    if (appId && typeof appId === 'string') {
                        candidates.push({ type: 'app_id', value: appId.toLowerCase() });
                        if (appId.endsWith('.desktop')) {
                            candidates.push({ type: 'app_id', value: appId.slice(0, -8).toLowerCase() });
                        }
                    }
                }
            }
        } catch (e) {}

        // Match against indexes
        let matched = null;
        for (const candidate of candidates) {
            if (candidate.type === 'wm_class' && this._wmClassIndex.has(candidate.value)) {
                matched = this._wmClassIndex.get(candidate.value);
                break;
            }
            if (candidate.type === 'app_id' && this._appIdIndex.has(candidate.value)) {
                matched = this._appIdIndex.get(candidate.value);
                break;
            }
        }

        if (!matched) return null;

        // Determine appName for template replacement
        let appName = customAppName;
        if (!appName) {
            if (tracker && typeof tracker.get_window_app === 'function') {
                try {
                    const app = tracker.get_window_app(metaWindow);
                    if (app && typeof app.get_name === 'function') {
                        appName = app.get_name() || '';
                    }
                } catch (e) {}
            }
            if (!appName && typeof metaWindow.get_wm_class === 'function') {
                appName = metaWindow.get_wm_class() || '';
            }
            if (!appName && typeof metaWindow.get_wm_class_instance === 'function') {
                appName = metaWindow.get_wm_class_instance() || '';
            }
            if (!appName && typeof metaWindow.get_title === 'function') {
                appName = metaWindow.get_title() || '';
            }
            if (!appName && matched.app_menu?.label && matched.app_menu.label !== '{{appName}}') {
                appName = matched.app_menu.label;
            }
        }

        return applyProfileTemplate(matched, appName);
    }

    /**
     * Clear profile data and caches.
     */
    destroy() {
        this._profiles.clear();
        this._wmClassIndex.clear();
        this._appIdIndex.clear();
    }
}
