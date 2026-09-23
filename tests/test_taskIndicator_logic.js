// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_taskIndicator_logic.js - Unit test suite for TaskIndicatorButton panel UI controller & dropdown.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TaskIndicatorButton, formatRelativeTime } from '../src/taskIndicatorButton.js';
import { TaskManager } from '../src/taskManager.js';
import { TaskProgressBar } from '../src/taskProgressBar.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing TaskIndicatorButton panel UI controller, interaction modes, collision clamping & dropdown...');

// ---------------------------------------------------------------------
// Mock Settings Helper for Unit Testing
// ---------------------------------------------------------------------
class MockSettings extends GObject.Object {
    _init() {
        super._init();
        this._values = new Map([
            ['enable-task-indicator', true],
            ['task-indicator-mode', 'compact'],
            ['task-auto-hide-seconds', 1], // 1s for fast tests
            ['task-sync-recent-items', true],
        ]);
    }

    get_boolean(key) {
        return this._values.get(key) ?? true;
    }

    get_string(key) {
        return this._values.get(key) ?? '';
    }

    get_int(key) {
        return this._values.get(key) ?? 0;
    }

    set_string(key, val) {
        this._values.set(key, val);
        this.emit(`changed::${key}`, key);
    }

    set_boolean(key, val) {
        this._values.set(key, val);
        this.emit(`changed::${key}`, key);
    }

    set_int(key, val) {
        this._values.set(key, val);
        this.emit(`changed::${key}`, key);
    }
}

const MockSettingsClass = GObject.registerClass(
    {
        GTypeName: 'MockSettingsIndicatorTest',
        Signals: {
            'changed': {
                flags: GObject.SignalFlags.RUN_LAST | GObject.SignalFlags.DETAILED,
                param_types: [GObject.TYPE_STRING],
            },
        },
    },
    MockSettings
);

// ---------------------------------------------------------------------
// 1. Instantiation, Signals, Interface & Initial State
// ---------------------------------------------------------------------
console.log('1. Verifying TaskIndicatorButton instantiation, default state, and public interface...');
const mockSettings = new MockSettingsClass();
const indicator = new TaskIndicatorButton(mockSettings, null);

assert(indicator instanceof TaskIndicatorButton, 'indicator must be instance of TaskIndicatorButton');
assert(typeof indicator.updateTask === 'function', 'updateTask missing');
assert(typeof indicator.setMode === 'function', 'setMode missing');
assert(typeof indicator.getMode === 'function', 'getMode missing');
assert(typeof indicator.getActiveTask === 'function', 'getActiveTask missing');
assert(typeof indicator.getLabelText === 'function', 'getLabelText missing');
assert(typeof indicator.getExpandedText === 'function', 'getExpandedText missing');
assert(typeof indicator.getDisplayedTelemetryText === 'function', 'getDisplayedTelemetryText missing');
assert(typeof indicator.openDropdown === 'function', 'openDropdown missing');
assert(typeof indicator.closeDropdown === 'function', 'closeDropdown missing');
assert(typeof indicator.toggleDropdown === 'function', 'toggleDropdown missing');
assert(typeof indicator.isDropdownOpen === 'function', 'isDropdownOpen missing');
assert(typeof indicator.isExpanded === 'function', 'isExpanded missing');
assert(typeof indicator.setExpanded === 'function', 'setExpanded missing');
assert(typeof indicator.bindToAppMenu === 'function', 'bindToAppMenu missing');
assert(typeof indicator.calculateAvailableSpace === 'function', 'calculateAvailableSpace missing');
assert(typeof indicator.clampTelemetryWidth === 'function', 'clampTelemetryWidth missing');
assert(typeof indicator.truncateTelemetry === 'function', 'truncateTelemetry missing');
assert(typeof indicator.pauseTask === 'function', 'pauseTask missing');
assert(typeof indicator.cancelTask === 'function', 'cancelTask missing');
assert(typeof indicator.revealTask === 'function', 'revealTask missing');
assert(typeof indicator.showInFiles === 'function', 'showInFiles missing');
assert(typeof indicator.openFile === 'function', 'openFile missing');
assert(typeof indicator.copyPath === 'function', 'copyPath missing');
assert(typeof indicator.destroy === 'function', 'destroy missing');

// Initial defaults
assert(indicator.getMode() === 'compact', `Initial mode should be 'compact', got '${indicator.getMode()}'`);
assert(indicator.getActiveTask() === null, 'Initial active task should be null');
assert(indicator.isExpanded() === false, 'Initial expanded should be false');
assert(indicator.isCompleted() === false, 'Initial completed should be false');
assert(indicator.isDropdownOpen() === false, 'Initial dropdown should be closed');
assert(indicator.getLabelText() === '', 'Initial label text should be empty');
assert(indicator.getExpandedText() === '', 'Initial expanded text should be empty');
assert(indicator.visible === false, 'Initial widget must be hidden when no active task exists');

// Signal presence and emission verification
let modeChangedVal = null;
let taskUpdatedVal = null;
let completionStateVal = null;
let dropdownToggledVal = null;

const s1 = indicator.connect('mode-changed', (btn, mode) => { modeChangedVal = mode; });
const s2 = indicator.connect('task-updated', (btn, task) => { taskUpdatedVal = task; });
const s3 = indicator.connect('completion-state-changed', (btn, state) => { completionStateVal = state; });
const s4 = indicator.connect('dropdown-toggled', (btn, open) => { dropdownToggledVal = open; });

indicator.setMode('hover');
assert(modeChangedVal === 'hover', `Expected mode-changed 'hover', got '${modeChangedVal}'`);

indicator.disconnect(s1);
indicator.disconnect(s2);
indicator.disconnect(s3);
indicator.disconnect(s4);
indicator.destroy();

// ---------------------------------------------------------------------
// 2. Task Updates, Formatting, and Input Sanitization
// ---------------------------------------------------------------------
console.log('2. Verifying task updates, compact formatting, ETA normalization & expanded telemetry...');
const indFormatting = new TaskIndicatorButton(null, null);

