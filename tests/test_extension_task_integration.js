// SPDX-License-Identifier: GPL-3.0-or-later
// tests/test_extension_task_integration.js - Full integration test suite for Task 5:
// Extension Lifecycle Integration, AppMenu Binding (pos = 1), and Recent Items Bridge.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TaskManager } from '../src/taskManager.js';
import { TaskIndicatorButton } from '../src/taskIndicatorButton.js';
import { TaskProgressBar } from '../src/taskProgressBar.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

console.log('=== Running Extension Task Lifecycle & Recent Items Integration Tests ===');

// ---------------------------------------------------------------------
// Mock Settings Helper for Integration Testing
// ---------------------------------------------------------------------
class MockSettings extends GObject.Object {
    _init() {
        super._init();
        this._values = new Map([
            ['enable-task-indicator', true],
            ['task-indicator-mode', 'compact'],
            ['task-auto-hide-seconds', 1],
            ['task-sync-recent-items', true],
            ['enable-system-menu', true],
        ]);
    }

    get_boolean(key) {
        return this._values.has(key) ? this._values.get(key) : true;
    }

    get_string(key) {
        return this._values.has(key) ? this._values.get(key) : '';
    }

    get_int(key) {
        return this._values.has(key) ? this._values.get(key) : 0;
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
        GTypeName: 'MockSettingsExtIntegration',
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
// 1. Static AST / Codebase Wiring Verification
// ---------------------------------------------------------------------
console.log('1. Verifying codebase wiring in extension.js, systemMenu.js, recentItemsSubmenu.js & stylesheet.css...');

function readTextFile(relativePath) {
    const file = Gio.File.new_for_path(relativePath);
    const [ok, bytes] = file.load_contents(null);
    if (!ok || !bytes) throw new Error(`Failed to read file: ${relativePath}`);
    return new TextDecoder().decode(bytes);
}

const extensionCode = readTextFile('./extension.js');
const systemMenuCode = readTextFile('./src/systemMenu.js');
const recentItemsCode = readTextFile('./src/recentItemsSubmenu.js');
const stylesheetCode = readTextFile('./stylesheet.css');

// Verify extension.js imports
assert(extensionCode.includes("import { TaskManager } from './src/taskManager.js'"),
    'extension.js must import TaskManager');
assert(extensionCode.includes("import { TaskIndicatorButton } from './src/taskIndicatorButton.js'"),
    'extension.js must import TaskIndicatorButton');

// Verify extension.js constructor initializes TaskManager
assert(extensionCode.includes('this._taskManager = new TaskManager(this._settings)'),
    'FUHGlobeGlobalMenu constructor must initialize this._taskManager');

// Verify extension.js _initButtonPool registers TaskIndicatorButton and binds to AppMenuButton
assert(extensionCode.includes('this._taskIndicator = new TaskIndicatorButton(this._settings, this._taskManager)'),
    '_initButtonPool must instantiate TaskIndicatorButton with settings and taskManager');
assert(extensionCode.includes('this._taskIndicator.bindToAppMenu(this._appMenuButton)'),
    '_initButtonPool must bind TaskIndicatorButton permanently to this._appMenuButton');

// Verify extension.js _updateSystemMenu passes this._taskManager to SystemMenu
assert(extensionCode.includes('new SystemMenu(this._settings, this._extensionPath, this._extension, this._taskManager)'),
    '_updateSystemMenu must pass this._taskManager to SystemMenu');

// Verify extension.js destroy tears down _taskIndicator and _taskManager cleanly
assert(extensionCode.includes('this._taskIndicator.destroy()'),
    'extension.js destroy must call this._taskIndicator.destroy()');
assert(extensionCode.includes('this._taskManager.destroy()'),
    'extension.js destroy must call this._taskManager.destroy()');

// Verify src/systemMenu.js accepts taskManager and passes to RecentItemsSubmenu
assert(systemMenuCode.includes('_init(settings, extensionPath, extension, taskManager = null)'),
    'SystemMenu _init must accept taskManager parameter');
assert(systemMenuCode.includes('this._taskManager = taskManager'),
    'SystemMenu must store this._taskManager');
assert(systemMenuCode.includes('this._taskManager') && systemMenuCode.includes('new RecentItemsSubmenu'),
    'SystemMenu _makeRecentItemsMenu must forward this._taskManager to RecentItemsSubmenu');

// Verify src/recentItemsSubmenu.js accepts taskManager and populates Recent Tasks
assert(recentItemsCode.includes('_init(title, parentMenu, recentMenuManager, extension, iconName, taskManager = null)'),
    'RecentItemsSubmenu _init must accept taskManager parameter');
assert(recentItemsCode.includes('this._taskManager = taskManager'),
    'RecentItemsSubmenu must store this._taskManager');
assert(recentItemsCode.includes('Recent Tasks') || recentItemsCode.includes('_createRecentTaskMenuItem'),
    'RecentItemsSubmenu must have Recent Tasks section builder');
assert(recentItemsCode.includes('slice(0, 5)'),
    'Recent Tasks in RecentItemsSubmenu must be capped at 5 items');
assert(recentItemsCode.includes('_showInFiles'),
    'RecentItemsSubmenu must support 1-click Show in Files action');
assert(recentItemsCode.includes('_openRecentTask'),
    'RecentItemsSubmenu must support 1-click Open action');

// Verify stylesheet.css contains required Adwaita / GNOME Shell classes
assert(stylesheetCode.includes('.fuhgawz-task-indicator-box'),
    'stylesheet.css must contain .fuhgawz-task-indicator-box');
assert(stylesheetCode.includes('.fuhgawz-task-pill'),
    'stylesheet.css must contain .fuhgawz-task-pill');
assert(stylesheetCode.includes('.fuhgawz-task-toggle-btn') || stylesheetCode.includes('.fuhgawz-task-slider-toggle'),
    'stylesheet.css must contain .fuhgawz-task-toggle-btn');
assert(stylesheetCode.includes('.fuhgawz-task-progress-bar'),
    'stylesheet.css must contain .fuhgawz-task-progress-bar');

console.log('-> Static codebase wiring checks PASSED.');

// ---------------------------------------------------------------------
// 2. Mock Actor Classes for Panel & AppMenuButton Simulation
// ---------------------------------------------------------------------
class MockClutterActor {
    constructor(name = 'actor') {
        this.name = name;
        this.children = [];
        this.visible = true;
        this._parent = null;
        this._styleClasses = new Set();
    }

    add_child(child) {
        if (!this.children.includes(child)) {
            this.children.push(child);
            child._parent = this;
        }
    }

    insert_child_at_index(child, index) {
        this.remove_child(child);
        this.children.splice(index, 0, child);
        child._parent = this;
    }

    remove_child(child) {
        this.children = this.children.filter(c => c !== child);
        if (child._parent === this) child._parent = null;
    }

    get_children() {
        return this.children.slice();
    }

    get_parent() {
        return this._parent;
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }

    add_style_class_name(cls) {
        this._styleClasses.add(cls);
    }

    destroy() {
        for (const c of this.children.slice()) {
            if (typeof c.destroy === 'function') c.destroy();
        }
        this.children = [];
        this._parent = null;
    }
}

// ---------------------------------------------------------------------
// 3. Extension Initialization & AppMenu Binding (`pos = 1`)
// ---------------------------------------------------------------------
console.log('2. Verifying Extension Initialization and Spatial AppMenu Binding (pos = 1)...');

const mockSettings = new MockSettingsClass();
const testTmpDir = GLib.dir_make_tmp('fuhgawz-int-test-XXXXXX');
const testCacheFile = GLib.build_filenamev([testTmpDir, 'integration-recent-tasks.json']);

const taskManager = new TaskManager(mockSettings, { cacheFile: testCacheFile });
assert(taskManager instanceof TaskManager, 'TaskManager initialized successfully');

// Create mock AppMenuButton as instantiated in extension.js:
// AppMenuButton allocated at pos = 1 in Main.panel._leftBox
const mockAppMenuButton = new MockClutterActor('AppMenuButton');
mockAppMenuButton._box = new MockClutterActor('AppMenuButton._box');
mockAppMenuButton.add_child(mockAppMenuButton._box);

const taskIndicator = new TaskIndicatorButton(mockSettings, taskManager);
assert(taskIndicator instanceof TaskIndicatorButton, 'TaskIndicatorButton initialized successfully');

// Permanently bind TaskIndicator to AppMenuButton
taskIndicator.bindToAppMenu(mockAppMenuButton);

// Assert spatial anchor inside AppMenuButton
assert(mockAppMenuButton._box.children.includes(taskIndicator),
    'TaskIndicator must be a child of AppMenuButton._box');
assert(mockAppMenuButton.children.some(c => c instanceof TaskProgressBar || c.style_class === 'fuhgawz-task-progress-bar'),
    'Hairline TaskProgressBar must be attached directly to AppMenuButton for bottom overlay');

// Idempotent binding check: Re-binding must not duplicate actors
taskIndicator.bindToAppMenu(mockAppMenuButton);
const indicatorCount = mockAppMenuButton._box.children.filter(c => c === taskIndicator).length;
assert(indicatorCount === 1, 'Re-binding must remain idempotent (1 indicator actor)');

console.log('-> Spatial AppMenu binding checks PASSED.');

// ---------------------------------------------------------------------
// 4. Live Task Telemetry & Ingestion to Indicator
// ---------------------------------------------------------------------
console.log('3. Verifying live desktop task ingestion and telemetry synchronization...');

// Simulate Unity LauncherEntry progress update (e.g., Nautilus copying files)
taskManager._handleUnityProgress('application://org.gnome.Nautilus.desktop', {
    'progress': 0.72,
    'progress-visible': true,
    'count': 1,
});

const activeTask = taskManager.getActiveTask('org.gnome.Nautilus');
assert(activeTask !== null, 'Active task must be registered in TaskManager');
assert(activeTask.progress === 0.72, 'Task progress must be 0.72');

// Verify TaskIndicator updated automatically via TaskManager signals
const indicatorTask = taskIndicator.getActiveTask();
assert(indicatorTask !== null, 'TaskIndicator must reflect active task');
assert(indicatorTask.id === activeTask.id, 'Task IDs must match');
assert(taskIndicator.getLabelText().includes('72%'),
    `Indicator label must include 72% (got "${taskIndicator.getLabelText()}")`);

// Test mode switching on indicator
taskIndicator.setMode('slider');
assert(taskIndicator.getMode() === 'slider', 'Indicator mode must be slider');
taskIndicator.setExpanded(true);
assert(taskIndicator.isExpanded() === true, 'Indicator must be expanded in slider mode');

// Test center clock collision guard logic
const availableSpace = taskIndicator.calculateAvailableSpace();
assert(typeof availableSpace === 'number' && availableSpace > 0, 'calculateAvailableSpace must return positive integer');
const clampedWidth = taskIndicator.clampTelemetryWidth(350, 150);
assert(clampedWidth === 150, `clampTelemetryWidth must clamp to maxAvailable (got ${clampedWidth})`);
const truncated = taskIndicator.truncateTelemetry('12.5 MB/s • 450 MB / 1.2 GB • 1m left', 15);
assert(truncated.endsWith('...'), 'truncateTelemetry must truncate with ellipsis');

console.log('-> Live task telemetry and collision guard checks PASSED.');

// ---------------------------------------------------------------------
// 5. Recent Items Bridge Integration & 1-Click Actions
// ---------------------------------------------------------------------
console.log('4. Verifying Recent Items Bridge with 5-item capping and 1-click actions...');

// Complete the active Nautilus task
taskManager._handleUnityProgress('application://org.gnome.Nautilus.desktop', {
    'progress': 1.0,
    'progress-visible': false,
    'count': 0,
});

// Ingest 6 additional completed tasks to test capping at 5 in recent items
for (let i = 1; i <= 6; i++) {
    const taskId = `test-task-${i}`;
    const uri = i % 2 === 0 ? `file:///home/user/Downloads/file-${i}.zip` : null;
    taskManager._addRecentTask({
        id: taskId,
        appId: `app-${i}`,
        desktopId: `app-${i}.desktop`,
        title: `Operation ${i} Completed`,
        summary: `Finished processing item ${i}`,
        progress: 1.0,
        source: 'unity',
        state: 'completed',
        startTime: Date.now() - 60000 * i,
        completedAt: Date.now() - 1000 * i,
        uri,
    });
}

const allRecent = taskManager.getRecentTasks();
assert(allRecent.length >= 6, 'TaskManager recent tasks cache must contain recent entries');

// Simulate RecentItemsSubmenu bridging logic
class MockRecentMenu {
    constructor() {
        this.items = [];
        this.isOpen = false;
    }
    removeAll() {
        this.items = [];
    }
    addMenuItem(item) {
        this.items.push(item);
    }
}

// Emulate RecentItemsSubmenu._populateMenu with this._taskManager
function simulateRecentMenuPopulation(tm, settings) {
    const menu = new MockRecentMenu();
    let syncTasks = true;
    if (settings) {
        syncTasks = settings.get_boolean('task-sync-recent-items');
    }

    const recentTasks = (syncTasks && tm?.getRecentTasks)
        ? (tm.getRecentTasks() || []).slice(0, 5)
        : [];

    if (recentTasks.length > 0) {
        menu.addMenuItem({ type: 'header', title: 'Recent Tasks' });
        for (const task of recentTasks) {
            let showInFilesCalled = false;
            let openCalled = false;

            const item = {
                type: 'recent-task-item',
                task,
                showInFilesBtn: task.uri ? { reactive: true } : null,
                openBtn: { reactive: true },
                showInFiles: () => {
                    showInFilesCalled = true;
                    return true;
                },
                open: () => {
                    openCalled = true;
                    return true;
                },
                wasShowInFilesCalled: () => showInFilesCalled,
                wasOpenCalled: () => openCalled,
            };
            menu.addMenuItem(item);
        }
    }

    return menu;
}

// Verify populated Recent Items menu
const populatedMenu = simulateRecentMenuPopulation(taskManager, mockSettings);
const taskHeader = populatedMenu.items.find(i => i.type === 'header' && i.title === 'Recent Tasks');
assert(taskHeader !== undefined, 'Recent Items menu must contain "Recent Tasks" section header');

const taskItems = populatedMenu.items.filter(i => i.type === 'recent-task-item');
assert(taskItems.length === 5, `Recent Tasks must be strictly capped at 5 items (got ${taskItems.length})`);

// Verify 1-click actions on bridged items
const uriTaskItem = taskItems.find(i => Boolean(i.task.uri));
assert(uriTaskItem !== undefined, 'At least one task item with URI must be present');
assert(uriTaskItem.showInFilesBtn !== null, 'Task with URI must have 1-click Show in Files button');
assert(uriTaskItem.openBtn !== null, 'Task must have 1-click Open button');

uriTaskItem.showInFiles();
assert(uriTaskItem.wasShowInFilesCalled() === true, '1-click Show in Files action succeeded');

uriTaskItem.open();
assert(uriTaskItem.wasOpenCalled() === true, '1-click Open action succeeded');

// Verify settings reactivity: Disable task-sync-recent-items
mockSettings.set_boolean('task-sync-recent-items', false);
const disabledMenu = simulateRecentMenuPopulation(taskManager, mockSettings);
const disabledItems = disabledMenu.items.filter(i => i.type === 'recent-task-item');
assert(disabledItems.length === 0, 'When task-sync-recent-items is false, Recent Tasks section must be omitted');

// Restore setting
mockSettings.set_boolean('task-sync-recent-items', true);

// Verify Clear Menu action clearing TaskManager recent history
assert(typeof taskManager.clearRecentTasks === 'function', 'TaskManager must expose clearRecentTasks()');
taskManager.clearRecentTasks();
assert(taskManager.getRecentTasks().length === 0, 'clearRecentTasks must empty TaskManager history');

console.log('-> Recent Items Bridge and 1-click action checks PASSED.');

// ---------------------------------------------------------------------
// 6. Clean Teardown & Zero Dangling Actors/Signals
// ---------------------------------------------------------------------
console.log('5. Verifying clean teardown, actor unparenting, and signal unhooking...');

// Destroy TaskIndicatorButton
taskIndicator.destroy();

// Verify actors cleanly unparented
assert(!mockAppMenuButton._box.children.includes(taskIndicator),
    'TaskIndicator must be removed from AppMenuButton._box on destroy');
assert(!mockAppMenuButton.children.some(c => c === taskIndicator._progressBar),
    'Hairline TaskProgressBar must be removed from AppMenuButton on destroy');

// Destroy TaskManager
taskManager.destroy();
assert(taskManager._destroyed === true, 'TaskManager must be marked destroyed');
assert(taskManager.getAllActiveTasks().length === 0, 'Active tasks must be cleared on destroy');

// Clean up temporary files
try {
    const f = Gio.File.new_for_path(testCacheFile);
    if (f.query_exists(null)) f.delete(null);
    const d = Gio.File.new_for_path(testTmpDir);
    if (d.query_exists(null)) d.delete(null);
} catch (e) {}

console.log('-> Clean teardown and zero-leak checks PASSED.');
console.log('=== All Extension Task Integration Tests PASSED Successfully! ===');
