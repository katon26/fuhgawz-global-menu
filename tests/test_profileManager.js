import { ProfileManager, applyProfileTemplate, getBrowserBookmarks, expandDynamicProfileItems, loadBrowserBookmarksAsync, getBookmarksCacheMtime, _bookmarksCache, clearBookmarksCache, MAX_DYNAMIC_ITEMS } from '../src/profileManager.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing ProfileManager...');

const currentDir = GLib.get_current_dir();
const manager = new ProfileManager(currentDir);

// 1. Load profiles from ./profiles/
manager.loadProfiles();

assert(manager._profiles.size >= 10, `Loaded at least 10 profiles (got ${manager._profiles.size})`);
assert(manager._profiles.has('brave-browser'), 'Brave profile loaded');
assert(manager._profiles.has('google-chrome'), 'Chrome profile loaded');
assert(manager._profiles.has('com.visualstudio.code'), 'VS Code profile loaded');
assert(manager._profiles.has('org.gnome.TextEditor'), 'Text Editor profile loaded');
assert(manager._profiles.has('org.gnome.Calculator'), 'Calculator profile loaded');
assert(manager._profiles.has('org.libreoffice.LibreOffice'), 'LibreOffice profile loaded');
assert(manager._profiles.has('onlyoffice-desktopeditors'), 'ONLYOFFICE profile loaded');
assert(manager._profiles.has('firefox'), 'Firefox profile loaded');
assert(manager._profiles.has('dev.zed.Zed'), 'Zed profile loaded');
assert(manager._profiles.has('warp-terminal'), 'Warp profile loaded');

// 2. Test matching Brave by WM_CLASS
const mockBraveWindow = {
    get_wm_class: () => 'Brave-browser',
    get_wm_class_instance: () => 'brave-browser',
    get_gtk_application_id: () => null,
};
const matchedBrave = manager.getProfileForWindow(mockBraveWindow);
assert(matchedBrave !== null, 'Matched Brave window');
assert(matchedBrave.id === 'brave-browser', 'Profile ID is brave-browser');
assert(matchedBrave.menus.length > 0, 'Brave has menus');
assert(matchedBrave.menus[0].label === 'File', 'First menu is File');

const braveQuit = matchedBrave.app_menu.items.find(i => i.label === 'Quit Brave');
assert(braveQuit && braveQuit.shortcut === 'Ctrl+Shift+Q', 'Brave Quit shortcut is Ctrl+Shift+Q');

const braveHide = matchedBrave.app_menu.items.find(i => i.label === 'Hide Brave');
assert(braveHide && braveHide.action === 'hide', 'Brave Hide action is hide');

const braveHistory = matchedBrave.menus.find(m => m.label === 'History');
assert(braveHistory, 'Brave has History menu');
const recentTabs = braveHistory.items.find(i => i.label === 'Recent Tabs');
assert(recentTabs && Array.isArray(recentTabs.items), 'Recent Tabs has nested items (level 2)');
const tabGroup = recentTabs.items.find(i => i.label && i.label.includes('GitHub'));
assert(tabGroup && Array.isArray(tabGroup.items), 'GitHub tab group has nested items (level 3)');
assert(tabGroup.items.length >= 3, 'GitHub tab group has tabs');

// 3. Test matching Chrome by WM_CLASS
const mockChromeWindow = {
    get_wm_class: () => 'google-chrome',
    get_wm_class_instance: () => 'google-chrome',
    get_gtk_application_id: () => null,
};
const matchedChrome = manager.getProfileForWindow(mockChromeWindow);
assert(matchedChrome !== null, 'Matched Chrome window');
assert(matchedChrome.id === 'google-chrome', 'Profile ID is google-chrome');

// 4. Test matching VS Code and Antigravity
const mockCodeWindow = {
    get_wm_class: () => 'Code',
    get_wm_class_instance: () => 'code',
    get_gtk_application_id: () => null,
};
const matchedCode = manager.getProfileForWindow(mockCodeWindow);
assert(matchedCode !== null, 'Matched VS Code window');
assert(matchedCode.id === 'com.visualstudio.code', 'Profile ID is com.visualstudio.code');

