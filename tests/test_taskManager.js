// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_taskManager.js - Unit test suite for TaskManager headless desktop task ingestion engine.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { TaskManager, MAX_RECENT_TASKS, TASK_MANAGER_OBJECT_PATH, formatBytes, formatSpeed, formatEta } from '../src/taskManager.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('Testing TaskManager headless desktop task ingestion engine...');

// Create a unique temporary directory for cache testing
const testTmpDir = GLib.dir_make_tmp('fuhgawz-test-tm-XXXXXX');
const testCacheFile = GLib.build_filenamev([testTmpDir, 'test-recent-tasks.json']);

try {
    // -------------------------------------------------------------
    // 1. Instantiation and Public Interface
    // -------------------------------------------------------------
    console.log('1. Verifying TaskManager instantiation, signals and public interface...');
    const tm = new TaskManager(null, { cacheFile: testCacheFile });
    assert(tm instanceof TaskManager, 'tm must be an instance of TaskManager');
    assert(typeof tm.getActiveTask === 'function', 'getActiveTask missing');
    assert(typeof tm.getAllActiveTasks === 'function', 'getAllActiveTasks missing');
    assert(typeof tm.getRecentTasks === 'function', 'getRecentTasks missing');
    assert(typeof tm.cancelTask === 'function', 'cancelTask missing');
    assert(typeof tm.destroy === 'function', 'destroy missing');
    assert(typeof tm._handleUnityProgress === 'function', '_handleUnityProgress missing');
    assert(typeof tm._handleNotification === 'function', '_handleNotification missing');
    assert(typeof tm._handleInhibitorAdded === 'function', '_handleInhibitorAdded missing');
    assert(typeof tm._handleInhibitorRemoved === 'function', '_handleInhibitorRemoved missing');

    assert(tm.getAllActiveTasks().length === 0, 'Initially active tasks should be empty');
    assert(Array.isArray(tm.getRecentTasks()), 'getRecentTasks should return an array');
    assert(tm.getRecentTasks().length === 0, 'Initially recent tasks should be empty');

    // -------------------------------------------------------------
    // 2. Unity LauncherEntry Ingestion & Signals
    // -------------------------------------------------------------
    console.log('2. Verifying Unity LauncherEntry ingestion and signal emissions...');
    let addedEvent = null;
    let updatedEvent = null;
    let completedEvent = null;
    let removedEvent = null;

    const addedId = tm.connect('task-added', (m, task) => { addedEvent = task; });
    const updatedId = tm.connect('task-updated', (m, task) => { updatedEvent = task; });
    const completedId = tm.connect('task-completed', (m, task) => { completedEvent = task; });
    const removedId = tm.connect('task-removed', (m, taskId) => { removedEvent = taskId; });

    // Ingest new task via Unity progress
    tm._handleUnityProgress('application://org.gnome.Chrome.desktop', {
        'progress': 0.42,
        'progress-visible': true,
        'count': 1,
        'count-visible': true,
    });

    assert(addedEvent !== null, 'task-added signal must be emitted on new task');
    assert(addedEvent.appId === 'org.gnome.Chrome', `Expected appId 'org.gnome.Chrome', got '${addedEvent.appId}'`);
    assert(Math.abs(addedEvent.progress - 0.42) < 0.001, `Expected progress 0.42, got ${addedEvent.progress}`);
    assert(addedEvent.progressVisible === true, 'Expected progressVisible to be true');
    assert(addedEvent.count === 1, `Expected count 1, got ${addedEvent.count}`);
    assert(addedEvent.source === 'unity', `Expected source 'unity', got '${addedEvent.source}'`);

    // Retrieval by different forms of appId
    const activeByCleanId = tm.getActiveTask('org.gnome.Chrome');
    assert(activeByCleanId !== null, 'getActiveTask with clean appId should find active task');
    assert(Math.abs(activeByCleanId.progress - 0.42) < 0.001, 'Active task progress mismatch');

    const activeByDesktop = tm.getActiveTask('org.gnome.Chrome.desktop');
    assert(activeByDesktop === activeByCleanId, 'getActiveTask with .desktop should return same task');

    const activeByUri = tm.getActiveTask('application://org.gnome.Chrome.desktop');
    assert(activeByUri === activeByCleanId, 'getActiveTask with application:// URI should return same task');

    const activeById = tm.getActiveTask(activeByCleanId.id);
    assert(activeById === activeByCleanId, 'getActiveTask by task.id should return same task');

    assert(tm.getAllActiveTasks().length === 1, 'getAllActiveTasks should return 1 active task');

    // Ingest progress update
    tm._handleUnityProgress('application://org.gnome.Chrome.desktop', {
        'progress': 0.85,
        'progress-visible': true,
        'count': 2,
    });

    assert(updatedEvent !== null, 'task-updated signal must be emitted on progress change');
    assert(Math.abs(updatedEvent.progress - 0.85) < 0.001, `Expected progress 0.85, got ${updatedEvent.progress}`);
    assert(updatedEvent.count === 2, `Expected count 2, got ${updatedEvent.count}`);

    // Ingest completion
    tm._handleUnityProgress('application://org.gnome.Chrome.desktop', {
        'progress': 1.0,
        'progress-visible': false,
        'count': 0,
    });

    assert(completedEvent !== null, 'task-completed signal must be emitted on completion');
    assert(completedEvent.id === activeByCleanId.id, 'Completed task id mismatch');
    assert(completedEvent.state === 'completed', 'Completed task state must be completed');
    assert(removedEvent === activeByCleanId.id, 'task-removed signal must be emitted with taskId');
    assert(tm.getActiveTask('org.gnome.Chrome') === null, 'Active task should be null after completion');
    assert(tm.getAllActiveTasks().length === 0, 'No active tasks should remain');

    // Verify recent tasks bridge
    const recentAfterUnity = tm.getRecentTasks();
    assert(recentAfterUnity.length === 1, `Expected 1 recent task, got ${recentAfterUnity.length}`);
    assert(recentAfterUnity[0].appId === 'org.gnome.Chrome', 'Recent task appId mismatch');
    assert(recentAfterUnity[0].progress === 1.0, 'Recent task progress must be 1.0');

    // -------------------------------------------------------------
    // 3. FreeDesktop Notifications Ingestion
    // -------------------------------------------------------------
    console.log('3. Verifying FreeDesktop notifications progress hints ingestion...');
    addedEvent = null;
    updatedEvent = null;
    completedEvent = null;
    removedEvent = null;

    // A notification without progress hints should be ignored
    tm._handleNotification({
        id: 'notif-1',
        title: 'Plain Notification',
        bannerBodyText: 'No progress here',
        hints: {},
    });
    assert(addedEvent === null, 'Notification without progress hints must not trigger task-added');

    // Notification with 'value' hint (0-100 scale)
    const mockNotif = {
        id: 'dl-notif-1',
        title: 'Downloading file.zip',
        bannerBodyText: '35 MB / 100 MB',
        source: {
            id: 'firefox',
            app: { get_id: () => 'firefox.desktop', get_name: () => 'Firefox' },
        },
        hints: {
            'value': 35,
        },
        close: () => {},
    };

    tm._handleNotification(mockNotif);
    assert(addedEvent !== null, 'Notification with value hint must trigger task-added');
    assert(addedEvent.source === 'notification', 'Task source should be notification');
    assert(Math.abs(addedEvent.progress - 0.35) < 0.001, `Expected progress 0.35, got ${addedEvent.progress}`);
    assert(addedEvent.title === 'Downloading file.zip', 'Title mismatch');
    assert(addedEvent.summary === '35 MB / 100 MB', 'Summary mismatch');

    // Update using 'x-canonical-progress' hint
    mockNotif.hints = { 'x-canonical-progress': 75 };
    mockNotif.bannerBodyText = '75 MB / 100 MB';
    tm._handleNotification(mockNotif, true);

    assert(updatedEvent !== null, 'Updated notification must trigger task-updated');
    assert(Math.abs(updatedEvent.progress - 0.75) < 0.001, `Expected progress 0.75, got ${updatedEvent.progress}`);
    assert(updatedEvent.summary === '75 MB / 100 MB', 'Updated summary mismatch');

    // Complete notification (value = 100)
    mockNotif.hints = { 'value': 100 };
    mockNotif.bannerBodyText = 'Download Complete';
    tm._handleNotification(mockNotif, true);

    assert(completedEvent !== null, 'Notification at 100% must trigger task-completed');
    assert(removedEvent === addedEvent.id, 'task-removed must be emitted for completed notification');
    assert(tm.getActiveTask('firefox') === null, 'Active task for firefox must be cleared');

    // -------------------------------------------------------------
    // 4. Nautilus Inhibitor Ingestion & Recent Files Bridge
    // -------------------------------------------------------------
    console.log('4. Verifying Nautilus session inhibitor ingestion, indeterminate state & recent files...');
    addedEvent = null;
    updatedEvent = null;
    completedEvent = null;
    removedEvent = null;

    // Simulate Nautilus Inhibit signal for file transfer
    const inhibitorPath = '/org/gnome/SessionManager/Inhibitor42';
    tm._handleInhibitorAdded(inhibitorPath, 'org.gnome.Nautilus', 'Transferring files');

    assert(addedEvent !== null, 'Inhibitor must emit task-added');
    assert(addedEvent.appId === 'org.gnome.Nautilus', 'AppId must be org.gnome.Nautilus');
    assert(addedEvent.indeterminate === true, 'Nautilus transfer must set indeterminate = true');
    assert(addedEvent.source === 'inhibitor', 'Source must be inhibitor');
    assert(addedEvent.summary === 'Transferring files', 'Summary must match inhibitor reason');

    const activeNautilus = tm.getActiveTask('org.gnome.Nautilus');
    assert(activeNautilus !== null, 'Active Nautilus task should be retrievable');
    assert(activeNautilus.indeterminate === true, 'Active task indeterminate should be true');

    // Non-matching inhibitor (e.g. video player inhibiting screensaver) should be ignored
    addedEvent = null;
    tm._handleInhibitorAdded('/org/gnome/SessionManager/Inhibitor43', 'org.videolan.VLC', 'Playing video');
    assert(addedEvent === null, 'Non-file-transfer inhibitor should be ignored');

    // Mock recent files querying method for inhibitor removal
    let recentFilesQueried = false;
    const origQueryRecent = tm._queryRecentFiles.bind(tm);
    tm._queryRecentFiles = () => {
        recentFilesQueried = true;
        return [
            {
                uri: 'file:///home/user/Downloads/Archive.zip',
                title: 'Archive.zip',
                timestamp: Math.floor(Date.now() / 1000),
            },
        ];
    };

    // Simulate inhibitor removal (file transfer complete)
    tm._handleInhibitorRemoved(inhibitorPath);

    assert(recentFilesQueried === true, 'Inhibitor removal must query recent files');
    assert(completedEvent !== null, 'Inhibitor removal must trigger task-completed');
    assert(completedEvent.appId === 'org.gnome.Nautilus', 'Completed task must be Nautilus');
    assert(completedEvent.indeterminate === false, 'Completed task indeterminate must be false');
    assert(completedEvent.progress === 1.0, 'Completed task progress must be 1.0');
    assert(completedEvent.uri === 'file:///home/user/Downloads/Archive.zip', 'Completed task should have recent file URI');
    assert(completedEvent.title === 'Archive.zip', 'Completed task title should be updated to recent file title');
    assert(removedEvent === activeNautilus.id, 'task-removed must be emitted on inhibitor removal');
    assert(tm.getActiveTask('org.gnome.Nautilus') === null, 'Nautilus active task must be cleared');

    tm._queryRecentFiles = origQueryRecent;

    // -------------------------------------------------------------
    // 5. Exported D-Bus Interface for CLI tasks (bin/gm-run)
    // -------------------------------------------------------------
    console.log('5. Verifying D-Bus methods for CLI task runner (gm-run)...');
    addedEvent = null;
    updatedEvent = null;
    completedEvent = null;
    removedEvent = null;

    // RegisterTask
    const cliTaskId = tm.RegisterTask('Backup database', 'org.gnome.Terminal');
    assert(Boolean(cliTaskId), 'RegisterTask must return a taskId');
    assert(addedEvent !== null, 'RegisterTask must emit task-added');
    assert(addedEvent.id === cliTaskId, 'Task ID mismatch');
    assert(addedEvent.title === 'Backup database', 'Task title mismatch');
    assert(addedEvent.source === 'cli', 'Task source should be cli');

    // GetActiveTasks via D-Bus JSON method
    const activeTasksJson = tm.GetActiveTasks();
    assert(typeof activeTasksJson === 'string', 'GetActiveTasks must return JSON string');
    const activeTasksParsed = JSON.parse(activeTasksJson);
    assert(activeTasksParsed.some(t => t.id === cliTaskId), 'GetActiveTasks must contain registered CLI task');

    // UpdateTask
    tm.UpdateTask(cliTaskId, 0.60, '60% completed');
    assert(updatedEvent !== null, 'UpdateTask must emit task-updated');
    assert(Math.abs(updatedEvent.progress - 0.60) < 0.001, 'Progress mismatch on UpdateTask');
    assert(updatedEvent.summary === '60% completed', 'Summary mismatch on UpdateTask');

    // CompleteTask
    tm.CompleteTask(cliTaskId, true);
    assert(completedEvent !== null, 'CompleteTask must emit task-completed');
    assert(completedEvent.state === 'completed', 'Completed state mismatch');
    assert(removedEvent === cliTaskId, 'CompleteTask must emit task-removed');
    assert(tm.getActiveTask(cliTaskId) === null, 'Task must be removed from active tasks');

    // GetRecentTasks via D-Bus JSON method
    const recentTasksJson = tm.GetRecentTasks();
    const recentTasksParsed = JSON.parse(recentTasksJson);
    assert(recentTasksParsed.some(t => t.id === cliTaskId), 'GetRecentTasks must contain completed CLI task');

    // RemoveTask directly
    const tempTaskId = tm.RegisterTask('Temporary Task', 'terminal');
    assert(tm.getActiveTask(tempTaskId) !== null, 'Temporary task should be active');
    tm.RemoveTask(tempTaskId);
    assert(tm.getActiveTask(tempTaskId) === null, 'RemoveTask must remove active task');

    // -------------------------------------------------------------
    // 6. Recent Tasks History Capping & Persistence
    // -------------------------------------------------------------
    console.log('6. Verifying recent tasks capping (max 10) and persistent disk caching...');
    // Create an isolated instance with a fresh cache file
    const isolatedCacheFile = GLib.build_filenamev([testTmpDir, 'isolated-history.json']);
    const tmHistory = new TaskManager(null, { cacheFile: isolatedCacheFile });

    assert(tmHistory.getRecentTasks().length === 0, 'Initial isolated history should be empty');

    // Ingest 15 tasks to verify strict cap at 10 items
    for (let i = 1; i <= 15; i++) {
        const taskId = tmHistory.RegisterTask(`Task Number ${i}`, 'terminal');
        tmHistory.CompleteTask(taskId, true);
    }

    const history = tmHistory.getRecentTasks();
    assert(history.length === MAX_RECENT_TASKS, `Recent tasks must be capped at ${MAX_RECENT_TASKS}, got ${history.length}`);
    assert(history[0].title === 'Task Number 15', `Most recent item must be at index 0, got '${history[0].title}'`);
    assert(history[9].title === 'Task Number 6', `Oldest item at index 9 should be Task Number 6, got '${history[9].title}'`);

    // Verify disk persistence by instantiating a brand new TaskManager pointing to same cache file
    tmHistory.destroy();

    const tmReloaded = new TaskManager(null, { cacheFile: isolatedCacheFile });
    const reloadedHistory = tmReloaded.getRecentTasks();
    assert(reloadedHistory.length === MAX_RECENT_TASKS, `Reloaded history must have ${MAX_RECENT_TASKS} items, got ${reloadedHistory.length}`);
    assert(reloadedHistory[0].title === 'Task Number 15', `Reloaded top item mismatch: '${reloadedHistory[0].title}'`);
    assert(reloadedHistory[9].title === 'Task Number 6', `Reloaded oldest item mismatch: '${reloadedHistory[9].title}'`);
    tmReloaded.destroy();

    // -------------------------------------------------------------
    // 7. Task Cancellation (cancelTask)
    // -------------------------------------------------------------
    console.log('7. Verifying task cancellation (cancelTask)...');
    let cancelClosed = false;
    const cancelNotif = {
        id: 'cancel-me',
        title: 'Cancellable Task',
        bannerBodyText: 'Running...',
        hints: { 'value': 20 },
        close: () => { cancelClosed = true; },
    };
    tm._handleNotification(cancelNotif);
    const cancelTaskId = `notify:${cancelNotif.id}`;
    assert(tm.getActiveTask(cancelTaskId) !== null, 'Task should be active before cancel');

    removedEvent = null;
    const cancelResult = tm.cancelTask(cancelTaskId);
    assert(cancelResult === true, 'cancelTask should return true for active task');
    assert(cancelClosed === true, 'cancelTask should trigger notification close()');
    assert(removedEvent === cancelTaskId, 'cancelTask must emit task-removed');
    assert(tm.getActiveTask(cancelTaskId) === null, 'Task must be removed from active tasks');

    // Cancelling non-existent task returns false
    assert(tm.cancelTask('non-existent-task') === false, 'cancelTask on unknown ID should return false');

    // -------------------------------------------------------------
    // 8. Clean Teardown & Idempotency (destroy)
    // -------------------------------------------------------------
    console.log('8. Verifying clean teardown, signal disconnection and idempotency...');
    // Create an active task before destroy
    tm.RegisterTask('Dangling Task', 'terminal');
    assert(tm.getAllActiveTasks().length === 1, 'Should have 1 active task before destroy');

    tm.disconnect(addedId);
    tm.disconnect(updatedId);
    tm.disconnect(completedId);
    tm.disconnect(removedId);

    tm.destroy();
    assert(tm._destroyed === true, '_destroyed flag should be set');
    assert(tm.getAllActiveTasks().length === 0, 'All active tasks should be cleared on destroy');

    // Idempotent destroy
    tm.destroy();
    tm.destroy();

    // Safe calls after destroy
    tm._handleUnityProgress('application://org.gnome.Chrome.desktop', { progress: 0.5, 'progress-visible': true });
    assert(tm.getAllActiveTasks().length === 0, 'No task should be created after destroy');
    assert(tm.RegisterTask('Late Task', 'terminal') === '', 'RegisterTask after destroy should return empty string');
    assert(tm.cancelTask('any') === false, 'cancelTask after destroy should return false');

    // -------------------------------------------------------------
    // 9. Edge Cases & Boundary Handling
    // -------------------------------------------------------------
    console.log('9. Verifying edge cases, boundary clamping, and GLib.Variant parsing...');
    const tmEdge = new TaskManager(null, { cacheFile: testCacheFile });

    // GLib.Variant dictionary parameter in _handleUnityProgress
    const variantDict = new GLib.Variant('a{sv}', {
        'progress': new GLib.Variant('d', 0.55),
        'progress-visible': new GLib.Variant('b', true),
        'count': new GLib.Variant('x', 5),
        'count-visible': new GLib.Variant('b', true),
    });

    tmEdge._handleUnityProgress('application://org.gnome.Calculator.desktop', variantDict);
    const calcTask = tmEdge.getActiveTask('org.gnome.Calculator');
    assert(calcTask !== null, 'Active task should be created from GLib.Variant dictionary');
    assert(Math.abs(calcTask.progress - 0.55) < 0.001, 'Progress unpacked from GLib.Variant mismatch');
    assert(calcTask.count === 5, 'Count unpacked from GLib.Variant mismatch');

    // Progress clamping: negative progress clamps to 0.0, > 1.0 clamps to 1.0
    tmEdge._handleUnityProgress('application://org.gnome.Calculator.desktop', {
        'progress': -0.5,
        'progress-visible': true,
    });
    assert(calcTask.progress === 0.0, `Negative progress should clamp to 0.0, got ${calcTask.progress}`);

    tmEdge._handleUnityProgress('application://org.gnome.Calculator.desktop', {
        'progress': 1.5,
        'progress-visible': true,
    });
    assert(calcTask.progress === 1.0, `Progress > 1.0 should clamp to 1.0, got ${calcTask.progress}`);

    // Invalid/empty arguments should not throw
    tmEdge._handleUnityProgress(null, {});
    tmEdge._handleUnityProgress('', {});
    tmEdge._handleNotification(null);
    tmEdge._handleNotification({});
    tmEdge._handleInhibitorAdded(null, null, null);
    tmEdge._handleInhibitorRemoved(null);
    tmEdge.getActiveTask(null);
    tmEdge.getActiveTask('');
    assert(tmEdge.getActiveTask('non-existent') === null, 'Unknown task should return null');

    // Notification progress percentage > 1.0 should scale from 0..100 down to 0..1
    const notifScale = {
        id: 'scale-test',
        hints: { 'value': 88 },
    };
    tmEdge._handleNotification(notifScale);
    const scaledTask = tmEdge.getActiveTask('notify:scale-test');
    assert(scaledTask !== null, 'Scaled notification task should exist');
    assert(Math.abs(scaledTask.progress - 0.88) < 0.001, `Expected scaled progress 0.88, got ${scaledTask.progress}`);

    // Clean teardown of edge manager
    tmEdge.destroy();

    // -------------------------------------------------------------
    // 10. Cyclic Object Serialization in GetActiveTasks
    // -------------------------------------------------------------
    console.log('10. Verifying cyclic notification object serialization in GetActiveTasks...');
    const tmCyclic = new TaskManager(null, { cacheFile: testCacheFile });
    const cyclicNotif = {
        id: 'cyclic-notif-1',
        title: 'Download with circular refs',
        bannerBodyText: '50 MB / 100 MB',
        hints: { 'value': 50 },
    };
    // Create cyclic reference simulating GNOME Shell MessageTray.Notification
    cyclicNotif.circular = cyclicNotif;
    cyclicNotif.source = { notification: cyclicNotif };

    tmCyclic._handleNotification(cyclicNotif);
    assert(tmCyclic.getAllActiveTasks().length === 1, 'Cyclic notification task should be active');

    // GetActiveTasks must NOT throw TypeError: cyclic object value
    let serializedActiveJson = null;
    try {
        serializedActiveJson = tmCyclic.GetActiveTasks();
    } catch (e) {
        throw new Error(`GetActiveTasks threw on cyclic object: ${e.message}`);
    }

    assert(typeof serializedActiveJson === 'string', 'GetActiveTasks must return a string');
    const parsedActive = JSON.parse(serializedActiveJson);
    assert(parsedActive.length === 1, 'Parsed active tasks should have length 1');
    assert(parsedActive[0].id === 'notify:cyclic-notif-1', 'Serialized task ID mismatch');
    assert(parsedActive[0].progress === 0.5, 'Serialized progress mismatch');
    assert(parsedActive[0]._notification === undefined, 'Internal _notification must be stripped from DTO');
    tmCyclic.destroy();

    // -------------------------------------------------------------
    // 11. Unity Incomplete Task Cancellation (No False Completion)
    // -------------------------------------------------------------
    console.log('11. Verifying Unity cancelled download does NOT trigger false completion...');
    const unityCancelCache = GLib.build_filenamev([testTmpDir, 'unity-cancel-recent.json']);
    const tmUnityCancel = new TaskManager(null, { cacheFile: unityCancelCache });
    let unityCompleted = false;
    let unityRemoved = false;
    tmUnityCancel.connect('task-completed', () => { unityCompleted = true; });
    tmUnityCancel.connect('task-removed', () => { unityRemoved = true; });

    // Start download at 30%
    tmUnityCancel._handleUnityProgress('application://org.gnome.Chrome.desktop', {
        'progress': 0.30,
        'progress-visible': true,
    });
    assert(tmUnityCancel.getActiveTask('org.gnome.Chrome') !== null, 'Chrome task should be active at 30%');

    // User cancels download in browser -> progress-visible set to false at 30%
    tmUnityCancel._handleUnityProgress('application://org.gnome.Chrome.desktop', {
        'progress-visible': false,
    });

    assert(unityCompleted === false, 'Cancelled Unity download must NOT emit task-completed');
    assert(unityRemoved === true, 'Cancelled Unity download must emit task-removed');
    assert(tmUnityCancel.getActiveTask('org.gnome.Chrome') === null, 'Chrome task should be removed from active');
    assert(tmUnityCancel.getRecentTasks().length === 0, 'Cancelled download must NOT be added to recent tasks');
    tmUnityCancel.destroy();

    // -------------------------------------------------------------
    // 12. FreeDesktop Notification 'value: 1' Proper Scaling (1% not 100%)
    // -------------------------------------------------------------
    console.log('12. Verifying notification value: 1 is scaled to 1% (0.01) rather than 100%...');
    const tmValueScale = new TaskManager(null, { cacheFile: testCacheFile });
    let valueCompleted = false;
    tmValueScale.connect('task-completed', () => { valueCompleted = true; });

    tmValueScale._handleNotification({
        id: 'one-percent-notif',
        title: 'Starting Download',
        hints: { 'value': 1 },
    });

    const onePercentTask = tmValueScale.getActiveTask('notify:one-percent-notif');
    assert(onePercentTask !== null, 'Task should be active at value: 1');
    assert(Math.abs(onePercentTask.progress - 0.01) < 0.0001, `Expected progress 0.01, got ${onePercentTask.progress}`);
    assert(onePercentTask.state === 'running', `Expected state 'running', got '${onePercentTask.state}'`);
    assert(valueCompleted === false, 'value: 1 must NOT trigger task-completed');
    tmValueScale.destroy();

    // -------------------------------------------------------------
    // 13. Non-numeric / NaN Notification Hints Ignored
    // -------------------------------------------------------------
    console.log('13. Verifying non-numeric / NaN progress hints are safely rejected...');
    const nanCache = GLib.build_filenamev([testTmpDir, 'nan-recent.json']);
    const tmNan = new TaskManager(null, { cacheFile: nanCache });
    tmNan._handleNotification({
        id: 'nan-notif',
        title: 'Invalid Hint',
        hints: { 'value': 'not-a-number' },
    });
    assert(tmNan.getActiveTask('notify:nan-notif') === null, 'NaN hint must not create active task');
    assert(tmNan.getRecentTasks().length === 0, 'NaN hint must not create recent task');
    tmNan.destroy();

    // -------------------------------------------------------------
    // 14. Exact-Once Signal Emission on Synchronous Notification Close
    // -------------------------------------------------------------
    console.log('14. Verifying exact-once task-removed emission when notification close() synchronously destroys...');
    const tmSyncClose = new TaskManager(null, { cacheFile: testCacheFile });
    let removeCount = 0;
    tmSyncClose.connect('task-removed', () => { removeCount++; });

    let destroyCallback = null;
    const syncNotif = {
        id: 'sync-close-notif',
        title: 'Sync Close',
        hints: { 'value': 40 },
        connect: (sig, cb) => {
            if (sig === 'destroy') destroyCallback = cb;
            return 1;
        },
        disconnect: () => {},
        close: () => {
            // Synchronously fire destroy listener
            if (destroyCallback) destroyCallback();
        },
    };

    tmSyncClose._handleNotification(syncNotif);
    assert(tmSyncClose.getActiveTask('notify:sync-close-notif') !== null, 'Task should be active');

    const didCancel = tmSyncClose.cancelTask('notify:sync-close-notif');
    assert(didCancel === true, 'cancelTask should succeed');
    assert(removeCount === 1, `task-removed must be emitted exactly 1 time, got ${removeCount}`);
    tmSyncClose.destroy();

    // -------------------------------------------------------------
    // 15. Robust XBEL Multi-Bookmark Parsing & Attribute Order Independence
    // -------------------------------------------------------------
    console.log('15. Verifying robust XBEL parsing (attribute order, no cross-bookmark title bleed, Nautilus priority)...');
    const mockXbelFile = GLib.build_filenamev([testTmpDir, 'test-mock-xbel.xbel']);

    const nowSec = Math.floor(Date.now() / 1000);
    const timeBefore = GLib.DateTime.new_from_unix_local(nowSec - 5).format_iso8601();
    const timeTransfer = GLib.DateTime.new_from_unix_local(nowSec).format_iso8601();

    // XML with:
    // 1. Inverted attribute order ('modified' before 'href')
    // 2. Bookmark 1 without title but with Nautilus application
    // 3. Bookmark 2 with title and different app
    // 4. Old bookmark from before transfer
    const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark modified="${timeBefore}" href="file:///home/user/ancient.pdf">
    <info><metadata owner="http://freedesktop.org">
      <title>Ancient Document</title>
      <bookmark:applications><bookmark:application name="evince" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>
  <bookmark modified="${timeTransfer}" href="file:///home/user/Downloads/copied_folder.tar.gz">
    <info><metadata owner="http://freedesktop.org">
      <bookmark:applications><bookmark:application name="org.gnome.Nautilus" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>
  <bookmark href="file:///home/user/music.mp3" modified="${timeTransfer}">
    <info><metadata owner="http://freedesktop.org">
      <title>Song Title</title>
      <bookmark:applications><bookmark:application name="rhythmbox" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>
</xbel>`;

    GLib.file_set_contents(mockXbelFile, testXml);

    const tmXbel = new TaskManager(null, { cacheFile: testCacheFile, xbelFile: mockXbelFile });
    const parsedFiles = tmXbel._queryRecentFiles(Date.now());
    assert(parsedFiles.length >= 2, `Expected at least 2 matching recent files, got ${parsedFiles.length}`);
    // Nautilus file must be prioritized
    assert(parsedFiles[0].title === 'copied_folder.tar.gz', `Expected top file 'copied_folder.tar.gz', got '${parsedFiles[0].title}'`);
    assert(parsedFiles[0].uri === 'file:///home/user/Downloads/copied_folder.tar.gz', 'URI mismatch on top file');
    // Ensure title from bookmark 3 did NOT bleed into bookmark 2
    assert(parsedFiles[1].title === 'Song Title', `Expected second file 'Song Title', got '${parsedFiles[1].title}'`);

    tmXbel.destroy();

    // -------------------------------------------------------------
    // 16. Recent Tasks Deduplication
    // -------------------------------------------------------------
    console.log('16. Verifying recent tasks history deduplication...');
    const dedupCache = GLib.build_filenamev([testTmpDir, 'dedup-recent.json']);
    const tmDedup = new TaskManager(null, { cacheFile: dedupCache });
    const taskId1 = tmDedup.RegisterTask('Duplicate Test Task', 'terminal');
    tmDedup.CompleteTask(taskId1, true);

    assert(tmDedup.getRecentTasks().length === 1, 'Should have 1 recent task');

    // Simulate same task ID completing again (e.g. repeated run or retry)
    tmDedup._addRecentTask({
        id: taskId1,
        appId: 'terminal',
        title: 'Duplicate Test Task',
        summary: 'Updated summary',
        progress: 1.0,
        source: 'cli',
        state: 'completed',
        startTime: Date.now(),
        completedAt: Date.now(),
    });

    const dedupHistory = tmDedup.getRecentTasks();
    assert(dedupHistory.length === 1, `Recent tasks must deduplicate identical IDs, got length ${dedupHistory.length}`);
    assert(dedupHistory[0].summary === 'Updated summary', 'Updated task entry should replace older entry');
    tmDedup.destroy();

    // -------------------------------------------------------------
    // 17. Corrupted Cache File Recovery
    // -------------------------------------------------------------
    console.log('17. Verifying corrupted cache file graceful recovery...');
    const corruptedCacheFile = GLib.build_filenamev([testTmpDir, 'corrupted-history.json']);
    GLib.file_set_contents(corruptedCacheFile, JSON.stringify([
        null,
        12345,
        "not an object",
        { id: "valid-task-id", title: "Legitimate Task", appId: "terminal", source: "cli" }
    ]));

    const tmCorrupted = new TaskManager(null, { cacheFile: corruptedCacheFile });
    const recoveredHistory = tmCorrupted.getRecentTasks();
    assert(recoveredHistory.length === 1, `Expected 1 recovered valid task, got ${recoveredHistory.length}`);
    assert(recoveredHistory[0].id === 'valid-task-id', `Recovered task ID mismatch: '${recoveredHistory[0].id}'`);
    tmCorrupted.destroy();

    // -------------------------------------------------------------
    // 18. Live D-Bus IPC & Signal Subscription (when session bus available)
    // -------------------------------------------------------------
    let sessionBus = null;
    try {
        sessionBus = Gio.DBus.session;
    } catch (e) {}

    if (sessionBus) {
        console.log('18. Verifying real D-Bus method export and signal IPC on active session bus...');
        const tmDbus = new TaskManager(null, { cacheFile: testCacheFile, dbusConnection: sessionBus });
        const loop = new GLib.MainLoop(null, false);
        let dbusCancelReceived = false;

        const cancelSubId = sessionBus.signal_subscribe(
            null,
            'org.gnome.Shell.Extensions.FUHGlobeGlobalMenu.TaskManager',
            'TaskCancelled',
            TASK_MANAGER_OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            () => {
                dbusCancelReceived = true;
                loop.quit();
            }
        );

        const dTaskId = tmDbus.RegisterTask('DBus CLI Job', 'terminal');
        assert(Boolean(dTaskId), 'RegisterTask should return task ID');

        // Allow D-Bus match rule to register before emitting signal
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            tmDbus.cancelTask(dTaskId);
            return GLib.SOURCE_REMOVE;
        });

        // Safety timeout so test never hangs
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });

        loop.run();

        assert(dbusCancelReceived === true, 'TaskCancelled signal should be delivered via D-Bus');
        sessionBus.signal_unsubscribe(cancelSubId);
        tmDbus.destroy();
    }

    console.log('19. Verifying filename extraction...');
    const tmExtract = new TaskManager(null, { cacheFile: GLib.build_filenamev([testTmpDir, 'test-extract-tasks.json']) });
    
    assert(tmExtract.extractFilenameFromText('Permanently delete “xCodium.json”?') === 'xCodium.json', 'xCodium.json extraction failed');
    assert(tmExtract.extractFilenameFromText('Copying "archive.tar.gz" to Downloads') === 'archive.tar.gz', 'archive.tar.gz extraction failed');
    assert(tmExtract.extractFilenameFromText('the.bombin.pan.am.103.zip (Finished)') === 'the.bombin.pan.am.103.zip', 'the.bombin... extraction failed');
    assert(tmExtract.extractFilenameFromText('Deleting...') === null, 'Deleting... with ellipsis must NOT be treated as a filename');
    assert(tmExtract.extractFilenameFromText('Copying 1,420 files') === null, 'Copying 1,420 files must NOT be treated as a filename');
    assert(tmExtract.extractFilenameFromText('Deleting... xCodium.json') === 'xCodium.json', 'Deleting... xCodium.json must extract xCodium.json');
    assert(tmExtract.extractFilenameFromText('In progress...') === null, 'In progress... must NOT be treated as a filename');
    assert(tmExtract.extractFilenameFromText('Download completed: test_file.iso') === 'test_file.iso', 'test_file.iso extraction failed');
    tmExtract.destroy();

    console.log('20. Verifying formatBytes, formatSpeed, formatEta and Nautilus I/O monitoring logic...');
    assert(formatBytes(3600000000) === '3.6 GB', `formatBytes(3.6G) failed: got ${formatBytes(3600000000)}`);
    assert(formatBytes(1100000000) === '1.1 GB', `formatBytes(1.1G) failed: got ${formatBytes(1100000000)}`);
    assert(formatBytes(320000000) === '320 MB', `formatBytes(320M) failed: got ${formatBytes(320000000)}`);
    assert(formatBytes(45000) === '45 KB', `formatBytes(45K) failed: got ${formatBytes(45000)}`);
    assert(formatBytes(0) === '0 bytes', `formatBytes(0) failed: got ${formatBytes(0)}`);

    assert(formatSpeed(25000000) === '25.0 MB/s', `formatSpeed(25M) failed: got ${formatSpeed(25000000)}`);
    assert(formatSpeed(500000) === '500.0 KB/s', `formatSpeed(500K) failed: got ${formatSpeed(500000)}`);
    assert(formatSpeed(0) === '', `formatSpeed(0) failed: got ${formatSpeed(0)}`);

    assert(formatEta(60) === '1m left', `formatEta(60) failed: got ${formatEta(60)}`);
    assert(formatEta(30) === '30s left', `formatEta(30) failed: got ${formatEta(30)}`);
    assert(formatEta(3600) === '1h left', `formatEta(3600) failed: got ${formatEta(3600)}`);

    const tmMonitor = new TaskManager(null, { cacheFile: GLib.build_filenamev([testTmpDir, 'test-mon-tasks.json']) });
    assert(Array.isArray(tmMonitor._findNautilusPids()), '_findNautilusPids must return an array');
    
    // Simulate simulated transfer injection
    tmMonitor._findNautilusActiveTransfer = () => ({
        pid: 12345,
        path: '/home/test/the.bombing.of.pan.am.103.s1.web.108-pahe.in.zip',
        fileName: 'the.bombing.of.pan.am.103.s1.web.108-pahe.in.zip',
        totalBytes: 3600000000,
        uri: 'file:///home/test/the.bombing.of.pan.am.103.s1.web.108-pahe.in.zip',
    });
    tmMonitor._findNautilusPids = () => [12345];

    let taskAddedReceived = null;
    tmMonitor.connect('task-added', (m, task) => {
        taskAddedReceived = task;
    });

    tmMonitor._handleInhibitorAdded('/org/gnome/SessionManager/Inhibitor99', 'org.gnome.Nautilus', 'Copying files');
    assert(taskAddedReceived !== null, 'task-added must be emitted for Nautilus inhibitor');
    assert(taskAddedReceived.fileName === 'the.bombing.of.pan.am.103.s1.web.108-pahe.in.zip', 'Task filename mismatch');
    assert(taskAddedReceived.totalBytes === 3600000000, 'Task totalBytes mismatch');
    assert(taskAddedReceived.bytesText === '0 bytes / 3.6 GB', `Task bytesText mismatch: got ${taskAddedReceived.bytesText}`);
    assert(taskAddedReceived.indeterminate === false, 'Task should be determinate when totalBytes is known');
    assert(tmMonitor._nautilusMonitors.has(taskAddedReceived.id), 'I/O monitor must be registered for task');

    let taskCompletedReceived = null;
    tmMonitor.connect('task-completed', (m, task) => {
        taskCompletedReceived = task;
    });

    tmMonitor._handleInhibitorRemoved('/org/gnome/SessionManager/Inhibitor99');
    assert(taskCompletedReceived !== null, 'task-completed must be emitted on inhibitor removal');
    assert(taskCompletedReceived.progress === 1.0, 'Progress must be 1.0 on completion');
    assert(taskCompletedReceived.bytesText === '3.6 GB', `bytesText on completion mismatch: got ${taskCompletedReceived.bytesText}`);
    assert(!tmMonitor._nautilusMonitors.has(taskAddedReceived.id), 'I/O monitor must be cleared on inhibitor removal');

    tmMonitor.destroy();

    console.log('TaskManager test suite passed with 100% success!');
} finally {
    // Cleanup temporary test files
    try {
        const dir = Gio.File.new_for_path(testTmpDir);
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            dir.get_child(info.get_name()).delete(null);
        }
        dir.delete(null);
    } catch (e) {
        // Best-effort cleanup
    }
}
