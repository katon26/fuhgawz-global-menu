import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Manages discovery, loading, caching, and window matching for declarative menu profiles.
 */
export class ProfileManager {
    /**
     * @param {string} [extensionPath] - Base path of the extension directory.
     */
    constructor(extensionPath = '') {
        this._extensionPath = extensionPath;
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
     * @returns {Object|null} The matched profile or null.
     */
    getProfileForWindow(metaWindow) {
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

        // Match against indexes
        for (const candidate of candidates) {
            if (candidate.type === 'wm_class' && this._wmClassIndex.has(candidate.value)) {
                return this._wmClassIndex.get(candidate.value);
            }
            if (candidate.type === 'app_id' && this._appIdIndex.has(candidate.value)) {
                return this._appIdIndex.get(candidate.value);
            }
        }

        return null;
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
