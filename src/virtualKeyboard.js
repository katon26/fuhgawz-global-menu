import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

/**
 * Key symbol mapping for common shortcut keys to Clutter keyvals.
 */
export const KEY_MAP = {
    'a': Clutter.KEY_a,
    'b': Clutter.KEY_b,
    'c': Clutter.KEY_c,
    'd': Clutter.KEY_d,
    'e': Clutter.KEY_e,
    'f': Clutter.KEY_f,
    'g': Clutter.KEY_g,
    'h': Clutter.KEY_h,
    'i': Clutter.KEY_i,
    'j': Clutter.KEY_j,
    'k': Clutter.KEY_k,
    'l': Clutter.KEY_l,
    'm': Clutter.KEY_m,
    'n': Clutter.KEY_n,
    'o': Clutter.KEY_o,
    'p': Clutter.KEY_p,
    'q': Clutter.KEY_q,
    'r': Clutter.KEY_r,
    's': Clutter.KEY_s,
    't': Clutter.KEY_t,
    'u': Clutter.KEY_u,
    'v': Clutter.KEY_v,
    'w': Clutter.KEY_w,
    'x': Clutter.KEY_x,
    'y': Clutter.KEY_y,
    'z': Clutter.KEY_z,
    '0': Clutter.KEY_0,
    '1': Clutter.KEY_1,
    '2': Clutter.KEY_2,
    '3': Clutter.KEY_3,
    '4': Clutter.KEY_4,
    '5': Clutter.KEY_5,
    '6': Clutter.KEY_6,
    '7': Clutter.KEY_7,
    '8': Clutter.KEY_8,
    '9': Clutter.KEY_9,
    ',': Clutter.KEY_comma,
    '.': Clutter.KEY_period,
    '/': Clutter.KEY_slash,
    ';': Clutter.KEY_semicolon,
    '\'': Clutter.KEY_apostrophe,
    '[': Clutter.KEY_bracketleft,
    ']': Clutter.KEY_bracketright,
    '\\': Clutter.KEY_backslash,
    '-': Clutter.KEY_minus,
    '=': Clutter.KEY_equal,
    '+': Clutter.KEY_plus,
    'plus': Clutter.KEY_plus,
    '?': Clutter.KEY_question,
    'question': Clutter.KEY_question,
    ':': Clutter.KEY_colon,
    'colon': Clutter.KEY_colon,
    '_': Clutter.KEY_underscore,
    'underscore': Clutter.KEY_underscore,
    '`': Clutter.KEY_grave,
    'backspace': Clutter.KEY_BackSpace,
    'BackSpace': Clutter.KEY_BackSpace,
    'bksp': Clutter.KEY_BackSpace,
    'delete': Clutter.KEY_Delete,
    'Delete': Clutter.KEY_Delete,
    'del': Clutter.KEY_Delete,
    'Del': Clutter.KEY_Delete,
    'enter': Clutter.KEY_Return,
    'Enter': Clutter.KEY_Return,
    'return': Clutter.KEY_Return,
    'Return': Clutter.KEY_Return,
    'tab': Clutter.KEY_Tab,
    'Tab': Clutter.KEY_Tab,
    'space': Clutter.KEY_space,
    'Space': Clutter.KEY_space,
    'escape': Clutter.KEY_Escape,
    'Escape': Clutter.KEY_Escape,
    'esc': Clutter.KEY_Escape,
    'Esc': Clutter.KEY_Escape,
    'right': Clutter.KEY_Right,
    'Right': Clutter.KEY_Right,
    'left': Clutter.KEY_Left,
    'Left': Clutter.KEY_Left,
    'up': Clutter.KEY_Up,
    'Up': Clutter.KEY_Up,
    'down': Clutter.KEY_Down,
    'Down': Clutter.KEY_Down,
    'home': Clutter.KEY_Home,
    'Home': Clutter.KEY_Home,
    'end': Clutter.KEY_End,
    'End': Clutter.KEY_End,
    'page_up': Clutter.KEY_Page_Up,
    'Page_Up': Clutter.KEY_Page_Up,
    'pageup': Clutter.KEY_Page_Up,
    'PageUp': Clutter.KEY_Page_Up,
    'page-up': Clutter.KEY_Page_Up,
    'Page-Up': Clutter.KEY_Page_Up,
    'prior': Clutter.KEY_Page_Up,
    'page_down': Clutter.KEY_Page_Down,
    'Page_Down': Clutter.KEY_Page_Down,
    'pagedown': Clutter.KEY_Page_Down,
    'PageDown': Clutter.KEY_Page_Down,
    'page-down': Clutter.KEY_Page_Down,
    'Page-Down': Clutter.KEY_Page_Down,
    'next': Clutter.KEY_Page_Down,
    'insert': Clutter.KEY_Insert,
    'Insert': Clutter.KEY_Insert,
    'ins': Clutter.KEY_Insert,
    'f1': Clutter.KEY_F1,
    'f2': Clutter.KEY_F2,
    'f3': Clutter.KEY_F3,
    'f4': Clutter.KEY_F4,
    'f5': Clutter.KEY_F5,
    'f6': Clutter.KEY_F6,
    'f7': Clutter.KEY_F7,
    'f8': Clutter.KEY_F8,
    'f9': Clutter.KEY_F9,
    'f10': Clutter.KEY_F10,
    'f11': Clutter.KEY_F11,
    'f12': Clutter.KEY_F12,
};

