import GLib from 'gi://GLib';
import GIRepository from 'gi://GIRepository';

// Ensure Mutter typelib paths are searched if not in default search path
for (const dir of [
    '/usr/lib64/mutter-18',
    '/usr/lib64/mutter-17',
    '/usr/lib64/mutter-16',
    '/usr/lib/x86_64-linux-gnu/mutter-18',
    '/usr/lib/x86_64-linux-gnu/mutter-17',
    '/usr/lib/x86_64-linux-gnu/mutter-16'
]) {
    if (GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
        try {
            GIRepository.Repository.dup_default().prepend_search_path(dir);
        } catch (e) {}
    }
}

const Clutter = (await import('gi://Clutter')).default;
const { parseAccelerator, KEY_MAP, MODIFIER_MAP, VirtualKeyboardDispatcher } = await import('../src/virtualKeyboard.js');

try {
    if (typeof Clutter.init === 'function') Clutter.init(null);
} catch (e) {
    // Already initialized or not needed
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

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

console.log('All virtualKeyboard tests passed successfully!');
