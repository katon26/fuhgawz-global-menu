// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_taskProgressBar_logic.js - Unit test suite for TaskProgressBar logic, hairline rendering & timer lifecycle.

import cairo from 'cairo';
import GLib from 'gi://GLib';
import { TaskProgressBar, BAR_HEIGHT, ACCENT_COLOR } from '../src/taskProgressBar.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing TaskProgressBar logic, Cairo hairline painting, and timer lifecycle...');

// 1. Instantiation and Method Presence
console.log('1. Verifying instantiation and public interface...');
const bar = new TaskProgressBar();
assert(bar instanceof TaskProgressBar, 'bar must be an instance of TaskProgressBar');
assert(typeof bar.setProgress === 'function', 'setProgress method missing');
assert(typeof bar.setIndeterminate === 'function', 'setIndeterminate method missing');
assert(typeof bar.destroy === 'function', 'destroy method missing');
assert(typeof bar.queue_repaint === 'function', 'queue_repaint method missing');
assert(typeof bar.vfunc_repaint === 'function', 'vfunc_repaint method missing');
assert(typeof bar.vfunc_get_preferred_height === 'function', 'vfunc_get_preferred_height method missing');
assert(typeof bar.vfunc_get_preferred_width === 'function', 'vfunc_get_preferred_width method missing');

// Initial defaults
assert(bar.progress === 0.0, `Initial progress should be 0.0, got ${bar.progress}`);
assert(bar.indeterminate === false, `Initial indeterminate should be false, got ${bar.indeterminate}`);
assert(bar.height === BAR_HEIGHT, `Initial height should match BAR_HEIGHT (${BAR_HEIGHT}), got ${bar.height}`);
assert(ACCENT_COLOR === '#3584e4', `ACCENT_COLOR should be #3584e4, got ${ACCENT_COLOR}`);

// 2. Parameterized Constructor
console.log('2. Verifying parameterized constructor initialization...');
const barCustom = new TaskProgressBar({ progress: 0.75, indeterminate: true });
assert(Math.abs(barCustom.progress - 0.75) < 0.001, `Progress should initialize to 0.75, got ${barCustom.progress}`);
assert(barCustom.indeterminate === true, 'Indeterminate should initialize to true');
assert(Boolean(barCustom._pulseTimerId), 'Pulse timer should be active for indeterminate initial state');
barCustom.destroy();
assert(!barCustom._pulseTimerId, 'Custom bar timer must be cleared after destroy');

// 3. setProgress updates and boundary clamping
console.log('3. Verifying setProgress updates, property accessors, and boundary clamping [0.0, 1.0]...');
let progressNotified = false;
const notifyProgressId = bar.connect('notify::progress', () => {
    progressNotified = true;
});

bar.setProgress(0.42);
assert(Math.abs(bar.progress - 0.42) < 0.001, `Progress should be 0.42, got ${bar.progress}`);
assert(progressNotified === true, 'notify::progress must be emitted on progress change');

// Property setter syntax test
progressNotified = false;
bar.progress = 0.65;
assert(Math.abs(bar.progress - 0.65) < 0.001, `Progress should be 0.65 via setter, got ${bar.progress}`);
assert(progressNotified === true, 'notify::progress must be emitted via property setter');

// Redundant update should be a no-op and not re-emit
progressNotified = false;
bar.setProgress(0.65);
assert(progressNotified === false, 'Redundant setProgress must not re-emit notify::progress');

bar.setProgress(-0.5);
assert(bar.progress === 0.0, `Progress should clamp negative numbers to 0.0, got ${bar.progress}`);

bar.setProgress(1.5);
assert(bar.progress === 1.0, `Progress should clamp numbers > 1.0 to 1.0, got ${bar.progress}`);

bar.setProgress(0.0);
assert(bar.progress === 0.0, `Progress should accept 0.0, got ${bar.progress}`);

bar.setProgress(1.0);
assert(bar.progress === 1.0, `Progress should accept 1.0, got ${bar.progress}`);

// Non-numeric or NaN fallback
bar.setProgress(NaN);
assert(bar.progress === 0.0, `Progress should handle NaN safely, got ${bar.progress}`);

bar.setProgress('invalid');
assert(bar.progress === 0.0, `Progress should handle invalid strings safely, got ${bar.progress}`);

bar.disconnect(notifyProgressId);

