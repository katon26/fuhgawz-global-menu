import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

let Shell = null;
try {
    const mod = await import('gi://Shell');
    Shell = mod.default;
} catch (e) {
    // Standalone unit test environment where gi://Shell typelib is not in search path
}

export const MAX_DYNAMIC_ITEMS = 50;
export const BOOKMARKS_MANAGER_ITEM = {
    label: 'Open Bookmarks Manager... (Ctrl+Shift+O)',
    shortcut: 'Ctrl+Shift+O',
};

// In-memory cache for parsed bookmarks: Map<string, { data: Object, mtime: number, monitor: Gio.FileMonitor|null, monitorSignalId: number }>
export const _bookmarksCache = new Map();

/**
 * Clears the bookmarks cache and cancels all active file monitors.
 */
export function clearBookmarksCache() {
    for (const [path, entry] of _bookmarksCache.entries()) {
        if (entry.monitor) {
            try {
                if (entry.monitorSignalId) {
                    entry.monitor.disconnect(entry.monitorSignalId);
                }
                entry.monitor.cancel();
            } catch (e) {}
        }
    }
    _bookmarksCache.clear();
}

/**
 * Returns the cached modification time (mtime) for a browser's bookmarks, or 0 if uncached.
 *
 * @param {string} browserType - 'brave-browser' | 'google-chrome' | 'chromium'
 * @param {string} [customPath] - Optional custom path for testing
 * @returns {number}
 */
export function getBookmarksCacheMtime(browserType = 'brave-browser', customPath = null) {
    const candidatePaths = _resolveBookmarkPaths(browserType, customPath);
    for (const path of candidatePaths) {
        if (_bookmarksCache.has(path)) {
            return _bookmarksCache.get(path).mtime || 0;
        }
    }
    return 0;
}