// Test standard telemetry payload from implementation plan
indFormatting.updateTask({
    title: 'the.bombin...e.in.zip',
    progress: 0.42,
    etaText: '1m left',
    speedText: '25.0 MB/s',
    bytesText: '1.1 GB / 3.6 GB',
});

assert(indFormatting.visible === true, 'Indicator should become visible when task arrives');
assert(indFormatting.getLabelText() === '42% · 1m', `Expected '42% · 1m', got '${indFormatting.getLabelText()}'`);
assert(
    indFormatting.getExpandedText() === '1.1 GB / 3.6 GB • 25.0 MB/s • the.bombin...e.in.zip',
    `Expanded telemetry mismatch: got '${indFormatting.getExpandedText()}'`
);

// Progress without ETA
indFormatting.updateTask({
    title: 'Download.iso',
    progress: 0.85,
});
assert(indFormatting.getLabelText() === '85%', `Expected '85%', got '${indFormatting.getLabelText()}'`);
assert(indFormatting.getExpandedText() === 'Download.iso', `Expected 'Download.iso', got '${indFormatting.getExpandedText()}'`);

// ETA formats: '45s left' -> '45s', '2h 10m left' -> '2h 10m'
indFormatting.updateTask({
    title: 'Archive.tar',
    progress: 0.10,
    etaText: '45s left',
});
assert(indFormatting.getLabelText() === '10% · 45s', `Expected '10% · 45s', got '${indFormatting.getLabelText()}'`);

indFormatting.updateTask({
    title: 'Backup.tar',
    progress: 0.05,
    etaText: '2h 10m left',
});
assert(indFormatting.getLabelText() === '5% · 2h 10m', `Expected '5% · 2h 10m', got '${indFormatting.getLabelText()}'`);

// 0% and 100% boundary
indFormatting.updateTask({ progress: 0.0, etaText: 'estimating' });
assert(indFormatting.getLabelText() === '0% · estimating', `Expected '0% · estimating', got '${indFormatting.getLabelText()}'`);

indFormatting.updateTask({ progress: 1.0 });
assert(indFormatting.getLabelText() === '100%', `Expected '100%', got '${indFormatting.getLabelText()}'`);

// Robustness: NaN, negative, and oversized progress values
indFormatting.updateTask({ progress: NaN });
assert(indFormatting.getLabelText() === '0%', `NaN progress should be normalized to 0%, got '${indFormatting.getLabelText()}'`);

indFormatting.updateTask({ progress: -0.5 });
assert(indFormatting.getLabelText() === '0%', `Negative progress should clamp to 0%, got '${indFormatting.getLabelText()}'`);

indFormatting.updateTask({ progress: 150 });
assert(indFormatting.getLabelText() === '100%', `Oversized progress should clamp to 100%, got '${indFormatting.getLabelText()}'`);

// Indeterminate state (Nautilus copy, spinner)
indFormatting.updateTask({
    indeterminate: true,
    summary: 'Transferring files',
});
assert(indFormatting.getLabelText() === 'Transferring files', `Expected 'Transferring files', got '${indFormatting.getLabelText()}'`);

indFormatting.destroy();

// ---------------------------------------------------------------------
// 2b. Deterministic Label Deduplication & Anti-Slop Formatting
// ---------------------------------------------------------------------
console.log('2b. Verifying label deduplication, anti-slop formatting & strict telemetry visibility...');
const indDedup = new TaskIndicatorButton(null, null, { appLabel: 'Files' });

// 1. Indeterminate task with appLabel="Files", summary="Deleting Files", title="Files"
// Must display "Deleting..." (NOT "Deleting Files Files" or "Deleting Files")
indDedup.updateTask({
    title: 'Files',
    summary: 'Deleting Files',
    indeterminate: true,
}, 'Files');

assert(
    indDedup.getLabelText() === 'Deleting...',
    `Expected compact label 'Deleting...', got '${indDedup.getLabelText()}'`
);

// Format compact label method directly with appLabel
assert(
    indDedup.formatCompactLabel({ title: 'Files', summary: 'Deleting Files', indeterminate: true }, 'Files') === 'Deleting...',
    `formatCompactLabel direct check failed, got '${indDedup.formatCompactLabel({ title: 'Files', summary: 'Deleting Files', indeterminate: true }, 'Files')}'`
);

// 2. Telemetry label widget must be strictly hidden when collapsed (_isExpanded === false)
assert(indDedup.isExpanded() === false, 'Indicator should be collapsed by default');
assert(indDedup._telemetryLabelWidget.visible === false, '_telemetryLabelWidget must be strictly hidden when _isExpanded is false');
assert(indDedup.getDisplayedTelemetryText() === '', 'getDisplayedTelemetryText must be empty string when not expanded');

// 3. Expanded telemetry filters out redundant app name
// When expanded, redundant app name "Files" in title must be filtered out
indDedup.setExpanded(true);
assert(indDedup.isExpanded() === true, 'Indicator should be expanded');
assert(indDedup._telemetryLabelWidget.visible === true, '_telemetryLabelWidget must be visible when expanded');
const expandedRunningText = indDedup.getExpandedText();
assert(
    !expandedRunningText.includes('Files Files'),
    `Expanded telemetry must not duplicate app name: '${expandedRunningText}'`
);
assert(
    !expandedRunningText.endsWith('Files'),
    `Expanded telemetry should filter out redundant app title: '${expandedRunningText}'`
);
assert(
    indDedup.formatExpandedTelemetry({ title: 'Files', summary: 'Deleting Files', indeterminate: true }, 'Files') === 'Deleting...',
    `Expected formatExpandedTelemetry to filter redundant title 'Files' and return 'Deleting...', got '${indDedup.formatExpandedTelemetry({ title: 'Files', summary: 'Deleting Files', indeterminate: true }, 'Files')}'`
);

// Telemetry with bytes and speed also filters out redundant app title
assert(
    indDedup.formatExpandedTelemetry({ title: 'Files', bytesText: '1.2 GB / 3.0 GB', speedText: '15 MB/s' }, 'Files') === '1.2 GB / 3.0 GB • 15 MB/s',
    `Expected redundant title 'Files' to be filtered out of telemetry parts, got '${indDedup.formatExpandedTelemetry({ title: 'Files', bytesText: '1.2 GB / 3.0 GB', speedText: '15 MB/s' }, 'Files')}'`
);