/**
 * Modifier mapping for shortcuts.
 */
export const MODIFIER_MAP = {
    'ctrl': Clutter.KEY_Control_L,
    'control': Clutter.KEY_Control_L,
    'shift': Clutter.KEY_Shift_L,
    'alt': Clutter.KEY_Alt_L,
    'option': Clutter.KEY_Alt_L,
    'super': Clutter.KEY_Super_L,
    'meta': Clutter.KEY_Super_L,
    'cmd': Clutter.KEY_Super_L,
    'command': Clutter.KEY_Super_L,
};

/**
 * Parses a string accelerator representation (e.g. "Ctrl+Shift+N", "Ctrl++", or "Ctrl+,")
 * into a primary keyval and modifier keyval array.
 *
 * @param {string} accelStr - Accelerator string.
 * @returns {{ keyval: number, modifiers: number[] } | null}
 */
export function parseAccelerator(accelStr) {
    if (!accelStr || typeof accelStr !== 'string') return null;

    let str = accelStr.trim();
    if (!str) return null;

    let hasTrailingPlus = false;
    // Check if the accelerator ends with '+' as the key (e.g. 'Ctrl++', 'Ctrl+Shift++', '+', 'Ctrl + +')
    if (str === '+' || str.endsWith('++') || /\+\s*\+$/.test(str)) {
        hasTrailingPlus = true;
        str = str.replace(/\+\s*$/, '');
    }

    const parts = str.split('+').map(p => p.trim()).filter(Boolean);
    if (hasTrailingPlus) {
        parts.push('+');
    }

    if (parts.length === 0) return null;

    const modifiers = [];
    let primaryKeyval = 0;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const lower = part.toLowerCase();

        if (i < parts.length - 1) {
            if (MODIFIER_MAP[lower]) {
                modifiers.push(MODIFIER_MAP[lower]);
                continue;
            }
            return null;
        }

        // Primary key (last part)
        if (MODIFIER_MAP[lower]) {
            return null;
        }

        if (KEY_MAP[part] !== undefined) {
            primaryKeyval = KEY_MAP[part];
        } else if (KEY_MAP[lower] !== undefined) {
            primaryKeyval = KEY_MAP[lower];
        } else if (part.length === 1) {
            primaryKeyval = Clutter.unicode_to_keyval ? Clutter.unicode_to_keyval(part.charCodeAt(0)) : part.charCodeAt(0);
        } else {
            return null;
        }
    }

    if (!primaryKeyval) return null;
    return { keyval: primaryKeyval, modifiers };
}

/**
 * Dispatches synthetic keyboard shortcuts to target windows using Clutter virtual input device.
 */
export class VirtualKeyboardDispatcher {
    constructor() {
        this._virtualDevice = null;
        this._pendingSources = new Set();
        this._initDevice();
    }

    _initDevice() {
        // Only initialize when running inside the GNOME Shell / Mutter compositor process
        if (typeof global === 'undefined') {
            return;
        }

        try {
            const backend = Clutter.get_default_backend();
            const seat = backend ? backend.get_default_seat() : null;
            if (seat && typeof seat.create_virtual_device === 'function') {
                this._virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            }
        } catch (e) {
            console.warn(`[FUHGAWZ] VirtualKeyboardDispatcher initialization failed: ${e.message}`);
        }
    }

