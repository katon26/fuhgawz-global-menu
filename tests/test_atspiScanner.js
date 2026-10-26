import { AtspiScanner, ATSPI_BLACKLIST } from '../src/atspiScanner.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing AtspiScanner blacklist logic...');

const scanner = new AtspiScanner();

// Construction must stay inert: Atspi.init() inside gnome-shell registers
// a11y cache listeners that can block the compositor — init only on use.
assert(scanner._atspiLoading === null && scanner._atspiAvailable === false,
    'constructing AtspiScanner must not initialize Atspi');
assert(typeof scanner.waitForAtspi === 'function', 'waitForAtspi must exist for the probe helper');

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

// 4. Progress text collection via a fake AT-SPI tree (no live a11y bus needed)
console.log('Testing AtspiScanner progress text collection...');

function fakeNode(role, name, children = [], extra = {}) {
    return {
        get_role: () => role,
        get_name: () => name,
        get_child_count: () => children.length,
        get_child_at_index: i => children[i] ?? null,
        ...extra,
    };
}

const progressTree = new AtspiScanner();
progressTree._atspiAvailable = true;
progressTree._atspiModule = {
    Role: {LABEL: 'label', PROGRESS_BAR: 'progress-bar', MENU_BAR: 'menu-bar'},
    get_desktop: () => fakeNode('desktop', 'desktop', [
        fakeNode('application', 'org.gnome.TextEditor', [
            fakeNode('frame', 'Text Editor', [fakeNode('label', 'untitled document')]),
        ], {get_process_id: () => 777}),
        fakeNode('application', 'nautilus', [
            fakeNode('frame', 'Files', [
                fakeNode('panel', '', [
                    fakeNode('label', 'Home'),
                    fakeNode('label', '3.7 GB / 5.5 GB'),
                    fakeNode('label', '6 seconds left'),
                ]),
            ]),
        ], {get_process_id: () => 4242}),
    ]),
};

const found = progressTree.findProgressText([4242]);
assert(found !== null, 'findProgressText must find the nautilus tree');
assert(found.texts.includes('3.7 GB / 5.5 GB'), 'byte pair label must be collected');
assert(found.texts.includes('6 seconds left'), 'eta label must be collected');
assert(found.texts.every(t => !t.includes('document')),
    'labels from other applications must not leak in');

// Progress-bar values come through the value interface.
const barTree = new AtspiScanner();
barTree._atspiAvailable = true;
barTree._atspiModule = {
    Role: {LABEL: 'label', PROGRESS_BAR: 'progress-bar'},
    get_desktop: () => fakeNode('desktop', 'desktop', [
        fakeNode('application', 'nautilus', [
            fakeNode('frame', 'Files', [
                fakeNode('progress-bar', '', [], {
                    query_value: () => ({get_current_value: () => 0.67}),
                }),
            ]),
        ], {get_process_id: () => 4242}),
    ]),
};
const barFound = barTree.findProgressText([4242]);
assert(barFound !== null && Math.abs(barFound.progressValues[0] - 0.67) < 0.001,
    'progress bar value must be collected');

// Node budget stops the walk before it can stall the shell.
let visitedCounter = 0;
const hugeTree = new AtspiScanner();
hugeTree._atspiAvailable = true;
hugeTree._atspiModule = {
    Role: {LABEL: 'label', PROGRESS_BAR: 'progress-bar'},
    get_desktop: () => fakeNode('desktop', 'desktop', [
        fakeNode('application', 'nautilus', [], {
            get_process_id: () => 4242,
            get_child_count: () => 100000,
            get_child_at_index: () => {
                visitedCounter++;
                return fakeNode('label', `item ${visitedCounter}`);
            },
        }),
    ]),
};
const hugeResult = hugeTree.findProgressText([4242], {maxNodes: 60, maxTexts: 60});
assert(hugeResult !== null && hugeResult.texts.length <= 60, 'text cap must be respected');
assert(visitedCounter < 200, `walk must stop at the node budget, visited ${visitedCounter}`);

// No pid match → null.
assert(progressTree.findProgressText([31337]) === null, 'unknown pid must return null');
assert(progressTree.findProgressText([]) === null, 'empty pid list must return null');
// Unavailable scanner → null.
const deadScanner = new AtspiScanner();
assert(deadScanner.findProgressText([4242]) === null, 'unavailable scanner must return null');

progressTree.destroy();
barTree.destroy();
hugeTree.destroy();

// 5. Clean destruction
scanner.destroy();
assert(scanner._atspiAvailable === false, 'Scanner marked unavailable on destroy');

console.log('All AtspiScanner tests passed successfully!');