// Collapse back: verify strictly hidden again
indDedup.setExpanded(false);
assert(indDedup._telemetryLabelWidget.visible === false, '_telemetryLabelWidget must be strictly hidden after collapse');

// 4. Completed state: compact label displays "Done" (NOT "Done Files")
indDedup.setCompleted({ title: 'Files', summary: 'Deleting Files' }, 'Files');
assert(
    indDedup.getLabelText() === 'Done',
    `Expected compact label 'Done' on completion, got '${indDedup.getLabelText()}'`
);
assert(
    !indDedup.getLabelText().includes('Files'),
    `Compact label on completion must not append app name: '${indDedup.getLabelText()}'`
);

// Expanded telemetry on completed state returns "Completed"
const completedExpanded = indDedup.getExpandedText();
assert(
    completedExpanded === 'Completed',
    `Expected expanded telemetry 'Completed', got '${completedExpanded}'`
);
assert(
    !completedExpanded.includes('Files'),
    `Expanded telemetry on completion must not contain app name 'Files': '${completedExpanded}'`
);
assert(
    indDedup.formatExpandedTelemetry({ state: 'completed', title: 'Files' }, 'Files') === 'Completed',
    `formatExpandedTelemetry direct completion check failed: got '${indDedup.formatExpandedTelemetry({ state: 'completed', title: 'Files' }, 'Files')}'`
);

// _telemetryLabelWidget must remain strictly hidden when completed in compact mode
assert(indDedup._telemetryLabelWidget.visible === false, '_telemetryLabelWidget must be strictly hidden on completion when collapsed');

indDedup.destroy();

// ---------------------------------------------------------------------
// 2c. Telemetry Ease Animation Flicker Guard
// ---------------------------------------------------------------------
console.log('2c. Verifying telemetry ease animation does not flicker on periodic updates...');

const indFlicker = new TaskIndicatorButton(mockSettings, null);
let easeCallCount = 0;
indFlicker._telemetryLabelWidget.ease = function (params) {
    easeCallCount++;
    this.opacity = params.opacity;
};
indFlicker._telemetryLabelWidget.opacity = 0;

// Update task with initial payload while collapsed
indFlicker.updateTask({
    id: 'org.gnome.Nautilus',
    appName: 'Files',
    progress: 0.20,
    bytesText: '200 MB / 1.0 GB',
    speedText: '10 MB/s',
}, 'Files');

assert(indFlicker.isExpanded() === false, 'Indicator starts collapsed');
assert(easeCallCount === 0, 'No ease animation when collapsed');

// Expand telemetry -> transitions from collapsed, triggers ease animation
indFlicker.setExpanded(true);
assert(indFlicker.isExpanded() === true, 'Indicator expanded');
assert(easeCallCount === 1, 'Ease animation must trigger on initial expansion');
assert(indFlicker._telemetryLabelWidget.opacity === 255, 'Opacity eased to 255');
assert(indFlicker._telemetryLabelWidget.text.includes('200 MB'), 'Telemetry text displayed');

// Periodic progress update 1: 40% (bytes update)
indFlicker.updateTask({
    id: 'org.gnome.Nautilus',
    appName: 'Files',
    progress: 0.40,
    bytesText: '400 MB / 1.0 GB',
    speedText: '12 MB/s',
}, 'Files');

assert(easeCallCount === 1, 'Ease animation MUST NOT retrigger on periodic progress update');
assert(indFlicker._telemetryLabelWidget.opacity === 255, 'Opacity must NOT reset to 0');
assert(indFlicker._telemetryLabelWidget.text.includes('400 MB'), 'Telemetry text must update directly');

// Periodic progress update 2: 60% (bytes update)
indFlicker.updateTask({
    id: 'org.gnome.Nautilus',
    appName: 'Files',
    progress: 0.60,
    bytesText: '600 MB / 1.0 GB',
    speedText: '15 MB/s',
}, 'Files');

assert(easeCallCount === 1, 'Ease animation count must remain 1');
assert(indFlicker._telemetryLabelWidget.opacity === 255, 'Opacity must remain 255');
assert(indFlicker._telemetryLabelWidget.text.includes('600 MB'), 'Telemetry text must update directly');

// Collapse: opacity resets to 0 and widget hidden
indFlicker.setExpanded(false);
assert(indFlicker.isExpanded() === false, 'Indicator collapsed');
assert(indFlicker._telemetryLabelWidget.visible === false, 'Widget hidden when collapsed');
assert(indFlicker._telemetryLabelWidget.opacity === 0, 'Opacity reset to 0 on collapse');

// Re-expand: transitions from collapsed, triggers ease animation again
indFlicker.setExpanded(true);
assert(easeCallCount === 2, 'Ease animation triggers again on re-expansion');
assert(indFlicker._telemetryLabelWidget.opacity === 255, 'Opacity eased to 255 on re-expansion');

indFlicker.destroy();
console.log('-> Telemetry ease animation flicker guard checks PASSED.');

// ---------------------------------------------------------------------
// 3. Mode Switching and Interactive Behaviors ('compact', 'hover', 'slider')
// ---------------------------------------------------------------------
console.log('3. Verifying mode switching and interactive behaviors...');
const indModes = new TaskIndicatorButton(null, null);

// Mode: compact
indModes.setMode('compact');
assert(indModes.getMode() === 'compact', 'Mode must be compact');
assert(indModes.isExpanded() === false, 'Compact mode should not be expanded initially');
assert(indModes._sliderToggleWidget.visible === false, 'Slider toggle widget must be hidden in compact mode');

indModes.updateTask({
    title: 'test.zip',
    progress: 0.5,
    bytesText: '50 MB / 100 MB',
});

// Mode: hover
indModes.setMode('hover');
assert(indModes.getMode() === 'hover', 'Mode must be hover');
assert(indModes._sliderToggleWidget.visible === false, 'Slider toggle widget must be hidden in hover mode');

