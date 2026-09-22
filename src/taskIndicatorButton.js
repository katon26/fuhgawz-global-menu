// SPDX-License-Identifier: GPL-3.0-or-later
// src/taskIndicatorButton.js - Panel UI Controller & Dropdown for FUHGAWZ Global Menu Live Task Indicator

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TaskProgressBar } from './taskProgressBar.js';

let St = null;
try {
    const mod = await import('gi://St');
    St = mod.default ?? mod;
} catch (e) {
    St = null;
}

let Clutter = null;
try {
    const mod = await import('gi://Clutter');
    Clutter = mod.default ?? mod;
} catch (e) {
    Clutter = null;
}

let PopupMenu = null;
try {
    PopupMenu = await import('resource:///org/gnome/shell/ui/popupMenu.js');
} catch (e) {
    PopupMenu = null;
}

let Main = null;
try {
    Main = await import('resource:///org/gnome/shell/ui/main.js');
} catch (e) {
    Main = null;
}

const hasClutterContext = typeof global !== 'undefined' && Boolean(global.stage);
const hasStWidget = Boolean(St?.Widget && hasClutterContext);

/**
 * Formats a timestamp into human-readable relative time (e.g. '2m ago').
 *
 * @param {number} timestamp
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const timeMs = timestamp < 1e11 ? timestamp * 1000 : timestamp;
    const diffSec = Math.max(0, Math.floor((now - timeMs) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

/**
 * Fallback lightweight PopupMenu structure for headless testing.
 */
class FallbackPopupMenu {
    constructor() {
        this.items = [];
        this.isOpen = false;
        this._handlers = new Map();
        this.actor = {
            show: () => {
                this.isOpen = true;
                this.actor.visible = true;
                this._emit('open-state-changed', true);
            },
            hide: () => {
                this.isOpen = false;
                this.actor.visible = false;
                this._emit('open-state-changed', false);
            },
            visible: false,
        };
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

    _emit(sig, ...args) {
        const list = this._handlers.get(sig) || [];
        for (const { handler } of list) {
            try { handler(this, ...args); } catch (e) {}
        }
    }

    addMenuItem(item) {
        this.items.push(item);
    }

    removeAll() {
        this.items = [];
    }

    open() {
        this.isOpen = true;
        this.actor.visible = true;
        this._emit('open-state-changed', true);
    }

    close() {
        this.isOpen = false;
        this.actor.visible = false;
        this._emit('open-state-changed', false);
    }

    destroy() {
        this.removeAll();
        this.isOpen = false;
        this._handlers.clear();
    }
}

/**
 * Core business logic implementation for TaskIndicatorButton.
 */
class BaseIndicatorLogic {
    _initIndicator(settings = null, taskManager = null, options = {}) {
        this._settings = settings;
        this._taskManager = taskManager;
        this._options = options;

        this._mode = 'compact';
        this._enabled = true;
        this._activeTask = null;
        this._isExpanded = false;
        this._isCompleted = false;
        this._isDropdownOpen = false;
        this._labelText = '';
        this._expandedText = '';
        this._lastCopiedPath = null;
        this._autoHideTimerId = 0;
        this._destroyed = false;

        this._tmSignalIds = [];
        this._settingsSignalIds = [];
        this._menuOpenStateId = 0;

        // Progress bar child
        this._progressBar = new TaskProgressBar();

        // Dropdown menu setup
        if (PopupMenu?.PopupMenu && Main?.uiGroup) {
            try {
                const sourceActor = this._actionButton || this;
                this.menu = new PopupMenu.PopupMenu(sourceActor, 0.0, St?.Side?.TOP ?? 0);
                this.menuManager = new PopupMenu.PopupMenuManager(this);
                this.menuManager.addMenu(this.menu);
                if (typeof Main.uiGroup.add_child === 'function') {
                    Main.uiGroup.add_child(this.menu.actor);
                } else if (typeof Main.uiGroup.add_actor === 'function') {
                    Main.uiGroup.add_actor(this.menu.actor);
                }
                this.menu.actor.hide();
                this._menuOpenStateId = this.menu.connect('open-state-changed', (m, isOpen) => {
                    this._isDropdownOpen = isOpen;
                    if (typeof this.emit === 'function') {
                        this.emit('dropdown-toggled', isOpen);
                    }
                });
            } catch (e) {
                this.menu = new FallbackPopupMenu();
            }
        } else {
            this.menu = new FallbackPopupMenu();
            this._menuOpenStateId = this.menu.connect('open-state-changed', (m, isOpen) => {
                this._isDropdownOpen = isOpen;
                if (typeof this.emit === 'function') {
                    this.emit('dropdown-toggled', isOpen);
                }
            });
        }

        // Initialize settings
        if (this._settings) {
            try {
                this._enabled = this._settings.get_boolean('enable-task-indicator');
            } catch (e) {
                this._enabled = true;
            }

            try {
                const settingMode = this._settings.get_string('task-indicator-mode');
                if (settingMode && ['compact', 'hover', 'slider'].includes(settingMode)) {
                    this._mode = settingMode;
                }
            } catch (e) {}

            try {
                const sModeId = this._settings.connect('changed::task-indicator-mode', () => {
                    if (this._destroyed) return;
                    const newMode = this._settings.get_string('task-indicator-mode');
                    this.setMode(newMode);
                });
                const sEnableId = this._settings.connect('changed::enable-task-indicator', () => {
                    if (this._destroyed) return;
                    this._enabled = this._settings.get_boolean('enable-task-indicator');
                    if (!this._enabled) {
                        if (typeof this.hide === 'function') this.hide();
                    } else if (this._activeTask) {
                        if (typeof this.show === 'function') this.show();
                    }
                });
                this._settingsSignalIds.push(sModeId, sEnableId);
            } catch (e) {}
        }

        // Connect to TaskManager
        if (this._taskManager) {
            try {
                const aId = this._taskManager.connect('task-added', (tm, task) => {
                    if (this._destroyed) return;
                    this._onTaskAdded(task);
                });
                const uId = this._taskManager.connect('task-updated', (tm, task) => {
                    if (this._destroyed) return;
                    this._onTaskUpdated(task);
                });
                const cId = this._taskManager.connect('task-completed', (tm, task) => {
                    if (this._destroyed) return;
                    this._onTaskCompleted(task);
                });
                const rId = this._taskManager.connect('task-removed', (tm, taskId) => {
                    if (this._destroyed) return;
                    this._onTaskRemoved(taskId);
                });

                this._tmSignalIds.push(aId, uId, cId, rId);

                // Ingest active task if already present
                const initialTasks = this._taskManager.getAllActiveTasks?.() ?? [];
                if (initialTasks.length > 0) {
                    this.updateTask(initialTasks[0]);
                } else if (typeof this.hide === 'function') {
                    this.hide();
                }
            } catch (e) {}
        } else if (typeof this.hide === 'function') {
            this.hide();
        }

        this._updateUiComponents();
    }

