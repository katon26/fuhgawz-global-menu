import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GIRepository from 'gi://GIRepository';

// Ensure Mutter typelib paths are searched if not in default search path
for (const parent of ['/usr/lib/x86_64-linux-gnu', '/usr/lib64', '/usr/lib', '/usr/lib/aarch64-linux-gnu']) {
    if (GLib.file_test(parent, GLib.FileTest.IS_DIR)) {
        try {
            const dir = GLib.Dir.open(parent, 0);
            let name;
            while ((name = dir.read_name()) !== null) {
                if (name.startsWith('mutter') || name.startsWith('gnome-shell')) {
                    const full = GLib.build_filenamev([parent, name]);
                    try {
                        GIRepository.Repository.dup_default().prepend_search_path(full);
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }
}

for (const v of [18, 17, 16, 15, 14, 13, 12, 11, 10]) {
    for (const prefix of ['/usr/lib64', '/usr/lib/x86_64-linux-gnu', '/usr/lib', '/usr/lib/aarch64-linux-gnu']) {
        const path = `${prefix}/mutter-${v}`;
        if (GLib.file_test(path, GLib.FileTest.IS_DIR)) {
            try {
                GIRepository.Repository.dup_default().prepend_search_path(path);
            } catch (e) {}
        }
    }
}

let Clutter;
let parseAccelerator, KEY_MAP, MODIFIER_MAP, VirtualKeyboardDispatcher;

try {
    Clutter = (await import('gi://Clutter')).default;
    const vk = await import('../src/virtualKeyboard.js');
    parseAccelerator = vk.parseAccelerator;
    KEY_MAP = vk.KEY_MAP;
    MODIFIER_MAP = vk.MODIFIER_MAP;
    VirtualKeyboardDispatcher = vk.VirtualKeyboardDispatcher;
} catch (e) {
    console.log(`Notice: Clutter typelib not available in this test environment (${e.message}). Skipping virtualKeyboard tests.`);
}

if (Clutter && parseAccelerator) {
    try {
        if (typeof Clutter.init === 'function') Clutter.init(null);
    } catch (e) {
        // Already initialized or not needed
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

if (!Clutter || !parseAccelerator) {
    console.log('Notice: Skipping virtualKeyboard tests because Clutter typelib is not installed in this runner.');
} else {
    console.log('Testing accelerator parsing...');

// Test 1: Simple Ctrl+S
const ctrlS = parseAccelerator('Ctrl+S');
assert(ctrlS !== null, 'Ctrl+S parsed');
assert(ctrlS.keyval === Clutter.KEY_s, `keyval is KEY_s (got ${ctrlS.keyval})`);
assert(ctrlS.modifiers.length === 1, '1 modifier');
assert(ctrlS.modifiers[0] === Clutter.KEY_Control_L, 'Modifier is Control_L');

// Test 2: Multi-modifier Ctrl+Shift+N
const multi = parseAccelerator('Ctrl+Shift+N');
assert(multi !== null, 'Ctrl+Shift+N parsed');
assert(multi.keyval === Clutter.KEY_n, 'keyval is KEY_n');
assert(multi.modifiers.length === 2, '2 modifiers');
assert(multi.modifiers[0] === Clutter.KEY_Control_L, 'Modifier 0 is Control_L');
assert(multi.modifiers[1] === Clutter.KEY_Shift_L, 'Modifier 1 is Shift_L');

// Test 3: Punctuation Ctrl+,
const comma = parseAccelerator('Ctrl+,');
assert(comma !== null, 'Ctrl+, parsed');
assert(comma.keyval === Clutter.KEY_comma, 'keyval is KEY_comma');

// Test 4: Function key F11
const f11 = parseAccelerator('F11');
assert(f11 !== null, 'F11 parsed');
assert(f11.keyval === Clutter.KEY_F11, 'keyval is KEY_F11');
assert(f11.modifiers.length === 0, '0 modifiers');

// Test 5: Ctrl++ (Zoom in) - must correctly preserve trailing '+'
const ctrlPlus = parseAccelerator('Ctrl++');
assert(ctrlPlus !== null, 'Ctrl++ parsed successfully');
assert(ctrlPlus.keyval === Clutter.KEY_plus, `Ctrl++ keyval is KEY_plus (got ${ctrlPlus.keyval})`);
assert(ctrlPlus.modifiers.length === 1, 'Ctrl++ has 1 modifier');
assert(ctrlPlus.modifiers[0] === Clutter.KEY_Control_L, 'Ctrl++ modifier is Control_L');

// Test 5b: Ctrl+Shift++
const ctrlShiftPlus = parseAccelerator('Ctrl+Shift++');
assert(ctrlShiftPlus !== null, 'Ctrl+Shift++ parsed successfully');
assert(ctrlShiftPlus.keyval === Clutter.KEY_plus, 'Ctrl+Shift++ keyval is KEY_plus');
assert(ctrlShiftPlus.modifiers.length === 2, 'Ctrl+Shift++ has 2 modifiers');

// Test 5c: Lone '+'
const lonePlus = parseAccelerator('+');
assert(lonePlus !== null, '+ parsed successfully');
assert(lonePlus.keyval === Clutter.KEY_plus, '+ keyval is KEY_plus');
assert(lonePlus.modifiers.length === 0, '+ has 0 modifiers');

// Test 6: Navigation keys in KEY_MAP
const navKeys = [
    { str: 'Right', expected: Clutter.KEY_Right },
    { str: 'Left', expected: Clutter.KEY_Left },
    { str: 'Up', expected: Clutter.KEY_Up },
    { str: 'Down', expected: Clutter.KEY_Down },
    { str: 'Home', expected: Clutter.KEY_Home },
    { str: 'End', expected: Clutter.KEY_End },
    { str: 'Page_Up', expected: Clutter.KEY_Page_Up },
    { str: 'Page_Down', expected: Clutter.KEY_Page_Down },
    { str: 'Insert', expected: Clutter.KEY_Insert },
];

for (const { str, expected } of navKeys) {
    assert(KEY_MAP[str] === expected, `KEY_MAP has ${str} (${KEY_MAP[str]} === ${expected})`);
    assert(KEY_MAP[str.toLowerCase()] === expected, `KEY_MAP has lowercase ${str.toLowerCase()}`);
    const parsed = parseAccelerator(`Ctrl+${str}`);
    assert(parsed !== null, `Ctrl+${str} parsed`);
    assert(parsed.keyval === expected, `Ctrl+${str} keyval is ${expected}`);
    assert(parsed.modifiers.length === 1, `Ctrl+${str} has 1 modifier`);
}

// Test 7: Complex shortcuts with navigation keys
const altShiftRight = parseAccelerator('Alt+Shift+Right');
assert(altShiftRight !== null, 'Alt+Shift+Right parsed');
assert(altShiftRight.keyval === Clutter.KEY_Right, 'keyval is KEY_Right');
assert(altShiftRight.modifiers.length === 2, '2 modifiers');
assert(altShiftRight.modifiers.includes(Clutter.KEY_Alt_L), 'includes Alt_L');
assert(altShiftRight.modifiers.includes(Clutter.KEY_Shift_L), 'includes Shift_L');

// Test 8: Invalid strings
assert(parseAccelerator('') === null, 'empty string returns null');
assert(parseAccelerator(null) === null, 'null returns null');
assert(parseAccelerator('Ctrl+') === null, 'incomplete modifier returns null');

// Test 8b: Spaced plus accelerators
const ctrlPlusSpaced = parseAccelerator('Ctrl + +');
assert(ctrlPlusSpaced !== null, 'Ctrl + + parsed');
assert(ctrlPlusSpaced.keyval === Clutter.KEY_plus, 'Ctrl + + keyval is KEY_plus');
assert(ctrlPlusSpaced.modifiers.length === 1, 'Ctrl + + has 1 modifier');

const ctrlShiftPlusSpaced = parseAccelerator('Ctrl + Shift + +');
assert(ctrlShiftPlusSpaced !== null, 'Ctrl + Shift + + parsed');
assert(ctrlShiftPlusSpaced.keyval === Clutter.KEY_plus, 'Ctrl + Shift + + keyval is KEY_plus');
assert(ctrlShiftPlusSpaced.modifiers.length === 2, 'Ctrl + Shift + + has 2 modifiers');

// Test 8c: Additional navigation aliases
const kebabPageUp = parseAccelerator('Ctrl+page-up');
assert(kebabPageUp !== null && kebabPageUp.keyval === Clutter.KEY_Page_Up, 'Ctrl+page-up parsed');
const camelPageDown = parseAccelerator('Ctrl+PageDown');
assert(camelPageDown !== null && camelPageDown.keyval === Clutter.KEY_Page_Down, 'Ctrl+PageDown parsed');

// Test 9: Dispatcher instantiation and lifecycle
const dispatcher = new VirtualKeyboardDispatcher();
assert(dispatcher !== null, 'dispatcher initialized');

// Test 10: Chord accelerator dispatching with null window
const nullChord = dispatcher.dispatchAccelerator(null, 'Ctrl+K Ctrl+S');
assert(nullChord === false, 'null window returns false safely');

// Test 11: Single accelerator vs chord dispatching with mock window
let dispatchedCalls = [];
dispatcher.dispatchShortcut = (win, keyval, modifiers, delay) => {
    dispatchedCalls.push({ win, keyval, modifiers, delay });
};

const mockWindow = { activate: () => {} };

// Test 11a: 'Ctrl + +' must dispatch as a SINGLE shortcut, NOT as chords
dispatchedCalls = [];
const ctrlPlusDispatched = dispatcher.dispatchAccelerator(mockWindow, 'Ctrl + +');
assert(ctrlPlusDispatched === true, 'Ctrl + + returned true');
assert(dispatchedCalls.length === 1, `Ctrl + + dispatched exactly 1 call (got ${dispatchedCalls.length})`);
assert(dispatchedCalls[0].keyval === Clutter.KEY_plus, 'Dispatched keyval is KEY_plus');
assert(dispatchedCalls[0].modifiers.length === 1, 'Dispatched 1 modifier');
assert(dispatchedCalls[0].modifiers[0] === Clutter.KEY_Control_L, 'Dispatched Control_L');

// Test 11b: 'Ctrl + S' must dispatch as a SINGLE shortcut
dispatchedCalls = [];
const ctrlSDispatched = dispatcher.dispatchAccelerator(mockWindow, 'Ctrl + S');
assert(ctrlSDispatched === true, 'Ctrl + S returned true');
assert(dispatchedCalls.length === 1, `Ctrl + S dispatched exactly 1 call (got ${dispatchedCalls.length})`);
assert(dispatchedCalls[0].keyval === Clutter.KEY_s, 'Dispatched keyval is KEY_s');
assert(dispatchedCalls[0].modifiers[0] === Clutter.KEY_Control_L, 'Dispatched Control_L');

// Test 11c: 'Ctrl+K Ctrl+S' chord sequence must dispatch 2 sequential calls with delay step
dispatchedCalls = [];
const chordSuccess = dispatcher.dispatchAccelerator(mockWindow, 'Ctrl+K Ctrl+S');
assert(chordSuccess === true, 'Chord returned true');
assert(dispatchedCalls.length === 2, `Chord dispatched 2 calls (got ${dispatchedCalls.length})`);
assert(dispatchedCalls[0].keyval === Clutter.KEY_k, 'First chord keyval is KEY_k');
assert(dispatchedCalls[0].delay === 50, `First chord delay is 50ms (got ${dispatchedCalls[0].delay})`);
assert(dispatchedCalls[1].keyval === Clutter.KEY_s, 'Second chord keyval is KEY_s');
assert(dispatchedCalls[1].delay === 130, `Second chord delay is 130ms (got ${dispatchedCalls[1].delay})`);

// Test 11d: Invalid chord sequence must return false and dispatch nothing
dispatchedCalls = [];
const invalidChord = dispatcher.dispatchAccelerator(mockWindow, 'Ctrl+K InvalidKeyNonExistent');
assert(invalidChord === false, 'Invalid chord returned false');
assert(dispatchedCalls.length === 0, 'No calls dispatched for invalid chord');

dispatcher.destroy();
assert(dispatcher._virtualDevice === null, 'dispatcher destroyed cleanly');

// Test 12: Specific keys used in Calculator, LibreOffice, ONLYOFFICE, and TextEditor
console.log('12. Verifying keyval parsing for app shortcuts (Alt+1..5, Ctrl+?, Ctrl+Return, Alt+F12)...');
const parsedQuestion = parseAccelerator('Ctrl+?');
assert(parsedQuestion !== null, 'Ctrl+? parsed');
assert(parsedQuestion.keyval === Clutter.KEY_question, 'keyval is KEY_question');
assert(parsedQuestion.modifiers[0] === Clutter.KEY_Control_L, 'modifier is Control_L');

const parsedAlt1 = parseAccelerator('Alt+1');
assert(parsedAlt1 !== null, 'Alt+1 parsed');
assert(parsedAlt1.keyval === Clutter.KEY_1, 'keyval is KEY_1');
assert(parsedAlt1.modifiers[0] === Clutter.KEY_Alt_L, 'modifier is Alt_L');

const parsedReturn = parseAccelerator('Ctrl+Return');
assert(parsedReturn !== null, 'Ctrl+Return parsed');
assert(parsedReturn.keyval === Clutter.KEY_Return, 'keyval is KEY_Return');

const parsedAltF12 = parseAccelerator('Alt+F12');
assert(parsedAltF12 !== null, 'Alt+F12 parsed');
assert(parsedAltF12.keyval === Clutter.KEY_F12, 'keyval is KEY_F12');

// Test 13: Validate all shortcuts in all profiles/ JSON files
console.log('13. Validating all shortcuts in all profiles/*.json files...');
const profilesDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), 'profiles']));
const enumerator = profilesDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
let fileInfo;
let totalShortcutsValidated = 0;
while ((fileInfo = enumerator.next_file(null)) !== null) {
    const filename = fileInfo.get_name();
    if (!filename.endsWith('.json')) continue;
    const jsonFile = profilesDir.get_child(filename);
    const [ok, bytes] = jsonFile.load_contents(null);
    assert(ok && bytes, `Loaded ${filename}`);
    const profile = JSON.parse(new TextDecoder('utf-8').decode(bytes));

    const checkItems = (items) => {
        for (const item of items) {
            if (item.shortcut && typeof item.shortcut === 'string' && item.shortcut.trim() !== '') {
                const isSingle = parseAccelerator(item.shortcut);
                const normalized = item.shortcut.replace(/\s*\+\s*/g, '+').trim();
                const chords = normalized.split(/[\s,]+/).filter(Boolean);
                const isChord = chords.length > 1 && chords.every(c => parseAccelerator(c) !== null);
                assert(isSingle || isChord, `Shortcut "${item.shortcut}" for "${item.label}" in ${filename} must be valid`);
                totalShortcutsValidated++;
            }
            if (Array.isArray(item.items)) {
                checkItems(item.items);
            }
        }
    };

    if (Array.isArray(profile.menus)) {
        for (const menu of profile.menus) {
            if (Array.isArray(menu.items)) checkItems(menu.items);
        }
    }
    if (profile.app_menu && Array.isArray(profile.app_menu.items)) {
        checkItems(profile.app_menu.items);
    }
}
assert(totalShortcutsValidated >= 100, `Validated at least 100 shortcuts across profiles (got ${totalShortcutsValidated})`);
console.log(`Validated ${totalShortcutsValidated} shortcuts across all profiles successfully.`);

console.log('All virtualKeyboard tests passed successfully!');
}