// Simulate pointer hover enter
indModes.onPointerEnter();
assert(indModes.isExpanded() === true, 'Hover mode should expand on pointer enter');
assert(indModes._telemetryLabelWidget.visible === true, 'Telemetry widget must be visible on hover');
assert(indModes.getExpandedText().includes('50 MB / 100 MB'), 'Expanded text must be available on hover');

// Simulate pointer hover leave
indModes.onPointerLeave();
assert(indModes.isExpanded() === false, 'Hover mode should collapse on pointer leave');
assert(indModes._telemetryLabelWidget.visible === false, 'Telemetry widget must be hidden after leave');

// Mode: slider
indModes.setMode('slider');
assert(indModes.getMode() === 'slider', 'Mode must be slider');
assert(indModes.isExpanded() === false, 'Slider mode starts collapsed');
assert(indModes._sliderToggleWidget.visible === true, 'Slider toggle widget must be visible in slider mode');
assert(indModes.getSliderToggleIconName() === 'go-next-symbolic', `Expected toggle icon 'go-next-symbolic', got '${indModes.getSliderToggleIconName()}'`);

// Click toggle button to expand
indModes.toggleSlider();
assert(indModes.isExpanded() === true, 'Slider mode must expand on toggle click');
assert(indModes._telemetryLabelWidget.visible === true, 'Telemetry widget must be visible after toggle');
assert(indModes.getSliderToggleIconName() === 'go-previous-symbolic', `Expected toggle icon 'go-previous-symbolic', got '${indModes.getSliderToggleIconName()}'`);

// Click toggle button to collapse
indModes.toggleSlider();
assert(indModes.isExpanded() === false, 'Slider mode must collapse on second toggle click');
assert(indModes._telemetryLabelWidget.visible === false, 'Telemetry widget must be hidden after toggle collapse');
assert(indModes.getSliderToggleIconName() === 'go-next-symbolic', `Expected toggle icon 'go-next-symbolic', got '${indModes.getSliderToggleIconName()}'`);

// Switching back to compact auto-collapses any expansion
indModes.setExpanded(true);
assert(indModes.isExpanded() === true);
indModes.setMode('compact');
assert(indModes.isExpanded() === false, 'Switching to compact must auto-collapse expanded telemetry');
assert(indModes._sliderToggleWidget.visible === false);

// Reject invalid modes
indModes.setMode('invalid_mode_name');
assert(indModes.getMode() === 'compact', 'Invalid mode should be rejected and keep current mode');

indModes.destroy();

// ---------------------------------------------------------------------
// 4. Center Clock Width Clamping & Graceful Collision Guard
// ---------------------------------------------------------------------
console.log('4. Verifying center clock width clamping, collision guard & boundary truncation...');
const indClamp = new TaskIndicatorButton(null, null, {
    centerBoxX: 800, // Center box starts at X = 800px
});

// Mock indicator coordinates: left anchor at X = 50px, compact width = 150px
indClamp.x = 50;
indClamp.width = 150;

// Available space before center box: 800 - (50 + 150) - margin(16) = 584px
const avail = indClamp.calculateAvailableSpace();
assert(avail === 584, `Expected available space 584px, got ${avail}px`);

// Case A: Requested telemetry width fits comfortably
const clampedFits = indClamp.clampTelemetryWidth(250, avail);
assert(clampedFits === 250, `Requested 250px should fit within 584px, got ${clampedFits}`);

// Case B: Requested telemetry width exceeds available space
const clampedExceeds = indClamp.clampTelemetryWidth(700, avail);
assert(clampedExceeds === 584, `Requested 700px must clamp to available 584px, got ${clampedExceeds}`);

// Case C: Available space zero or negative (narrow screen or crowded left box)
const clampedZero = indClamp.clampTelemetryWidth(300, 0);
assert(clampedZero === 0, `Clamped width on 0 available space should be 0, got ${clampedZero}`);

// Case D: Graceful text truncation for collision guard
const longText = '1.2 GB / 4.5 GB • 32.0 MB/s • very_long_telemetry_filename_that_exceeds_panel_space.tar.gz';
const truncated = indClamp.truncateTelemetry(longText, 35);
assert(truncated.length <= 35, `Truncated text must not exceed maxChars (35), length was ${truncated.length}`);
assert(truncated.endsWith('...'), `Truncated text should end with ellipsis '...', got '${truncated}'`);

// Critical boundary test: maxWidth === 0 must truncate to '...' rather than returning full text
const truncatedZero = indClamp.truncateTelemetry(longText, null, 0);
assert(truncatedZero === '...', `maxWidth = 0 must produce '...', got '${truncatedZero}'`);

// Text shorter than limit remains untouched
const shortText = '45 MB / 100 MB';
assert(indClamp.truncateTelemetry(shortText, 50) === shortText, 'Short text must not be truncated');

// Verify displayed telemetry reflects collision guard clamping
indClamp.updateTask({
    title: 'massive_telemetry_stream_from_server_backup.tar.gz',
    bytesText: '10.5 GB / 50.0 GB',
    speedText: '120 MB/s',
    progress: 0.2,
});
indClamp.setExpanded(true);
const displayed = indClamp.getDisplayedTelemetryText();
assert(displayed.length > 0, 'Displayed telemetry text must not be empty when expanded');
assert(displayed.length <= Math.floor(avail / 8), `Displayed telemetry must be clamped to available space, length was ${displayed.length}`);
assert(indClamp._telemetryLabelWidget.text === displayed, 'Label widget must display clamped string');

indClamp.destroy();

// ---------------------------------------------------------------------
// 5. Completion State, Done Badge, and Auto-Hide Lifecycle
// ---------------------------------------------------------------------
console.log('5. Verifying completion state, [ ✓ Done ] badge, and multi-task auto-collapse...');
const indCompletion = new TaskIndicatorButton(null, null, { autoHideSeconds: 0.1 }); // 100ms for test
let completionEmitted = false;
let collapseEmitted = false;

indCompletion.connect('completion-state-changed', (btn, isDone) => {
    if (isDone) completionEmitted = true;
    else collapseEmitted = true;
});

