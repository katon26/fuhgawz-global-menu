import { parseAccelerator, KEY_MAP, MODIFIER_MAP, VirtualKeyboardDispatcher } from '../src/virtualKeyboard.js';
import Clutter from 'gi://Clutter';

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

// Test 5: Invalid string
assert(parseAccelerator('') === null, 'empty string returns null');
assert(parseAccelerator(null) === null, 'null returns null');

// Test 6: Dispatcher instantiation and lifecycle
const dispatcher = new VirtualKeyboardDispatcher();
assert(dispatcher !== null, 'dispatcher initialized');
dispatcher.destroy();
assert(dispatcher._virtualDevice === null, 'dispatcher destroyed cleanly');

console.log('All virtualKeyboard tests passed successfully!');