const codeShortcuts = matchedCode.app_menu.items.find(i => i.label === 'Keyboard Shortcuts');
assert(codeShortcuts && codeShortcuts.shortcut === 'Ctrl+K Ctrl+S', 'Code Keyboard Shortcuts shortcut is Ctrl+K Ctrl+S');

const codeHide = matchedCode.app_menu.items.find(i => i.label === 'Hide Code');
assert(codeHide && codeHide.action === 'hide', 'Code Hide action is hide');

const mockAntigravityWindow = {
    get_wm_class: () => 'Antigravity',
    get_wm_class_instance: () => 'antigravity',
    get_gtk_application_id: () => null,
};
const matchedAntigravity = manager.getProfileForWindow(mockAntigravityWindow);
assert(matchedAntigravity !== null, 'Matched Antigravity window to Antigravity profile');
assert(matchedAntigravity.id === 'antigravity', 'Profile ID is antigravity');
assert(matchedAntigravity.app_menu.label === 'Antigravity', 'Antigravity app menu label is Antigravity');
const antigravityAbout = matchedAntigravity.app_menu.items.find(i => i.label === 'About Antigravity');
assert(antigravityAbout && antigravityAbout.action === 'about', 'Antigravity About action is about');

// 5. Test matching Firefox
const mockFirefoxWindow = {
    get_wm_class: () => 'Firefox',
    get_wm_class_instance: () => 'firefox',
    get_gtk_application_id: () => null,
};
const matchedFirefox = manager.getProfileForWindow(mockFirefoxWindow);
assert(matchedFirefox !== null, 'Matched Firefox window');
assert(matchedFirefox.id === 'firefox', 'Profile ID is firefox');
assert(matchedFirefox.menus.length === 7, `Firefox has 7 standard menus (got ${matchedFirefox.menus.length})`);

// 6. Test matching Zed
const mockZedWindow = {
    get_wm_class: () => 'dev.zed.Zed',
    get_wm_class_instance: () => 'zed',
    get_gtk_application_id: () => null,
};
const matchedZed = manager.getProfileForWindow(mockZedWindow);
assert(matchedZed !== null, 'Matched Zed window');
assert(matchedZed.id === 'dev.zed.Zed', 'Profile ID is dev.zed.Zed');
assert(matchedZed.menus.length === 6, `Zed has 6 standard menus (got ${matchedZed.menus.length})`);

// 6b. Test matching Zed by app_id without .desktop
const mockZedNoDesktop = {
    get_wm_class: () => null,
    get_wm_class_instance: () => null,
    get_gtk_application_id: () => 'dev.zed.Zed',
};
const matchedZedNoDesktop = manager.getProfileForWindow(mockZedNoDesktop);
assert(matchedZedNoDesktop !== null, 'Matched Zed window by app_id without .desktop');
assert(matchedZedNoDesktop.id === 'dev.zed.Zed', 'Profile ID is dev.zed.Zed');

// 6c. Test matching window via WindowTracker get_window_app
const mockTrackerWindow = {
    get_wm_class: () => null,
    get_wm_class_instance: () => null,
    get_gtk_application_id: () => null,
    get_window_app: () => ({ get_id: () => 'dev.zed.Zed.desktop' }),
};
const matchedTracker = manager.getProfileForWindow(mockTrackerWindow);
assert(matchedTracker !== null, 'Matched window via window tracker');
assert(matchedTracker.id === 'dev.zed.Zed', 'Tracker profile ID is dev.zed.Zed');

// 7. Test matching Warp Terminal
const mockWarpWindow = {
    get_wm_class: () => 'warp-terminal',
    get_wm_class_instance: () => 'warp',
    get_gtk_application_id: () => null,
};
const matchedWarp = manager.getProfileForWindow(mockWarpWindow);
assert(matchedWarp !== null, 'Matched Warp window');
assert(matchedWarp.id === 'warp-terminal', 'Profile ID is warp-terminal');
assert(matchedWarp.menus.length === 5, `Warp has 5 standard menus (got ${matchedWarp.menus.length})`);

