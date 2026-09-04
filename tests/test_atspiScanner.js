import { AtspiScanner, ATSPI_BLACKLIST } from '../src/atspiScanner.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing AtspiScanner blacklist logic...');

const scanner = new AtspiScanner();

// 1. Blacklisted windows
const mockBrave = {
    get_wm_class: () => 'Brave-browser',
    get_wm_class_instance: () => 'brave-browser',
    get_gtk_application_id: () => null,
};
assert(scanner.isBlacklisted(mockBrave) === true, 'Brave is blacklisted');

const mockChrome = {
    get_wm_class: () => 'google-chrome',
    get_wm_class_instance: () => 'google-chrome',
    get_gtk_application_id: () => 'google-chrome.desktop',
};
assert(scanner.isBlacklisted(mockChrome) === true, 'Chrome is blacklisted');

const mockCode = {
    get_wm_class: () => 'Code',
    get_wm_class_instance: () => 'code',
    get_gtk_application_id: () => 'com.visualstudio.code.desktop',
};
assert(scanner.isBlacklisted(mockCode) === true, 'VS Code is blacklisted');

const mockDiscord = {
    get_wm_class: () => 'discord',
    get_wm_class_instance: () => 'discord',
    get_gtk_application_id: () => null,
};
assert(scanner.isBlacklisted(mockDiscord) === true, 'Discord is blacklisted');

const mockAntigravity = {
    get_wm_class: () => 'Antigravity',
    get_wm_class_instance: () => 'antigravity',
    get_gtk_application_id: () => 'antigravity.desktop',
};
assert(scanner.isBlacklisted(mockAntigravity) === true, 'Antigravity is blacklisted');

// 2. Non-blacklisted applications (e.g. GIMP, LibreOffice, Gedit)
const mockGimp = {
    get_wm_class: () => 'Gimp-2.10',
    get_wm_class_instance: () => 'gimp',
    get_gtk_application_id: () => 'org.gimp.GIMP',
};
assert(scanner.isBlacklisted(mockGimp) === false, 'GIMP is not blacklisted');

const mockLibreOffice = {
    get_wm_class: () => 'libreoffice-writer',
    get_wm_class_instance: () => 'soffice.bin',
    get_gtk_application_id: () => 'libreoffice-writer.desktop',
};
assert(scanner.isBlacklisted(mockLibreOffice) === false, 'LibreOffice is not blacklisted');

// 3. Null window
assert(scanner.isBlacklisted(null) === true, 'Null window is blacklisted');

// 4. Clean destruction
scanner.destroy();
assert(scanner._atspiAvailable === false, 'Scanner marked unavailable on destroy');

console.log('All AtspiScanner tests passed successfully!');
