import { TaskManager } from '../src/taskManager.js';
import { TaskIndicatorButton } from '../src/taskIndicatorButton.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('=== Regression Test: Phantom Duplicated Dots & Idle Menu State ===');

const tm = new TaskManager();
const btn = new TaskIndicatorButton(null, tm);

// Test 1: Initial idle state with 0 active tasks
assert(tm.getAllActiveTasks().length === 0, 'Initial active tasks must be 0');
assert(btn.hasLiveIndicator() === false, 'btn.hasLiveIndicator() must be false when no task is active');
assert(btn.visible === false, 'btn.visible must be false when idle');
assert(btn._statusIconWidget.visible === false, 'btn._statusIconWidget must NOT be visible when idle (no phantom loading dots)');
assert(btn._actionButton.visible === false, 'btn._actionButton must NOT be visible when idle (no phantom more-actions dots)');
assert(btn._compactLabelWidget.visible === false, 'btn._compactLabelWidget must NOT be visible when idle');

// Test 2: Hovering menu zone when NO task is active must NOT display phantom dots
btn.onMenuZoneEnter();
assert(btn.visible === false, 'btn.visible must remain false after onMenuZoneEnter with no active task');
assert(btn._statusIconWidget.visible === false, 'btn._statusIconWidget must remain false after onMenuZoneEnter (no phantom dots)');
assert(btn._actionButton.visible === false, 'btn._actionButton must remain false after onMenuZoneEnter');
assert(btn._compactLabelWidget.visible === false, 'btn._compactLabelWidget must remain false after onMenuZoneEnter');

// Test 3: Leaving menu zone returns cleanly
btn.onMenuZoneLeave();
assert(btn.visible === false, 'btn.visible must remain false after onMenuZoneLeave');
assert(btn._statusIconWidget.visible === false, 'btn._statusIconWidget must remain false');
assert(btn._actionButton.visible === false, 'btn._actionButton must remain false');

// Test 4: When a real task starts, UI components activate properly
tm._handleUnityProgress('application://org.gnome.Nautilus.desktop', {
    progress: 0.45,
    'progress-visible': true,
});
const activeTasks = tm.getAllActiveTasks();
assert(activeTasks.length > 0, 'activeTasks must have at least 1 task');
btn.updateTask(activeTasks[0]);
assert(btn.hasLiveIndicator() === true, 'btn.hasLiveIndicator() must be true when task is running');
assert(btn.visible === true, 'btn.visible must be true when task is running');
assert(btn._statusIconWidget.visible === true, 'btn._statusIconWidget must be visible when task is running');
assert(btn._actionButton.visible === true, 'btn._actionButton must be visible when task is running');
assert(btn._compactLabelWidget.visible === true, 'btn._compactLabelWidget must be visible when task is running');

// Test 5: Removing the task hides UI components again
tm.cancelTask(tm.getAllActiveTasks()[0].id);
btn.updateTask(null);
btn._syncVisibility();
assert(btn.hasLiveIndicator() === false, 'btn.hasLiveIndicator() must be false after task completion');
assert(btn.visible === false, 'btn.visible must be false after task completion');
assert(btn._statusIconWidget.visible === false, 'btn._statusIconWidget must be hidden after task completion');
assert(btn._actionButton.visible === false, 'btn._actionButton must be hidden after task completion');
assert(btn._compactLabelWidget.visible === false, 'btn._compactLabelWidget must be hidden after task completion');

console.log('-> Phantom Duplicated Dots & Idle Menu State regression test PASSED cleanly.');
