import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Ensure in-memory settings backend is used if no dconf/display daemon is present
if (!GLib.getenv('GSETTINGS_BACKEND')) {
    GLib.setenv('GSETTINGS_BACKEND', 'memory', false);
}

const schemaDir = Gio.File.new_for_path('./schemas');
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir.get_path(),
    Gio.SettingsSchemaSource.get_default(),
    false
);

const schema = schemaSource.lookup('org.gnome.shell.extensions.fuhgawzglbmenu', false);
if (!schema) {
    throw new Error('Schema org.gnome.shell.extensions.fuhgawzglbmenu not found');
}

const requiredKeys = {
    'enable-task-indicator': { type: 'b', defaultVal: true },
    'task-indicator-mode': { type: 's', defaultVal: 'compact', choices: ['compact', 'hover', 'slider'] },
    'task-auto-hide-seconds': { type: 'i', defaultVal: 4 },
    'task-sync-recent-items': { type: 'b', defaultVal: true },
};

// 1. Validate schema keys, types, defaults, and choices
for (const [key, spec] of Object.entries(requiredKeys)) {
    if (!schema.has_key(key)) {
        throw new Error(`Missing expected schema key: ${key}`);
    }
    const schemaKey = schema.get_key(key);
    const valType = schemaKey.get_value_type().dup_string();
    if (valType !== spec.type) {
        throw new Error(`Key ${key} has type ${valType}, expected ${spec.type}`);
    }

    const defaultVal = schemaKey.get_default_value().deep_unpack();
    if (defaultVal !== spec.defaultVal) {
        throw new Error(`Key ${key} default mismatch: got ${defaultVal}, expected ${spec.defaultVal}`);
    }

    if (spec.choices) {
        const range = schemaKey.get_range();
        const [rangeType, rangeVal] = range.deep_unpack();
        if (rangeType !== 'enum' && rangeType !== 'choice') {
            throw new Error(`Key ${key} has unexpected range type: ${rangeType}, expected enum or choice`);
        }
        const choices = Array.isArray(rangeVal) ? rangeVal : (rangeVal.deep_unpack ? rangeVal.deep_unpack() : []);
        if (choices.length !== spec.choices.length) {
            throw new Error(`Key ${key} choices count mismatch: got ${choices.length}, expected ${spec.choices.length}`);
        }
        for (const choice of spec.choices) {
            if (!choices.includes(choice)) {
                throw new Error(`Key ${key} missing expected choice: ${choice}`);
            }
        }
    }
}

// 2. Validate functional Gio.Settings read, write, and reset behavior
const settings = new Gio.Settings({ settings_schema: schema });

// Check initial read values against defaults
if (settings.get_boolean('enable-task-indicator') !== true) {
    throw new Error('Initial enable-task-indicator read mismatch');
}
if (settings.get_string('task-indicator-mode') !== 'compact') {
    throw new Error('Initial task-indicator-mode read mismatch');
}
if (settings.get_int('task-auto-hide-seconds') !== 4) {
    throw new Error('Initial task-auto-hide-seconds read mismatch');
}
if (settings.get_boolean('task-sync-recent-items') !== true) {
    throw new Error('Initial task-sync-recent-items read mismatch');
}

// Test write/read cycles
settings.set_boolean('enable-task-indicator', false);
if (settings.get_boolean('enable-task-indicator') !== false) {
    throw new Error('Failed to update enable-task-indicator to false');
}

for (const mode of ['hover', 'slider', 'compact']) {
    settings.set_string('task-indicator-mode', mode);
    if (settings.get_string('task-indicator-mode') !== mode) {
        throw new Error(`Failed to update task-indicator-mode to ${mode}`);
    }
}

for (const sec of [1, 5, 10]) {
    settings.set_int('task-auto-hide-seconds', sec);
    if (settings.get_int('task-auto-hide-seconds') !== sec) {
        throw new Error(`Failed to update task-auto-hide-seconds to ${sec}`);
    }
}

settings.set_boolean('task-sync-recent-items', false);
if (settings.get_boolean('task-sync-recent-items') !== false) {
    throw new Error('Failed to update task-sync-recent-items to false');
}

// Test settings reset
for (const key of Object.keys(requiredKeys)) {
    settings.reset(key);
}
if (settings.get_boolean('enable-task-indicator') !== true) {
    throw new Error('Reset failed for enable-task-indicator');
}
if (settings.get_string('task-indicator-mode') !== 'compact') {
    throw new Error('Reset failed for task-indicator-mode');
}
if (settings.get_int('task-auto-hide-seconds') !== 4) {
    throw new Error('Reset failed for task-auto-hide-seconds');
}
if (settings.get_boolean('task-sync-recent-items') !== true) {
    throw new Error('Reset failed for task-sync-recent-items');
}

// 3. Verify prefs.js structure for Task Indicator integration
const prefsFile = Gio.File.new_for_path('./prefs.js');
const [, prefsContents] = prefsFile.load_contents(null);
const decoder = new TextDecoder();
const prefsSource = decoder.decode(prefsContents);

const expectedPrefsTokens = [
    'Live Task Indicator',
    'enable-task-indicator',
    'task-indicator-mode',
    'task-auto-hide-seconds',
    'task-sync-recent-items',
    'Compact (Default)',
    'Hover Expand',
    'Click Toggle (>>)',
    'Adw.PreferencesGroup',
    'Adw.SwitchRow',
    'Adw.ComboRow',
    'Adw.SpinRow',
];

for (const token of expectedPrefsTokens) {
    if (!prefsSource.includes(token)) {
        throw new Error(`prefs.js is missing expected token: "${token}"`);
    }
}

console.log('Task 1 schema verification passed!');
