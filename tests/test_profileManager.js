import { ProfileManager } from '../src/profileManager.js';
import GLib from 'gi://GLib';

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

assert(manager._profiles.size >= 7, `Loaded at least 7 profiles (got ${manager._profiles.size})`);
assert(manager._profiles.has('brave-browser'), 'Brave profile loaded');
assert(manager._profiles.has('google-chrome'), 'Chrome profile loaded');
assert(manager._profiles.has('com.visualstudio.code'), 'VS Code profile loaded');
assert(manager._profiles.has('org.gnome.TextEditor'), 'Text Editor profile loaded');
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
assert(matchedAntigravity !== null, 'Matched Antigravity window to VS Code profile');
assert(matchedAntigravity.id === 'com.visualstudio.code', 'Profile ID is com.visualstudio.code');

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

// 10. Cleanup
manager.destroy();
assert(manager._profiles.size === 0, 'Profiles cleared on destroy');

console.log('All ProfileManager tests passed successfully!');