// 4. setIndeterminate state and timer management
console.log('4. Verifying setIndeterminate toggling, property accessors, and timer lifecycle...');
assert(!bar._pulseTimerId, 'Pulse timer should initially be inactive');

let indeterminateNotified = false;
const notifyIndeterminateId = bar.connect('notify::indeterminate', () => {
    indeterminateNotified = true;
});

bar.setIndeterminate(true);
assert(bar.indeterminate === true, 'Indeterminate state mismatch after enabling');
assert(Boolean(bar._pulseTimerId), 'Pulse timer ID should be active when indeterminate');
assert(indeterminateNotified === true, 'notify::indeterminate must be emitted');

const timerId1 = bar._pulseTimerId;
// Setting true again should be idempotent and not create a duplicate timer
indeterminateNotified = false;
bar.setIndeterminate(true);
assert(bar._pulseTimerId === timerId1, 'Duplicate timer created on redundant setIndeterminate(true)');
assert(indeterminateNotified === false, 'Redundant setIndeterminate must not re-emit');

bar.setIndeterminate(false);
assert(bar.indeterminate === false, 'Indeterminate state mismatch after disabling');
assert(!bar._pulseTimerId, 'Pulse timer should be cleared when indeterminate is false');

// Property setter syntax test
bar.indeterminate = true;
assert(bar.indeterminate === true, 'Indeterminate state mismatch via setter');
assert(Boolean(bar._pulseTimerId), 'Timer should be active when set via property setter');
bar.indeterminate = false;
assert(!bar._pulseTimerId, 'Timer should be cleared when disabled via property setter');

// Truthy and falsy argument coercion
bar.setIndeterminate(1);
assert(bar.indeterminate === true, 'setIndeterminate(1) should coerce to true');
assert(Boolean(bar._pulseTimerId), 'Timer should be active for truthy value');

bar.setIndeterminate(0);
assert(bar.indeterminate === false, 'setIndeterminate(0) should coerce to false');
assert(!bar._pulseTimerId, 'Timer should be inactive for falsy value');

bar.disconnect(notifyIndeterminateId);

// 5. Zero Layout Thrashing Guarantee
console.log('5. Verifying zero layout thrashing (queue_repaint only, never queue_relayout)...');
let repaintCalls = 0;
const originalQueueRepaint = bar.queue_repaint.bind(bar);
bar.queue_repaint = () => {
    repaintCalls++;
    originalQueueRepaint();
};

let relayoutCalls = 0;
bar.queue_relayout = () => {
    relayoutCalls++;
};

bar.setProgress(0.75);
assert(repaintCalls > 0, 'setProgress must call queue_repaint');
assert(relayoutCalls === 0, 'setProgress must NEVER call queue_relayout');

const prevRepaint = repaintCalls;
bar.setIndeterminate(true);
assert(repaintCalls > prevRepaint, 'setIndeterminate must call queue_repaint');
assert(relayoutCalls === 0, 'setIndeterminate must NEVER call queue_relayout');

// Restore methods
bar.queue_repaint = originalQueueRepaint;
delete bar.queue_relayout;

// 6. Preferred Sizing
console.log('6. Verifying preferred sizing...');
const [minH, natH] = bar.vfunc_get_preferred_height(100);
assert(minH === BAR_HEIGHT && natH === BAR_HEIGHT, `Preferred height should be [${BAR_HEIGHT}, ${BAR_HEIGHT}], got [${minH}, ${natH}]`);
const [minW, natW] = bar.vfunc_get_preferred_width(minH);
assert(minW === 0 && natW === 0, `Preferred width should be [0, 0], got [${minW}, ${natW}]`);

// 7. Cairo Hairline Painting Execution & Exception Safety
console.log('7. Verifying Cairo hairline painting (_paintCairo & vfunc_repaint)...');
const testSurf = new cairo.ImageSurface(cairo.Format.ARGB32, 120, 24);
const testCr = new cairo.Context(testSurf);

// Test direct paint with determinate progress
bar.setProgress(0.65);
bar.setIndeterminate(false);
bar._paintCairo(testCr, 120, 24);

// Test direct paint with indeterminate pulse
bar.setIndeterminate(true);
bar._paintCairo(testCr, 120, 24);

// Test zero width/height guard (must not throw or divide by zero)
bar._paintCairo(testCr, 0, 24);
bar._paintCairo(testCr, 120, 0);
bar._paintCairo(testCr, 0, 0);