    // ---------------------------------------------------------------------
    // Task Event Handlers
    // ---------------------------------------------------------------------

    _onTaskAdded(task) {
        if (this._destroyed || !task) return;
        this.updateTask(task);
    }

    _onTaskUpdated(task) {
        if (this._destroyed || !task) return;
        this.updateTask(task);
    }

    _onTaskCompleted(task) {
        if (this._destroyed) return;
        if (this._activeTask && task?.id && this._activeTask.id !== task.id) {
            const activeIsStillRunning = Boolean(this._taskManager?.getActiveTask?.(this._activeTask.id));
            if (activeIsStillRunning) {
                return;
            }
        }
        this.setCompleted(task);
    }

    _onTaskRemoved(taskId) {
        if (this._destroyed || !taskId) return;
        if (this._activeTask?.id === taskId) {
            const remaining = (this._taskManager?.getAllActiveTasks?.() ?? []).filter(t => t.id !== taskId);
            if (remaining.length > 0) {
                this.updateTask(remaining[0]);
            } else if (!this._isCompleted) {
                this._activeTask = null;
                this._labelText = '';
                this._expandedText = '';
                this.setExpanded(false);
                this._progressBar?.setProgress(0.0);
                this._updateUiComponents();
                if (typeof this.hide === 'function') {
                    this.hide();
                    if (this._appMenuButton && !this._appMenuButton._window && typeof this._appMenuButton.hide === 'function') {
                        this._appMenuButton.hide();
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Public State & Telemetry Interface
    // ---------------------------------------------------------------------

    getMode() {
        return this._mode;
    }

    setMode(mode) {
        if (this._destroyed) return;
        if (!['compact', 'hover', 'slider'].includes(mode)) return;
        if (this._mode === mode) return;

        this._mode = mode;
        if (mode !== 'slider') {
            this.setExpanded(false);
        }

        this._updateUiComponents();
        if (typeof this.emit === 'function') {
            this.emit('mode-changed', mode);
        }
    }

    getActiveTask() {
        return this._activeTask;
    }

    getLabelText() {
        return this._labelText;
    }

    getExpandedText() {
        return this._expandedText;
    }

    getDisplayedTelemetryText() {
        if (!this._isExpanded || !this._expandedText) return '';
        const availableSpace = this.calculateAvailableSpace();
        return this.truncateTelemetry(this._expandedText, null, availableSpace);
    }

    isExpanded() {
        return this._isExpanded;
    }

    isCompleted() {
        return this._isCompleted;
    }

    isDropdownOpen() {
        return this._isDropdownOpen;
    }

    getSliderToggleLabel() {
        return this._isExpanded ? '<<' : '>>';
    }

    getLastCopiedPath() {
        return this._lastCopiedPath;
    }

    // ---------------------------------------------------------------------
    // Telemetry Formatting & Task Updates
    // ---------------------------------------------------------------------

    /**
     * Formats compact status label e.g. '⏳ 42% 1m'.
     */
    formatCompactLabel(task) {
        if (!task) return '';
        if (this._isCompleted || task.state === 'completed') {
            return '✓ Done';
        }

        if (task.indeterminate) {
            return `⏳ ${task.summary || task.title || 'In progress...'}`;
        }

        const rawVal = Number(task.progress);
        const progressVal = Number.isFinite(rawVal) ? Math.max(0, rawVal) : 0;
        const percent = Math.min(100, Math.round((progressVal > 1.0 ? progressVal : progressVal * 100)));
        const percentStr = `${percent}%`;

        let cleanEta = '';
        if (task.etaText && typeof task.etaText === 'string') {
            cleanEta = task.etaText.replace(/\s*left$/i, '').trim();
        }

        if (cleanEta) {
            return `⏳ ${percentStr} ${cleanEta}`;
        }
        return `⏳ ${percentStr}`;
    }

    /**
     * Formats full expanded telemetry string e.g. '1.1 GB / 3.6 GB • 25.0 MB/s • the.bombin...'.
     */
    formatExpandedTelemetry(task) {
        if (!task) return '';
        if (this._isCompleted || task.state === 'completed') {
            return `✓ ${task.title || 'Completed'}`;
        }

        const parts = [];
        if (task.bytesText) parts.push(task.bytesText);
        if (task.speedText) parts.push(task.speedText);
        if (task.title) parts.push(task.title);
        else if (task.summary) parts.push(task.summary);

        if (parts.length === 0 && task.etaText) {
            parts.push(task.etaText);
        }

        return parts.join(' • ');
    }

    /**
     * Updates indicator with a task object.
     * @param {object} taskObj
     */
    updateTask(taskObj) {
        if (this._destroyed || !taskObj) return;

        // Cancel any pending auto-hide timer if new task arrives
        if (this._autoHideTimerId) {
            GLib.source_remove(this._autoHideTimerId);
            this._autoHideTimerId = 0;
        }
        this._isCompleted = false;

        this._activeTask = { ...taskObj };
        this._labelText = this.formatCompactLabel(this._activeTask);
        this._expandedText = this.formatExpandedTelemetry(this._activeTask);

        // Update progress bar
        if (this._progressBar) {
            if (this._activeTask.indeterminate) {
                this._progressBar.setIndeterminate(true);
            } else {
                this._progressBar.setIndeterminate(false);
                const p = Number(this._activeTask.progress ?? 0);
                const safeP = Number.isFinite(p) ? Math.max(0, p) : 0;
                this._progressBar.setProgress(safeP > 1.0 ? safeP / 100 : safeP);
            }
        }

        this._updateUiComponents();

        if (this._enabled && typeof this.show === 'function') {
            this.show();
            if (this._appMenuButton && typeof this._appMenuButton.show === 'function') {
                this._appMenuButton.show();
            }
        }

        if (typeof this.emit === 'function') {
            this.emit('task-updated', this._activeTask);
        }
    }

    /**
     * Flashes completion badge '[ ✓ Done ]' and starts auto-hide timer.
     * @param {object} [taskObj]
     */
    setCompleted(taskObj = null) {
        if (this._destroyed) return;

        if (taskObj) {
            this._activeTask = { ...taskObj, state: 'completed' };
        } else if (this._activeTask) {
            this._activeTask.state = 'completed';
        }

        this._isCompleted = true;
        this._labelText = '✓ Done';
        this._expandedText = this.formatExpandedTelemetry(this._activeTask);

        if (this._progressBar) {
            this._progressBar.setIndeterminate(false);
            this._progressBar.setProgress(1.0);
        }

        this._updateUiComponents();

        if (typeof this.emit === 'function') {
            this.emit('completion-state-changed', true);
        }

        // Cancel previous timer
        if (this._autoHideTimerId) {
            GLib.source_remove(this._autoHideTimerId);
            this._autoHideTimerId = 0;
        }

        const autoHideSec = Number(
            this._options?.autoHideSeconds ??
            this._settings?.get_int('task-auto-hide-seconds') ??
            4
        );
        const delayMs = Math.max(50, Math.floor(autoHideSec * 1000));

        this._autoHideTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._autoHideTimerId = 0;
            this._autoCollapseCompletion();
            return GLib.SOURCE_REMOVE;
        });
    }

    _autoCollapseCompletion() {
        if (this._destroyed) return;

        this._isCompleted = false;

        const remaining = this._taskManager?.getAllActiveTasks?.() ?? [];
        if (remaining.length > 0) {
            this.updateTask(remaining[0]);
            if (typeof this.emit === 'function') {
                this.emit('completion-state-changed', false);
            }
            return;
        }

        this._activeTask = null;
        this._labelText = '';
        this._expandedText = '';
        this.setExpanded(false);

        if (this._progressBar) {
            this._progressBar.setProgress(0.0);
            this._progressBar.setIndeterminate(false);
        }

        this._updateUiComponents();

        if (typeof this.hide === 'function') {
            this.hide();
            if (this._appMenuButton && !this._appMenuButton._window && typeof this._appMenuButton.hide === 'function') {
                this._appMenuButton.hide();
            }
        }

        if (typeof this.emit === 'function') {
            this.emit('completion-state-changed', false);
        }
    }

    // ---------------------------------------------------------------------
    // Mode Interaction & Pointer Handlers
    // ---------------------------------------------------------------------

    onPointerEnter() {
        if (this._destroyed) return;
        if (this._mode === 'hover') {
            this.setExpanded(true);
        }
    }

    onPointerLeave() {
        if (this._destroyed) return;
        if (this._mode === 'hover') {
            this.setExpanded(false);
        }
    }

    toggleSlider() {
        if (this._destroyed) return;
        if (this._mode === 'slider') {
            this.setExpanded(!this._isExpanded);
        }
    }

    setExpanded(expanded) {
        if (this._destroyed) return;
        const flag = Boolean(expanded);
        if (this._isExpanded === flag) return;

        this._isExpanded = flag;
        if (this._isExpanded && this._activeTask) {
            this._expandedText = this.formatExpandedTelemetry(this._activeTask);
        }

        this._updateUiComponents();
    }

    // ---------------------------------------------------------------------
    // Center Clock Collision Guard & Width Clamping
    // ---------------------------------------------------------------------

    calculateAvailableSpace() {
        let centerBoxX = null;
        if (this._options?.centerBoxX !== undefined) {
            centerBoxX = this._options.centerBoxX;
        } else if (Main?.panel?._centerBox) {
            try {
                if (typeof Main.panel._centerBox.get_transformed_position === 'function') {
                    const [x] = Main.panel._centerBox.get_transformed_position();
                    centerBoxX = x;
                } else if (Main.panel._centerBox.x !== undefined) {
                    centerBoxX = Main.panel._centerBox.x;
                }
            } catch (e) {}
        }

        let indicatorX = 0;
        let indicatorWidth = 0;
        try {
            if (typeof this.get_transformed_position === 'function') {
                const [x] = this.get_transformed_position();
                indicatorX = x;
            } else if (this.x !== undefined) {
                indicatorX = this.x;
            }
            if (typeof this.get_width === 'function') {
                indicatorWidth = this.get_width();
            } else if (this.width !== undefined) {
                indicatorWidth = this.width;
            }
        } catch (e) {}

        if (centerBoxX !== null && Number.isFinite(centerBoxX)) {
            const MARGIN = 16;
            let telemetryWidth = 0;
            if (this._isExpanded && this._telemetryLabelWidget) {
                if (typeof this._telemetryLabelWidget.get_width === 'function') {
                    telemetryWidth = this._telemetryLabelWidget.get_width();
                } else if (this._telemetryLabelWidget.width !== undefined) {
                    telemetryWidth = this._telemetryLabelWidget.width;
                }
            }
            const baseWidth = Math.max(0, indicatorWidth - telemetryWidth);
            const available = Math.max(0, centerBoxX - (indicatorX + baseWidth) - MARGIN);
            return available;
        }
        return 300;
    }

    clampTelemetryWidth(targetWidth, maxAvailable = null) {
        const avail = maxAvailable !== null ? maxAvailable : this.calculateAvailableSpace();
        const width = Number(targetWidth) || 0;
        return Math.max(0, Math.min(width, Math.max(0, avail)));
    }

    truncateTelemetry(text, maxChars = null, maxWidth = null, charWidth = 8) {
        if (!text || typeof text !== 'string') return '';
        const limit = maxChars !== null
            ? maxChars
            : (maxWidth !== null ? Math.floor(maxWidth / charWidth) : text.length);
        if (limit <= 0) return '...';
        if (text.length <= limit) return text;
        const keep = Math.max(0, limit - 3);
        return text.substring(0, keep) + '...';
    }

    // ---------------------------------------------------------------------
    // Dropdown Menu Generation & Action Handlers
    // ---------------------------------------------------------------------

    toggleDropdown() {
        if (this._destroyed) return;
        if (this.isDropdownOpen()) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        if (this._destroyed) return;
        this._buildDropdownMenu();
        this._isDropdownOpen = true;

        if (typeof this.menu?.open === 'function') {
            this.menu.open();
        }

        if (typeof this.emit === 'function') {
            this.emit('dropdown-toggled', true);
        }
    }

    closeDropdown() {
        if (this._destroyed) return;
        this._isDropdownOpen = false;

        if (typeof this.menu?.close === 'function') {
            this.menu.close();
        }

        if (typeof this.emit === 'function') {
            this.emit('dropdown-toggled', false);
        }
    }

    getDropdownData() {
        const recentTasks = (this._taskManager?.getRecentTasks?.() || []).slice(0, 10).map(t => ({
            id: t.id,
            title: t.title,
            uri: t.uri,
            completedAt: t.completedAt,
            relativeTime: formatRelativeTime(t.completedAt),
            actions: ['showInFiles', 'openFile', 'copyPath'],
        }));

        let activeCard = null;
        if (this._activeTask) {
            activeCard = {
                id: this._activeTask.id,
                title: this._activeTask.title,
                progress: this._activeTask.progress,
                indeterminate: Boolean(this._activeTask.indeterminate),
                summary: this._activeTask.summary || '',
                bytesText: this._activeTask.bytesText || '',
                speedText: this._activeTask.speedText || '',
                etaText: this._activeTask.etaText || '',
                uri: this._activeTask.uri || null,
                paused: Boolean(this._activeTask.paused),
            };
        }

        return {
            activeCard,
            recentItems: recentTasks,
        };
    }

    _buildDropdownMenu() {
        if (!this.menu) return;

        if (typeof this.menu.removeAll === 'function') {
            this.menu.removeAll();
        }

        const data = this.getDropdownData();

        // 1. Active Task Card
        if (data.activeCard) {
            const card = data.activeCard;
            if (PopupMenu?.PopupMenuItem) {
                const titleItem = new PopupMenu.PopupMenuItem(`📄 ${card.title || 'Active Task'}`, { reactive: false });
                this.menu.addMenuItem(titleItem);

                // Hairline Progress Bar row
                try {
                    const progressItem = new (PopupMenu.PopupBaseMenuItem || PopupMenu.PopupMenuItem)({ reactive: false });
                    const progressBox = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'fuhgawz-dropdown-progress-box' });
                    const percentText = card.indeterminate ? 'In progress...' : `${Math.round((card.progress ?? 0) * 100)}%`;
                    const percentLabel = new St.Label({ text: percentText, style_class: 'fuhgawz-card-percent-label' });
                    const cardProgressBar = new TaskProgressBar({ progress: card.progress, indeterminate: card.indeterminate });
                    progressBox.add_child(percentLabel);
                    progressBox.add_child(cardProgressBar);
                    progressItem.add_child(progressBox);
                    this.menu.addMenuItem(progressItem);
                } catch (e) {
                    const percentText = card.indeterminate ? 'In progress...' : `${Math.round((card.progress ?? 0) * 100)}%`;
                    const progressItem = new PopupMenu.PopupMenuItem(`📊 ${percentText}`, { reactive: false });
                    this.menu.addMenuItem(progressItem);
                }

                // Stats line: ETA, Speed, Bytes
                const statsText = [card.etaText, card.speedText, card.bytesText].filter(Boolean).join(' · ');
                if (statsText) {
                    const statsItem = new PopupMenu.PopupMenuItem(`🕒 ${statsText}`, { reactive: false });
                    this.menu.addMenuItem(statsItem);
                }

                // Action buttons row: Pause/Resume, Cancel, Reveal
                const pauseLabel = card.paused ? '▶️ Resume' : '⏸️ Pause';
                const pauseItem = new PopupMenu.PopupMenuItem(pauseLabel);
                pauseItem.connect('activate', () => {
                    this.pauseTask(card.id);
                    this._buildDropdownMenu();
                });
                this.menu.addMenuItem(pauseItem);

                const cancelItem = new PopupMenu.PopupMenuItem('🛑 Cancel');
                cancelItem.connect('activate', () => {
                    this.cancelTask(card.id);
                    this.closeDropdown();
                });
                this.menu.addMenuItem(cancelItem);

                if (card.uri || this._taskManager?.revealTask) {
                    const revealItem = new PopupMenu.PopupMenuItem('📁 Show in Files');
                    revealItem.connect('activate', () => {
                        this.revealTask(card.id);
                        this.closeDropdown();
                    });
                    this.menu.addMenuItem(revealItem);
                }
            } else {
                // Fallback mock items
                const cardProgressBar = new TaskProgressBar({ progress: card.progress, indeterminate: card.indeterminate });
                this.menu.addMenuItem({
                    type: 'card',
                    ...card,
                    progressBar: cardProgressBar,
                    actions: {
                        pause: () => this.pauseTask(card.id),
                        cancel: () => this.cancelTask(card.id),
                        reveal: () => this.revealTask(card.id),
                    },
                });
            }
        }

        // Separator
        if (PopupMenu?.PopupSeparatorMenuItem) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        } else {
            this.menu.addMenuItem({ type: 'separator' });
        }

        // 2. Recent Tasks Section
        if (data.recentItems.length > 0) {
            if (PopupMenu?.PopupSubMenuMenuItem && PopupMenu?.PopupMenuItem) {
                const headerItem = new PopupMenu.PopupMenuItem('RECENT TASKS', { reactive: false });
                this.menu.addMenuItem(headerItem);

                for (const item of data.recentItems) {
                    const label = `✓ ${item.title}  (${item.relativeTime})`;
                    const subItem = new PopupMenu.PopupSubMenuMenuItem(label);

                    const showInFilesItem = new PopupMenu.PopupMenuItem('📁 Show in Files');
                    showInFilesItem.connect('activate', () => {
                        if (item.uri) this.showInFiles(item.uri);
                        this.closeDropdown();
                    });
                    subItem.menu.addMenuItem(showInFilesItem);

                    const openItem = new PopupMenu.PopupMenuItem('📄 Open File');
                    openItem.connect('activate', () => {
                        if (item.uri) this.openFile(item.uri);
                        this.closeDropdown();
                    });
                    subItem.menu.addMenuItem(openItem);

                    const copyItem = new PopupMenu.PopupMenuItem('📋 Copy Path');
                    copyItem.connect('activate', () => {
                        if (item.uri) this.copyPath(item.uri);
                        this.closeDropdown();
                    });
                    subItem.menu.addMenuItem(copyItem);

                    this.menu.addMenuItem(subItem);
                }
            } else if (PopupMenu?.PopupMenuItem) {
                const headerItem = new PopupMenu.PopupMenuItem('RECENT TASKS', { reactive: false });
                this.menu.addMenuItem(headerItem);

                for (const item of data.recentItems) {
                    const label = `✓ ${item.title}  (${item.relativeTime})`;
                    const recentEntry = new PopupMenu.PopupMenuItem(label);
                    recentEntry.connect('activate', () => {
                        if (item.uri) this.showInFiles(item.uri);
                    });
                    this.menu.addMenuItem(recentEntry);
                }
            } else {
                this.menu.addMenuItem({ type: 'recent_header', label: 'RECENT TASKS' });
                for (const item of data.recentItems) {
                    this.menu.addMenuItem({
                        type: 'recent_item',
                        ...item,
                        actions: {
                            showInFiles: () => this.showInFiles(item.uri),
                            openFile: () => this.openFile(item.uri),
                            copyPath: () => this.copyPath(item.uri),
                        },
                    });
                }
            }
        } else if (!data.activeCard) {
            if (PopupMenu?.PopupMenuItem) {
                const emptyItem = new PopupMenu.PopupMenuItem('No active tasks', { reactive: false });
                this.menu.addMenuItem(emptyItem);
            } else {
                this.menu.addMenuItem({ type: 'empty', label: 'No active tasks' });
            }
        }
    }

