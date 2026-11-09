// tests/test_screencast_regression.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TaskIndicatorButton } from '../src/taskIndicatorButton.js';
import { TaskManager } from '../src/taskManager.js';
import { MediaFloatingCard } from '../src/mediaFloatingCard.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}
assert.strictEqual = function (actual, expected, message) {
    assert(actual === expected, message || `${actual} === ${expected}`);
};

console.log('=== Running Screencast Regression & Lifecycle Deep Verification ===');

class MockSettingsBase extends GObject.Object {
    _init() {
        super._init();
        this._values = new Map();
    }
    get_boolean(key) {
        return this._values.has(key) ? this._values.get(key) : false;
    }
    set_boolean(key, val) {
        this._values.set(key, Boolean(val));
        this.emit(`changed::${key}`, key);
    }
    get_string(key) {
        return this._values.has(key) ? this._values.get(key) : '';
    }
    set_string(key, val) {
        this._values.set(key, String(val));
        this.emit(`changed::${key}`, key);
    }
    get_int(key) {
        return this._values.has(key) ? this._values.get(key) : 0;
    }
    set_int(key, val) {
        this._values.set(key, Number(val));
    }
}

const MockSettings = GObject.registerClass(
    {
        GTypeName: 'MockSettingsScreencastRegTest',
        Signals: {
            'changed': {
                flags: GObject.SignalFlags.RUN_LAST | GObject.SignalFlags.DETAILED,
                param_types: [GObject.TYPE_STRING],
            },
        },
    },
    MockSettingsBase
);

class MockMediaManager {
    constructor() {
        this._track = null;
        this._status = 'Stopped';
        this._listeners = new Map();
    }
    connect(signal, cb) {
        if (!this._listeners.has(signal)) this._listeners.set(signal, []);
        this._listeners.get(signal).push(cb);
        return cb;
    }
    disconnect(cb) {
        for (const [sig, list] of this._listeners.entries()) {
            const idx = list.indexOf(cb);
            if (idx !== -1) list.splice(idx, 1);
        }
    }
    getActiveTrack() { return this._track; }
    getPlaybackStatus() { return this._status; }
    isSeeking() { return false; }
    publishTrack(track) {
        this._track = track;
        for (const cb of this._listeners.get('track-changed') || []) cb(this, track);
    }
    publishStatus(status) {
        this._status = status;
        for (const cb of this._listeners.get('status-changed') || []) cb(this, status);
    }
}

class MockHostMenu {
    constructor() {
        this._box = {
            add_child() {},
            remove_child() {},
            children: [],
        };
        this.menu = {
            toggle() {},
            isOpen: false,
        };
        this._listeners = new Map();
        this._idleRevealed = true;
    }
    connect(sig, cb) {
        if (!this._listeners.has(sig)) this._listeners.set(sig, []);
        this._listeners.get(sig).push(cb);
        return cb;
    }
    disconnect() {}
    setIdleRevealed(rev) { this._idleRevealed = rev; }
    isIdleRevealed() { return this._idleRevealed; }
}

const settings = new MockSettings();
settings.set_boolean('enable-media-indicator', true);
settings.set_boolean('indicator-hide-on-hover', true);
settings.set_string('indicator-hide-return', 'zone-leave');
settings.set_boolean('media-hover-popover', true);
settings.set_boolean('menu-hide-when-idle', true);

const mediaManager = new MockMediaManager();
const indicator = new TaskIndicatorButton(settings, null, { mediaManager });
const hostApp = new MockHostMenu();
indicator.bindToAppMenu(hostApp);

// 1. Playback starts
mediaManager.publishTrack({
    player: 'org.mpris.MediaPlayer2.brave',
    title: 'MBA MBA DI PARIS: AP...',
    artist: 'Brave',
    lengthMs: 1200000,
    positionMs: 60000,
});
mediaManager.publishStatus('Playing');
indicator._syncVisibility();

assert.strictEqual(indicator.hasLiveIndicator(), true, 'Media indicator active');
assert.strictEqual(indicator.isHidden, false, 'Media indicator visible initially');