// Test vfunc_repaint with a mocked get_context / get_surface_size
bar.get_context = () => new cairo.Context(testSurf);
bar.get_surface_size = () => [120, 24];
bar.vfunc_repaint();

// Test exception safety during vfunc_repaint: cr.$dispose MUST still be called
let disposedAfterError = false;
bar.get_context = () => {
    const mockCr = new cairo.Context(testSurf);
    const origDispose = mockCr.$dispose.bind(mockCr);
    mockCr.$dispose = () => {
        disposedAfterError = true;
        origDispose();
    };
    return mockCr;
};
const origPaintCairo = bar._paintCairo;
bar._paintCairo = () => {
    throw new Error('Simulated paint error');
};
let caught = false;
try {
    bar.vfunc_repaint();
} catch (e) {
    caught = true;
}
assert(caught === true, 'vfunc_repaint should rethrow uncaught paint exceptions');
assert(disposedAfterError === true, 'cr.$dispose() must be invoked in finally block even on paint error');

// Restore original paint method
bar._paintCairo = origPaintCairo;

testCr.$dispose();

// 8. GLib MainLoop Pulse Animation Iteration
console.log('8. Verifying GLib timeout execution in active pulse state...');
bar.setIndeterminate(true);
let loopTicks = 0;
const loop = GLib.MainLoop.new(null, false);
bar.queue_repaint = () => {
    loopTicks++;
    if (loopTicks >= 3) {
        loop.quit();
    }
};
// Run the loop for up to 300ms
const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
GLib.source_remove(timeoutId);
assert(loopTicks >= 3, `Expected at least 3 pulse repaint ticks, got ${loopTicks}`);
bar.queue_repaint = originalQueueRepaint;

// 9. Stress Test: Rapid Burst Toggling
console.log('9. Verifying rapid burst toggling robustness...');
for (let i = 0; i < 50; i++) {
    bar.setIndeterminate(true);
    bar.setIndeterminate(false);
}
assert(!bar._pulseTimerId, 'Pulse timer must not be leaked after burst toggles');
assert(bar.indeterminate === false, 'Indeterminate state should be false after burst toggles');

// 10. Clean Teardown via destroy()
console.log('10. Verifying explicit destroy() teardown and idempotency...');
bar.setIndeterminate(true);
assert(Boolean(bar._pulseTimerId), 'Pulse timer should be active before destroy');
bar.destroy();

assert(!bar._pulseTimerId, 'Pulse timer should be cleared after destroy()');
assert(bar._destroyed === true, '_destroyed flag should be true');

// Post-destroy calls must be safe and not resurrect timers or throw
const prevProgress = bar.progress;
bar.setProgress(0.9);
assert(!bar._pulseTimerId, 'setProgress after destroy must not restart timer');
assert(bar.progress === prevProgress, 'setProgress after destroy must not mutate progress');

bar.setIndeterminate(true);
assert(!bar._pulseTimerId, 'setIndeterminate after destroy must not restart timer');
assert(bar.indeterminate === false, 'setIndeterminate after destroy must remain false');

// Multiple destroy() calls should be idempotent
bar.destroy();
bar.destroy();

// 11. External Destruction via GObject/Clutter 'destroy' Signal Emission
console.log('11. Verifying external destruction via "destroy" signal...');
const barSignal = new TaskProgressBar({ indeterminate: true });
assert(Boolean(barSignal._pulseTimerId), 'Timer should be active on barSignal');
assert(barSignal._destroyed === false, 'barSignal should not be destroyed yet');

// Simulate parent actor destroying children or Clutter emitting 'destroy'
barSignal.emit('destroy');
assert(barSignal._destroyed === true, '_destroyed must be true when "destroy" signal is emitted');
assert(!barSignal._pulseTimerId, 'Pulse timer must be cancelled when "destroy" signal is emitted');

// Subsequent calls on signal-destroyed bar must not leak timers
barSignal.setIndeterminate(true);
assert(!barSignal._pulseTimerId, 'setIndeterminate after signal destroy must not start timer');
barSignal.setProgress(0.5);
assert(!barSignal._pulseTimerId, 'setProgress after signal destroy must not start timer');

console.log('Task 2 TaskProgressBar logic test passed with 100% success!');