    pauseTask(taskId) {
        if (this._destroyed || !taskId) return false;
        if (this._taskManager && typeof this._taskManager.pauseTask === 'function') {
            return this._taskManager.pauseTask(taskId);
        }
        const task = (this._taskManager?.getActiveTask?.(taskId)) || (this._activeTask?.id === taskId ? this._activeTask : null);
        if (task) {
            task.paused = !task.paused;
            if (this._activeTask?.id === taskId) {
                this._activeTask.paused = task.paused;
            }
            return true;
        }
        return false;
    }

    cancelTask(taskId) {
        if (this._destroyed || !taskId) return false;
        if (this._taskManager && typeof this._taskManager.cancelTask === 'function') {
            return this._taskManager.cancelTask(taskId);
        }
        if (this._activeTask && this._activeTask.id === taskId) {
            this._activeTask = null;
            this._labelText = '';
            this._expandedText = '';
            this.setExpanded(false);
            if (this._progressBar) {
                this._progressBar.setProgress(0.0);
            }
            this._updateUiComponents();
            if (typeof this.hide === 'function') {
                this.hide();
            }
            return true;
        }
        return false;
    }

    revealTask(taskId) {
        if (this._destroyed || !taskId) return false;
        if (this._taskManager && typeof this._taskManager.revealTask === 'function') {
            return this._taskManager.revealTask(taskId);
        }
        const task = (this._taskManager?.getActiveTask?.(taskId)) || (this._activeTask?.id === taskId ? this._activeTask : null);
        if (task?.uri) {
            return this.showInFiles(task.uri);
        }
        return false;
    }

