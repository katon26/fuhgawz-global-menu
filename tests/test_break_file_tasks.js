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

// ---------------------------------------------------------------------
// TEST 5: Early removal before addition completes (race condition guard)
// ---------------------------------------------------------------------
console.log('\n--- Test 5: Early removal race condition guard ---');
const racePath = '/org/gnome/SessionManager/InhibitorRace1';
tm._pendingInhibitors.add(racePath);
assert(tm._pendingInhibitors.has(racePath), 'Inhibitor must be marked pending');

// InhibitorRemoved arrives while async D-Bus calls are still in flight
tm._handleInhibitorRemoved(racePath);
assert(!tm._pendingInhibitors.has(racePath), 'Pending inhibitor must be removed from pending set');
assert(tm._earlyRemovedInhibitors.has(racePath), 'Must be recorded in _earlyRemovedInhibitors');

// When async callback completes, it checks _earlyRemovedInhibitors and aborts
let addedZombie = false;
if (tm._earlyRemovedInhibitors.has(racePath)) {
    tm._earlyRemovedInhibitors.delete(racePath);
    // Aborted cleanly: does NOT call _handleInhibitorAdded
} else {
    tm._handleInhibitorAdded(racePath, 'org.gnome.Nautilus', 'Copying files');
    addedZombie = true;
}
assert(addedZombie === false, 'Early removed inhibitor must NOT become a zombie task');
assert(tm.getActiveTask(`inhibitor:${racePath}`) === null, 'No zombie task must exist');

// ---------------------------------------------------------------------
// TEST 6: Probe progress reaching 1.0 (100%) completes inhibitor task
// ---------------------------------------------------------------------
console.log('\n--- Test 6: Probe progress reaching 1.0 completes inhibitor task ---');
const probeInhibitor = '/org/gnome/SessionManager/InhibitorProbe100';
tm._handleInhibitorAdded(probeInhibitor, 'org.gnome.Nautilus', 'Copying files');
const taskId100 = `inhibitor:${probeInhibitor}`;
assert(tm.getActiveTask(taskId100) !== null, 'Probe task must be active initially');

// Emit probe update reaching 1.0 (100%)
let probeCompletedEmitted = false;
let probeRemovedEmitted = false;
const compSigId = tm.connect('task-completed', (m, t) => {
    if (t.id === taskId100) probeCompletedEmitted = true;
});
const remSigId = tm.connect('task-removed', (m, id) => {
    if (id === taskId100) probeRemovedEmitted = true;
});

tm._onProbeLine(taskId100, JSON.stringify({
    progress: 1.0,
    bytesText: '500 MB / 500 MB',
    etaText: 'Completed',
    totalBytes: 500000000,
}));

assert(probeCompletedEmitted === true, 'task-completed must be emitted when probe hits 1.0');
assert(probeRemovedEmitted === true, 'task-removed must be emitted when probe hits 1.0');
assert(tm.getActiveTask(taskId100) === null, 'Task must be removed from active tasks once probe hits 1.0');
tm.disconnect(compSigId);
tm.disconnect(remSigId);

// ---------------------------------------------------------------------
// TEST 7: Drag & drop operation label and operation type mapping
// ---------------------------------------------------------------------
console.log('\n--- Test 7: Drag & drop opType and label mapping ---');
const { deriveOperationLabel, operationTypeFromLabel } = await import('../src/taskManager.js');

assert(deriveOperationLabel('drag and drop') === 'Transferring files', `Expected 'Transferring files', got '${deriveOperationLabel('drag and drop')}'`);
assert(deriveOperationLabel('') === 'Transferring files', `Expected 'Transferring files', got '${deriveOperationLabel('')}'`);
assert(deriveOperationLabel('Working on files') === 'Working on files', `Expected 'Working on files', got '${deriveOperationLabel('Working on files')}'`);
assert(operationTypeFromLabel('Working on files') === 'transfer', `Expected 'transfer', got '${operationTypeFromLabel('Working on files')}'`);
assert(operationTypeFromLabel('Transferring files') === 'transfer', `Expected 'transfer', got '${operationTypeFromLabel('Transferring files')}'`);