// 2. Screencast scenario: pointer enters AppMenuButton ("Brave")
// Must NOT hide chip, must NOT freeze width, must NOT leave void
indicator.onAppMenuEnter();
assert.strictEqual(indicator.isHidden, false, 'Entering AppMenuButton must not hide indicator');
assert.strictEqual(indicator.isCompressed, false, 'Entering AppMenuButton must not compress media chip');
assert.strictEqual(indicator._chipWidthPinned, false, 'Entering AppMenuButton must not pin chip width');
assert.strictEqual(indicator._chipActor._explicitWidth ?? -1, -1, 'Indicator width must remain unpinned (-1)');
assert.strictEqual(indicator._mediaCard?._openTimerId ?? 0, 0, 'Hovering AppMenuButton away from the media chip must not open its card');

// 3. A direct media-chip enter is authoritative even before hover/bounds settle.
indicator._mediaChip.hover = false;
indicator._mediaChip.emit('enter-event', {});
assert.strictEqual(indicator.isCompressed, false, 'Hovering media chip keeps it uncompressed');
assert.strictEqual(indicator._chipWidthPinned, false, 'Hovering media chip keeps width unpinned');
assert(indicator._mediaCard?._openTimerId > 0, 'Direct media-chip enter schedules card open with dwell delay before hover state settles');
indicator.onPointerLeave({ immediate: true });
assert.strictEqual(indicator._mediaCard?._openTimerId ?? 0, 0, 'Immediate chip leave cancels the pending direct-entry open timer');
assert.strictEqual(indicator._mediaCard?.isOpen?.() ?? false, false, 'Immediate chip leave closes the direct-entry card');
indicator._mediaChip.emit('enter-event', {});
assert(indicator._mediaCard?._openTimerId > 0, 'Repeated direct media-chip entry schedules the card after leave');
indicator.onPointerLeave();
assert(indicator._leaveGraceTimerId > 0, 'Chip leave starts the indicator grace-close timer');
indicator._mediaChip.emit('enter-event', {});
assert.strictEqual(indicator._leaveGraceTimerId, 0, 'Direct media-chip re-entry cancels the pending grace-close timer');

// 4. Moving to global menu items (File/Edit) with hide-on-hover ON hides chip cleanly
indicator.onMenuZoneEnter();
assert.strictEqual(indicator.isHidden, true, 'Moving to File/Edit menu zone hides indicator when hide-on-hover is true');
assert.strictEqual(indicator._chipActor.opacity, 0, 'Hidden chip opacity is 0');
assert.strictEqual(indicator._chipActor.width, 0, 'Hidden chip width is 0');

// 5. Leaving menu zone restores indicator
indicator.hideChipIn();
assert.strictEqual(indicator.isHidden, false, 'Leaving menu zone restores indicator');
assert.strictEqual(indicator._chipActor.opacity, 255, 'Restored chip opacity is 255');
assert.strictEqual(indicator._chipActor._explicitWidth ?? -1, -1, 'Restored chip width is unpinned (-1)');

// 6. With hide-on-hover OFF, entering menu zone compresses without pinning width
settings.set_boolean('indicator-hide-on-hover', false);
indicator.onMenuZoneEnter();
assert.strictEqual(indicator.isHidden, false, 'With hide-on-hover false, indicator stays visible');
assert.strictEqual(indicator.isCompressed, true, 'Indicator compresses beside menu');
assert.strictEqual(indicator._chipWidthPinned, false, 'Media chip width must NEVER be pinned');
assert.strictEqual(indicator._chipActor._explicitWidth ?? -1, -1, 'Width stays unpinned (-1) preventing void');

// 7. The AppMenuButton and global-menu item actors are one combined hover
// zone. Crossing between them must preserve the presentation selected by a
// global-menu entry; only leaving both actors restores the full media chip.
function makeMenuZoneTransitionIndicator(hideOnHover) {
    const transitionSettings = new MockSettings();
    transitionSettings.set_boolean('enable-media-indicator', true);
    transitionSettings.set_boolean('indicator-hide-on-hover', hideOnHover);
    transitionSettings.set_string('indicator-hide-return', 'zone-leave');
    const transitionMedia = new MockMediaManager();
    const transitionIndicator = new TaskIndicatorButton(transitionSettings, null, {
        mediaManager: transitionMedia,
        leaveGraceMs: 120,
    });
    transitionIndicator.bindToAppMenu(new MockHostMenu());
    transitionMedia.publishTrack({
        player: 'org.mpris.MediaPlayer2.brave',
        title: 'Sibling crossings',
        artist: 'Brave',
    });
    transitionMedia.publishStatus('Playing');
    transitionIndicator._syncVisibility();
    return transitionIndicator;
}

