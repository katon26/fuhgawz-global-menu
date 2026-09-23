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

let PanelMenu = null;
try {
    PanelMenu = await import('resource:///org/gnome/shell/ui/panelMenu.js');
} catch (e) {
    PanelMenu = null;
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
        this._placement = 'unified';
        this._placementApplied = false;
        this._enabled = true;
        this._activeTask = null;
        this._isExpanded = false;
        this._isCompleted = false;
        this._isDropdownOpen = false;
        this._labelText = '';
        this._expandedText = '';
        this._appLabel = this._options?.appLabel || '';
        this._lastCopiedPath = null;
        this._autoHideTimerId = 0;
        this._destroyed = false;

        this._tmSignalIds = [];
        this._settingsSignalIds = [];
        this._menuOpenStateId = 0;
        this._appMenuSignalIds = [];
        this._origAppMenuToggle = null;
        this._childClickInProgress = false;

        // Progress bar child
        this._progressBar = new TaskProgressBar();

        // Dropdown menu setup
        if (!this.menu) {
            if (PopupMenu?.PopupMenu && Main?.uiGroup) {
                try {
                    const sourceActor = this._actionButton || this;
                    this.menu = new PopupMenu.PopupMenu(sourceActor, 0.0, St?.Side?.TOP ?? 0);
                    if (typeof Main.uiGroup.add_child === 'function') {
                        Main.uiGroup.add_child(this.menu.actor);
                    } else if (typeof Main.uiGroup.add_actor === 'function') {
                        Main.uiGroup.add_actor(this.menu.actor);
                    }
                    this.menu.actor.hide();
                } catch (e) {
                    this.menu = new FallbackPopupMenu();
                }
            } else {
                this.menu = new FallbackPopupMenu();
            }
        }

        if (this.menu && !this._menuOpenStateId && typeof this.menu.connect === 'function') {
            this._menuOpenStateId = this.menu.connect('open-state-changed', (m, isOpen) => {
                this._isDropdownOpen = isOpen;
                this._updateUiComponents();
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
                const settingPlacement = this._settings.get_string('task-indicator-placement');
                if (settingPlacement && ['unified', 'standalone'].includes(settingPlacement)) {
                    this._placement = settingPlacement;
                }
            } catch (e) {}

            try {
                const sModeId = this._settings.connect('changed::task-indicator-mode', () => {
                    if (this._destroyed) return;
                    const newMode = this._settings.get_string('task-indicator-mode');
                    this.setMode(newMode);
                });
                const sPlacementId = this._settings.connect('changed::task-indicator-placement', () => {
                    if (this._destroyed) return;
                    const newPlacement = this._settings.get_string('task-indicator-placement');
                    this.setPlacement(newPlacement);
                });
                const sEnableId = this._settings.connect('changed::enable-task-indicator', () => {
                    if (this._destroyed) return;
                    this._enabled = this._settings.get_boolean('enable-task-indicator');
                    if (!this._enabled) {
                        this._hideIndicator();
                    } else if (this._activeTask || this._isCompleted) {
                        this._showIndicator();
                    }
                });
                this._settingsSignalIds.push(sModeId, sPlacementId, sEnableId);
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
                if (this._progressBar) {
                    this._progressBar.setProgress(0.0);
                    if (typeof this._progressBar.setCompleted === 'function') {
                        this._progressBar.setCompleted(false);
                    }
                }
                this._updateUiComponents();
                if (typeof this.hide === 'function') {
                    this.hide();
                }
                this.visible = false;
                if (this._placement === 'unified' && this._appMenuButton && !this._appMenuButton._window && typeof this._appMenuButton.hide === 'function') {
                    this._appMenuButton.hide();
                }
            }
        }
    }

    _getMain() {
        return this._options?.main || (typeof globalThis !== 'undefined' && globalThis.Main) || Main;
    }

    getPlacement() {
        return this._placement || 'unified';
    }

    setPlacement(placement) {
        if (this._destroyed) return;
        if (!['unified', 'standalone'].includes(placement)) return;
        if (this._placement === placement && this._placementApplied) return;

        const oldPlacement = this._placement;
        this._placement = placement;
        this._applyPlacement(oldPlacement);

        if (typeof this.emit === 'function') {
            this.emit('placement-changed', placement);
        }
    }

    _syncVisibility() {
        const hasContent = Boolean(this._activeTask || this._isCompleted);
        const shouldShow = Boolean(this._enabled && hasContent);

        if (this._placement === 'standalone') {
            if (shouldShow) {
                if (this.container && typeof this.container.show === 'function') {
                    this.container.show();
                    this.container.visible = true;
                }
                if (typeof this.show === 'function') this.show();
                this.visible = true;
            } else {
                if (this.container && typeof this.container.hide === 'function') {
                    this.container.hide();
                    this.container.visible = false;
                }
                if (typeof this.hide === 'function') this.hide();
                this.visible = false;
            }
        } else {
            // Unified placement
            if (shouldShow) {
                if (typeof this.show === 'function') this.show();
                this.visible = true;
                if (this._appMenuButton && typeof this._appMenuButton.show === 'function') {
                    this._appMenuButton.show();
                }
            } else {
                if (typeof this.hide === 'function') this.hide();
                this.visible = false;
                if (this._appMenuButton && !this._appMenuButton._window && typeof this._appMenuButton.hide === 'function') {
                    this._appMenuButton.hide();
                }
            }
        }
    }

    _showIndicator() {
        this._syncVisibility();
    }

    _hideIndicator() {
        if (typeof this.hide === 'function') this.hide();
        this.visible = false;
        if (this._placement === 'standalone') {
            if (this.container && typeof this.container.hide === 'function') {
                this.container.hide();
                this.container.visible = false;
            }
        } else if (this._appMenuButton && !this._appMenuButton._window && typeof this._appMenuButton.hide === 'function') {
            this._appMenuButton.hide();
        }
    }

    _applyPlacement(oldPlacement = null) {
        if (this._destroyed) return;
        const main = this._getMain();

        if (this._placement === 'standalone') {
            // 1. Unparent from AppMenuButton._box if currently parented there
            if (this._appMenuButton) {
                const targetBox = this._appMenuButton._box || this._appMenuButton;
                const curParent = (typeof this.get_parent === 'function') ? this.get_parent() : this._parent;
                if (curParent === targetBox || (targetBox && typeof targetBox.remove_child === 'function')) {
                    try { targetBox.remove_child(this); } catch (e) {}
                }
                if (this._parent === targetBox) {
                    this._parent = null;
                }
            }

            // 2. Unparent progress bar from AppMenuButton
            if (this._progressBar && this._appMenuButton) {
                const curPbParent = (typeof this._progressBar.get_parent === 'function')
                    ? this._progressBar.get_parent()
                    : this._progressBar._parent;
                if (curPbParent === this._appMenuButton || typeof this._appMenuButton.remove_child === 'function') {
                    try { this._appMenuButton.remove_child(this._progressBar); } catch (e) {}
                }
                if (this._progressBar._parent === this._appMenuButton) {
                    this._progressBar._parent = null;
                }
                this._appMenuButton._progressBar = null;
            }

            // 3. Attach progress bar directly to this indicator
            if (this._progressBar) {
                const curPbParent = (typeof this._progressBar.get_parent === 'function')
                    ? this._progressBar.get_parent()
                    : this._progressBar._parent;
                if (curPbParent !== this) {
                    if (curPbParent && typeof curPbParent.remove_child === 'function') {
                        try { curPbParent.remove_child(this._progressBar); } catch (e) {}
                    }
                    const myChildren = (typeof this.get_children === 'function')
                        ? this.get_children()
                        : (this.children || []);
                    if (!myChildren.includes(this._progressBar)) {
                        if (typeof this.add_child === 'function') {
                            this.add_child(this._progressBar);
                        }
                    }
                    this._progressBar._parent = this;
                }
            }

            // 4. Ensure this is inside this.container if container exists (GNOME Shell PanelMenu.Button)
            if (this.container) {
                const curChild = (typeof this.container.get_child === 'function')
                    ? this.container.get_child()
                    : (this.container.child || null);
                if (curChild !== this) {
                    if (typeof this.container.set_child === 'function') {
                        try { this.container.set_child(this); } catch (e) {}
                    }
                    if (this.container.child !== this) {
                        try { this.container.child = this; } catch (e) {}
                    }
                }
            }

            // 5. Register in Main.panel (role: 'fuhgawz-task-indicator', pos = 2, 'left')
            if (main?.panel) {
                if (typeof main.panel.addToStatusArea === 'function') {
                    if (main.panel.statusArea?.['fuhgawz-task-indicator'] !== this) {
                        if (main.panel.statusArea?.['fuhgawz-task-indicator']) {
                            delete main.panel.statusArea['fuhgawz-task-indicator'];
                        }
                        try {
                            main.panel.addToStatusArea('fuhgawz-task-indicator', this, 2, 'left');
                        } catch (e) {
                            console.error(`FUHGlobe: Failed to register TaskIndicator in statusArea: ${e}`);
                            if (main.panel._leftBox) {
                                const targetChild = this.container || this;
                                const boxChildren = main.panel._leftBox.get_children ? main.panel._leftBox.get_children() : (main.panel._leftBox.children || []);
                                if (!boxChildren.includes(targetChild)) {
                                    if (typeof main.panel._leftBox.insert_child_at_index === 'function') {
                                        main.panel._leftBox.insert_child_at_index(targetChild, 2);
                                    } else {
                                        main.panel._leftBox.add_child(targetChild);
                                    }
                                }
                                if (main.panel.statusArea) {
                                    main.panel.statusArea['fuhgawz-task-indicator'] = this;
                                }
                                this._rolePosition = 2;
                            }
                        }
                    }
                } else if (main.panel._leftBox && typeof main.panel._leftBox.add_child === 'function') {
                    const targetChild = this.container || this;
                    const boxChildren = main.panel._leftBox.get_children ? main.panel._leftBox.get_children() : (main.panel._leftBox.children || []);
                    if (!boxChildren.includes(targetChild)) {
                        if (typeof main.panel._leftBox.insert_child_at_index === 'function') {
                            main.panel._leftBox.insert_child_at_index(targetChild, 2);
                        } else {
                            main.panel._leftBox.add_child(targetChild);
                        }
                        this._parent = main.panel._leftBox;
                    }
                    if (main.panel.statusArea) {
                        main.panel.statusArea['fuhgawz-task-indicator'] = this;
                    }
                    this._rolePosition = 2;
                }

                // Consistently ensure indicator actor is at index 2 in Main.panel._leftBox
                if (main.panel._leftBox && typeof main.panel._leftBox.set_child_at_index === 'function') {
                    const targetChild = this.container || this;
                    const boxChildren = main.panel._leftBox.get_children ? main.panel._leftBox.get_children() : (main.panel._leftBox.children || []);
                    const curIdx = boxChildren.indexOf(targetChild);
                    if (curIdx !== -1 && curIdx !== 2 && boxChildren.length > 2) {
                        try {
                            if (typeof main.panel._leftBox.set_child_at_index === 'function') {
                                main.panel._leftBox.set_child_at_index(targetChild, 2);
                            } else {
                                main.panel._leftBox.insert_child_at_index(targetChild, 2);
                            }
                        } catch (e) {}
                    }
                }
            }

            // 6. Update style classes for standalone panel button
            if (typeof this.remove_style_class_name === 'function') {
                this.remove_style_class_name('fuhgawz-task-indicator-unified');
            }
            if (typeof this.add_style_class_name === 'function') {
                this.add_style_class_name('panel-button');
                this.add_style_class_name('fuhgawz-task-indicator-standalone');
            }

            // 7. Hide separator in standalone mode
            if (this._separatorWidget) {
                if (typeof this._separatorWidget.hide === 'function') this._separatorWidget.hide();
                this._separatorWidget.visible = false;
            }

            // 8. Auto-hide behavior synchronized across indicator and its container
            this._syncVisibility();

        } else {
            // Placement: 'unified'
            // 1. Remove from Main.panel / statusArea if registered
            if (main?.panel) {
                if (main.panel.statusArea && main.panel.statusArea['fuhgawz-task-indicator']) {
                    delete main.panel.statusArea['fuhgawz-task-indicator'];
                }
                const targetChild = this.container || this;
                if (main.panel._leftBox && typeof main.panel._leftBox.remove_child === 'function') {
                    try { main.panel._leftBox.remove_child(targetChild); } catch (e) {}
                }
                if (this.container && typeof this.container.get_parent === 'function' && this.container.get_parent()) {
                    try { this.container.get_parent().remove_child(this.container); } catch (e) {}
                }
                const curParent = (typeof this.get_parent === 'function') ? this.get_parent() : this._parent;
                if (curParent === main.panel._leftBox) {
                    this._parent = null;
                }
            }

            // 2. Unparent progress bar from this indicator if it was attached here
            if (this._progressBar) {
                const curPbParent = (typeof this._progressBar.get_parent === 'function')
                    ? this._progressBar.get_parent()
                    : this._progressBar._parent;
                if (curPbParent === this && typeof this.remove_child === 'function') {
                    try { this.remove_child(this._progressBar); } catch (e) {}
                    this._progressBar._parent = null;
                }
            }

            // 3. Remove this from this.container if parented there
            if (this.container) {
                const curChild = (typeof this.container.get_child === 'function')
                    ? this.container.get_child()
                    : (this.container.child || null);
                if (curChild === this) {
                    if (typeof this.container.set_child === 'function') {
                        try { this.container.set_child(null); } catch (e) {}
                    }
                    if (this.container.child === this) {
                        try { this.container.child = null; } catch (e) {}
                    }
                }
            }

            // 4. Attach inside AppMenuButton._box ALWAYS AT THE END (after app name label)
            if (this._appMenuButton) {
                const targetBox = this._appMenuButton._box || this._appMenuButton;
                const curParent = (typeof this.get_parent === 'function') ? this.get_parent() : this._parent;
                if (curParent && curParent !== targetBox && typeof curParent.remove_child === 'function') {
                    try { curParent.remove_child(this); } catch (e) {}
                }
                const existingChildren = targetBox.get_children ? targetBox.get_children() : (targetBox.children || []);
                if (!existingChildren.includes(this)) {
                    if (typeof targetBox.add_child === 'function') {
                        targetBox.add_child(this);
                    } else if (typeof targetBox.insert_child_at_index === 'function') {
                        targetBox.insert_child_at_index(this, existingChildren.length);
                    }
                    this._parent = targetBox;
                } else {
                    const lastIdx = existingChildren.length - 1;
                    const curIdx = existingChildren.indexOf(this);
                    if (curIdx !== -1 && curIdx !== lastIdx && lastIdx > 0) {
                        if (typeof targetBox.set_child_at_index === 'function') {
                            targetBox.set_child_at_index(this, lastIdx);
                        } else if (typeof targetBox.insert_child_at_index === 'function') {
                            targetBox.insert_child_at_index(this, lastIdx);
                        }
                    }
                }

                // Attach progress bar to AppMenuButton
                if (this._progressBar && typeof this._appMenuButton.add_child === 'function') {
                    const curPbParent = (typeof this._progressBar.get_parent === 'function')
                        ? this._progressBar.get_parent()
                        : this._progressBar._parent;
                    if (curPbParent !== this._appMenuButton) {
                        if (curPbParent && typeof curPbParent.remove_child === 'function') {
                            try { curPbParent.remove_child(this._progressBar); } catch (e) {}
                        }
                        const pbChildren = this._appMenuButton.get_children ? this._appMenuButton.get_children() : (this._appMenuButton.children || []);
                        if (!pbChildren.includes(this._progressBar)) {
                            this._appMenuButton.add_child(this._progressBar);
                        }
                        this._progressBar._parent = this._appMenuButton;
                    }
                    this._appMenuButton._progressBar = this._progressBar;
                }
            }

            // 5. Remove standalone style classes, add unified class
            if (typeof this.remove_style_class_name === 'function') {
                this.remove_style_class_name('panel-button');
                this.remove_style_class_name('fuhgawz-task-indicator-standalone');
            }
            if (typeof this.add_style_class_name === 'function') {
                this.add_style_class_name('fuhgawz-task-indicator-unified');
            }

            // 6. Restore separator based on content
            if (this._separatorWidget) {
                const hasContent = Boolean(this._labelText || this._activeTask || this._isCompleted);
                if (hasContent) {
                    if (typeof this._separatorWidget.show === 'function') this._separatorWidget.show();
                    this._separatorWidget.visible = true;
                } else {
                    if (typeof this._separatorWidget.hide === 'function') this._separatorWidget.hide();
                    this._separatorWidget.visible = false;
                }
            }

            // 7. Auto-hide behavior synchronized across indicator and its container
            this._syncVisibility();
        }

        this._placementApplied = true;
        this._updateUiComponents();
    }

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

    getAppLabel() {
        if (this._appLabel) return this._appLabel;
        if (this._options?.appLabel) return this._options.appLabel;
        if (this._appMenuButton) {
            if (typeof this._appMenuButton._label?.get_text === 'function') {
                return this._appMenuButton._label.get_text() || '';
            }
            if (this._appMenuButton._label?.text) {
                return this._appMenuButton._label.text;
            }
        }
        return '';
    }

    setAppLabel(label) {
        this._appLabel = label || '';
        if (this._activeTask) {
            const effectiveAppLabel = this.getAppLabel();
            this._labelText = this.formatCompactLabel(this._activeTask, effectiveAppLabel);
            this._expandedText = this.formatExpandedTelemetry(this._activeTask, effectiveAppLabel);
            this._updateUiComponents();
        }
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

    getSliderToggleIconName() {
        return this._isExpanded ? 'go-previous-symbolic' : 'go-next-symbolic';
    }

    getLastCopiedPath() {
        return this._lastCopiedPath;
    }

    // ---------------------------------------------------------------------
    // Telemetry Formatting & Task Updates
    // ---------------------------------------------------------------------

    /**
     * Sanitizes and deduplicates labels against the application title.
     * Prevents issues like "Files | ⏳ Deleting Files Files" or "Files | ✓ Done ✓ Files".
     *
     * @param {string} appLabel
     * @param {string} taskTitle
     * @param {string} summary
     * @returns {string}
     */
    _sanitizeLabel(appLabel, taskTitle, summary) {
        const text = (summary || taskTitle || '').trim();
        if (!text) return '';
        if (!appLabel || typeof appLabel !== 'string' || !appLabel.trim()) {
            return text;
        }

        const cleanApp = appLabel.trim();
        if (text.toLowerCase() === cleanApp.toLowerCase()) {
            return '';
        }

        const escapedApp = cleanApp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Check if text ends with appLabel (e.g., "Deleting Files", "Deleting Files...", "Copying to Files")
        const endPattern = new RegExp(`(?:\\s+(?:to|from|in|into))?\\s+${escapedApp}(?:\\.{3}|…)?$`, 'i');
        if (endPattern.test(text)) {
            let cleaned = text;
            while (endPattern.test(cleaned)) {
                cleaned = cleaned.replace(endPattern, '').trim();
            }
            if (cleaned) {
                if (!cleaned.endsWith('...') && !cleaned.endsWith('…')) {
                    cleaned += '...';
                }
                return cleaned;
            }
            return '';
        }

        // Check if text contains appLabel as a whole word
        const wordPattern = new RegExp(`\\b${escapedApp}\\b`, 'gi');
        if (wordPattern.test(text)) {
            let cleaned = text.replace(wordPattern, '').replace(/\s{2,}/g, ' ').trim();
            // Clean up dangling prepositions like "to", "from", "in" at the end
            cleaned = cleaned.replace(/\s+(?:to|from|in|into)$/i, '').trim();
            if (cleaned) {
                if (!cleaned.endsWith('...') && !cleaned.endsWith('…')) {
                    cleaned += '...';
                }
                return cleaned;
            }
            return '';
        }

        return text;
    }

    /**
     * Formats compact status label e.g. '⏳ 42% 1m'.
     *
     * @param {object} task
     * @param {string} [appLabel]
     * @returns {string}
     */
    formatCompactLabel(task, appLabel = null) {
        if (!task) return '';
        if (this._isCompleted || task.state === 'completed') {
            return 'Done';
        }

        const effectiveAppLabel = appLabel || task.appLabel || this.getAppLabel?.() || '';

        if (task.indeterminate) {
            const sanitizedText = this._sanitizeLabel(effectiveAppLabel, task.title, task.summary);
            return sanitizedText || 'In progress...';
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
            return `${percentStr} · ${cleanEta}`;
        }
        return `${percentStr}`;
    }

    /**
     * Formats full expanded telemetry string e.g. '1.1 GB / 3.6 GB • 25.0 MB/s • the.bombin...'.
     *
     * @param {object} task
     * @param {string} [appLabel]
     * @returns {string}
     */
    formatExpandedTelemetry(task, appLabel = null) {
        if (!task) return '';
        if (this._isCompleted || task.state === 'completed') {
            return 'Completed';
        }

        const rawAppLabel = appLabel || task.appLabel || this.getAppLabel?.() || '';
        const effectiveAppLabel = rawAppLabel.trim().toLowerCase();

        const isRedundant = (str) => {
            if (!str || typeof str !== 'string') return true;
            if (!effectiveAppLabel) return false;
            return str.trim().toLowerCase() === effectiveAppLabel;
        };

        const parts = [];
        if (task.bytesText && !isRedundant(task.bytesText)) {
            parts.push(task.bytesText);
        }
        if (task.speedText && !isRedundant(task.speedText)) {
            parts.push(task.speedText);
        }

        let addedNameOrAction = false;
        if (task.fileName && !isRedundant(task.fileName)) {
            parts.push(task.fileName);
            addedNameOrAction = true;
        } else if (task.title && !isRedundant(task.title)) {
            parts.push(task.title);
            addedNameOrAction = true;
        }

        if (!addedNameOrAction && task.summary) {
            const sanitized = this._sanitizeLabel(rawAppLabel, task.title, task.summary);
            if (sanitized) {
                parts.push(sanitized);
            }
        }

        if (parts.length === 0 && task.etaText) {
            parts.push(task.etaText);
        }

        return parts.join(' • ');
    }

    /**
     * Updates indicator with a task object.
     * @param {object} taskObj
     * @param {string} [appLabel]
     */
    updateTask(taskObj, appLabel = null) {
        if (this._destroyed || !taskObj) return;

        if (appLabel) {
            this._appLabel = appLabel;
        }
        const effectiveAppLabel = appLabel || taskObj.appLabel || this.getAppLabel();

        // Cancel any pending auto-hide timer if new task arrives
        if (this._autoHideTimerId) {
            GLib.source_remove(this._autoHideTimerId);
            this._autoHideTimerId = 0;
        }
        this._isCompleted = false;

        this._activeTask = { ...taskObj };
        this._labelText = this.formatCompactLabel(this._activeTask, effectiveAppLabel);
        this._expandedText = this.formatExpandedTelemetry(this._activeTask, effectiveAppLabel);

        // Update progress bar
        if (this._progressBar) {
            if (typeof this._progressBar.setCompleted === 'function') {
                this._progressBar.setCompleted(false);
            }
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
        this._syncVisibility();

        if (typeof this.emit === 'function') {
            this.emit('task-updated', this._activeTask);
        }
    }

    /**
     * Flashes completion badge '[ ✓ Done ]' and starts auto-hide timer.
     * @param {object} [taskObj]
     * @param {string} [appLabel]
     */
    setCompleted(taskObj = null, appLabel = null) {
        if (this._destroyed) return;

        if (appLabel) {
            this._appLabel = appLabel;
        }
        const effectiveAppLabel = appLabel || taskObj?.appLabel || this.getAppLabel();

        if (taskObj) {
            this._activeTask = { ...taskObj, state: 'completed' };
        } else if (this._activeTask) {
            this._activeTask.state = 'completed';
        }

        this._isCompleted = true;
        this._labelText = this.formatCompactLabel(this._activeTask, effectiveAppLabel);
        this._expandedText = this.formatExpandedTelemetry(this._activeTask, effectiveAppLabel);

        if (this._progressBar) {
            this._progressBar.setIndeterminate(false);
            this._progressBar.setProgress(1.0);
            if (typeof this._progressBar.setCompleted === 'function') {
                this._progressBar.setCompleted(true);
            }
        }

        this._updateUiComponents();
        this._syncVisibility();

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
            if (typeof this._progressBar.setCompleted === 'function') {
                this._progressBar.setCompleted(false);
            }
        }

        this._updateUiComponents();
        this._syncVisibility();

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

    isDescendantOf(child, parent) {
        if (!child || !parent) return false;
        let current = child;
        while (current) {
            if (current === parent) return true;
            if (typeof current.get_parent === 'function') {
                current = current.get_parent();
            } else if (current._parent !== undefined) {
                current = current._parent;
            } else {
                break;
            }
        }
        return false;
    }

    _handleSliderToggleClicked() {
        this._childClickInProgress = true;
        try {
            this.toggleSlider();
        } finally {
            this._childClickInProgress = false;
        }
    }

    _handleActionButtonClicked() {
        this._childClickInProgress = true;
        try {
            this.toggleDropdown();
        } finally {
            this._childClickInProgress = false;
        }
    }

    toggleSlider() {
        if (this._destroyed) return;
        this.setExpanded(!this._isExpanded);
    }

    setExpanded(expanded) {
        if (this._destroyed) return;
        const flag = Boolean(expanded);
        if (this._isExpanded === flag) return;

        this._isExpanded = flag;
        if (this._isExpanded && this._activeTask) {
            this._expandedText = this.formatExpandedTelemetry(this._activeTask, this.getAppLabel());
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

        if (this.menu) {
            if (this._placement === 'unified') {
                this.menu.sourceActor = this._actionButton || this;
            } else {
                this.menu.sourceActor = this;
            }
        }

        const main = this._getMain();
        if (main?.panel?.menuManager && this.menu) {
            try {
                main.panel.menuManager.addMenu(this.menu);
            } catch (e) {}
        }

        this._isDropdownOpen = true;

        if (typeof this.menu?.open === 'function') {
            this.menu.open();
        }

        this._updateUiComponents();

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

        this._updateUiComponents();

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
                fileName: this._activeTask.fileName || '',
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
                const headerText = card.fileName || card.summary || 'Active Task';
                let titleItem;
                if (PopupMenu.PopupImageMenuItem) {
                    titleItem = new PopupMenu.PopupImageMenuItem(headerText, 'text-x-generic-symbolic', { reactive: false });
                } else {
                    titleItem = new PopupMenu.PopupMenuItem(headerText, { reactive: false });
                }
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
                    const progressItem = new PopupMenu.PopupMenuItem(percentText, { reactive: false });
                    this.menu.addMenuItem(progressItem);
                }

                // Stats line: ETA, Speed, Bytes
                const statsText = [card.etaText, card.speedText, card.bytesText].filter(Boolean).join(' · ');
                if (statsText) {
                    const statsItem = new PopupMenu.PopupMenuItem(statsText, { reactive: false });
                    this.menu.addMenuItem(statsItem);
                }

                // Action buttons row: Pause/Resume, Cancel, Reveal
                const pauseLabel = card.paused ? 'Resume' : 'Pause';
                const pauseIcon = card.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
                let pauseItem;
                if (PopupMenu.PopupImageMenuItem) {
                    pauseItem = new PopupMenu.PopupImageMenuItem(pauseLabel, pauseIcon);
                } else {
                    pauseItem = new PopupMenu.PopupMenuItem(pauseLabel);
                }
                pauseItem.connect('activate', () => {
                    this.pauseTask(card.id);
                    this._buildDropdownMenu();
                });
                this.menu.addMenuItem(pauseItem);

                let cancelItem;
                if (PopupMenu.PopupImageMenuItem) {
                    cancelItem = new PopupMenu.PopupImageMenuItem('Cancel', 'process-stop-symbolic');
                } else {
                    cancelItem = new PopupMenu.PopupMenuItem('Cancel');
                }
                cancelItem.connect('activate', () => {
                    this.cancelTask(card.id);
                    this.closeDropdown();
                });
                this.menu.addMenuItem(cancelItem);

                if (card.uri || this._taskManager?.revealTask) {
                    let revealItem;
                    if (PopupMenu.PopupImageMenuItem) {
                        revealItem = new PopupMenu.PopupImageMenuItem('Show in Files', 'folder-symbolic');
                    } else {
                        revealItem = new PopupMenu.PopupMenuItem('Show in Files');
                    }
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

        if (this._appMenuButton && this._appMenuButton !== appMenuButton) {
            this._unbindAppMenu();
        }

        this._appMenuButton = appMenuButton;
        try {
            this._appMenuButton._taskIndicator = this;
        } catch (e) {}

        // Apply placement (unified attaches into appMenuButton._box, standalone registers in statusArea)
        this._applyPlacement();

        // Event delegation: Prevent child button clicks inside _box from triggering AppMenuButton popup
        if (this._appMenuSignalIds.length === 0 && typeof appMenuButton.connect === 'function') {
            const pId = appMenuButton.connect('button-press-event', (actor, event) => {
                const source = event?.get_source ? event.get_source() : (event?.target || null);
                if (this._isChildButton(source)) {
                    return Clutter ? Clutter.EVENT_STOP : true;
                }
                return Clutter ? Clutter.EVENT_PROPAGATE : false;
            });
            const rId = appMenuButton.connect('button-release-event', (actor, event) => {
                const source = event?.get_source ? event.get_source() : (event?.target || null);
                if (this._isChildButton(source)) {
                    return Clutter ? Clutter.EVENT_STOP : true;
                }
                return Clutter ? Clutter.EVENT_PROPAGATE : false;
            });
            this._appMenuSignalIds.push(pId, rId);
        }

        if (!this._origAppMenuToggle && appMenuButton.menu && typeof appMenuButton.menu.toggle === 'function') {
            const origToggle = appMenuButton.menu.toggle.bind(appMenuButton.menu);
            this._origAppMenuToggle = origToggle;
            appMenuButton.menu.toggle = () => {
                if (this._childClickInProgress) {
                    return;
                }
                return origToggle();
            };
        }

        if (this._activeTask) {
            const effectiveAppLabel = this.getAppLabel();
            this._labelText = this.formatCompactLabel(this._activeTask, effectiveAppLabel);
            this._expandedText = this.formatExpandedTelemetry(this._activeTask, effectiveAppLabel);
            this._updateUiComponents();
        }
    }

    _unbindAppMenu() {
        if (this._appMenuButton && this._appMenuSignalIds && this._appMenuSignalIds.length > 0) {
            for (const id of this._appMenuSignalIds) {
                try {
                    this._appMenuButton.disconnect(id);
                } catch (e) {}
            }
            this._appMenuSignalIds = [];
        }
        if (this._origAppMenuToggle && this._appMenuButton?.menu) {
            try {
                this._appMenuButton.menu.toggle = this._origAppMenuToggle;
            } catch (e) {}
            this._origAppMenuToggle = null;
        }
        if (this._appMenuButton && this._appMenuButton._taskIndicator === this) {
            this._appMenuButton._taskIndicator = null;
        }
    }

    // ---------------------------------------------------------------------
    // UI Component Updates
    // ---------------------------------------------------------------------

    _updateUiComponents() {
        if (this._separatorWidget) {
            if (this._placement === 'standalone') {
                if (typeof this._separatorWidget.hide === 'function') this._separatorWidget.hide();
                else this._separatorWidget.visible = false;
            } else {
                const hasContent = Boolean(this._labelText || this._activeTask || this._isCompleted);
                if (hasContent) {
                    if (typeof this._separatorWidget.show === 'function') this._separatorWidget.show();
                    else this._separatorWidget.visible = true;
                } else {
                    if (typeof this._separatorWidget.hide === 'function') this._separatorWidget.hide();
                    else this._separatorWidget.visible = false;
                }
            }
        }

        if (this._compactLabelWidget) {
            this._compactLabelWidget.text = this._labelText;
            if (this._isCompleted) {
                if (typeof this._compactLabelWidget.add_style_class_name === 'function') {
                    this._compactLabelWidget.add_style_class_name('completed');
                }
            } else {
                if (typeof this._compactLabelWidget.remove_style_class_name === 'function') {
                    this._compactLabelWidget.remove_style_class_name('completed');
                }
            }
        }

        if (this._progressBar) {
            if (typeof this._progressBar.setCompleted === 'function') {
                this._progressBar.setCompleted(this._isCompleted);
            }
            if (this._isCompleted) {
                if (typeof this._progressBar.add_style_class_name === 'function') {
                    this._progressBar.add_style_class_name('completed');
                }
            } else {
                if (typeof this._progressBar.remove_style_class_name === 'function') {
                    this._progressBar.remove_style_class_name('completed');
                }
            }
        }

        if (this._isCompleted) {
            if (typeof this.add_style_class_name === 'function') {
                this.add_style_class_name('completed');
            }
        } else {
            if (typeof this.remove_style_class_name === 'function') {
                this.remove_style_class_name('completed');
            }
        }

        if (this._actionButton) {
            if (this._isDropdownOpen) {
                if (typeof this._actionButton.add_style_pseudo_class === 'function') {
                    this._actionButton.add_style_pseudo_class('active');
                }
                if (typeof this._actionButton.add_style_class_name === 'function') {
                    this._actionButton.add_style_class_name('active');
                }
            } else {
                if (typeof this._actionButton.remove_style_pseudo_class === 'function') {
                    this._actionButton.remove_style_pseudo_class('active');
                }
                if (typeof this._actionButton.remove_style_class_name === 'function') {
                    this._actionButton.remove_style_class_name('active');
                }
            }
        }

        if (this._telemetryLabelWidget) {
            if (this._isExpanded && this._expandedText) {
                const displayText = this.getDisplayedTelemetryText();
                this._telemetryLabelWidget.text = displayText;
                const isCollapsed = !this._telemetryLabelWidget.visible || this._telemetryLabelWidget.opacity === 0;
                if (isCollapsed) {
                    if (typeof this._telemetryLabelWidget.ease === 'function') {
                        this._telemetryLabelWidget.opacity = 0;
                        if (typeof this._telemetryLabelWidget.show === 'function') {
                            this._telemetryLabelWidget.show();
                        }
                        this._telemetryLabelWidget.visible = true;
                        try {
                            this._telemetryLabelWidget.ease({
                                opacity: 255,
                                duration: 200,
                                mode: Clutter?.AnimationMode ? Clutter.AnimationMode.EASE_OUT_CUBIC : 0,
                            });
                        } catch (e) {
                            if (this._telemetryLabelWidget.opacity !== undefined) {
                                this._telemetryLabelWidget.opacity = 255;
                            }
                        }
                    } else {
                        if (typeof this._telemetryLabelWidget.show === 'function') {
                            this._telemetryLabelWidget.show();
                        }
                        this._telemetryLabelWidget.visible = true;
                        if (this._telemetryLabelWidget.opacity !== undefined) {
                            this._telemetryLabelWidget.opacity = 255;
                        }
                    }
                } else {
                    if (typeof this._telemetryLabelWidget.show === 'function') {
                        this._telemetryLabelWidget.show();
                    }
                    this._telemetryLabelWidget.visible = true;
                    if (this._telemetryLabelWidget.opacity !== undefined && this._telemetryLabelWidget.opacity < 255) {
                        this._telemetryLabelWidget.opacity = 255;
                    }
                }
            } else {
                if (typeof this._telemetryLabelWidget.remove_all_transitions === 'function') {
                    try { this._telemetryLabelWidget.remove_all_transitions(); } catch (e) {}
                }
                if (typeof this._telemetryLabelWidget.hide === 'function') {
                    this._telemetryLabelWidget.hide();
                }
                this._telemetryLabelWidget.visible = false;
                this._telemetryLabelWidget.opacity = 0;
                this._telemetryLabelWidget.text = '';
            }
        }

        if (this._statusIconWidget) {
            const iconName = this._isCompleted ? 'object-select-symbolic' : 'process-working-symbolic';
            if (typeof this._statusIconWidget.set_icon_name === 'function') {
                this._statusIconWidget.set_icon_name(iconName);
            } else {
                this._statusIconWidget.icon_name = iconName;
            }
        }

        if (this._sliderToggleWidget) {
            if (this._sliderToggleIcon && typeof this._sliderToggleIcon.set_icon_name === 'function') {
                this._sliderToggleIcon.set_icon_name(this.getSliderToggleIconName());
            } else if (this._sliderToggleIcon) {
                this._sliderToggleIcon.icon_name = this.getSliderToggleIconName();
            }

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
        this._appLabel = '';
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

        const main = this._getMain();
        if (main?.panel) {
            if (main.panel.statusArea && main.panel.statusArea['fuhgawz-task-indicator']) {
                delete main.panel.statusArea['fuhgawz-task-indicator'];
            }
            if (main.panel._leftBox && typeof main.panel._leftBox.remove_child === 'function') {
                try { main.panel._leftBox.remove_child(this); } catch (e) {}
            }
        }

        const myParent = (typeof this.get_parent === 'function')
            ? this.get_parent()
            : this._parent;
        if (myParent && typeof myParent.remove_child === 'function') {
            myParent.remove_child(this);
        }
        this._parent = null;

        this._unbindAppMenu();
        this._appMenuButton = null;
    }
}

// -------------------------------------------------------------------------
// GObject Class Registration
// -------------------------------------------------------------------------

const BasePanelButton = PanelMenu?.Button ?? St?.Widget ?? Object;
let TaskIndicatorButtonClass;

if (hasStWidget) {
    TaskIndicatorButtonClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskIndicatorButton',
            Signals: {
                'mode-changed': {
                    param_types: [GObject.TYPE_STRING],
                },
                'placement-changed': {
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
        class TaskIndicatorButton extends BasePanelButton {
            _init(settings = null, taskManager = null, options = {}) {
                if (PanelMenu?.Button && BasePanelButton === PanelMenu.Button) {
                    super._init(0.0, 'FUHGlobeTaskIndicatorButton');
                    // Remove default ClickGesture so it does not intercept or cancel events on child buttons
                    if (this._clickGesture && typeof this.remove_action === 'function') {
                        try {
                            this.remove_action(this._clickGesture);
                        } catch (e) {}
                        this._clickGesture = null;
                    }
                } else {
                    super._init({
                        style_class: 'fuhgawz-task-indicator',
                        reactive: true,
                        track_hover: true,
                    });
                    this.container = this;
                }

                this._box = new St.BoxLayout({
                    style_class: 'fuhgawz-task-indicator-box',
                    reactive: true,
                    track_hover: true,
                });

                this._separatorWidget = new St.Label({
                    style_class: 'fuhgawz-task-separator',
                    text: '·',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._box.add_child(this._separatorWidget);

                this._statusIconWidget = new St.Icon({
                    style_class: 'fuhgawz-task-icon',
                    icon_name: 'process-working-symbolic',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._box.add_child(this._statusIconWidget);

                this._compactLabelWidget = new St.Label({
                    style_class: 'fuhgawz-task-indicator-label',
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                    track_hover: true,
                });
                this._compactLabelWidget.connect('button-release-event', () => {
                    this.toggleDropdown();
                    return Clutter ? Clutter.EVENT_STOP : true;
                });
                this._box.add_child(this._compactLabelWidget);

                this._sliderToggleIcon = new St.Icon({
                    style_class: 'fuhgawz-task-toggle-icon',
                    icon_name: 'go-next-symbolic',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._sliderToggleWidget = new St.Button({
                    style_class: 'fuhgawz-task-slider-toggle fuhgawz-task-toggle-btn',
                    child: this._sliderToggleIcon,
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._sliderToggleWidget.set({
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._sliderToggleWidget.connect('clicked', () => this._handleSliderToggleClicked());
                this._sliderToggleWidget.connect('button-press-event', (actor, event) => {
                    this._handleSliderToggleClicked();
                    return Clutter ? Clutter.EVENT_STOP : true;
                });
                if (typeof this._sliderToggleWidget.click !== 'function') {
                    this._sliderToggleWidget.click = () => this._sliderToggleWidget.emit('clicked');
                }
                this._box.add_child(this._sliderToggleWidget);

                this._telemetryLabelWidget = new St.Label({
                    style_class: 'fuhgawz-task-telemetry-label',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._telemetryLabelWidget.hide();
                this._telemetryLabelWidget.opacity = 0;
                this._box.add_child(this._telemetryLabelWidget);

                this._actionIcon = new St.Icon({
                    style_class: 'fuhgawz-task-action-icon',
                    icon_name: 'view-more-symbolic',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._actionButton = new St.Button({
                    style_class: 'fuhgawz-task-action-button',
                    child: this._actionIcon,
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._actionButton.set({
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._actionButton.connect('clicked', () => this._handleActionButtonClicked());
                this._actionButton.connect('button-press-event', (actor, event) => {
                    this._handleActionButtonClicked();
                    return Clutter ? Clutter.EVENT_STOP : true;
                });
                if (typeof this._actionButton.click !== 'function') {
                    this._actionButton.click = () => this._actionButton.emit('clicked');
                }
                this._box.add_child(this._actionButton);

                this.add_child(this._box);

                this.connect('button-press-event', (actor, event) => {
                    const source = event?.get_source ? event.get_source() : (event?.target || null);
                    if (this.isDescendantOf(source, this._sliderToggleWidget) || this.isDescendantOf(source, this._actionButton)) {
                        return Clutter ? Clutter.EVENT_STOP : true;
                    }
                    if (this._placement === 'standalone') {
                        this.toggleDropdown();
                        return Clutter ? Clutter.EVENT_STOP : true;
                    }
                    return Clutter ? Clutter.EVENT_PROPAGATE : false;
                });

                this.connect('enter-event', () => this.onPointerEnter());
                this.connect('leave-event', () => this.onPointerLeave());

                this._initIndicator(settings, taskManager, options);
            }

            vfunc_allocate(box) {
                super.vfunc_allocate(box);
                if (this._progressBar && this._progressBar.visible && (this._progressBar.get_parent() === this || this._progressBar._parent === this)) {
                    const availWidth = box.x2 - box.x1;
                    const availHeight = box.y2 - box.y1;
                    const pbBox = new (Clutter?.ActorBox ?? Object)();
                    pbBox.x1 = 0;
                    pbBox.x2 = availWidth;
                    pbBox.y1 = Math.max(0, availHeight - 2);
                    pbBox.y2 = availHeight;
                    if (typeof this._progressBar.allocate === 'function') {
                        this._progressBar.allocate(pbBox);
                    }
                }
            }

            destroy() {
                if (this._destroyed) return;
                this._destroyIndicator();
                super.destroy();
            }
        }
    );
} else {
    /**
     * Lightweight mock St.Button for standalone testing and headless environments.
     */
    class MockStButton {
        constructor(props = {}) {
            this.label = props.label ?? '';
            this.style_class = props.style_class ?? '';
            this.reactive = Boolean(props.reactive ?? true);
            this.can_focus = Boolean(props.can_focus ?? true);
            this.track_hover = Boolean(props.track_hover ?? true);
            this.visible = props.visible ?? true;
            this._handlers = new Map();
            if (props) {
                this.set(props);
            }
        }

        set(props) {
            Object.assign(this, props);
        }

        show() {
            this.visible = true;
        }

        hide() {
            this.visible = false;
        }

        contains(child) {
            return child === this;
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
                try {
                    res = handler(this, ...args);
                } catch (e) {
                    console.error(e);
                }
            }
            return res;
        }

        click(event = null) {
            const ev = event || { get_source: () => this, target: this };
            const pressRes = this.emit('button-press-event', ev);
            if (pressRes === (Clutter?.EVENT_STOP ?? true)) {
                return;
            }
            this.emit('button-release-event', ev);
            this.emit('clicked');
        }

        add_style_class_name(name) {
            const classes = new Set((this.style_class || '').split(/\s+/).filter(Boolean));
            classes.add(name);
            this.style_class = Array.from(classes).join(' ');
        }

        remove_style_class_name(name) {
            const classes = new Set((this.style_class || '').split(/\s+/).filter(Boolean));
            classes.delete(name);
            this.style_class = Array.from(classes).join(' ');
        }

        has_style_class_name(name) {
            return (this.style_class || '').split(/\s+/).includes(name);
        }

        add_style_pseudo_class(name) {
            this.add_style_class_name(name);
        }

        remove_style_pseudo_class(name) {
            this.remove_style_class_name(name);
        }
    }

    // Standalone unit test environment
    TaskIndicatorButtonClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskIndicatorButton',
            Signals: {
                'mode-changed': {
                    param_types: [GObject.TYPE_STRING],
                },
                'placement-changed': {
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
                'button-press-event': {
                    param_types: [GObject.TYPE_JSOBJECT],
                    return_type: GObject.TYPE_BOOLEAN,
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
                this.container = this;
                this.style_class = 'fuhgawz-task-indicator';
                this.style_classes = new Set(['fuhgawz-task-indicator']);

                this._separatorWidget = {
                    text: '·',
                    visible: false,
                    show() { this.visible = true; },
                    hide() { this.visible = false; },
                };
                this._compactLabelWidget = {
                    text: '',
                    style_class: 'fuhgawz-task-indicator-label',
                    add_style_class_name(name) {
                        const classes = new Set((this.style_class || '').split(/\s+/).filter(Boolean));
                        classes.add(name);
                        this.style_class = Array.from(classes).join(' ');
                    },
                    remove_style_class_name(name) {
                        const classes = new Set((this.style_class || '').split(/\s+/).filter(Boolean));
                        classes.delete(name);
                        this.style_class = Array.from(classes).join(' ');
                    },
                    has_style_class_name(name) {
                        return (this.style_class || '').split(/\s+/).includes(name);
                    },
                };
                
                this._statusIconWidget = {
                    icon_name: 'process-working-symbolic',
                    style_class: 'fuhgawz-task-icon',
                    set_icon_name(name) { this.icon_name = name; }
                };
                
                this._sliderToggleIcon = {
                    icon_name: 'go-next-symbolic',
                    style_class: 'fuhgawz-task-toggle-icon',
                    set_icon_name(name) { this.icon_name = name; }
                };
                this._sliderToggleWidget = new MockStButton({
                    label: '>>',
                    visible: false,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._sliderToggleWidget.set({
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._sliderToggleWidget.connect('clicked', () => this._handleSliderToggleClicked());
                this._sliderToggleWidget.connect('button-press-event', (actor, event) => {
                    this._handleSliderToggleClicked();
                    return Clutter ? Clutter.EVENT_STOP : true;
                });

                this._telemetryLabelWidget = {
                    text: '',
                    visible: false,
                    opacity: 0,
                    show() { this.visible = true; },
                    hide() { this.visible = false; },
                };

                this._actionIcon = {
                    icon_name: 'view-more-symbolic',
                    style_class: 'fuhgawz-task-action-icon',
                    set_icon_name(name) { this.icon_name = name; }
                };

                this._actionButton = new MockStButton({
                    label: '• • •',
                    child: this._actionIcon,
                    visible: true,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._actionButton.set({
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                this._actionButton.connect('clicked', () => this._handleActionButtonClicked());
                this._actionButton.connect('button-press-event', (actor, event) => {
                    this._handleActionButtonClicked();
                    return Clutter ? Clutter.EVENT_STOP : true;
                });

                this.contains = (actor) => {
                    return actor === this || this.children.includes(actor) || actor === this._sliderToggleWidget || actor === this._actionButton;
                };

                this.connect('button-press-event', (actor, event) => {
                    const source = event?.get_source ? event.get_source() : (event?.target || null);
                    if (this.isDescendantOf(source, this._sliderToggleWidget) || this.isDescendantOf(source, this._actionButton)) {
                        return Clutter ? Clutter.EVENT_STOP : true;
                    }
                    if (this._placement === 'standalone') {
                        this.toggleDropdown();
                        return Clutter ? Clutter.EVENT_STOP : true;
                    }
                    return Clutter ? Clutter.EVENT_PROPAGATE : false;
                });

                this.click = (event = null) => {
                    if (this._placement === 'standalone') {
                        this.toggleDropdown();
                    } else {
                        this.emit('clicked');
                    }
                };

                this._initIndicator(settings, taskManager, options);
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

            add_style_class_name(name) {
                if (!this.style_classes) this.style_classes = new Set(['fuhgawz-task-indicator']);
                this.style_classes.add(name);
                this.style_class = Array.from(this.style_classes).join(' ');
            }

            remove_style_class_name(name) {
                if (!this.style_classes) this.style_classes = new Set(['fuhgawz-task-indicator']);
                this.style_classes.delete(name);
                this.style_class = Array.from(this.style_classes).join(' ');
            }

            has_style_class_name(name) {
                return Boolean(this.style_classes?.has(name));
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