    showInFiles(uriOrPath) {
        if (!uriOrPath || this._destroyed) return false;
        const uri = uriOrPath.startsWith('file://') ? uriOrPath : GLib.filename_to_uri(uriOrPath, null);
        try {
            const bus = Gio.DBus.session;
            if (bus) {
                bus.call(
                    'org.freedesktop.FileManager1',
                    '/org/freedesktop/FileManager1',
                    'org.freedesktop.FileManager1',
                    'ShowItems',
                    new GLib.Variant('(ass)', [[uri], '']),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
                return true;
            }
        } catch (e) {}

        try {
            const file = Gio.File.new_for_uri(uri);
            const parent = file.get_parent();
            if (parent) {
                Gio.AppInfo.launch_default_for_uri(parent.get_uri(), null);
                return true;
            }
        } catch (e) {}
        return true;
    }

    openFile(uriOrPath) {
        if (!uriOrPath || this._destroyed) return false;
        const uri = uriOrPath.startsWith('file://') ? uriOrPath : GLib.filename_to_uri(uriOrPath, null);
        try {
            return Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e) {
            return false;
        }
    }

    copyPath(uriOrPath) {
        if (!uriOrPath || this._destroyed) return false;
        let path = uriOrPath;
        if (path.startsWith('file://')) {
            try {
                path = Gio.File.new_for_uri(path).get_path() || path;
            } catch (e) {}
        }
        this._lastCopiedPath = path;
        const hasMetaDisplay = typeof global !== 'undefined' && Boolean(global.display);
        if (St?.Clipboard && hasMetaDisplay) {
            try {
                const clipboard = St.Clipboard.get_default();
                clipboard.set_text(St.ClipboardType.CLIPBOARD, path);
                return true;
            } catch (e) {}
        }
        return true;
    }

    // ---------------------------------------------------------------------
    // AppMenuButton Binding
    // ---------------------------------------------------------------------

    bindToAppMenu(appMenuButton) {
        if (!appMenuButton || this._destroyed) return;
        this._appMenuButton = appMenuButton;

        const targetBox = appMenuButton._box || appMenuButton;
        if (targetBox && typeof targetBox.add_child === 'function') {
            const curParent = (typeof this.get_parent === 'function') ? this.get_parent() : this._parent;
            if (curParent && curParent !== targetBox && typeof curParent.remove_child === 'function') {
                curParent.remove_child(this);
            }
            const existingChildren = targetBox.get_children ? targetBox.get_children() : (targetBox.children || []);
            if (!existingChildren.includes(this)) {
                targetBox.add_child(this);
                this._parent = targetBox;
            }
        }

        if (this._progressBar && typeof appMenuButton.add_child === 'function') {
            const curParent = (typeof this._progressBar.get_parent === 'function')
                ? this._progressBar.get_parent()
                : this._progressBar._parent;
            if (curParent && curParent !== appMenuButton && typeof curParent.remove_child === 'function') {
                curParent.remove_child(this._progressBar);
            }
            const existingChildren = appMenuButton.get_children ? appMenuButton.get_children() : (appMenuButton.children || []);
            if (!existingChildren.includes(this._progressBar)) {
                appMenuButton.add_child(this._progressBar);
                this._progressBar._parent = appMenuButton;
            }
        }
    }

    // ---------------------------------------------------------------------
    // UI Component Updates
    // ---------------------------------------------------------------------

    _updateUiComponents() {
        if (this._separatorWidget) {
            const hasContent = Boolean(this._labelText || this._activeTask || this._isCompleted);
            if (hasContent) {
                if (typeof this._separatorWidget.show === 'function') this._separatorWidget.show();
                else this._separatorWidget.visible = true;
            } else {
                if (typeof this._separatorWidget.hide === 'function') this._separatorWidget.hide();
                else this._separatorWidget.visible = false;
            }
        }

        if (this._compactLabelWidget) {
            this._compactLabelWidget.text = this._labelText;
        }

        if (this._telemetryLabelWidget) {
            const displayText = this.getDisplayedTelemetryText();
            this._telemetryLabelWidget.text = displayText;
            if (this._isExpanded && this._expandedText) {
                if (typeof this._telemetryLabelWidget.ease === 'function' && Clutter?.AnimationMode) {
                    this._telemetryLabelWidget.opacity = 0;
                    this._telemetryLabelWidget.show();
                    this._telemetryLabelWidget.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                } else if (typeof this._telemetryLabelWidget.show === 'function') {
                    this._telemetryLabelWidget.show();
                } else {
                    this._telemetryLabelWidget.visible = true;
                }
            } else {
                if (typeof this._telemetryLabelWidget.hide === 'function') {
                    this._telemetryLabelWidget.hide();
                } else {
                    this._telemetryLabelWidget.visible = false;
                }
            }
        }

        if (this._sliderToggleWidget) {
            this._sliderToggleWidget.label = this.getSliderToggleLabel();
            if (this._mode === 'slider') {
                if (typeof this._sliderToggleWidget.show === 'function') {
                    this._sliderToggleWidget.show();
                } else {
                    this._sliderToggleWidget.visible = true;
                }
            } else {
                if (typeof this._sliderToggleWidget.hide === 'function') {
                    this._sliderToggleWidget.hide();
                } else {
                    this._sliderToggleWidget.visible = false;
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Clean Teardown
    // ---------------------------------------------------------------------

    _destroyIndicator() {
        if (this._destroyed) return;
        this._destroyed = true;

        this._activeTask = null;
        this._labelText = '';
        this._expandedText = '';
        this._isCompleted = false;
        this._isExpanded = false;

        if (this._autoHideTimerId) {
            GLib.source_remove(this._autoHideTimerId);
            this._autoHideTimerId = 0;
        }

        if (this._taskManager && this._tmSignalIds.length > 0) {
            for (const sId of this._tmSignalIds) {
                try {
                    this._taskManager.disconnect(sId);
                } catch (e) {}
            }
            this._tmSignalIds = [];
        }

        if (this._settings && this._settingsSignalIds.length > 0) {
            for (const sId of this._settingsSignalIds) {
                try {
                    this._settings.disconnect(sId);
                } catch (e) {}
            }
            this._settingsSignalIds = [];
        }

        if (this.menu) {
            if (this._menuOpenStateId && typeof this.menu.disconnect === 'function') {
                try {
                    this.menu.disconnect(this._menuOpenStateId);
                } catch (e) {}
                this._menuOpenStateId = 0;
            }
            if (this.menuManager && typeof this.menuManager.removeMenu === 'function') {
                try {
                    this.menuManager.removeMenu(this.menu);
                } catch (e) {}
                this.menuManager = null;
            }
            try {
                this.menu.destroy();
            } catch (e) {}
            this.menu = null;
        }

        if (this._progressBar) {
            const pbParent = (typeof this._progressBar.get_parent === 'function')
                ? this._progressBar.get_parent()
                : this._progressBar._parent;
            if (pbParent && typeof pbParent.remove_child === 'function') {
                pbParent.remove_child(this._progressBar);
            }
            try {
                this._progressBar.destroy();
            } catch (e) {}
            this._progressBar = null;
        }

        const myParent = (typeof this.get_parent === 'function')
            ? this.get_parent()
            : this._parent;
        if (myParent && typeof myParent.remove_child === 'function') {
            myParent.remove_child(this);
        }
        this._parent = null;

        this._appMenuButton = null;
    }
}

// -------------------------------------------------------------------------
// GObject Class Registration
// -------------------------------------------------------------------------

let TaskIndicatorButtonClass;

if (hasStWidget) {
    TaskIndicatorButtonClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskIndicatorButton',
            Signals: {
                'mode-changed': {
                    param_types: [GObject.TYPE_STRING],
                },
                'task-updated': {
                    param_types: [GObject.TYPE_JSOBJECT],
                },
                'completion-state-changed': {
                    param_types: [GObject.TYPE_BOOLEAN],
                },
                'dropdown-toggled': {
                    param_types: [GObject.TYPE_BOOLEAN],
                },
            },
        },
        class TaskIndicatorButton extends St.Widget {
            _init(settings = null, taskManager = null, options = {}) {
                super._init({
                    style_class: 'fuhgawz-task-indicator',
                    reactive: true,
                    track_hover: true,
                });

                this._box = new St.BoxLayout({
                    style_class: 'fuhgawz-task-indicator-box',
                    reactive: true,
                    track_hover: true,
                });

                this._separatorWidget = new St.Label({
                    style_class: 'fuhgawz-task-separator',
                    text: '•',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._box.add_child(this._separatorWidget);

                this._compactLabelWidget = new St.Label({
                    style_class: 'fuhgawz-task-indicator-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._box.add_child(this._compactLabelWidget);

                this._sliderToggleWidget = new St.Button({
                    style_class: 'fuhgawz-task-slider-toggle fuhgawz-task-toggle-btn',
                    label: '>>',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._sliderToggleWidget.connect('button-press-event', () => Clutter.EVENT_STOP);
                this._sliderToggleWidget.connect('clicked', () => this.toggleSlider());
                this._box.add_child(this._sliderToggleWidget);

                this._telemetryLabelWidget = new St.Label({
                    style_class: 'fuhgawz-task-telemetry-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._telemetryLabelWidget.hide();
                this._box.add_child(this._telemetryLabelWidget);

                this._actionButton = new St.Button({
                    style_class: 'fuhgawz-task-action-button',
                    label: '•••',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._actionButton.connect('button-press-event', () => Clutter.EVENT_STOP);
                this._actionButton.connect('clicked', () => this.toggleDropdown());
                this._box.add_child(this._actionButton);

                this.add_child(this._box);

                this.connect('enter-event', () => this.onPointerEnter());
                this.connect('leave-event', () => this.onPointerLeave());

                this._initIndicator(settings, taskManager, options);
            }

            destroy() {
                if (this._destroyed) return;
                this._destroyIndicator();
                super.destroy();
            }
        }
    );
} else {
    // Standalone unit test environment
    TaskIndicatorButtonClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskIndicatorButton',
            Signals: {
                'mode-changed': {
                    param_types: [GObject.TYPE_STRING],
                },
                'task-updated': {
                    param_types: [GObject.TYPE_JSOBJECT],
                },
                'completion-state-changed': {
                    param_types: [GObject.TYPE_BOOLEAN],
                },
                'dropdown-toggled': {
                    param_types: [GObject.TYPE_BOOLEAN],
                },
                'destroy': {},
            },
        },
        class TaskIndicatorButton extends GObject.Object {
            _init(settings = null, taskManager = null, options = {}) {
                super._init();
                this.x = 0;
                this.y = 0;
                this.width = 0;
                this.height = 0;
                this.visible = true;
                this.children = [];

                this._separatorWidget = {
                    text: '•',
                    visible: false,
                    show() { this.visible = true; },
                    hide() { this.visible = false; },
                };
                this._compactLabelWidget = { text: '' };
                this._sliderToggleWidget = {
                    label: '>>',
                    visible: false,
                    show() { this.visible = true; },
                    hide() { this.visible = false; },
                };
                this._telemetryLabelWidget = {
                    text: '',
                    visible: false,
                    show() { this.visible = true; },
                    hide() { this.visible = false; },
                };

                this._initIndicator(settings, taskManager, options);
            }

            add_child(child) {
                this.children.push(child);
            }

            remove_child(child) {
                this.children = this.children.filter(c => c !== child);
            }

            get_children() {
                return this.children.slice();
            }

            show() {
                this.visible = true;
            }

            hide() {
                this.visible = false;
            }

            get_transformed_position() {
                return [this.x, this.y];
            }

            get_width() {
                return this.width;
            }

            get_height() {
                return this.height;
            }

            get_parent() {
                return this._parent || null;
            }

            destroy() {
                if (this._destroyed) return;
                this._destroyIndicator();
                this.children = [];
                this.emit('destroy');
            }
        }
    );
}

// Copy shared methods and accessors onto prototype, excluding constructor and destroy
const protoDescriptors = Object.getOwnPropertyDescriptors(BaseIndicatorLogic.prototype);
for (const [name, descriptor] of Object.entries(protoDescriptors)) {
    if (name !== 'constructor' && name !== 'destroy') {
        Object.defineProperty(TaskIndicatorButtonClass.prototype, name, descriptor);
    }
}

export const TaskIndicatorButton = TaskIndicatorButtonClass;