// Update with running task
indCompletion.updateTask({ title: 'Transfer', progress: 0.9 });
assert(indCompletion.isCompleted() === false, 'Initially should not be completed');

// Trigger task completion
indCompletion.setCompleted({ title: 'Transfer', progress: 1.0 });
assert(indCompletion.isCompleted() === true, 'isCompleted must be true');
assert(indCompletion.getLabelText() === 'Done', `Expected 'Done', got '${indCompletion.getLabelText()}'`);
assert(completionEmitted === true, 'completion-state-changed true must be emitted');
assert(Boolean(indCompletion._autoHideTimerId), 'Auto-hide timer must be active');

// Run GLib main loop to wait for auto-hide expiration
const loop = new GLib.MainLoop(null, false);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();

assert(collapseEmitted === true, 'completion-state-changed false must be emitted after auto-hide delay');
assert(indCompletion.isCompleted() === false, 'isCompleted must be false after auto-hide');
assert(!indCompletion._autoHideTimerId, 'Auto-hide timer must be cleared');
assert(indCompletion.getLabelText() === '', 'Label text should reset after auto-collapse');
assert(indCompletion.visible === false, 'Indicator should hide after auto-collapse when no other tasks exist');

// Test timer cancellation when new task arrives during Done flash
indCompletion.setCompleted({ title: 'Another task' });
assert(Boolean(indCompletion._autoHideTimerId), 'Timer active during second completion');
indCompletion.updateTask({ title: 'New active task', progress: 0.1 });
assert(!indCompletion._autoHideTimerId, 'Timer must be cancelled when new task arrives');
assert(indCompletion.isCompleted() === false, 'isCompleted must be reset by new task');
assert(indCompletion.getLabelText().includes('10%'), 'Label must update to new task');

indCompletion.destroy();

// Multi-task auto-collapse test: if Task B is still active when Task A completes, auto-collapse switches to Task B
const testTmpDir2 = GLib.dir_make_tmp('fuhgawz-test-ind-multi-XXXXXX');
const testCacheFile2 = GLib.build_filenamev([testTmpDir2, 'test-multi-recent.json']);
try {
    const tmMulti = new TaskManager(null, { cacheFile: testCacheFile2 });
    const indMulti = new TaskIndicatorButton(null, tmMulti, { autoHideSeconds: 0.1 });

    const id1 = tmMulti.RegisterTask('Task 1 (short)', 'app1');
    const id2 = tmMulti.RegisterTask('Task 2 (long)', 'app2');
    tmMulti.UpdateTask(id1, 0.9, 'almost done');
    tmMulti.UpdateTask(id2, 0.2, 'just started');

    indMulti.updateTask(tmMulti.getActiveTask(id1));
    indMulti.setCompleted(tmMulti.getActiveTask(id1));
    tmMulti.CompleteTask(id1, true);

    // Wait for auto-hide
    const loop2 = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        loop2.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop2.run();

    // After task 1 collapses, indicator should seamlessly switch to task 2 rather than disappearing
    assert(indMulti.getActiveTask() !== null, 'Should have switched to remaining active task');
    assert(indMulti.getActiveTask().id === id2, 'Active task should now be Task 2');
    assert(indMulti.visible === true, 'Indicator should remain visible for active Task 2');

    indMulti.destroy();
    tmMulti.destroy();
} finally {
    try {
        const dir = Gio.File.new_for_path(testTmpDir2);
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            dir.get_child(info.get_name()).delete(null);
        }
        dir.delete(null);
    } catch (e) {}
}

// ---------------------------------------------------------------------
// 6. Dropdown Menu Generation, Toggle, and Action Handlers
// ---------------------------------------------------------------------
console.log('6. Verifying dropdown menu generation, active card, pause/cancel/reveal and recent items...');
const testTmpDir = GLib.dir_make_tmp('fuhgawz-test-ind-XXXXXX');
const testCacheFile = GLib.build_filenamev([testTmpDir, 'test-dropdown-recent.json']);