function _resolveBookmarkPaths(browserType = 'brave-browser', customPath = null) {
    if (customPath) return [customPath];

    const homeDir = GLib.get_home_dir();
    const typeLower = (browserType || '').toLowerCase();
    const candidatePaths = [];

    if (typeLower.includes('brave')) {
        candidatePaths.push(
            GLib.build_filenamev([homeDir, '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Bookmarks']),
            GLib.build_filenamev([homeDir, '.var', 'app', 'com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Bookmarks']),
            GLib.build_filenamev([homeDir, 'snap', 'brave', 'current', '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Bookmarks'])
        );
    } else if (typeLower.includes('chrome') || typeLower.includes('chromium')) {
        candidatePaths.push(
            GLib.build_filenamev([homeDir, '.config', 'google-chrome', 'Default', 'Bookmarks']),
            GLib.build_filenamev([homeDir, '.config', 'chromium', 'Default', 'Bookmarks']),
            GLib.build_filenamev([homeDir, '.var', 'app', 'com.google.Chrome', 'config', 'google-chrome', 'Default', 'Bookmarks']),
            GLib.build_filenamev([homeDir, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium', 'Default', 'Bookmarks'])
        );
    }
    return candidatePaths;
}

function _getFileMtime(file) {
    try {
        const info = file.query_info(Gio.FILE_ATTRIBUTE_TIME_MODIFIED, Gio.FileQueryInfoFlags.NONE, null);
        return info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED);
    } catch (e) {
        return 0;
    }
}

function _parseBookmarksJson(rawJson) {
    if (!rawJson || !rawJson.roots) {
        return { bookmarkBarItems: [], otherItems: [] };
    }

    const convertNode = node => {
        if (!node || typeof node !== 'object') return null;

        if (node.type === 'folder') {
            let children = Array.isArray(node.children) ? node.children.map(convertNode).filter(Boolean) : [];
            if (children.length > MAX_DYNAMIC_ITEMS) {
                children = children.slice(0, MAX_DYNAMIC_ITEMS);
                children.push(BOOKMARKS_MANAGER_ITEM);
            }
            return {
                label: node.name || 'Folder',
                items: children.length > 0 ? children : [{ label: 'Folder is Empty', sensitive: false }],
            };
        }

        if (node.type === 'url') {
            let label = node.name ? node.name.trim() : '';
            if (!label && node.url) {
                try {
                    const u = GLib.Uri.parse(node.url, GLib.UriFlags.NONE);
                    label = u.get_host()?.replace(/^www\./, '') || node.url;
                } catch (e) {
                    label = node.url;
                }
            }
            if (!label) label = 'Bookmark';
            return {
                label,
                url: node.url,
            };
        }

        return null;
    };

    let bookmarkBarItems = Array.isArray(rawJson.roots?.bookmark_bar?.children)
        ? rawJson.roots.bookmark_bar.children.map(convertNode).filter(Boolean)
        : [];
    if (bookmarkBarItems.length > MAX_DYNAMIC_ITEMS) {
        bookmarkBarItems = bookmarkBarItems.slice(0, MAX_DYNAMIC_ITEMS);
        bookmarkBarItems.push(BOOKMARKS_MANAGER_ITEM);
    }

    let otherItems = Array.isArray(rawJson.roots?.other?.children)
        ? rawJson.roots.other.children.map(convertNode).filter(Boolean)
        : [];
    if (otherItems.length > MAX_DYNAMIC_ITEMS) {
        otherItems = otherItems.slice(0, MAX_DYNAMIC_ITEMS);
        otherItems.push(BOOKMARKS_MANAGER_ITEM);
    }

    return { bookmarkBarItems, otherItems };
}

function _setupBookmarkFileMonitor(filePath, file) {
    const entry = _bookmarksCache.get(filePath);
    if (!entry || entry.monitor) return;

    try {
        const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        const signalId = monitor.connect('changed', (_mon, _f, _otherF, eventType) => {
            if (
                eventType === Gio.FileMonitorEvent.CHANGED ||
                eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                eventType === Gio.FileMonitorEvent.CREATED
            ) {
                file.load_contents_async(null, (source, res) => {
                    try {
                        const [ok, bytes] = source.load_contents_finish(res);
                        if (ok && bytes) {
                            const rawJson = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                            const parsed = _parseBookmarksJson(rawJson);
                            const currentEntry = _bookmarksCache.get(filePath);
                            if (currentEntry) {
                                currentEntry.data = parsed;
                                currentEntry.mtime = _getFileMtime(file);
                            }
                        }
                    } catch (e) {
                        console.warn(`[FUHGAWZ] Failed to reload bookmarks async: ${e}`);
                    }
                });
            }
        });
        entry.monitor = monitor;
        entry.monitorSignalId = signalId;
    } catch (e) {
        // Monitoring not supported in headless unit tests
    }
}

/**
 * Loads bookmarks from disk for Chromium-based browsers (Brave, Google Chrome, Chromium).
 * Uses in-memory caching and file modification checks.
 *
 * @param {string} browserType - 'brave-browser' | 'google-chrome' | 'chromium'
 * @param {string} [customPath] - Optional custom path for testing
 * @returns {{ bookmarkBarItems: Object[], otherItems: Object[] }}
 */
export function getBrowserBookmarks(browserType = 'brave-browser', customPath = null) {
    const candidatePaths = _resolveBookmarkPaths(browserType, customPath);

    let targetPath = null;
    let file = null;
    for (const path of candidatePaths) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            targetPath = path;
            file = Gio.File.new_for_path(path);
            break;
        }
    }

    if (!targetPath || !file) {
        return { bookmarkBarItems: [], otherItems: [] };
    }

    const mtime = _getFileMtime(file);
    if (_bookmarksCache.has(targetPath)) {
        const cached = _bookmarksCache.get(targetPath);
        if (cached.mtime && cached.mtime === mtime) {
            return cached.data;
        }
    }

    let rawJson = null;
    try {
        const [ok, bytes] = GLib.file_get_contents(targetPath);
        if (ok && bytes) {
            rawJson = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        }
    } catch (e) {
        console.warn(`[FUHGAWZ] Error parsing bookmarks at ${targetPath}: ${e.message}`);
    }

    const data = _parseBookmarksJson(rawJson);
    const existingEntry = _bookmarksCache.get(targetPath);
    if (existingEntry) {
        existingEntry.data = data;
        existingEntry.mtime = mtime;
    } else {
        _bookmarksCache.set(targetPath, {
            data,
            mtime,
            monitor: null,
            monitorSignalId: 0,
        });
        _setupBookmarkFileMonitor(targetPath, file);
    }

    return data;
}