function assertMenuPresentation(indicator, expectedPresentation, phase) {
    const mode = typeof expectedPresentation === 'boolean'
        ? (expectedPresentation ? 'hidden' : 'compact')
        : expectedPresentation;
    const isHidden = mode === 'hidden';
    const isCompact = mode === 'compact';
    assert.strictEqual(indicator.isHidden, isHidden,
        `${phase}: hide-on-hover ${isHidden ? 'hides' : 'does not hide'} the chip`);
    assert.strictEqual(indicator.isCompressed, isCompact,
        `${phase}: compact state matches presentation (${mode})`);
    assert.strictEqual(indicator._chipWidthPinned,
        isCompact && !indicator._isMediaDisplay,
        `${phase}: chip width pin matches presentation (${mode})`);
}

function menuActorPresentation(indicator) {
    const chip = indicator._chipActor;
    return {
        hiddenClass: indicator.has_style_class_name('fuhgawz-chip-hidden'),
        chipHiddenClass: chip.has_style_class_name?.('fuhgawz-chip-hidden') ?? false,
        compressedClass: indicator.has_style_class_name('fuhgawz-chip-compressed'),
        opacity: chip.opacity,
        width: chip.width,
        visible: indicator.visible,
    };
}

function assertMenuActorPresentation(indicator, expectedPresentation, phase) {
    const mode = typeof expectedPresentation === 'boolean'
        ? (expectedPresentation ? 'hidden' : 'compact')
        : expectedPresentation;
    const isHidden = mode === 'hidden';
    const isCompact = mode === 'compact';
    const actual = menuActorPresentation(indicator);
    assert.strictEqual(actual.hiddenClass, isHidden, `${phase}: indicator hidden class matches presentation (${mode})`);
    assert.strictEqual(actual.chipHiddenClass, isHidden, `${phase}: chip hidden class matches presentation (${mode})`);
    assert.strictEqual(actual.compressedClass, isCompact, `${phase}: compressed class matches presentation (${mode})`);
    assert.strictEqual(actual.opacity, isHidden ? 0 : 255, `${phase}: chip opacity matches presentation (${mode})`);
    if (isHidden) {
        assert.strictEqual(actual.width, 0, `${phase}: chip width is 0 when hidden`);
    } else if (isCompact && !indicator._isMediaDisplay) {
        assert(actual.width > 0, `${phase}: task chip width is pinned (> 0) when compact`);
    } else {
        assert.strictEqual(actual.width, -1, `${phase}: chip width is unpinned (-1)`);
    }
    assert.strictEqual(actual.visible, !isHidden, `${phase}: container visibility matches presentation (${mode})`);
}

function observeVisualTransitions(indicator) {
    const events = [];
    const originals = new Map();
    let depth = 0;
    for (const name of ['hideChipOut', 'hideChipIn', '_setChipCompressed', '_pinChipWidth']) {
        const original = indicator[name];
        originals.set(name, original);
        indicator[name] = (...args) => {
            const before = depth === 0 ? JSON.stringify(menuActorPresentation(indicator)) : null;
            depth++;
            try {
                return original.apply(indicator, args);
            } finally {
                depth--;
                if (depth === 0) {
                    const after = JSON.stringify(menuActorPresentation(indicator));
                    if (before !== after)
                        events.push(name);
                }
            }
        };
    }
    return {
        events,
        restore() {
            for (const [name, original] of originals)
                indicator[name] = original;
        },
    };
}