try {
    const tm = new TaskManager(null, { cacheFile: testCacheFile });
    const indMenu = new TaskIndicatorButton(null, tm);

    // Register active task
    const taskId = tm.RegisterTask('Backup database', 'terminal');
    tm.UpdateTask(taskId, 0.45, '45% done');
    const activeTask = tm.getActiveTask(taskId);
    activeTask.bytesText = '450 MB / 1.0 GB';
    activeTask.speedText = '15 MB/s';
    activeTask.etaText = '2m left';
    activeTask.uri = 'file:///home/user/backup.db';

    // Populate a completed task for Recent Tasks section
    const pastTaskId = tm.RegisterTask('archive.tar.gz', 'org.gnome.Nautilus');
    const pastTask = tm.getActiveTask(pastTaskId);
    pastTask.uri = 'file:///home/user/Downloads/archive.tar.gz';
    tm.CompleteTask(pastTaskId, true);

    // Test toggleDropdown() open
    indMenu.toggleDropdown();
    assert(indMenu.isDropdownOpen() === true, 'toggleDropdown should open menu');

    const menuData = indMenu.getDropdownData();
    assert(menuData !== null, 'Dropdown data must be generated');
    assert(menuData.activeCard !== null, 'Active card must be present');
    assert(menuData.activeCard.title === 'Backup database', `Active title mismatch: '${menuData.activeCard.title}'`);
    assert(menuData.activeCard.progress === 0.45, `Active progress mismatch: ${menuData.activeCard.progress}`);
    assert(menuData.activeCard.bytesText === '450 MB / 1.0 GB', 'Active bytesText mismatch');

    // Verify fallback menu items structure
    const cardItem = indMenu.menu.items.find(i => i.type === 'card');
    assert(Boolean(cardItem), 'Card item must be added to menu');
    assert(cardItem.progressBar instanceof TaskProgressBar, 'Card must include TaskProgressBar instance');
    assert(typeof cardItem.actions.pause === 'function', 'Card must have pause action');
    assert(typeof cardItem.actions.cancel === 'function', 'Card must have cancel action');
    assert(typeof cardItem.actions.reveal === 'function', 'Card must have reveal action');

    // Test Action Buttons: pauseTask
    const didPause = indMenu.pauseTask(taskId);
    assert(didPause === true, 'pauseTask should succeed');
    assert(activeTask.paused === true, 'Task paused flag should be true');

    // Test Action Buttons: revealTask
    let revealedUri = null;
    indMenu.showInFiles = (uri) => {
        revealedUri = uri;
        return true;
    };
    const didReveal = indMenu.revealTask(taskId);
    assert(didReveal === true, 'revealTask should succeed');
    assert(revealedUri === 'file:///home/user/backup.db', 'revealTask URI mismatch');

    // Test Recent Tasks actions: "Show in Files", "Open File", "Copy Path"
    assert(Array.isArray(menuData.recentItems), 'recentItems must be an array');
    assert(menuData.recentItems.length >= 1, 'Should contain completed task in recentItems');
    assert(menuData.recentItems[0].title === 'archive.tar.gz', `Recent item title mismatch: '${menuData.recentItems[0].title}'`);

    const recentMenuItem = indMenu.menu.items.find(i => i.type === 'recent_item');
    assert(Boolean(recentMenuItem), 'Recent item must exist in menu items');
    assert(typeof recentMenuItem.actions.showInFiles === 'function', 'Recent item must have showInFiles action');
    assert(typeof recentMenuItem.actions.openFile === 'function', 'Recent item must have openFile action');
    assert(typeof recentMenuItem.actions.copyPath === 'function', 'Recent item must have copyPath action');

    // Test recent item action executions
    let openedUri = null;
    indMenu.openFile = (uri) => { openedUri = uri; return true; };
    const didShowRecent = recentMenuItem.actions.showInFiles();
    assert(didShowRecent === true, 'showInFiles on recent item must succeed');
    assert(revealedUri === 'file:///home/user/Downloads/archive.tar.gz', 'showInFiles URI mismatch');

    const didOpenRecent = recentMenuItem.actions.openFile();
    assert(didOpenRecent === true, 'openFile on recent item must succeed');
    assert(openedUri === 'file:///home/user/Downloads/archive.tar.gz', 'openFile URI mismatch');

    const didCopyPath = recentMenuItem.actions.copyPath();
    assert(didCopyPath === true, 'copyPath on recent item must succeed');
    assert(indMenu.getLastCopiedPath() === '/home/user/Downloads/archive.tar.gz', `Copied path mismatch: ${indMenu.getLastCopiedPath()}`);

    // Test cancelTask
    const didCancel = indMenu.cancelTask(taskId);
    assert(didCancel === true, 'cancelTask should succeed');
    assert(tm.getActiveTask(taskId) === null, 'Task must be cancelled in TaskManager');

    // Test toggleDropdown() close
    indMenu.toggleDropdown();
    assert(indMenu.isDropdownOpen() === false, 'toggleDropdown should close menu');

    // Test open-state-changed signal from menu actor
    indMenu.openDropdown();
    assert(indMenu.isDropdownOpen() === true);
    indMenu.menu.actor.hide(); // Simulates menu manager / outside click closing menu
    assert(indMenu.isDropdownOpen() === false, 'Menu actor hide must sync isDropdownOpen to false');

    indMenu.destroy();
    tm.destroy();
} finally {
    try {
        const dir = Gio.File.new_for_path(testTmpDir);
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            dir.get_child(info.get_name()).delete(null);
        }
        dir.delete(null);
    } catch (e) {}
}

// ---------------------------------------------------------------------
// 7. AppMenuButton Integration (`bindToAppMenu`)
// ---------------------------------------------------------------------
console.log('7. Verifying AppMenuButton binding and actor injection...');
const indAppMenu = new TaskIndicatorButton(null, null);

class MockActor {
    constructor() {
        this.children = [];
    }
    add_child(child) {
        this.children.push(child);
        child._parent = this;
    }
    remove_child(child) {
        this.children = this.children.filter(c => c !== child);
        if (child._parent === this) child._parent = null;
    }
    get_children() {
        return this.children.slice();
    }
}

const mockAppMenuButton = new MockActor();
mockAppMenuButton._box = new MockActor();

// Bind to AppMenuButton
indAppMenu.bindToAppMenu(mockAppMenuButton);
assert(mockAppMenuButton._box.children.length === 1, 'Indicator actor must be added to AppMenuButton._box');
assert(mockAppMenuButton.children.length === 1, 'Progress bar actor must be added to AppMenuButton');

// Idempotent binding: re-binding must not add duplicate actors
indAppMenu.bindToAppMenu(mockAppMenuButton);
assert(mockAppMenuButton._box.children.length === 1, 'Re-binding must not create duplicate indicator in _box');
assert(mockAppMenuButton.children.length === 1, 'Re-binding must not create duplicate progress bar in AppMenuButton');

// Destroying indicator must safely remove actors from parent
indAppMenu.destroy();
assert(mockAppMenuButton._box.children.length === 0, 'Destroy must remove indicator from _box');
assert(mockAppMenuButton.children.length === 0, 'Destroy must remove progress bar from AppMenuButton');

// ---------------------------------------------------------------------
// 8. Zero Leaks, GSettings Sync & Clean Teardown (`destroy`)
// ---------------------------------------------------------------------
console.log('8. Verifying GSettings reactivity, clean teardown, and signal disconnection...');
const tmTeardown = new TaskManager(null);
const indTeardown = new TaskIndicatorButton(mockSettings, tmTeardown);

// Update with task and start completion timer
indTeardown.updateTask({ title: 'Teardown task', progress: 0.5 });
assert(indTeardown.visible === true, 'Indicator visible with active task');

// Test enable-task-indicator GSettings toggle
mockSettings.set_boolean('enable-task-indicator', false);
assert(indTeardown.visible === false, 'Indicator must hide when enable-task-indicator is false');
mockSettings.set_boolean('enable-task-indicator', true);
assert(indTeardown.visible === true, 'Indicator must reappear when enable-task-indicator is true');

indTeardown.setCompleted({ title: 'Teardown task' });
assert(Boolean(indTeardown._autoHideTimerId), 'Timer must be active before destroy');