/**
 * Asynchronously loads bookmarks from disk using Gio.File.load_contents_async().
 *
 * @param {string} browserType - 'brave-browser' | 'google-chrome' | 'chromium'
 * @param {string} [customPath] - Optional custom path for testing
 * @param {Gio.Cancellable} [cancellable] - Optional cancellable
 * @returns {Promise<{ bookmarkBarItems: Object[], otherItems: Object[] }>}
 */
export function loadBrowserBookmarksAsync(browserType = 'brave-browser', customPath = null, cancellable = null) {
    return new Promise(resolve => {
        const candidatePaths = _resolveBookmarkPaths(browserType, customPath);

        let targetPath = null;
        let file = null;
        for (const path of candidatePaths) {
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                targetPath = path;
                file = Gio.File.new_for_path(path);
                break;
            }
        }

        if (!targetPath || !file) {
            resolve({ bookmarkBarItems: [], otherItems: [] });
            return;
        }

        const mtime = _getFileMtime(file);
        if (_bookmarksCache.has(targetPath)) {
            const cached = _bookmarksCache.get(targetPath);
            if (cached.mtime && cached.mtime === mtime) {
                resolve(cached.data);
                return;
            }
        }

        file.load_contents_async(cancellable, (source, res) => {
            try {
                const [ok, bytes] = source.load_contents_finish(res);
                if (ok && bytes) {
                    const rawJson = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                    const data = _parseBookmarksJson(rawJson);
                    const existingEntry = _bookmarksCache.get(targetPath);
                    if (existingEntry) {
                        existingEntry.data = data;
                        existingEntry.mtime = mtime;
                    } else {
                        _bookmarksCache.set(targetPath, {
                            data,
                            mtime,
                            monitor: null,
                            monitorSignalId: 0,
                        });
                        _setupBookmarkFileMonitor(targetPath, file);
                    }
                    resolve(data);
                } else {
                    resolve({ bookmarkBarItems: [], otherItems: [] });
                }
            } catch (e) {
                console.warn(`[FUHGAWZ] Async bookmark load error: ${e}`);
                resolve({ bookmarkBarItems: [], otherItems: [] });
            }
        });
    });
}

/**
 * Recursively expands dynamic menu items in a profile (e.g. bookmarks-bar).
 *
 * @param {Object} profile - Profile to expand.
 * @param {string} [customBookmarksPath] - Optional override path for testing.
 * @returns {Object}
 */