// ---------------------------------------------------------------------
// TEST 8: Stale probe near-completion (>= 0.95) completes task cleanly
// ---------------------------------------------------------------------
console.log('\n--- Test 8: Stale probe near-completion completes task cleanly ---');
tm._findNautilusPids = () => [12345];
const nearDoneInhibitor = '/org/gnome/SessionManager/InhibitorNearDone';
tm._handleInhibitorAdded(nearDoneInhibitor, 'org.gnome.Nautilus', 'Transferring files');
const nearDoneTask = tm.getActiveTask(`inhibitor:${nearDoneInhibitor}`);
assert(nearDoneTask !== null, 'Near-done task must exist');

nearDoneTask.progress = 0.98;
nearDoneTask.indeterminate = false;
nearDoneTask._lastRealProgressAt = Date.now() - 15000; // 15s ago (> ATSPI_STALE_MS)

const monNear = tm._nautilusMonitors.get(nearDoneTask.id);
assert(monNear !== undefined, 'Monitor state must exist');

let nearDoneCompleted = false;
const nearSigId = tm.connect('task-completed', (m, t) => {
    if (t.id === nearDoneTask.id) nearDoneCompleted = true;
});

// Tick the monitor
tm._nautilusMonitorTick(nearDoneTask, monNear);
assert(nearDoneCompleted === true, 'Near-done task (> 0.95) must complete when probe disappears');
assert(tm.getActiveTask(nearDoneTask.id) === null, 'Completed near-done task must be removed');
tm.disconnect(nearSigId);

// ---------------------------------------------------------------------
// TEST 9: Noise threshold ignores small background jitter
// ---------------------------------------------------------------------
console.log('\n--- Test 9: Noise threshold ignores background jitter (< 16 KB) ---');
const noiseInhibitor = '/org/gnome/SessionManager/InhibitorNoise';
tm._handleInhibitorAdded(noiseInhibitor, 'org.gnome.Nautilus', 'Working on files');
const noiseTask = tm.getActiveTask(`inhibitor:${noiseInhibitor}`);
const monNoise = tm._nautilusMonitors.get(noiseTask.id);

// Simulate background 500-byte noise read (e.g. socket/IPC ping)
tm._readProcessIo = () => ({ rchar: monNoise.lastRead + 500, wchar: monNoise.lastWrite });
tm._nautilusMonitorTick(noiseTask, monNoise);

assert(noiseTask.speedText === '', `Speed text must remain empty for noise (<16 KB), got '${noiseTask.speedText}'`);
assert(monNoise.accumulatedCopied === 0, `accumulatedCopied must not increment for noise, got ${monNoise.accumulatedCopied}`);
assert(monNoise.idleTicks === 1, `idleTicks must increment for noise ticks, got ${monNoise.idleTicks}`);

// Now simulate real 500 KB transfer
tm._readProcessIo = () => ({ rchar: monNoise.lastRead + 500000, wchar: monNoise.lastWrite });
tm._nautilusMonitorTick(noiseTask, monNoise);
assert(noiseTask.speedText.includes('KB/s') || noiseTask.speedText.includes('MB/s'), `Speed text must show speed for real transfer, got '${noiseTask.speedText}'`);
assert(monNoise.idleTicks === 0, 'idleTicks must reset on real I/O');

// ---------------------------------------------------------------------
// TEST 10: SessionManager liveness check completes removed inhibitor
// ---------------------------------------------------------------------
console.log('\n--- Test 10: SessionManager liveness check completes removed inhibitor ---');
let livenessCompleted = false;
const liveSigId = tm.connect('task-completed', (m, t) => {
    if (t.id === noiseTask.id) livenessCompleted = true;
});

// Mock D-Bus connection where GetInhibitors returns empty list (inhibitor was removed on desktop)
tm._dbusConnection = {
    call: (dest, path, iface, method, params, replyType, flags, timeout, cancellable, callback) => {
        if (method === 'GetInhibitors') {
            callback(null, {
                // Return empty list of inhibitors
                call_finish: () => new GLib.Variant('(ao)', [[]]),
            });
        }
    },
};

tm._checkInhibitorLiveness(noiseTask);
assert(livenessCompleted === true, 'Liveness check must complete task when inhibitor is no longer in SessionManager');
assert(tm.getActiveTask(noiseTask.id) === null, 'Active task must be removed after liveness check detects removal');
tm.disconnect(liveSigId);

