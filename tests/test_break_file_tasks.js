import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { TaskManager } from '../src/taskManager.js';
import { TaskIndicatorButton } from '../src/taskIndicatorButton.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        failed++;
        throw new Error(message);
    } else {
        passed++;
    }
}

console.log('=== BREAKING PRIOR ATTEMPT: Testing File Task Synchronization & UI ===');

// ---------------------------------------------------------------------
// TEST 1: Multi-file copy with reason "Copying files" (Plural, no numbers)
// ---------------------------------------------------------------------
console.log('\n--- Test 1: Multi-file copy with reason "Copying files" ---');
const tm = new TaskManager();

// Simulate Nautilus inhibitor added for "Copying files"
// Nautilus passes reason = "Copying files" and appId = "org.gnome.Nautilus"
tm._handleInhibitorAdded('/org/gnome/SessionManager/Inhibitor1', 'org.gnome.Nautilus', 'Copying files');

const task1 = tm.getActiveTask('inhibitor:/org/gnome/SessionManager/Inhibitor1');
assert(task1 !== null, 'Task must be registered in active tasks');
console.log('Task 1 initial state:', {
    indeterminate: task1.indeterminate,
    totalBytes: task1.totalBytes,
    progress: task1.progress,
    summary: task1.summary
});

// If task1 was assigned a single file's totalBytes (e.g., 1MB), simulate I/O progress exceeding that
const mon = tm._nautilusMonitors.get(task1.id);
if (mon) {
    // If monitor was started with totalBytes = 1MB
    mon.totalBytes = 1000000;
    mon.accumulatedCopied = 5000000; // Copied 5MB (exceeded single file!)
    // Trigger the monitor logic
}

// ---------------------------------------------------------------------
// TEST 2: Popover getDropdownData() fields
// ---------------------------------------------------------------------
console.log('\n--- Test 2: Popover activeCard data fields ---');
const button = new TaskIndicatorButton(null, tm);
button.updateTask({
    id: 'test-del-1',
    title: 'Deleted files',
    appId: 'org.gnome.Nautilus',
    opType: 'delete',
    summary: 'Deleting files',
    state: 'running',
    canCancel: false,
    indeterminate: true,
    progress: 0.0,
});

const dropdownData = button.getDropdownData();
console.log('dropdownData.activeCard:', dropdownData.activeCard);

try {
    assert(dropdownData.activeCard.opType === 'delete', 'activeCard must preserve opType');
    assert(dropdownData.activeCard.state === 'running', 'activeCard must preserve state');
    assert(dropdownData.activeCard.canCancel === false, 'activeCard must preserve canCancel');
} catch (e) {
    console.log('Test 2 FAILED as expected on prior attempt:', e.message);
}

// ---------------------------------------------------------------------
// TEST 3: Delete / Trash operation completion title
// ---------------------------------------------------------------------
console.log('\n--- Test 3: Delete / Trash operation completion title ---');
tm._handleInhibitorAdded('/org/gnome/SessionManager/Inhibitor2', 'org.gnome.Nautilus', 'Deleting files');
const task2 = tm.getActiveTask('inhibitor:/org/gnome/SessionManager/Inhibitor2');
assert(task2 !== null, 'Delete task must exist');

tm._handleInhibitorRemoved('/org/gnome/SessionManager/Inhibitor2');
// Check recent task title
const recentTasks = tm.getRecentTasks();
const recentDel = recentTasks.find(t => t.id === 'inhibitor:/org/gnome/SessionManager/Inhibitor2');
assert(recentDel !== undefined, 'Completed delete task must be in recent tasks');
console.log('Completed delete task title:', recentDel.title);
try {
    assert(recentDel.title !== 'Files', `Completed delete task title must NOT be generic 'Files', got '${recentDel.title}'`);
} catch (e) {
    console.log('Test 3 FAILED as expected on prior attempt:', e.message);
}

// ---------------------------------------------------------------------
// TEST 4: Popover menu build with delete card
// ---------------------------------------------------------------------
console.log('\n--- Test 4: Popover card subtitle & icons for delete operation ---');
button.updateTask({
    id: 'test-del-2',
    title: 'Deleted files',
    opType: 'delete',
    summary: 'Deleting files',
    state: 'running',
    progress: 0.4,
});
assert(button._statusIconWidget.icon_name === 'user-trash-symbolic', `Expected _statusIconWidget to have 'user-trash-symbolic', got '${button._statusIconWidget.icon_name}'`);

button.updateTask({
    id: 'test-copy-2',
    title: 'Copying files',
    opType: 'copy',
    summary: 'Copying files',
    state: 'running',
    progress: 0.6,
});
assert(button._statusIconWidget.icon_name === 'edit-copy-symbolic', `Expected _statusIconWidget to have 'edit-copy-symbolic', got '${button._statusIconWidget.icon_name}'`);

button._buildDropdownMenu();

console.log(`\nResults: ${passed} passed, ${failed} failed`);

