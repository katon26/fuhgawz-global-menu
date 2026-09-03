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

assert(manager._profiles.size >= 4, `Loaded at least 4 profiles (got ${manager._profiles.size})`);
assert(manager._profiles.has('brave-browser'), 'Brave profile loaded');
assert(manager._profiles.has('google-chrome'), 'Chrome profile loaded');
assert(manager._profiles.has('com.visualstudio.code'), 'VS Code profile loaded');
assert(manager._profiles.has('org.gnome.TextEditor'), 'Text Editor profile loaded');

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

// 3. Test matching Chrome by WM_CLASS
const mockChromeWindow = {
    get_wm_class: () => 'google-chrome',
    get_wm_class_instance: () => 'google-chrome',
    get_gtk_application_id: () => null,
};
const matchedChrome = manager.getProfileForWindow(mockChromeWindow);
assert(matchedChrome !== null, 'Matched Chrome window');
assert(matchedChrome.id === 'google-chrome', 'Profile ID is google-chrome');

// 4. Test matching VS Code
const mockCodeWindow = {
    get_wm_class: () => 'Code',
    get_wm_class_instance: () => 'code',
    get_gtk_application_id: () => null,
};
const matchedCode = manager.getProfileForWindow(mockCodeWindow);
assert(matchedCode !== null, 'Matched VS Code window');
assert(matchedCode.id === 'com.visualstudio.code', 'Profile ID is com.visualstudio.code');

// 5. Test matching GNOME Text Editor by GTK application ID
const mockTextEditorWindow = {
    get_wm_class: () => 'org.gnome.TextEditor',
    get_wm_class_instance: () => 'gnome-text-editor',
    get_gtk_application_id: () => 'org.gnome.TextEditor.desktop',
};
const matchedEditor = manager.getProfileForWindow(mockTextEditorWindow);
assert(matchedEditor !== null, 'Matched Text Editor window');
assert(matchedEditor.id === 'org.gnome.TextEditor', 'Profile ID is org.gnome.TextEditor');

// 6. Test unmatched window
const mockUnknownWindow = {
    get_wm_class: () => 'UnknownApp',
    get_wm_class_instance: () => 'unknownapp',
    get_gtk_application_id: () => null,
};
assert(manager.getProfileForWindow(mockUnknownWindow) === null, 'Unknown window returns null');

// 7. Cleanup
manager.destroy();
assert(manager._profiles.size === 0, 'Profiles cleared on destroy');

console.log('All ProfileManager tests passed successfully!');