export function expandDynamicProfileItems(profile, customBookmarksPath = null) {
    if (!profile || !profile.id) return profile;

    const profileId = (profile.id || '').toLowerCase();
    const isChromium = profileId.includes('brave') || profileId.includes('chrome') || profileId.includes('chromium');

    if (!isChromium) return profile;

    const { bookmarkBarItems, otherItems } = getBrowserBookmarks(profileId, customBookmarksPath);
    if (bookmarkBarItems.length === 0 && otherItems.length === 0) {
        return profile;
    }

    const expandItem = item => {
        if (!item || typeof item !== 'object') return item;
        const copy = { ...item };

        if (copy.dynamic === 'bookmarks-bar' || copy.dynamic === 'brave-bookmarks-bar' ||
            (copy.label === 'Bookmarks Bar' && (!copy.items || copy.items.length <= 1))) {
            const finalItems = bookmarkBarItems.length > 0
                ? [...bookmarkBarItems]
                : [{ label: 'Bookmarks Bar is Empty', sensitive: false }];

            if (otherItems.length > 0) {
                finalItems.push(
                    { type: 'separator' },
                    {
                        label: 'Other Bookmarks',
                        items: otherItems,
                    }
                );
            }
            copy.items = finalItems;
            return copy;
        }

        const subItems = copy.items || copy.submenu || copy.children;
        if (Array.isArray(subItems)) {
            const mapped = subItems.map(expandItem);
            if (copy.items) copy.items = mapped;
            if (copy.submenu) copy.submenu = mapped;
            if (copy.children) copy.children = mapped;
        }
        return copy;
    };

    const result = { ...profile };
    if (Array.isArray(result.menus)) {
        result.menus = result.menus.map(menu => ({
            ...menu,
            items: Array.isArray(menu.items) ? menu.items.map(expandItem) : [],
        }));
    }
    return result;
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
            const wmClass = (typeof metaWindow.get_wm_class === 'function' ? metaWindow.get_wm_class() : metaWindow.wm_class) || '';
            if (wmClass) candidates.push({ type: 'wm_class', value: wmClass.toLowerCase() });
            const inst = (typeof metaWindow.get_wm_class_instance === 'function' ? metaWindow.get_wm_class_instance() : metaWindow.wm_class_instance) || '';
            if (inst) candidates.push({ type: 'wm_class', value: inst.toLowerCase() });
        } catch (e) {}

        // 2. GTK Application ID / Sandboxed App ID
        try {
            const appId = (typeof metaWindow.get_gtk_application_id === 'function' ? metaWindow.get_gtk_application_id() : metaWindow.gtk_application_id) || '';
            if (appId) {
                const lower = appId.toLowerCase();
                candidates.push({ type: 'app_id', value: lower });
                if (lower.endsWith('.desktop')) {
                    candidates.push({ type: 'app_id', value: lower.slice(0, -8) });
                } else {
                    candidates.push({ type: 'app_id', value: `${lower}.desktop` });
                }
            }
            const sandboxedId = (typeof metaWindow.get_sandboxed_app_id === 'function' ? metaWindow.get_sandboxed_app_id() : metaWindow.sandboxed_app_id) || '';
            if (sandboxedId) {
                const sLower = sandboxedId.toLowerCase();
                candidates.push({ type: 'app_id', value: sLower });
                if (sLower.endsWith('.desktop')) {
                    candidates.push({ type: 'app_id', value: sLower.slice(0, -8) });
                } else {
                    candidates.push({ type: 'app_id', value: `${sLower}.desktop` });
                }
            }
            const waylandAppId = (typeof metaWindow.get_app_id === 'function' ? metaWindow.get_app_id() : metaWindow.app_id) || '';
            if (waylandAppId) {
                const wLower = waylandAppId.toLowerCase();
                candidates.push({ type: 'app_id', value: wLower });
                if (wLower.endsWith('.desktop')) {
                    candidates.push({ type: 'app_id', value: wLower.slice(0, -8) });
                } else {
                    candidates.push({ type: 'app_id', value: `${wLower}.desktop` });
                }
            }
            const appObjPath = (typeof metaWindow.get_gtk_application_object_path === 'function' ? metaWindow.get_gtk_application_object_path() : metaWindow.gtk_application_object_path) || '';
            if (appObjPath && appObjPath.startsWith('/')) {
                const pathId = appObjPath.slice(1).replace(/\//g, '.');
                if (pathId && !pathId.startsWith('org.gtk.Application')) {
                    const pLower = pathId.toLowerCase();
                    candidates.push({ type: 'app_id', value: pLower });
                    if (pLower.endsWith('.desktop')) {
                        candidates.push({ type: 'app_id', value: pLower.slice(0, -8) });
                    } else {
                        candidates.push({ type: 'app_id', value: `${pLower}.desktop` });
                    }
                }
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
                        const lower = appId.toLowerCase();
                        candidates.push({ type: 'app_id', value: lower });
                        if (lower.endsWith('.desktop')) {
                            candidates.push({ type: 'app_id', value: lower.slice(0, -8) });
                        } else {
                            candidates.push({ type: 'app_id', value: `${lower}.desktop` });
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
                        const lower = appId.toLowerCase();
                        candidates.push({ type: 'app_id', value: lower });
                        if (lower.endsWith('.desktop')) {
                            candidates.push({ type: 'app_id', value: lower.slice(0, -8) });
                        } else {
                            candidates.push({ type: 'app_id', value: `${lower}.desktop` });
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
        clearBookmarksCache();
    }
}