// Destroy
indTeardown.destroy();

assert(!indTeardown._autoHideTimerId, 'Auto-hide timer must be cleared on destroy');
assert(indTeardown._destroyed === true, '_destroyed flag must be true');

// Verify TaskManager signals no longer invoke destroyed indicator
const dummyId = tmTeardown.RegisterTask('Post Destroy', 'terminal');
tmTeardown.UpdateTask(dummyId, 0.5, '50%');
assert(indTeardown.getActiveTask() === null, 'Active task must remain null after destroy');

// Idempotent destroy calls
indTeardown.destroy();
indTeardown.destroy();

tmTeardown.destroy();

// Relative time helper check
assert(formatRelativeTime(Date.now() - 5000) === '5s ago', 'Relative time 5s ago check');
assert(formatRelativeTime(Date.now() - 120000) === '2m ago', 'Relative time 2m ago check');
assert(formatRelativeTime(Date.now() - 7200000) === '2h ago', 'Relative time 2h ago check');
assert(formatRelativeTime(Date.now() - 86400000 * 3) === '3d ago', 'Relative time 3d ago check');

// ---------------------------------------------------------------------
// 9. Click Reactivity for `>>` Expander, `•••` Popover & AppMenu Event Isolation
// ---------------------------------------------------------------------
console.log('9. Verifying click reactivity for _sliderToggleWidget, _actionButton & AppMenu event isolation...');
const indClick = new TaskIndicatorButton(mockSettings, null);

// 1. Verify buttons exist and have reactive properties
assert(indClick._sliderToggleWidget !== undefined && indClick._sliderToggleWidget !== null,
    '_sliderToggleWidget must exist');
assert(indClick._actionButton !== undefined && indClick._actionButton !== null,
    '_actionButton must exist');

assert(indClick._sliderToggleWidget.reactive === true,
    '_sliderToggleWidget must have reactive: true');
assert(indClick._sliderToggleWidget.can_focus === true,
    '_sliderToggleWidget must have can_focus: true');
assert(indClick._sliderToggleWidget.track_hover === true,
    '_sliderToggleWidget must have track_hover: true');

assert(indClick._actionButton.reactive === true,
    '_actionButton must have reactive: true');
assert(indClick._actionButton.can_focus === true,
    '_actionButton must have can_focus: true');
assert(indClick._actionButton.track_hover === true,
    '_actionButton must have track_hover: true');

// 2. Set mode to slider and provide an active task
indClick.setMode('slider');
assert(indClick.getMode() === 'slider', 'Mode must be slider');
assert(indClick.isExpanded() === false, 'Initially collapsed');

indClick.updateTask({
    title: 'Download.tar.gz',
    progress: 0.6,
    bytesText: '600 MB / 1 GB',
});

// 3. Test _sliderToggleWidget click reactivity
// Directly clicking _sliderToggleWidget must toggle isExpanded()
assert(typeof indClick._sliderToggleWidget.click === 'function' || typeof indClick._sliderToggleWidget.emit === 'function',
    '_sliderToggleWidget must support click event simulation');

// Simulate click on _sliderToggleWidget
if (typeof indClick._sliderToggleWidget.click === 'function') {
    indClick._sliderToggleWidget.click();
} else {
    indClick._sliderToggleWidget.emit('clicked');
}
assert(indClick.isExpanded() === true, 'Clicking _sliderToggleWidget must expand indicator');
assert(indClick.getSliderToggleIconName() === 'go-previous-symbolic', 'Icon must be go-previous-symbolic when expanded');
assert(indClick._telemetryLabelWidget.visible === true, 'Telemetry must be visible when expanded');

// Click again to collapse
if (typeof indClick._sliderToggleWidget.click === 'function') {
    indClick._sliderToggleWidget.click();
} else {
    indClick._sliderToggleWidget.emit('clicked');
}
assert(indClick.isExpanded() === false, 'Clicking _sliderToggleWidget again must collapse indicator');
assert(indClick.getSliderToggleIconName() === 'go-next-symbolic', 'Icon must be go-next-symbolic when collapsed');
assert(indClick._telemetryLabelWidget.visible === false, 'Telemetry must be hidden when collapsed');

// 4. Test _actionButton click reactivity and dropdown-toggled signal
let dropdownToggledSignalVal = null;
const dropSigId = indClick.connect('dropdown-toggled', (btn, isOpen) => {
    dropdownToggledSignalVal = isOpen;
});

assert(indClick.isDropdownOpen() === false, 'Initially dropdown is closed');

// Simulate click on _actionButton
if (typeof indClick._actionButton.click === 'function') {
    indClick._actionButton.click();
} else {
    indClick._actionButton.emit('clicked');
}
assert(indClick.isDropdownOpen() === true, 'Clicking _actionButton must open dropdown');
assert(dropdownToggledSignalVal === true, 'dropdown-toggled signal must be emitted with true');

// Click again to close
if (typeof indClick._actionButton.click === 'function') {
    indClick._actionButton.click();
} else {
    indClick._actionButton.emit('clicked');
}
assert(indClick.isDropdownOpen() === false, 'Clicking _actionButton again must close dropdown');
assert(dropdownToggledSignalVal === false, 'dropdown-toggled signal must be emitted with false');

indClick.disconnect(dropSigId);

// 5. Test AppMenuButton event isolation: child clicks do NOT trigger AppMenu popup toggle
class MockAppMenuWithPopup extends MockActor {
    constructor() {
        super();
        this._box = new MockActor();
        this._box._parent = this;
        this.add_child(this._box);
        this.menuToggled = false;
        this.menu = {
            isOpen: false,
            toggle: () => {
                this.menuToggled = true;
                this.menu.isOpen = !this.menu.isOpen;
            },
        };
        this._handlers = new Map();
    }
    connect(sig, handler) {
        if (!this._handlers.has(sig)) this._handlers.set(sig, []);
        const id = this._handlers.get(sig).length + 1;
        this._handlers.get(sig).push({ id, handler });
        return id;
    }
    disconnect(id) {
        for (const list of this._handlers.values()) {
            const idx = list.findIndex(h => h.id === id);
            if (idx >= 0) {
                list.splice(idx, 1);
                return;
            }
        }
    }
    emit(sig, ...args) {
        const list = this._handlers.get(sig) || [];
        let res = undefined;
        for (const { handler } of list) {
            res = handler(this, ...args);
        }
        return res;
    }
}