    /**
     * Synthesize a keyboard shortcut into the active MetaWindow.
     *
     * @param {Meta.Window} metaWindow - The window to receive the keystroke.
     * @param {number} keyval - Clutter keyval.
     * @param {number[]} [modifiers] - Array of modifier keyvals.
     * @param {number} [delayMs=50] - Delay in milliseconds before dispatch to allow Shell grab release.
     */
    dispatchShortcut(metaWindow, keyval, modifiers = [], delayMs = 50) {
        if (!metaWindow || !keyval) return;

        // 1. Activate the window to ensure focus handoff
        try {
            if (typeof metaWindow.activate === 'function') {
                const time = (typeof global !== 'undefined' && global.get_current_time)
                    ? global.get_current_time()
                    : 0;
                metaWindow.activate(time);
            }
        } catch (e) {
            console.debug(`[FUHGAWZ] Failed to activate window for shortcut: ${e.message}`);
        }

        // 2. Wait for Shell popups to drop their grab
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._pendingSources.delete(sourceId);

            if (!this._virtualDevice) {
                this._initDevice();
            }
            if (!this._virtualDevice) {
                console.warn('[FUHGAWZ] No virtual keyboard device available to dispatch shortcut');
                return GLib.SOURCE_REMOVE;
            }

            const now = ((typeof Clutter.get_current_event_time === 'function')
                ? Clutter.get_current_event_time()
                : Date.now()) * 1000;

            try {
                // Press modifiers
                for (let i = 0; i < modifiers.length; i++) {
                    this._virtualDevice.notify_keyval(now, modifiers[i], Clutter.KeyState.PRESSED);
                }

                // Press primary key
                this._virtualDevice.notify_keyval(now, keyval, Clutter.KeyState.PRESSED);
            } catch (err) {
                console.warn(`[FUHGAWZ] Error injecting virtual keyval press: ${err.message}`);
                return GLib.SOURCE_REMOVE;
            }

            // 20ms release delay and timestamp delta so Wayland client surfaces reliably capture key transition
            const releaseSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                this._pendingSources.delete(releaseSourceId);

                if (!this._virtualDevice) return GLib.SOURCE_REMOVE;

                const releaseNow = Math.max(
                    ((typeof Clutter.get_current_event_time === 'function')
                        ? Clutter.get_current_event_time()
                        : Date.now()) * 1000,
                    now + 20000
                );

                try {
                    // Release primary key
                    this._virtualDevice.notify_keyval(releaseNow, keyval, Clutter.KeyState.RELEASED);

                    // Release modifiers in reverse order
                    for (let i = modifiers.length - 1; i >= 0; i--) {
                        this._virtualDevice.notify_keyval(releaseNow, modifiers[i], Clutter.KeyState.RELEASED);
                    }
                } catch (err) {
                    console.warn(`[FUHGAWZ] Error injecting virtual keyval release: ${err.message}`);
                }

                return GLib.SOURCE_REMOVE;
            });

            this._pendingSources.add(releaseSourceId);

            return GLib.SOURCE_REMOVE;
        });

        this._pendingSources.add(sourceId);
    }

    /**
     * Convenience method to dispatch a string accelerator (e.g. "Ctrl+S" or "Ctrl+K Ctrl+S").
     *
     * @param {Meta.Window} metaWindow
     * @param {string} accelStr
     * @param {number} [delayMs=50]
     * @returns {boolean} True if successfully queued
     */
    dispatchAccelerator(metaWindow, accelStr, delayMs = 50) {
        if (!metaWindow || !accelStr || typeof accelStr !== 'string') return false;

        // 1. Prioritize parsing as a single accelerator (e.g. "Ctrl+S", "Ctrl++", "Ctrl + +", "F11")
        const singleParsed = parseAccelerator(accelStr);
        if (singleParsed) {
            this.dispatchShortcut(metaWindow, singleParsed.keyval, singleParsed.modifiers, delayMs);
            return true;
        }

        // 2. Otherwise test for chord sequences (e.g. "Ctrl+K Ctrl+S" or "Ctrl+K, Ctrl+S")
        const normalized = accelStr.replace(/\s*\+\s*/g, '+');
        const chords = normalized.trim().split(/[\s,]+/).filter(Boolean);
        if (chords.length > 1) {
            const parsedChords = [];
            for (const chord of chords) {
                const parsed = parseAccelerator(chord);
                if (!parsed) return false;
                parsedChords.push(parsed);
            }

            let currentDelay = delayMs;
            for (const parsed of parsedChords) {
                this.dispatchShortcut(metaWindow, parsed.keyval, parsed.modifiers, currentDelay);
                currentDelay += 80; // 50ms Shell grab + 20ms release + 10ms gap
            }
            return true;
        }

        return false;
    }

    /**
     * Clean up all pending timeouts and release references.
     */
    destroy() {
        for (const id of this._pendingSources) {
            GLib.Source.remove(id);
        }
        this._pendingSources.clear();
        this._virtualDevice = null;
    }
}