for (const hideOnHover of [true, false]) {
    const appThenMenu = makeMenuZoneTransitionIndicator(hideOnHover);
    appThenMenu.onAppMenuEnter();
    assert.strictEqual(appThenMenu.isHidden, false,
        'fresh AppMenuButton hover away from the media chip stays visible');
    assert.strictEqual(appThenMenu.isCompressed, false,
        'fresh AppMenuButton hover away from the media chip stays full');
    assertMenuActorPresentation(appThenMenu, 'full', 'fresh AppMenuButton hover');
    const appToMenuTransitions = observeVisualTransitions(appThenMenu);
    appThenMenu.onMenuZoneLeave();
    appThenMenu.onMenuZoneEnter();
    appToMenuTransitions.restore();
    assertMenuPresentation(appThenMenu, hideOnHover, 'AppMenuButton → global-menu entry');
    assertMenuActorPresentation(appThenMenu, hideOnHover, 'AppMenuButton → global-menu entry');
    assert.strictEqual(appToMenuTransitions.events.length, 1,
        'AppMenuButton → global-menu crossing makes exactly one requested visual presentation change');
    appThenMenu.onMenuZoneLeave({ immediate: true });
    assert.strictEqual(appThenMenu.isHidden, false,
        'real combined-zone exit restores a hidden media chip');
    assert.strictEqual(appThenMenu.isCompressed, false,
        'real combined-zone exit restores an uncompressed media chip');
    assertMenuActorPresentation(appThenMenu, 'full', 'real combined-zone exit');
    appThenMenu.destroy();

    const menuThenApp = makeMenuZoneTransitionIndicator(hideOnHover);
    menuThenApp.onMenuZoneEnter();
    assertMenuPresentation(menuThenApp, hideOnHover, 'global-menu entry');
    assertMenuActorPresentation(menuThenApp, hideOnHover, 'global-menu entry');
    const menuToAppTransitions = observeVisualTransitions(menuThenApp);
    menuThenApp.onMenuZoneLeave();
    assertMenuPresentation(menuThenApp, hideOnHover, 'pending global-menu → AppMenuButton sibling crossing');
    menuThenApp.onAppMenuEnter();
    assertMenuPresentation(menuThenApp, hideOnHover, 'global-menu → AppMenuButton sibling crossing');
    assertMenuActorPresentation(menuThenApp, hideOnHover, 'global-menu → AppMenuButton sibling crossing');
    menuThenApp.onMenuZoneLeave();
    menuThenApp.onMenuZoneEnter();
    menuToAppTransitions.restore();
    assertMenuPresentation(menuThenApp, hideOnHover, 'repeated global-menu entry after AppMenuButton crossing');
    assertMenuActorPresentation(menuThenApp, hideOnHover, 'repeated global-menu entry after AppMenuButton crossing');
    assert.strictEqual(menuToAppTransitions.events.length, 0,
        'global-menu ↔ AppMenuButton sibling crossings and repeated onMenuZoneEnter do not hide/reveal or compact/expand');
    menuThenApp.onMenuZoneLeave({ immediate: true });
    assert.strictEqual(menuThenApp.isHidden, false,
        'real combined-zone exit restores media visibility after sibling crossing');
    assert.strictEqual(menuThenApp.isCompressed, false,
        'real combined-zone exit restores full media presentation after sibling crossing');
    assertMenuActorPresentation(menuThenApp, 'full', 'real combined-zone exit after sibling crossing');
    menuThenApp.destroy();
}

// A direct media-chip entry takes priority over a compact global-menu state.
const directChipPriorityIndicator = makeMenuZoneTransitionIndicator(false);
directChipPriorityIndicator.onMenuZoneEnter();
assertMenuActorPresentation(directChipPriorityIndicator, 'compact', 'compact state before direct media-chip entry');
directChipPriorityIndicator._mediaChip.emit('enter-event', {});
assert.strictEqual(directChipPriorityIndicator.isHidden, false, 'direct media-chip entry remains visible');
assert.strictEqual(directChipPriorityIndicator.isCompressed, false, 'direct media-chip entry restores full presentation');
assert.strictEqual(directChipPriorityIndicator._chipWidthPinned, false, 'direct media-chip entry remains unpinned');
assertMenuActorPresentation(directChipPriorityIndicator, 'full', 'direct media-chip priority state');
directChipPriorityIndicator.onMenuZoneLeave({ immediate: true });
directChipPriorityIndicator.destroy();