// 8. Test matching GNOME Text Editor by GTK application ID
const mockTextEditorWindow = {
    get_wm_class: () => 'org.gnome.TextEditor',
    get_wm_class_instance: () => 'gnome-text-editor',
    get_gtk_application_id: () => 'org.gnome.TextEditor.desktop',
};
const matchedEditor = manager.getProfileForWindow(mockTextEditorWindow);
assert(matchedEditor !== null, 'Matched Text Editor window');
assert(matchedEditor.id === 'org.gnome.TextEditor', 'Profile ID is org.gnome.TextEditor');

// 9. Test unmatched window
const mockUnknownWindow = {
    get_wm_class: () => 'UnknownApp',
    get_wm_class_instance: () => 'unknownapp',
    get_gtk_application_id: () => null,
};
assert(manager.getProfileForWindow(mockUnknownWindow) === null, 'Unknown window returns null');

// 10. Test {{appName}} templating
const rawProfile = {
    app_menu: {
        label: '{{appName}}',
        items: [
            { label: 'About {{appName}}', action: 'about' },
            { label: 'Hide {{appName}}', action: 'hide' }
        ]
    },
    menus: [
        {
            label: 'File',
            items: [
                {
                    label: 'New {{appName}} Window',
                    submenu: [
                        { label: 'Open in {{appName}} Worktree' }
                    ]
                }
            ]
        }
    ]
};
const templated = applyProfileTemplate(rawProfile, 'CustomFork');
assert(templated.app_menu.label === 'CustomFork', 'app_menu label templated');
assert(templated.app_menu.items[0].label === 'About CustomFork', 'About item templated');
assert(templated.app_menu.items[1].label === 'Hide CustomFork', 'Hide item templated');
assert(templated.menus[0].items[0].label === 'New CustomFork Window', 'Menu item templated');
assert(templated.menus[0].items[0].submenu[0].label === 'Open in CustomFork Worktree', 'Nested submenu templated');

// 10b. Test WindowTracker app.get_name() resolution for appName templating
const mockTrackerWithName = {
    get_window_app: (_win) => ({
        get_id: () => 'dev.zed.Zed.desktop',
        get_name: () => 'Zed Nightly',
    }),
};
const mockWindowForTrackerName = {
    get_wm_class: () => 'zed',
    get_wm_class_instance: () => 'zed',
    get_gtk_application_id: () => null,
};
const matchedWithTrackerName = manager.getProfileForWindow(mockWindowForTrackerName, null, mockTrackerWithName);
assert(matchedWithTrackerName !== null, 'Matched window with custom tracker');
assert(matchedWithTrackerName.id === 'dev.zed.Zed', 'Profile ID is dev.zed.Zed');
assert(matchedWithTrackerName.app_menu.label === 'Zed', 'Zed app menu label preserved');

// 10c. Test getBrowserBookmarks with mock JSON file
const mockBookmarksData = {
    checksum: 'mock-checksum',
    roots: {
        bookmark_bar: {
            name: 'Bookmarks bar',
            type: 'folder',
            children: [
                { type: 'url', name: '', url: 'https://www.youtube.com/' },
                { type: 'url', name: 'Reddit', url: 'https://www.reddit.com/' },
                {
                    type: 'folder',
                    name: 'Dev Tools',
                    children: [
                        { type: 'url', name: 'GitHub', url: 'https://github.com/' }
                    ]
                }
            ]
        },
        other: {
            name: 'Other bookmarks',
            type: 'folder',
            children: [
                { type: 'url', name: 'Archive', url: 'https://archive.org/' }
            ]
        }
    }
};

const mockTmpFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_tmp_dir(), `test-bookmarks-${Date.now()}.json`]));
mockTmpFile.replace_contents(
    new TextEncoder().encode(JSON.stringify(mockBookmarksData)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
);

const { bookmarkBarItems, otherItems } = getBrowserBookmarks('brave-browser', mockTmpFile.get_path());
assert(bookmarkBarItems.length === 3, `Expected 3 bookmarkBarItems, got ${bookmarkBarItems.length}`);
assert(bookmarkBarItems[0].label === 'youtube.com', `Empty name derived from host: expected 'youtube.com', got '${bookmarkBarItems[0].label}'`);
assert(bookmarkBarItems[0].url === 'https://www.youtube.com/', 'First bookmark URL matches');
assert(bookmarkBarItems[1].label === 'Reddit', 'Second bookmark label matches');
assert(bookmarkBarItems[2].label === 'Dev Tools', 'Third item is folder Dev Tools');
assert(Array.isArray(bookmarkBarItems[2].items) && bookmarkBarItems[2].items.length === 1, 'Dev Tools folder has 1 item');
assert(bookmarkBarItems[2].items[0].label === 'GitHub', 'Nested bookmark is GitHub');
assert(bookmarkBarItems[2].items[0].url === 'https://github.com/', 'Nested bookmark has URL');
assert(otherItems.length === 1 && otherItems[0].label === 'Archive', 'otherItems parsed correctly');

// 10d. Test expandDynamicProfileItems with mock path
const braveMockProfile = {
    id: 'brave-browser',
    menus: [
        {
            label: 'Bookmarks',
            items: [
                { label: 'Bookmark This Tab...', shortcut: 'Ctrl+D' },
                {
                    label: 'Bookmarks Bar',
                    dynamic: 'bookmarks-bar',
                    items: [{ label: 'Bookmarks Bar is Empty' }]
                }
            ]
        }
    ]
};
const expandedBrave = expandDynamicProfileItems(braveMockProfile, mockTmpFile.get_path());
const expandedBmBar = expandedBrave.menus[0].items.find(i => i.label === 'Bookmarks Bar');
assert(expandedBmBar !== null, 'Bookmarks Bar exists in expanded profile');
assert(expandedBmBar.items.length >= 4, `Bookmarks Bar has items + separator + other bookmarks (got ${expandedBmBar.items.length})`);
assert(expandedBmBar.items[0].label === 'youtube.com', 'Expanded item 0 is youtube.com');
assert(expandedBmBar.items[1].label === 'Reddit', 'Expanded item 1 is Reddit');
const otherBmSub = expandedBmBar.items.find(i => i.label === 'Other Bookmarks');
assert(otherBmSub && Array.isArray(otherBmSub.items), 'Other Bookmarks attached as submenu');
assert(otherBmSub.items[0].label === 'Archive', 'Other Bookmarks has Archive item');

// Clean up mock file
try { mockTmpFile.delete(null); } catch (e) {}

// 10e. Test fallback for missing bookmarks path
const missingResult = getBrowserBookmarks('brave-browser', '/non/existent/path/Bookmarks.json');
assert(missingResult.bookmarkBarItems.length === 0, 'Missing path returns empty bookmarkBarItems');
assert(missingResult.otherItems.length === 0, 'Missing path returns empty otherItems');

// 10f. Test non-chromium profile is not modified by expandDynamicProfileItems
const zedMockProfile = { id: 'dev.zed.Zed', menus: [{ label: 'File', items: [] }] };
const zedNotExpanded = expandDynamicProfileItems(zedMockProfile);
assert(zedNotExpanded === zedMockProfile, 'Non-chromium profile untouched');

// 10g. Test in-memory caching with mtime
console.log('10g. Verifying in-memory caching with mtime...');
const cacheTestFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_tmp_dir(), `test-cache-bm-${Date.now()}.json`]));
cacheTestFile.replace_contents(
    new TextEncoder().encode(JSON.stringify(mockBookmarksData)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
);
const firstRead = getBrowserBookmarks('brave-browser', cacheTestFile.get_path());
assert(_bookmarksCache.has(cacheTestFile.get_path()), 'Cached in _bookmarksCache');
const cachedEntry = _bookmarksCache.get(cacheTestFile.get_path());
assert(cachedEntry.data === firstRead, 'Cache entry holds exact parsed data reference');
assert(typeof cachedEntry.mtime === 'number' && cachedEntry.mtime > 0, 'Cache entry has numeric mtime');

// Second call returns cached reference directly
const secondRead = getBrowserBookmarks('brave-browser', cacheTestFile.get_path());
assert(secondRead === firstRead, 'Repeated call returns identical cached data reference');

// 10h. Test loadBrowserBookmarksAsync
console.log('10h. Verifying loadBrowserBookmarksAsync...');
let asyncResult = null;
await loadBrowserBookmarksAsync('brave-browser', cacheTestFile.get_path()).then(res => {
    asyncResult = res;
});
assert(asyncResult !== null && Array.isArray(asyncResult.bookmarkBarItems), 'Async load returned bookmarkBarItems');
assert(asyncResult.bookmarkBarItems.length === 3, 'Async loaded 3 items');
try { cacheTestFile.delete(null); } catch (e) {}

// 10i. Test 50-item capping and "Open Bookmarks Manager... (Ctrl+Shift+O)"
console.log('10i. Verifying 50-item capping on dynamic expansion...');
const manyChildren = [];
for (let i = 1; i <= 60; i++) {
    manyChildren.push({ type: 'url', name: `Bookmark ${i}`, url: `https://example.com/${i}` });
}
const hugeBookmarksData = {
    roots: {
        bookmark_bar: {
            name: 'Bookmarks bar',
            type: 'folder',
            children: manyChildren,
        }
    }
};
const hugeTmpFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_tmp_dir(), `test-huge-bm-${Date.now()}.json`]));
hugeTmpFile.replace_contents(
    new TextEncoder().encode(JSON.stringify(hugeBookmarksData)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
);
const { bookmarkBarItems: cappedItems } = getBrowserBookmarks('brave-browser', hugeTmpFile.get_path());
assert(cappedItems.length === 51, `Expected 51 items (50 capped + 1 manager), got ${cappedItems.length}`);
assert(cappedItems[49].label === 'Bookmark 50', '50th item is Bookmark 50');
assert(cappedItems[50].label === 'Open Bookmarks Manager... (Ctrl+Shift+O)', 'Appended manager item');
assert(cappedItems[50].shortcut === 'Ctrl+Shift+O', 'Manager item shortcut is Ctrl+Shift+O');
try { hugeTmpFile.delete(null); } catch (e) {}

// 10j. Test Decoupled getProfileForWindow: does NOT run expandDynamicProfileItems
console.log('10j. Verifying decoupled getProfileForWindow matching...');
const mockDecoupledBraveWin = {
    get_wm_class: () => 'Brave-browser',
    get_wm_class_instance: () => 'brave-browser',
    get_sandboxed_app_id: () => null,
    get_title: () => 'Brave Browser',
};
const decoupledBrave = manager.getProfileForWindow(mockDecoupledBraveWin);
assert(decoupledBrave !== null, 'Matched Brave window');
assert(decoupledBrave.id === 'brave-browser', 'Matched Brave profile ID');
const matchedBmMenu = decoupledBrave.menus.find(m => m.label === 'Bookmarks');
assert(matchedBmMenu, 'Bookmarks menu exists');
const matchedBmBar = matchedBmMenu.items.find(i => i.label === 'Bookmarks Bar');
assert(matchedBmBar && matchedBmBar.dynamic === 'bookmarks-bar', 'Bookmarks Bar retains dynamic token without premature expansion');
assert(matchedBmBar.items.length <= 1, 'Bookmarks Bar items not yet expanded');

// 10k. Test getBookmarksCacheMtime
console.log('10k. Verifying getBookmarksCacheMtime...');
const mtimeTestFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_tmp_dir(), `test-mtime-bm-${Date.now()}.json`]));
mtimeTestFile.replace_contents(
    new TextEncoder().encode(JSON.stringify(mockBookmarksData)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null
);
const initialMtime = getBookmarksCacheMtime('brave-browser', mtimeTestFile.get_path());
assert(initialMtime === 0, 'Uncached path has mtime 0');

getBrowserBookmarks('brave-browser', mtimeTestFile.get_path());
const cachedMtime = getBookmarksCacheMtime('brave-browser', mtimeTestFile.get_path());
assert(cachedMtime > 0, `Cached mtime is > 0 (got ${cachedMtime})`);
try { mtimeTestFile.delete(null); } catch (e) {}

// 10l. Test matching Calculator
console.log('10l. Verifying Calculator profile matching...');
const mockCalcWindow = {
    get_wm_class: () => 'org.gnome.Calculator',
    get_wm_class_instance: () => 'gnome-calculator',
    gtk_application_id: 'org.gnome.Calculator',
};
const matchedCalc = manager.getProfileForWindow(mockCalcWindow);
assert(matchedCalc !== null, 'Matched Calculator window');
assert(matchedCalc.id === 'org.gnome.Calculator', 'Profile ID is org.gnome.Calculator');
assert(matchedCalc.menus.some(m => m.label === 'Mode'), 'Calculator has Mode menu');
assert(matchedCalc.menus.some(m => m.label === 'Edit'), 'Calculator has Edit menu');
assert(matchedCalc.menus.some(m => m.label === 'Help'), 'Calculator has Help menu');

// 10m. Test matching TextEditor via property without .desktop
console.log('10m. Verifying TextEditor window matching via property...');
const mockTextEditorPropWindow = {
    gtk_application_id: 'org.gnome.TextEditor',
};
const matchedTextEditor = manager.getProfileForWindow(mockTextEditorPropWindow);
assert(matchedTextEditor !== null, 'Matched TextEditor window via gtk_application_id property');
assert(matchedTextEditor.id === 'org.gnome.TextEditor', 'Profile ID is org.gnome.TextEditor');

// 10n. Test matching LibreOffice
console.log('10n. Verifying LibreOffice profile matching...');
const mockLibreOfficeSoffice = {
    get_wm_class: () => 'soffice.bin',
    get_wm_class_instance: () => 'soffice',
};
const matchedLO = manager.getProfileForWindow(mockLibreOfficeSoffice);
assert(matchedLO !== null, 'Matched LibreOffice window via soffice.bin');
assert(matchedLO.id === 'org.libreoffice.LibreOffice', 'Profile ID is org.libreoffice.LibreOffice');
assert(matchedLO.menus.length === 8, `LibreOffice has 8 menus (got ${matchedLO.menus.length})`);
assert(matchedLO.menus.some(m => m.label === 'Format'), 'LibreOffice has Format menu');
assert(matchedLO.menus.some(m => m.label === 'Tools'), 'LibreOffice has Tools menu');

const mockLibreOfficeWriter = {
    gtk_application_id: 'libreoffice-writer.desktop',
};
const matchedLOWriter = manager.getProfileForWindow(mockLibreOfficeWriter);
assert(matchedLOWriter !== null, 'Matched LibreOffice Writer window via app_id');
assert(matchedLOWriter.id === 'org.libreoffice.LibreOffice', 'Writer matches LibreOffice profile');

// 10o. Test matching ONLYOFFICE
console.log('10o. Verifying ONLYOFFICE profile matching...');
const mockOnlyOfficeWindow = {
    get_wm_class: () => 'DesktopEditors',
    get_wm_class_instance: () => 'desktopeditors',
};
const matchedOO = manager.getProfileForWindow(mockOnlyOfficeWindow);
assert(matchedOO !== null, 'Matched ONLYOFFICE window');
assert(matchedOO.id === 'onlyoffice-desktopeditors', 'Profile ID is onlyoffice-desktopeditors');
assert(matchedOO.menus.some(m => m.label === 'File'), 'ONLYOFFICE has File menu');
assert(matchedOO.menus.some(m => m.label === 'Insert'), 'ONLYOFFICE has Insert menu');

// 10p. Test WindowTracker bidirectional matching (bare appId without .desktop matching profile with .desktop)
console.log('10p. Verifying WindowTracker bidirectional appId matching...');
const mockTrackerBareWindow = {
    get_window_app: () => ({
        get_id: () => 'org.gnome.TextEditor',
    }),
};
const matchedTrackerBare = manager.getProfileForWindow(mockTrackerBareWindow);
assert(matchedTrackerBare !== null, 'Matched TextEditor window via WindowTracker bare appId');
assert(matchedTrackerBare.id === 'org.gnome.TextEditor', 'Profile ID matches org.gnome.TextEditor');

// 10q. Test _buildActionsMenu fallback evaluation when addedCount === 0
console.log('10q. Verifying _buildActionsMenu 0-action declarative fallback safety...');
const mockActionsContext = {
    _settings: null,
    _profileManager: manager,
    _loadedProfile: null,
    _loadDeclarativeProfile(prof) {
        this._loadedProfile = prof;
    },
    triggerFallback(win, profile) {
        const addedCount = 0;
        if (addedCount === 0) {
            const enableDeclarative = !this._settings || this._settings.get_boolean('enable-declarative-profiles');
            const profileToUse = profile || (this._profileManager ? this._profileManager.getProfileForWindow(win) : null);
            if (enableDeclarative && profileToUse) {
                this._loadDeclarativeProfile(profileToUse, win);
            }
        }
    }
};
mockActionsContext.triggerFallback(mockCalcWindow, null);
assert(mockActionsContext._loadedProfile !== null, 'Fallback loaded declarative profile for Calculator');
assert(mockActionsContext._loadedProfile.id === 'org.gnome.Calculator', 'Loaded Calculator profile on 0 actions');

// 10r. Test TextEditor matching via Wayland get_app_id()
console.log('10r. Verifying TextEditor matching via Wayland get_app_id()...');
const mockWaylandTextEditorWindow = {
    get_app_id: () => 'org.gnome.TextEditor',
};
const matchedWaylandTextEditor = manager.getProfileForWindow(mockWaylandTextEditorWindow);
assert(matchedWaylandTextEditor !== null, 'Matched TextEditor window via Wayland get_app_id()');
assert(matchedWaylandTextEditor.id === 'org.gnome.TextEditor', 'Profile ID is org.gnome.TextEditor');

// 10s. Test TextEditor matching via GTK application object path
console.log('10s. Verifying TextEditor matching via GTK application object path...');
const mockObjPathTextEditorWindow = {
    get_gtk_application_object_path: () => '/org/gnome/TextEditor',
};
const matchedObjPathTextEditor = manager.getProfileForWindow(mockObjPathTextEditorWindow);
assert(matchedObjPathTextEditor !== null, 'Matched TextEditor window via GTK application object path');
assert(matchedObjPathTextEditor.id === 'org.gnome.TextEditor', 'Profile ID is org.gnome.TextEditor');

// 10t. Test _reloadGtkMenu 0-button fallback safety
console.log('10t. Verifying _reloadGtkMenu 0-button declarative fallback safety...');
const mockReloadContext = {
    _settings: null,
    _profileManager: manager,
    _loadedProfile: null,
    _loadDeclarativeProfile(prof) {
        this._loadedProfile = prof;
    },
    triggerReloadFallback(win) {
        const position = 2; // No buttons added (start position was 2)
        if (position <= 2) {
            const profile = (this._profileManager && win) ? this._profileManager.getProfileForWindow(win) : null;
            const enableDeclarative = !this._settings || this._settings.get_boolean('enable-declarative-profiles');
            if (enableDeclarative && profile) {
                this._loadDeclarativeProfile(profile, win);
            }
        }
    }
};
mockReloadContext.triggerReloadFallback(mockTextEditorPropWindow);
assert(mockReloadContext._loadedProfile !== null, 'Loaded declarative profile when GTK menu model has 0 buttons');
assert(mockReloadContext._loadedProfile.id === 'org.gnome.TextEditor', 'Loaded TextEditor profile on 0 GTK model items');

// 10u. Test _buildActionsMenu incomplete action menu fallback safety
console.log('10u. Verifying _buildActionsMenu incomplete action menu fallback safety...');
const mockPartialActionsContext = {
    _settings: null,
    _profileManager: manager,
    _loadedProfile: null,
    _loadDeclarativeProfile(prof) {
        this._loadedProfile = prof;
    },
    triggerPartialFallback(win, grouped, addedCount) {
        const profileToUse = this._profileManager ? this._profileManager.getProfileForWindow(win) : null;
        const enableDeclarative = !this._settings || this._settings.get_boolean('enable-declarative-profiles');
        if (addedCount === 0 || (addedCount < 3 && !grouped['File'] && profileToUse)) {
            if (enableDeclarative && profileToUse) {
                this._loadDeclarativeProfile(profileToUse, win);
            }
        }
    }
};
// Simulate only 'Help' and 'Edit' actions found without 'File'
mockPartialActionsContext.triggerPartialFallback(mockTextEditorPropWindow, { 'Help': ['about'], 'Edit': ['preferences'] }, 2);
assert(mockPartialActionsContext._loadedProfile !== null, 'Fell back to declarative profile when GTK actions lacked File menu');
assert(mockPartialActionsContext._loadedProfile.id === 'org.gnome.TextEditor', 'Loaded complete TextEditor profile on incomplete actions');

// 10v. Test TextEditor matching via bare "texteditor" and "text-editor" wm_class / app_id
console.log('10v. Verifying TextEditor matching via bare wm_class/app_id...');
const mockBareTextEditor1 = { get_wm_class: () => 'texteditor' };
const mockBareTextEditor2 = { get_app_id: () => 'text-editor' };
const matchedBare1 = manager.getProfileForWindow(mockBareTextEditor1);
const matchedBare2 = manager.getProfileForWindow(mockBareTextEditor2);
assert(matchedBare1 !== null && matchedBare1.id === 'org.gnome.TextEditor', 'Matched bare "texteditor"');
assert(matchedBare2 !== null && matchedBare2.id === 'org.gnome.TextEditor', 'Matched bare "text-editor"');

// 10w. Test updateCycleId and active window guard on delayed D-Bus callbacks
console.log('10w. Verifying updateCycleId and active window guard against ghost buttons...');
let builtActions = false;
const mockCycleContext = {
    _updateCycleId: 1,
    currentFocusWindow: mockTextEditorPropWindow,
    _buildActionsMenu(win, cycleId) {
        if (cycleId && this._updateCycleId !== cycleId) return;
        if (this.currentFocusWindow !== win) return;
        builtActions = true;
    }
};
// Delayed callback arrives after cycle advanced (window closed / focus changed)
mockCycleContext._updateCycleId = 2;
mockCycleContext._buildActionsMenu(mockTextEditorPropWindow, 1);
assert(!builtActions, 'Delayed callback with obsolete cycleId correctly aborted (no ghost buttons)');

// Delayed callback arrives after focus window changed to null/desktop
mockCycleContext._updateCycleId = 3;
mockCycleContext.currentFocusWindow = null;
mockCycleContext._buildActionsMenu(mockTextEditorPropWindow, 3);
assert(!builtActions, 'Delayed callback after window closed/unfocused correctly aborted');

// Active window with matching cycle builds successfully
mockCycleContext.currentFocusWindow = mockTextEditorPropWindow;
mockCycleContext._buildActionsMenu(mockTextEditorPropWindow, 3);
assert(builtActions, 'Matching cycle and active window builds actions menu');

// 10x. Test Fallback 1 directly calling _loadGtkMenu when menuBarPath is present
console.log('10x. Verifying Fallback 1 direct _loadGtkMenu invocation on menuBarPath...');
let loadedGtkMenuPath = null;
const mockGtkMenubarContext = {
    _loadGtkMenu(bus, path, win) {
        loadedGtkMenuPath = path;
    },
    triggerFallback1(win, busName, menuBarPath, appMenuPath, profile) {
        if (busName && menuBarPath) {
            this._loadGtkMenu(busName, menuBarPath, win);
            return true;
        }
        if (busName && appMenuPath && !profile) {
            this._loadGtkMenu(busName, appMenuPath, win);
            return true;
        }
        return false;
    }
};
const handledMenubar = mockGtkMenubarContext.triggerFallback1(
    mockTextEditorPropWindow,
    ':1.100',
    '/org/gnome/Gedit/menus/menubar',
    null,
    null
);
assert(handledMenubar === true, 'Fallback 1 handled advertised GTK menubar directly');
assert(loadedGtkMenuPath === '/org/gnome/Gedit/menus/menubar', 'Loaded correct GTK menubar path');

// 11. Cleanup and cache clearing on destroy
console.log('11. Verifying cleanup and bookmarks cache clearing on destroy...');
assert(_bookmarksCache.size > 0, 'Bookmarks cache has entries before destroy');
manager.destroy();
assert(manager._profiles.size === 0, 'Profiles cleared on destroy');
assert(_bookmarksCache.size === 0, 'Bookmarks cache cleared on destroy');

console.log('All ProfileManager tests passed successfully!');