const mockAppMenuWithPopup = new MockAppMenuWithPopup();
indClick.bindToAppMenu(mockAppMenuWithPopup);

// Simulate click on _sliderToggleWidget while bound to AppMenu
mockAppMenuWithPopup.menuToggled = false;
if (typeof indClick._sliderToggleWidget.click === 'function') {
    indClick._sliderToggleWidget.click();
} else {
    indClick._sliderToggleWidget.emit('clicked');
}
assert(indClick.isExpanded() === true, '_sliderToggleWidget click must still expand');
assert(mockAppMenuWithPopup.menuToggled === false,
    'Clicking _sliderToggleWidget must NOT toggle AppMenuButton menu');

// Simulate click on _actionButton while bound to AppMenu
mockAppMenuWithPopup.menuToggled = false;
if (typeof indClick._actionButton.click === 'function') {
    indClick._actionButton.click();
} else {
    indClick._actionButton.emit('clicked');
}
assert(indClick.isDropdownOpen() === true, '_actionButton click must still open task dropdown');
assert(mockAppMenuWithPopup.menuToggled === false,
    'Clicking _actionButton must NOT toggle AppMenuButton menu');

// 6. Test isDescendantOf helper
console.log('Verifying isDescendantOf helper...');
const parentNode = { get_parent: () => null };
const childNode = { get_parent: () => parentNode };
const deepChildNode = { get_parent: () => childNode };
const unrelatedNode = { get_parent: () => null };
assert(indClick.isDescendantOf(childNode, parentNode) === true, 'Child is descendant of parent');
assert(indClick.isDescendantOf(deepChildNode, parentNode) === true, 'Deep child is descendant of parent');
assert(indClick.isDescendantOf(unrelatedNode, parentNode) === false, 'Unrelated node is not descendant');

// 7. Test standalone placement event stoppage
console.log('Verifying standalone button-press-event routing...');
indClick.setPlacement('standalone');
assert(indClick.getPlacement() === 'standalone', 'Indicator placement is standalone');
indClick.closeDropdown(); // Reset

// Mock button press event
class MockEvent {
    constructor(source) {
        this._source = source;
    }
    get_source() {
        return this._source;
    }
}

// 7a. Click on slider toggle widget must return EVENT_STOP and NOT open menu
const sliderEvent = new MockEvent(indClick._sliderToggleWidget);
const resSlider = indClick.emit('button-press-event', sliderEvent);
assert(indClick.isDropdownOpen() === false, 'Clicking slider toggle in standalone must NOT open dropdown');
assert(resSlider === true || resSlider === (Clutter ? Clutter.EVENT_STOP : true), 'Slider toggle click must stop propagation');

// 7b. Click on action button must return EVENT_STOP
const actionEvent = new MockEvent(indClick._actionButton);
const resAction = indClick.emit('button-press-event', actionEvent);
assert(resAction === true || resAction === (Clutter ? Clutter.EVENT_STOP : true), 'Action button click must stop propagation');

// 7c. Click on indicator body must open menu and return EVENT_STOP
const bodyEvent = new MockEvent(indClick);
const resBody = indClick.emit('button-press-event', bodyEvent);
assert(indClick.isDropdownOpen() === true, 'Clicking body in standalone must open dropdown');
assert(resBody === true || resBody === (Clutter ? Clutter.EVENT_STOP : true), 'Body click must stop propagation');

// Clean up
indClick.destroy();
assert(mockAppMenuWithPopup.menuToggled === false);

console.log('TaskIndicatorButton test suite passed with 100% success!');



// ---------------------------------------------------------------------
// 10. Task 3 Specific Requirements
// ---------------------------------------------------------------------
console.log('10. Verifying Task 3 specific UI and anti-duplication logic...');
const indTask3 = new TaskIndicatorButton(mockSettings, null);

indTask3.updateTask({
    title: 'test.zip',
    progress: 0.5,
});

assert(indTask3._statusIconWidget !== undefined, '_statusIconWidget must exist');
assert(indTask3._statusIconWidget.icon_name === 'process-working-symbolic', `Expected _statusIconWidget to have 'process-working-symbolic', got '${indTask3._statusIconWidget.icon_name}'`);

indTask3.setCompleted({ title: 'test.zip' });
assert(indTask3._statusIconWidget.icon_name === 'object-select-symbolic', `Expected _statusIconWidget to have 'object-select-symbolic', got '${indTask3._statusIconWidget.icon_name}'`);

indTask3.setMode('slider');
assert(indTask3._sliderToggleWidget !== undefined, '_sliderToggleWidget must exist');
assert(indTask3._sliderToggleIcon !== undefined, '_sliderToggleIcon must exist inside slider toggle');
assert(indTask3._sliderToggleIcon.icon_name === 'go-next-symbolic', 'Slider toggle icon must be go-next-symbolic when collapsed');

indTask3.toggleSlider();
assert(indTask3._sliderToggleIcon.icon_name === 'go-previous-symbolic', 'Slider toggle icon must be go-previous-symbolic when expanded');

assert(indTask3._actionIcon !== undefined, '_actionIcon must exist inside action button');
assert(indTask3._actionIcon.icon_name === 'view-more-symbolic', 'Action icon must be view-more-symbolic');

// Filename telemetry anti-duplication
indTask3.updateTask({
    title: 'Files',
    summary: 'Deleting...',
    fileName: 'xCodium.json',
    indeterminate: true,
}, 'Files');
assert(indTask3.formatExpandedTelemetry(indTask3.getActiveTask(), 'Files') === 'xCodium.json', `Expected 'xCodium.json', got '${indTask3.formatExpandedTelemetry(indTask3.getActiveTask(), 'Files')}'`);

indTask3.destroy();
console.log('-> Task 3 specific requirements PASSED.');

console.log('ALL TESTS PASSED SUCCESSFULLY!');