// If a hidden or compact media indicator disappears while the menu zone is
// active (whether the pointer subsequently leaves the zone or stays inside),
// the next fresh AppMenuButton title hover must start full rather than inherit
// the former hidden or compact presentation.
for (const hideOnHover of [true, false]) {
    const staleWithLeave = makeMenuZoneTransitionIndicator(hideOnHover);
    staleWithLeave.onMenuZoneEnter();
    assertMenuActorPresentation(staleWithLeave, hideOnHover, 'menu state before media disappears (with zone leave)');
    staleWithLeave._mediaManager.publishStatus('Stopped');
    staleWithLeave.onMenuZoneLeave({ immediate: true });
    staleWithLeave._mediaManager.publishStatus('Playing');
    staleWithLeave.onAppMenuEnter();
    assertMenuPresentation(staleWithLeave, 'full', 'fresh AppMenuButton hover after media returns (with zone leave)');
    assertMenuActorPresentation(staleWithLeave, 'full', 'fresh AppMenuButton hover after media returns (with zone leave)');
    staleWithLeave.onMenuZoneLeave({ immediate: true });
    staleWithLeave.destroy();

    const staleInZone = makeMenuZoneTransitionIndicator(hideOnHover);
    staleInZone.onMenuZoneEnter();
    assertMenuActorPresentation(staleInZone, hideOnHover, 'menu state before media disappears (in zone)');
    staleInZone._mediaManager.publishStatus('Stopped');
    staleInZone._mediaManager.publishStatus('Playing');
    staleInZone.onAppMenuEnter();
    assertMenuPresentation(staleInZone, 'full', 'fresh AppMenuButton hover after media returns in zone');
    assertMenuActorPresentation(staleInZone, 'full', 'fresh AppMenuButton hover after media returns in zone');
    staleInZone.onMenuZoneLeave({ immediate: true });
    staleInZone.destroy();
}

// 8. Changing hide-on-hover while global-menu items are active selects the
// new menu presentation immediately; it must not need another pointer event.
const liveSettingIndicator = makeMenuZoneTransitionIndicator(false);
liveSettingIndicator.onMenuZoneEnter();
assertMenuPresentation(liveSettingIndicator, 'compact', 'active global-menu before setting change');
assertMenuActorPresentation(liveSettingIndicator, 'compact', 'active global-menu before setting change');
liveSettingIndicator._settings.set_boolean('indicator-hide-on-hover', true);
assertMenuPresentation(liveSettingIndicator, 'hidden', 'active global-menu after hide-on-hover turns on');
assertMenuActorPresentation(liveSettingIndicator, 'hidden', 'active global-menu after hide-on-hover turns on');
liveSettingIndicator._settings.set_boolean('indicator-hide-on-hover', false);
assertMenuPresentation(liveSettingIndicator, 'compact', 'active global-menu after hide-on-hover turns off');
assertMenuActorPresentation(liveSettingIndicator, 'compact', 'active global-menu after hide-on-hover turns off');
liveSettingIndicator.onMenuZoneLeave({ immediate: true });
liveSettingIndicator.destroy();

// A title-only AppMenuButton hover remains the fresh full presentation; a
// menu-only setting transition must not turn it into hidden or compact state.
const freshAppMenuIndicator = makeMenuZoneTransitionIndicator(false);
freshAppMenuIndicator.onAppMenuEnter();
freshAppMenuIndicator._settings.set_boolean('indicator-hide-on-hover', true);
assert.strictEqual(freshAppMenuIndicator.isHidden, false,
    'title-only AppMenuButton hover stays visible when hide-on-hover changes');
assert.strictEqual(freshAppMenuIndicator.isCompressed, false,
    'title-only AppMenuButton hover stays full when hide-on-hover changes');
assertMenuActorPresentation(freshAppMenuIndicator, 'full', 'title-only AppMenuButton hover when hide-on-hover turns on');
freshAppMenuIndicator._settings.set_boolean('indicator-hide-on-hover', false);
assert.strictEqual(freshAppMenuIndicator.isHidden, false,
    'title-only AppMenuButton hover remains visible after hide-on-hover toggles back');
assert.strictEqual(freshAppMenuIndicator.isCompressed, false,
    'title-only AppMenuButton hover remains full after hide-on-hover toggles back');