// ---------------------------------------------------------------------
// TEST 11: Settled idle transfer cleanly completes on idleTicks >= 5 with no open fds
// ---------------------------------------------------------------------
console.log('\n--- Test 11: Settled idle transfer cleanly completes on idleTicks >= 5 ---');
const idleInhibitor = '/org/gnome/SessionManager/InhibitorIdleSettled';
tm._handleInhibitorAdded(idleInhibitor, 'org.gnome.Nautilus', 'Transferring files');
const idleTask = tm.getActiveTask(`inhibitor:${idleInhibitor}`);
assert(idleTask !== null, 'Idle task must be registered');

const monIdle = tm._nautilusMonitors.get(idleTask.id);
assert(monIdle !== undefined, 'Monitor state must exist for idle task');

// Mock no open active transfer files and no AT-SPI progress
tm._findNautilusActiveTransfer = () => null;
idleTask._lastRealProgressAt = Date.now() - 5000;
tm._readProcessIo = () => ({ rchar: monIdle.lastRead + 100, wchar: monIdle.lastWrite });

// Mock DBus connection where inhibitor is still reported as present in SessionManager
tm._dbusConnection = {
    call: (dest, path, iface, method, params, replyType, flags, timeout, cancellable, callback) => {
        if (method === 'GetInhibitors') {
            callback(null, {
                call_finish: () => new GLib.Variant('(ao)', [[idleInhibitor]]),
            });
        }
    },
};

// Tick 1 to 4: idle ticks increment, task stays running
for (let i = 1; i <= 4; i++) {
    tm._nautilusMonitorTick(idleTask, monIdle);
    assert(monIdle.idleTicks === i, `idleTicks should be ${i}, got ${monIdle.idleTicks}`);
    assert(idleTask.state === 'running', 'Task should still be running during grace idle ticks');
}

let idleSettledCompleted = false;
const idleCompSigId = tm.connect('task-completed', (m, t) => {
    if (t.id === idleTask.id) idleSettledCompleted = true;
});

// Tick 5: reaches threshold, cleanly auto-completes settled transfer
tm._nautilusMonitorTick(idleTask, monIdle);
assert(idleSettledCompleted === true, 'Task must complete when settled idle for >= 5 ticks with no active fds');
assert(tm.getActiveTask(idleTask.id) === null, 'Completed idle task must be removed from active tasks');
tm.disconnect(idleCompSigId);

// ---------------------------------------------------------------------
// TEST 12: In-flight filename discovery enriches title and fileName
// ---------------------------------------------------------------------
console.log('\n--- Test 12: In-flight filename discovery enriches title ---');
const fileInhibitor = '/org/gnome/SessionManager/InhibitorFileDiscovery';
tm._findNautilusActiveTransfer = () => ({
    pid: 12345,
    path: '/home/user/test-document.pdf',
    fileName: 'test-document.pdf',
    totalBytes: 1048576,
    uri: 'file:///home/user/test-document.pdf',
});
tm._handleInhibitorAdded(fileInhibitor, 'org.gnome.Nautilus', 'Transferring files');
const fileTask = tm.getActiveTask(`inhibitor:${fileInhibitor}`);
assert(fileTask !== null, 'Task must exist');
assert(fileTask.fileName === 'test-document.pdf', `fileName should be 'test-document.pdf', got '${fileTask.fileName}'`);
assert(fileTask.title === 'test-document.pdf', `title should be 'test-document.pdf', got '${fileTask.title}'`);

// Dynamic enrichment during monitor tick
fileTask.title = 'Transferring files';
fileTask.fileName = null;
const monFile = tm._nautilusMonitors.get(fileTask.id);
tm._nautilusMonitorTick(fileTask, monFile);
assert(fileTask.fileName === 'test-document.pdf', `fileName should be enriched during tick, got '${fileTask.fileName}'`);
assert(fileTask.title === 'test-document.pdf', `title should be enriched during tick, got '${fileTask.title}'`);

// ---------------------------------------------------------------------
// TEST 13: TaskIndicatorButton formatCompactLabel displays fileName
// ---------------------------------------------------------------------
console.log('\n--- Test 13: formatCompactLabel displays fileName for indeterminate file task ---');
const btn13 = new TaskIndicatorButton(null, null, {});
const compactLabel = btn13.formatCompactLabel({
    title: 'test-document.pdf',
    fileName: 'test-document.pdf',
    summary: 'Transferring files',
    indeterminate: true,
}, 'Files');
assert(compactLabel === 'test-document.pdf', `Expected 'test-document.pdf', got '${compactLabel}'`);

console.log(`\nResults: ${passed} passed, ${failed} failed`);