assertMenuActorPresentation(freshAppMenuIndicator, 'full', 'title-only AppMenuButton hover when hide-on-hover turns off');
freshAppMenuIndicator.onMenuZoneLeave({ immediate: true });
freshAppMenuIndicator.destroy();

// 9. Non-media (task-mode) menu-zone transitions: sibling crossings, live
// hide-on-hover setting changes, and stale-presentation reset on task completion.
function makeTaskZoneTransitionIndicator(hideOnHover) {
    const taskSettings = new MockSettings();
    taskSettings.set_boolean('enable-task-indicator', true);
    taskSettings.set_string('task-indicator-mode', 'hover');
    taskSettings.set_boolean('indicator-hide-on-hover', hideOnHover);
    taskSettings.set_string('indicator-hide-return', 'zone-leave');
    const taskHost = new MockHostMenu();
    const taskIndicator = new TaskIndicatorButton(taskSettings, null, {
        leaveGraceMs: 120,
    });
    taskIndicator.bindToAppMenu(taskHost);
    taskIndicator.updateTask({
        id: 'task-zone-1',
        appId: 'org.gnome.Nautilus',
        title: 'Copying files',
        summary: 'Copying 12 files',
        state: 'running',
        progress: 0.5,
    });
    return { taskIndicator, taskHost, taskSettings };
}

for (const hideOnHover of [true, false]) {
    // Entry order A: AppMenuButton (hovered host) -> global-menu
    const { taskIndicator: taskAppThenMenu, taskHost: hostA } = makeTaskZoneTransitionIndicator(hideOnHover);
    hostA.hover = true;
    taskAppThenMenu.onAppMenuEnter();
    // Direct task host hover always expands/compresses/pins the task chip (never hides)
    assertMenuPresentation(taskAppThenMenu, 'compact', 'Task AppMenuButton hover');
    assertMenuActorPresentation(taskAppThenMenu, 'compact', 'Task AppMenuButton hover');
    assert.strictEqual(taskAppThenMenu.isExpanded(), true, 'Task AppMenuButton hover expands details in hover mode');
    const taskAppToMenuObs = observeVisualTransitions(taskAppThenMenu);
    hostA.hover = false;
    taskAppThenMenu.onMenuZoneLeave();
    taskAppThenMenu.onMenuZoneEnter();
    taskAppToMenuObs.restore();
    assertMenuPresentation(taskAppThenMenu, hideOnHover, 'Task AppMenuButton → global-menu entry');
    assertMenuActorPresentation(taskAppThenMenu, hideOnHover, 'Task AppMenuButton → global-menu entry');
    assert.strictEqual(taskAppToMenuObs.events.length, hideOnHover ? 1 : 0,
        'Task AppMenuButton → global-menu transitions only when switching from compact to hidden');
    taskAppThenMenu.onMenuZoneLeave({ immediate: true });
    assertMenuPresentation(taskAppThenMenu, 'full', 'Task real combined-zone exit');
    assertMenuActorPresentation(taskAppThenMenu, 'full', 'Task real combined-zone exit');
    taskAppThenMenu.destroy();

    // Entry order B: global-menu -> AppMenuButton -> global-menu
    const { taskIndicator: taskMenuThenApp, taskHost: hostB } = makeTaskZoneTransitionIndicator(hideOnHover);
    taskMenuThenApp.onMenuZoneEnter();
    assertMenuPresentation(taskMenuThenApp, hideOnHover, 'Task global-menu entry');
    assertMenuActorPresentation(taskMenuThenApp, hideOnHover, 'Task global-menu entry');
    const taskMenuToAppObs = observeVisualTransitions(taskMenuThenApp);
    taskMenuThenApp.onMenuZoneLeave();
    hostB.hover = true;
    taskMenuThenApp.onAppMenuEnter();
    assertMenuPresentation(taskMenuThenApp, hideOnHover, 'Task global-menu → AppMenuButton sibling crossing');
    assertMenuActorPresentation(taskMenuThenApp, hideOnHover, 'Task global-menu → AppMenuButton sibling crossing');
    hostB.hover = false;
    taskMenuThenApp.onMenuZoneLeave();
    taskMenuThenApp.onMenuZoneEnter();
    taskMenuToAppObs.restore();
    assertMenuPresentation(taskMenuThenApp, hideOnHover, 'Task repeated global-menu entry');
    assertMenuActorPresentation(taskMenuThenApp, hideOnHover, 'Task repeated global-menu entry');
    assert.strictEqual(taskMenuToAppObs.events.length, 0,
        'Task global-menu ↔ AppMenuButton sibling crossing does not oscillate');
    taskMenuThenApp.onMenuZoneLeave({ immediate: true });
    assertMenuPresentation(taskMenuThenApp, 'full', 'Task real combined-zone exit after sibling crossing');
    assertMenuActorPresentation(taskMenuThenApp, 'full', 'Task real combined-zone exit after sibling crossing');
    taskMenuThenApp.destroy();

    // Stale-presentation reset when task finishes while in the menu zone
    const { taskIndicator: taskStale } = makeTaskZoneTransitionIndicator(hideOnHover);
    taskStale.onMenuZoneEnter();
    assertMenuActorPresentation(taskStale, hideOnHover, 'Task menu state before task finishes');
    taskStale.setCompleted({ id: 'task-zone-1', state: 'completed' });
    if (!hideOnHover)
        taskStale._autoCollapseCompletion();
    taskStale.onMenuZoneLeave({ immediate: true });
    taskStale.updateTask({
        id: 'task-zone-2',
        appId: 'org.gnome.Nautilus',
        title: 'Moving files',
        summary: 'Moving 4 files',
        state: 'running',
        progress: 0.25,
    });
    assertMenuPresentation(taskStale, 'full', 'New task after prior task finished in menu zone');
    assertMenuActorPresentation(taskStale, 'full', 'New task after prior task finished in menu zone');
    taskStale.onAppMenuEnter();
    assertMenuPresentation(taskStale, 'full', 'Fresh title-only AppMenu enter on new task does not inherit stale menu presentation');
    assertMenuActorPresentation(taskStale, 'full', 'Fresh title-only AppMenu enter on new task does not inherit stale menu presentation');
    taskStale.onMenuZoneLeave({ immediate: true });
    taskStale.destroy();
}

// Live indicator-hide-on-hover setting changes while in the menu zone for a task indicator
const { taskIndicator: taskLiveSetting, taskSettings: taskLiveSettings } = makeTaskZoneTransitionIndicator(false);
taskLiveSetting.onMenuZoneEnter();
assertMenuPresentation(taskLiveSetting, 'compact', 'Task active global-menu before setting change');
assertMenuActorPresentation(taskLiveSetting, 'compact', 'Task active global-menu before setting change');
taskLiveSettings.set_boolean('indicator-hide-on-hover', true);
assertMenuPresentation(taskLiveSetting, 'hidden', 'Task active global-menu after hide-on-hover turns on');
assertMenuActorPresentation(taskLiveSetting, 'hidden', 'Task active global-menu after hide-on-hover turns on');
taskLiveSetting.updateTask({
    id: 'task-zone-1',
    appId: 'org.gnome.Nautilus',
    title: 'Copying files',
    summary: 'Copying 12 files',
    state: 'running',
    progress: 0.75,
});
assertMenuPresentation(taskLiveSetting, 'hidden', 'Task progress update while hidden in menu zone preserves logical hidden state');
assertMenuActorPresentation(taskLiveSetting, 'hidden', 'Task progress update while hidden in menu zone preserves actor hidden presentation');
assert.strictEqual(taskLiveSetting.visible, false, 'Task progress update while hidden in menu zone keeps visible === false');
taskLiveSettings.set_boolean('indicator-hide-on-hover', false);
assertMenuPresentation(taskLiveSetting, 'compact', 'Task active global-menu after hide-on-hover turns off');
assertMenuActorPresentation(taskLiveSetting, 'compact', 'Task active global-menu after hide-on-hover turns off');
taskLiveSetting.onMenuZoneLeave({ immediate: true });
taskLiveSetting.destroy();

// 10. Cleanup
indicator.destroy();
console.log('=== Screencast Regression Deep Verification PASSED! ===');
