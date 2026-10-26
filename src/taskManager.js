// SPDX-License-Identifier: GPL-3.0-or-later
// src/taskManager.js - Headless Desktop Task Ingestion Engine for FUHGAWZ Global Menu

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

let Shell = null;
try {
    const mod = await import('gi://Shell');
    Shell = mod.default ?? mod;
} catch (e) {
    // Standalone unit test environment where gi://Shell typelib is not in search path
}

let GioUnix = null;
try {
    const mod = await import('gi://GioUnix');
    GioUnix = mod.default ?? mod;
} catch (e) {
    // Fallback if GioUnix is not available
}

let Main = null;
try {
    const mod = await import('resource:///org/gnome/shell/ui/main.js');
    Main = mod.default ?? mod;
} catch (e) {
    // Standalone unit test environment
}

export const MAX_RECENT_TASKS = 10;
export const TASK_MANAGER_OBJECT_PATH = '/org/gnome/Shell/Extensions/FUHGlobeGlobalMenu/TaskManager';

/** Without a real progress reading for this long, fall back to indeterminate. */
export const ATSPI_STALE_MS = 10_000;
/** Telemetry cadence for the /proc I/O reader. */
const NAUTILUS_MONITOR_INTERVAL_MS = 1000;
/** How often the isolated AT-SPI helper reports. */
const PROBE_INTERVAL_MS = 1000;

const SIZE_UNITS = {
    b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1024 ** 2,
    gb: 1e9, gib: 1024 ** 3, tb: 1e12, tib: 1024 ** 4,
};

function unitToBytes(valueText, unitText) {
    const value = Number(String(valueText).replace(',', '.'));
    const unit = String(unitText).toLowerCase();
    const multiplier = SIZE_UNITS[unit] ?? 1;
    return Number.isFinite(value) ? value * multiplier : 0;
}

function parseEtaSeconds(text) {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)/i);
    if (!match) return 0;
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value)) return 0;
    const unit = match[2].toLowerCase();
    if (unit.startsWith('h')) return value * 3600;
    if (unit.startsWith('m')) return value * 60;
    return value;
}

/**
 * Parses the progress strings Nautilus itself renders — "3.7 GB / 5.5 GB",
 * "12 of 45 files", "About 6 seconds left" — gathered from its accessibility
 * tree, into exact task telemetry.
 *
 * @param {string} text
 * @returns {{progress: number, copiedBytes: number, totalBytes: number, bytesText: string, etaText: string}|null}
 */
export function parseNautilusProgressText(text) {
    if (!text || typeof text !== 'string') return null;
    const normalized = text.replace(/\u00a0/g, ' ');

    const bytesMatch = normalized.match(
        /(\d+(?:[.,]\d+)?)\s*(KiB|MiB|GiB|TiB|kB|KB|MB|GB|TB|B)\s*(?:\/|of)\s*(\d+(?:[.,]\d+)?)\s*(KiB|MiB|GiB|TiB|kB|KB|MB|GB|TB|B)/i);
    if (bytesMatch) {
        const copiedBytes = unitToBytes(bytesMatch[1], bytesMatch[2]);
        const totalBytes = unitToBytes(bytesMatch[3], bytesMatch[4]);
        if (totalBytes > 0 && copiedBytes <= totalBytes * 1.05) {
            return {
                progress: Math.max(0, Math.min(1, copiedBytes / totalBytes)),
                copiedBytes,
                totalBytes,
                bytesText: `${formatBytes(copiedBytes)} / ${formatBytes(totalBytes)}`,
                etaText: formatEta(parseEtaSeconds(normalized)),
            };
        }
    }

    const countMatch = normalized.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*(?:files?|items?)/i);
    if (countMatch) {
        const done = Number(countMatch[1]);
        const total = Number(countMatch[2]);
        if (total > 0 && done <= total) {
            return {
                progress: done / total,
                copiedBytes: 0,
                totalBytes: 0,
                bytesText: `${done} / ${total}`,
                etaText: formatEta(parseEtaSeconds(normalized)),
            };
        }
    }

    const percentMatch = normalized.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (percentMatch) {
        const percent = Number(percentMatch[1]);
        if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
            return {
                progress: percent / 100,
                copiedBytes: 0,
                totalBytes: 0,
                bytesText: '',
                etaText: formatEta(parseEtaSeconds(normalized)),
            };
        }
    }

    return null;
}

/**
 * Maps a Nautilus session-inhibitor reason to a stable operation label.
 * Nautilus sends reasons like "Deleting Files", "Moving Files", "Extracting…";
 * the label doubles as the task title and chip summary.
 *
 * @param {string} reason
 * @returns {string}
 */
export function deriveOperationLabel(reason) {
    const text = String(reason ?? '').trim();
    if (!text) return 'Working on files';
    const lower = text.toLowerCase();
    if (/(extract|unzip|unpack|uncompress|decompress)/.test(lower)) return 'Extracting files';
    if (/(compress|archiv)/.test(lower)) return 'Compressing files';
    if (/(delet|trash|remove|unlink|empty)/.test(lower)) return 'Deleting files';
    if (/(copy|paste|duplicat)/.test(lower)) return 'Copying files';
    if (/(mov|renam)/.test(lower)) return 'Moving files';
    if (/(transfer|send|receiv)/.test(lower)) return 'Transferring files';
    return text.replace(/\s*\.+$/, '');
}

/**
 * @param {string} label
 * @returns {'extract'|'compress'|'delete'|'copy'|'move'|'transfer'|'other'}
 */
export function operationTypeFromLabel(label) {
    const lower = String(label ?? '').toLowerCase();
    if (lower.startsWith('extract')) return 'extract';
    if (lower.startsWith('compress')) return 'compress';
    if (lower.startsWith('delet')) return 'delete';
    if (lower.startsWith('copy')) return 'copy';
    if (lower.startsWith('mov')) return 'move';
    if (lower.startsWith('transf')) return 'transfer';
    return 'other';
}

export const TASK_MANAGER_IFACE_XML = `
<node>
  <interface name="org.gnome.Shell.Extensions.FUHGlobeGlobalMenu.TaskManager">
    <method name="RegisterTask">
      <arg type="s" direction="in" name="title"/>
      <arg type="s" direction="in" name="appId"/>
      <arg type="s" direction="out" name="taskId"/>
    </method>
    <method name="UpdateTask">
      <arg type="s" direction="in" name="taskId"/>
      <arg type="d" direction="in" name="progress"/>
      <arg type="s" direction="in" name="statusText"/>
    </method>
    <method name="CompleteTask">
      <arg type="s" direction="in" name="taskId"/>
      <arg type="b" direction="in" name="success"/>
    </method>
    <method name="RemoveTask">
      <arg type="s" direction="in" name="taskId"/>
    </method>
    <method name="GetActiveTasks">
      <arg type="s" direction="out" name="tasksJson"/>
    </method>
    <method name="GetRecentTasks">
      <arg type="s" direction="out" name="tasksJson"/>
    </method>
    <signal name="TaskCancelled">
      <arg type="s" name="taskId"/>
    </signal>
  </interface>
</node>`;

/**
 * Normalizes an application ID or URI to a clean, canonical form.
 * Strips 'application://' prefix and lowercases for uniform matching.
 *
 * @param {string} appIdOrUri
 * @returns {string}
 */
function normalizeAppId(appIdOrUri) {
    if (!appIdOrUri || typeof appIdOrUri !== 'string') return '';
    let clean = appIdOrUri.trim();
    if (clean.startsWith('application://')) {
        clean = clean.substring('application://'.length);
    }
    if (clean.endsWith('.desktop')) {
        clean = clean.substring(0, clean.length - '.desktop'.length);
    }
    return clean;
}

/**
 * Deep unrolls GLib.Variant objects into plain JavaScript values.
 *
 * @param {any} val
 * @returns {any}
 */
function unrollVariant(val) {
    if (!val) return val;
    if (typeof val === 'object') {
        if (typeof val.deep_unpack === 'function') {
            return unrollVariant(val.deep_unpack());
        }
        if (Array.isArray(val)) {
            return val.map(unrollVariant);
        }
        const res = {};
        for (const [k, v] of Object.entries(val)) {
            res[k] = unrollVariant(v);
        }
        return res;
    }
    return val;
}

/**
 * Formats byte counts into human-readable strings (e.g. '1.1 GB', '320 MB').
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 bytes';
    if (bytes >= 1e9) {
        return `${(bytes / 1e9).toFixed(1)} GB`;
    }
    if (bytes >= 1e6) {
        const val = (bytes / 1e6).toFixed(1);
        return `${val.endsWith('.0') ? val.slice(0, -2) : val} MB`;
    }
    if (bytes >= 1e3) {
        const val = (bytes / 1e3).toFixed(1);
        return `${val.endsWith('.0') ? val.slice(0, -2) : val} KB`;
    }
    return `${Math.round(bytes)} B`;
}

/**
 * Formats transfer rate into human-readable strings (e.g. '25.0 MB/s').
 *
 * @param {number} bytesPerSec
 * @returns {string}
 */
export function formatSpeed(bytesPerSec) {
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
    if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
    if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(1)} KB/s`;
    return `${Math.round(bytesPerSec)} B/s`;
}

/**
 * Formats seconds into human-readable ETA strings (e.g. '1m left', '30s left').
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins}m left`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m left` : `${hours}h left`;
}

/**
 * Creates a clean, JSON-serializable DTO from a task object,
 * stripping private internal handles (like _notification) that could contain cyclic references.
 *
 * @param {object} task
 * @returns {object|null}
 */
export function serializeTask(task) {
    if (!task) return null;
    return {
        id: task.id,
        appId: task.appId,
        desktopId: task.desktopId || '',
        title: task.title,
        summary: task.summary || '',
        opType: task.opType || 'other',
        progress: task.progress,
        progressVisible: Boolean(task.progressVisible),
        count: task.count || 0,
        countVisible: Boolean(task.countVisible),
        indeterminate: Boolean(task.indeterminate),
        source: task.source,
        state: task.state,
        startTime: task.startTime,
        completedAt: task.completedAt || null,
        canCancel: Boolean(task.canCancel),
        uri: task.uri || null,
        etaText: task.etaText || '',
        speedText: task.speedText || '',
        bytesText: task.bytesText || '',
    };
}

export const TaskManager = GObject.registerClass(
    {
        GTypeName: 'FUHGlobeTaskManager',
        Signals: {
            'task-added': {
                param_types: [GObject.TYPE_JSOBJECT],
            },
            'task-updated': {
                param_types: [GObject.TYPE_JSOBJECT],
            },
            'task-completed': {
                param_types: [GObject.TYPE_JSOBJECT],
            },
            'task-removed': {
                param_types: [GObject.TYPE_STRING],
            },
            'recent-tasks-cleared': {
                param_types: [],
            },
        },
    },
    class TaskManager extends GObject.Object {
        _init(settings = null, options = {}) {
            super._init();

            this._settings = settings;
            this._options = options;
            this._cancellable = new Gio.Cancellable();
            this._destroyed = false;

            this._cacheFile = options.cacheFile || GLib.build_filenamev([
                GLib.get_user_cache_dir(),
                'fuhgawz-recent-tasks.json',
            ]);
            this._xbelFile = options.xbelFile || GLib.build_filenamev([
                GLib.get_user_data_dir(),
                'recently-used.xbel',
            ]);

            this._activeTasks = new Map(); // taskId -> taskObj
            this._activeInhibitors = new Map(); // inhibitorPath -> taskId
            this._notificationSignals = new Map(); // notification -> [signalId, ...]
            this._nautilusMonitors = new Map(); // taskId -> monitorState
            this._probeHandles = new Map(); // taskId -> {stop()}
            this._recentTasks = [];

            this._probeScriptPath = options.probeScriptPath ?? null;
            this._spawnFileOpsProbe = options.spawnFileOpsProbe ?? null;

            this._loadRecentTasks();

            // Safe D-Bus setup
            this._dbusConnection = options.dbusConnection ?? this._getSafeSessionBus();
            this._unitySubId = 0;
            this._inhibitorAddedSubId = 0;
            this._inhibitorRemovedSubId = 0;
            this._dbusExport = null;
            this._messageTraySubId = 0;

            if (this._dbusConnection) {
                this._setupDBus();
            }

            this._setupMessageTray();
        }

        _getSafeSessionBus() {
            try {
                return Gio.DBus.session;
            } catch (e) {
                return null;
            }
        }

        _setupDBus() {
            if (!this._dbusConnection || this._destroyed) return;

            // 1. Subscribe to Unity LauncherEntry updates
            try {
                this._unitySubId = this._dbusConnection.signal_subscribe(
                    null, // sender
                    'com.canonical.Unity.LauncherEntry',
                    'Update',
                    null, // path
                    null, // arg0
                    Gio.DBusSignalFlags.NONE,
                    (_conn, _sender, _path, _iface, _signal, params) => {
                        try {
                            const [appUri, propsVariant] = params.deep_unpack();
                            this._handleUnityProgress(appUri, propsVariant);
                        } catch (e) {
                            // Ignore malformed signal
                        }
                    }
                );
            } catch (e) {}

            // 2. Subscribe to org.gnome.SessionManager InhibitorAdded & InhibitorRemoved
            try {
                this._inhibitorAddedSubId = this._dbusConnection.signal_subscribe(
                    'org.gnome.SessionManager',
                    'org.gnome.SessionManager',
                    'InhibitorAdded',
                    '/org/gnome/SessionManager',
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_conn, _sender, _path, _iface, _signal, params) => {
                        try {
                            const [inhibitorPath] = params.deep_unpack();
                            this._onInhibitorAdded(inhibitorPath);
                        } catch (e) {}
                    }
                );
            } catch (e) {}

            try {
                this._inhibitorRemovedSubId = this._dbusConnection.signal_subscribe(
                    'org.gnome.SessionManager',
                    'org.gnome.SessionManager',
                    'InhibitorRemoved',
                    '/org/gnome/SessionManager',
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_conn, _sender, _path, _iface, _signal, params) => {
                        try {
                            const [inhibitorPath] = params.deep_unpack();
                            this._handleInhibitorRemoved(inhibitorPath);
                        } catch (e) {}
                    }
                );
            } catch (e) {}

            // 3. Export D-Bus interface for CLI tasks (gm-run)
            try {
                const exported = Gio.DBusExportedObject.wrapJSObject(TASK_MANAGER_IFACE_XML, this);
                exported.export(this._dbusConnection, TASK_MANAGER_OBJECT_PATH);
                this._dbusExport = exported;
            } catch (e) {
                this._dbusExport = null;
            }

            try {
                this._dbusNameId = Gio.bus_own_name_on_connection(
                    this._dbusConnection,
                    'org.gnome.Shell.Extensions.FUHGlobeGlobalMenu.TaskManager',
                    Gio.BusNameOwnerFlags.NONE,
                    null,
                    null
                );
            } catch (e) {
                this._dbusNameId = 0;
            }
        }

        _setupMessageTray() {
            if (this._destroyed) return;
            if (Main && Main.messageTray && typeof Main.messageTray.connect === 'function') {
                try {
                    this._messageTraySubId = Main.messageTray.connect('notification-added', (_tray, notification) => {
                        this._handleNotification(notification);
                    });
                } catch (e) {}
            }
        }

        // ---------------------------------------------------------------------
        // Protocol 1: Unity LauncherEntry Ingestion
        // ---------------------------------------------------------------------

        /**
         * Ingests a Unity LauncherEntry progress update.
         *
         * @param {string} appUri - e.g. 'application://org.gnome.Chrome.desktop'
         * @param {object|GLib.Variant} rawProperties - Dictionary of properties
         */
        _handleUnityProgress(appUri, rawProperties) {
            if (this._destroyed || !appUri) return;

            const properties = unrollVariant(rawProperties) || {};
            const cleanAppId = normalizeAppId(appUri);
            const desktopId = cleanAppId ? `${cleanAppId}.desktop` : '';

            let progress = properties['progress'];
            if (progress !== undefined) {
                progress = Math.max(0.0, Math.min(1.0, Number(progress)));
            }

            const taskId = `unity:${cleanAppId}`;
            const existingTask = this._activeTasks.get(taskId) || this.getActiveTask(appUri) || this.getActiveTask(cleanAppId);

            const progressVisible = properties['progress-visible'] !== undefined
                ? Boolean(properties['progress-visible'])
                : (existingTask
                    ? (progress !== undefined ? (progress > 0.0 && progress < 1.0) : existingTask.progressVisible)
                    : (progress !== undefined && progress > 0.0 && progress < 1.0));

            const count = properties['count'] !== undefined ? Number(properties['count']) : 0;
            const countVisible = properties['count-visible'] !== undefined
                ? Boolean(properties['count-visible'])
                : (count > 0);

            if (progressVisible) {
                if (existingTask) {
                    if (progress !== undefined) existingTask.progress = progress;
                    existingTask.progressVisible = true;
                    existingTask.count = count;
                    existingTask.countVisible = countVisible;
                    existingTask.indeterminate = false;
                    this.emit('task-updated', existingTask);
                } else {
                    const newTask = {
                        id: taskId,
                        appId: cleanAppId,
                        desktopId: desktopId,
                        title: this._deriveAppTitle(cleanAppId),
                        summary: '',
                        progress: progress !== undefined ? progress : 0.0,
                        progressVisible: true,
                        count: count,
                        countVisible: countVisible,
                        indeterminate: false,
                        source: 'unity',
                        state: 'running',
                        startTime: Date.now(),
                        completedAt: null,
                        canCancel: false,
                        uri: null,
                        etaText: '',
                        speedText: '',
                        bytesText: '',
                    };
                    this._activeTasks.set(taskId, newTask);
                    this.emit('task-added', newTask);
                }
            } else {
                // Progress visibility disabled -> Task finished or cancelled
                if (existingTask) {
                    const isCompleted = (progress !== undefined && progress >= 0.99) ||
                                       (existingTask.progress >= 0.99);

                    if (isCompleted) {
                        existingTask.progress = 1.0;
                        existingTask.progressVisible = false;
                        existingTask.state = 'completed';
                        existingTask.completedAt = Date.now();
                        this._addRecentTask(existingTask);
                        this.emit('task-completed', existingTask);
                    } else {
                        existingTask.state = 'cancelled';
                    }

                    this._activeTasks.delete(existingTask.id);
                    this.emit('task-removed', existingTask.id);
                }
            }
        }

        // ---------------------------------------------------------------------
        // Protocol 2: FreeDesktop Notifications Ingestion
        // ---------------------------------------------------------------------

        /**
         * Handles incoming or updated FreeDesktop notifications with progress hints.
         *
         * @param {object} notification
         * @param {boolean} [isUpdate=false]
         */
        _handleNotification(notification, isUpdate = false) {
            if (this._destroyed || !notification) return;

            const rawHints = notification.hints || notification._hints || notification.params?.hints || {};
            const hints = unrollVariant(rawHints) || {};

            let rawVal = hints['value'] ?? hints['x-canonical-progress'] ?? hints['x-canonical-progress-percentage'];
            if (rawVal === undefined && notification.progress !== undefined) {
                rawVal = notification.progress;
            }

            // A notification without progress hints is not a live task
            if (rawVal === undefined) return;

            let progress = Number(rawVal);
            if (isNaN(progress)) return;

            // FreeDesktop notification 'value' and 'x-canonical-progress-percentage' use 0..100 scale
            if (hints['value'] !== undefined || hints['x-canonical-progress-percentage'] !== undefined) {
                if (progress > 1.0 || (Number.isInteger(progress) && progress >= 1)) {
                    progress = progress / 100.0;
                }
            } else if (progress > 1.0) {
                progress = progress / 100.0;
            }
            progress = Math.max(0.0, Math.min(1.0, progress));

            const rawAppId = notification.source?.app?.get_id?.() ||
                             hints['desktop-entry'] ||
                             notification.source?.id ||
                             notification.appName ||
                             'notification';
            const cleanAppId = normalizeAppId(rawAppId);

            const title = notification.title ||
                          notification.source?.title ||
                          this._deriveAppTitle(cleanAppId) ||
                          'Notification';
            const summary = notification.bannerBodyText ||
                            notification.body ||
                            notification.summary ||
                            '';

            const taskId = (notification.id !== undefined && notification.id !== null)
                ? `notify:${notification.id}`
                : `notify:${cleanAppId}:${title}`;

            // Find existing task for THIS notification specifically
            let existingTask = this._activeTasks.get(taskId);
            if (!existingTask) {
                for (const task of this._activeTasks.values()) {
                    if (task._notification && task._notification === notification) {
                        existingTask = task;
                        break;
                    }
                }
            }

            let filename = this.extractFilenameFromText(title) || this.extractFilenameFromText(summary) || this.extractFilenameFromText(notification.body);

            if (progress < 1.0) {
                if (existingTask) {
                    existingTask.progress = progress;
                    existingTask.progressVisible = true;
                    existingTask.title = title;
                    existingTask.summary = summary;
                    if (filename && !existingTask.fileName) existingTask.fileName = filename;
                    this.emit('task-updated', existingTask);
                } else {
                    const task = {
                        id: taskId,
                        appId: cleanAppId,
                        desktopId: cleanAppId ? `${cleanAppId}.desktop` : '',
                        title: title,
                        summary: summary,
                        progress: progress,
                        progressVisible: true,
                        count: 0,
                        countVisible: false,
                        indeterminate: false,
                        source: 'notification',
                        state: 'running',
                        startTime: Date.now(),
                        completedAt: null,
                        canCancel: typeof notification.close === 'function',
                        uri: null,
                        fileName: filename || null,
                        etaText: '',
                        speedText: '',
                        bytesText: '',
                        _notification: notification,
                    };

                    this._activeTasks.set(taskId, task);

                    // Track notification signals for cleanup if closed externally
                    if (typeof notification.connect === 'function') {
                        const sigIds = [];
                        try {
                            const closeId = notification.connect('destroy', () => {
                                this._onNotificationDestroyed(taskId, notification);
                            });
                            sigIds.push(closeId);
                        } catch (e) {}

                        try {
                            const updateId = notification.connect('updated', () => {
                                this._handleNotification(notification, true);
                            });
                            sigIds.push(updateId);
                        } catch (e) {}

                        this._notificationSignals.set(notification, sigIds);
                    }

                    this.emit('task-added', task);
                }
            } else {
                // Completed (progress >= 1.0)
                const currentId = existingTask ? existingTask.id : taskId;
                const task = existingTask || {
                    id: currentId,
                    appId: cleanAppId,
                    desktopId: cleanAppId ? `${cleanAppId}.desktop` : '',
                    title: title,
                    summary: summary,
                    progress: 1.0,
                    progressVisible: false,
                    count: 0,
                    countVisible: false,
                    indeterminate: false,
                    source: 'notification',
                    state: 'completed',
                    startTime: Date.now(),
                    completedAt: Date.now(),
                    canCancel: false,
                    uri: null,
                    fileName: filename || null,
                    etaText: '',
                    speedText: '',
                    bytesText: '',
                };
                if (filename && !task.fileName) task.fileName = filename;

                task.progress = 1.0;
                task.progressVisible = false;
                task.state = 'completed';
                task.completedAt = Date.now();
                this._addRecentTask(task);
                this.emit('task-completed', task);

                this._activeTasks.delete(currentId);
                this._clearNotificationSignals(notification);
                this.emit('task-removed', currentId);
            }
        }

        _onNotificationDestroyed(taskId, notification) {
            this._clearNotificationSignals(notification);
            const task = this._activeTasks.get(taskId);
            if (task) {
                if (task.progress >= 0.99) {
                    task.state = 'completed';
                    task.completedAt = Date.now();
                    this._addRecentTask(task);
                    this.emit('task-completed', task);
                } else {
                    task.state = 'cancelled';
                }
                this._activeTasks.delete(taskId);
                this.emit('task-removed', taskId);
            }
        }

        _clearNotificationSignals(notification) {
            if (!notification) return;
            const sigIds = this._notificationSignals.get(notification);
            if (sigIds && typeof notification.disconnect === 'function') {
                for (const sigId of sigIds) {
                    try {
                        notification.disconnect(sigId);
                    } catch (e) {}
                }
            }
            this._notificationSignals.delete(notification);
        }

        // ---------------------------------------------------------------------
        // Protocol 3: Nautilus Session Inhibitor Ingestion
        // ---------------------------------------------------------------------

        _onInhibitorAdded(inhibitorPath) {
            if (this._destroyed || !this._dbusConnection) return;

            Gio.DBusProxy.new(
                this._dbusConnection,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.gnome.SessionManager',
                inhibitorPath,
                'org.gnome.SessionManager.Inhibitor',
                this._cancellable,
                (source, res) => {
                    try {
                        const proxy = Gio.DBusProxy.new_finish(res);
                        proxy.call(
                            'GetAppId',
                            null,
                            Gio.DBusCallFlags.NONE,
                            -1,
                            this._cancellable,
                            (pApp, resApp) => {
                                let appId = '';
                                try {
                                    const [appIdVariant] = pApp.call_finish(resApp).deep_unpack();
                                    appId = appIdVariant;
                                } catch (e) {}

                                proxy.call(
                                    'GetReason',
                                    null,
                                    Gio.DBusCallFlags.NONE,
                                    -1,
                                    this._cancellable,
                                    (pReason, resReason) => {
                                        let reason = '';
                                        try {
                                            const [reasonVariant] = pReason.call_finish(resReason).deep_unpack();
                                            reason = reasonVariant;
                                        } catch (e) {}

                                        this._handleInhibitorAdded(inhibitorPath, appId, reason);
                                    }
                                );
                            }
                        );
                    } catch (e) {
                        // Proxy creation failed or cancelled
                    }
                }
            );
        }

        /**
         * Extracts a filename from text containing quotes or at the beginning.
         * 
         * @param {string} text
         * @returns {string|null}
         */
        extractFilenameFromText(text) {
            if (!text || typeof text !== 'string') return null;

            // 1. Extract from quotes (curly or straight)
            const quoteMatch = text.match(/["“'‘]([^"”'’]+)["”'’]/);
            if (quoteMatch) {
                const quoted = quoteMatch[1].trim();
                if (quoted) return quoted;
            }

            // 2. Extract filename with valid alphanumeric extension (2 to 6 chars)
            // Strip any trailing ellipsis (...) to prevent false matches on verbs like 'Deleting...'
            const clean = text.replace(/\.{2,}/g, '');
            const extMatch = clean.match(/\b([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]{2,6})\b/);
            if (extMatch) {
                const candidate = extMatch[1].trim();
                if (/\.[a-zA-Z0-9]{2,6}$/.test(candidate)) {
                    return candidate;
                }
            }

            return null;
        }

        /**
         * Resolves PIDs of running Nautilus instances via Shell.AppSystem, WindowTracker, or /proc scan.
         *
         * @returns {number[]}
         */
        _findNautilusPids() {
            const pids = [];
            try {
                if (Shell?.AppSystem) {
                    const appSys = Shell.AppSystem.get_default();
                    const nautilusApp = appSys?.lookup_app?.('org.gnome.Nautilus.desktop') ||
                                        appSys?.lookup_app?.('nautilus.desktop');
                    if (nautilusApp && typeof nautilusApp.get_pids === 'function') {
                        const appPids = nautilusApp.get_pids();
                        if (Array.isArray(appPids)) {
                            for (const p of appPids) {
                                if (typeof p === 'number' && !pids.includes(p)) pids.push(p);
                            }
                        }
                    }
                }
            } catch (e) {}

            try {
                if (Shell?.WindowTracker && typeof global !== 'undefined' && typeof global.get_window_actors === 'function') {
                    const tracker = Shell.WindowTracker.get_default();
                    for (const actor of global.get_window_actors()) {
                        const win = actor.meta_window || actor.get_meta_window?.();
                        if (win) {
                            const app = tracker.get_window_app(win);
                            if (app && app.get_id()?.toLowerCase().includes('nautilus')) {
                                const pid = typeof win.get_pid === 'function' ? win.get_pid() : null;
                                if (pid && !pids.includes(pid)) pids.push(pid);
                            }
                        }
                    }
                }
            } catch (e) {}

            if (pids.length === 0) {
                try {
                    const procDir = Gio.File.new_for_path('/proc');
                    const enumerator = procDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const name = info.get_name();
                        if (/^\d+$/.test(name)) {
                            try {
                                const [ok, comm] = GLib.file_get_contents(`/proc/${name}/comm`);
                                if (ok) {
                                    const commStr = (comm instanceof Uint8Array ? new TextDecoder().decode(comm) : comm.toString()).trim();
                                    if (commStr === 'nautilus') {
                                        const p = parseInt(name, 10);
                                        if (!pids.includes(p)) pids.push(p);
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
            }

            return pids;
        }

        /**
         * Scans open file descriptors in /proc/<pid>/fd to find active file transfers.
         *
         * @param {number[]} pids
         * @returns {{ pid: number, path: string, fileName: string, totalBytes: number, uri: string }|null}
         */
        _findNautilusActiveTransfer(pids = []) {
            if (!Array.isArray(pids) || pids.length === 0) return null;

            let foundFile = null;
            let maxFileSize = 0;

            for (const pid of pids) {
                let enumerator;
                try {
                    const fdDir = Gio.File.new_for_path(`/proc/${pid}/fd`);
                    enumerator = fdDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                } catch (e) {
                    continue;
                }

                let info;
                try {
                    while ((info = enumerator.next_file(null)) !== null) {
                        const fdName = info.get_name();
                        const linkPath = `/proc/${pid}/fd/${fdName}`;
                        let targetPath = null;
                        try {
                            targetPath = GLib.file_read_link(linkPath);
                        } catch (e) {
                            continue;
                        }

                        if (!targetPath || !targetPath.startsWith('/')) continue;
                        if (targetPath.startsWith('/proc') || targetPath.startsWith('/sys') || targetPath.startsWith('/dev')) continue;
                        if (targetPath.includes('/.cache/') || targetPath.includes('/.config/') || targetPath.includes('/.local/share/gvfs-metadata/')) continue;
                        if (targetPath.includes('/.local/share/nautilus/') || targetPath.includes('/.local/share/Trash/')) continue;
                        if (targetPath.endsWith('.so') || targetPath.endsWith('.mo') || targetPath.endsWith('.desktop')) continue;

                        try {
                            if (GLib.file_test(targetPath, GLib.FileTest.IS_REGULAR)) {
                                const basename = GLib.path_get_basename(targetPath);
                                const isTempOutput = basename.startsWith('.goutputstream-');
                                const gFile = Gio.File.new_for_path(targetPath);
                                const qInfo = gFile.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                                const size = qInfo ? qInfo.get_size() : 0;

                                if (!isTempOutput && size >= maxFileSize) {
                                    maxFileSize = size;
                                    foundFile = {
                                        pid,
                                        path: targetPath,
                                        fileName: basename,
                                        totalBytes: size,
                                        uri: gFile.get_uri(),
                                    };
                                } else if (!foundFile && isTempOutput) {
                                    foundFile = {
                                        pid,
                                        path: targetPath,
                                        fileName: basename,
                                        totalBytes: size,
                                        uri: gFile.get_uri(),
                                    };
                                }
                            }
                        } catch (e) {}
                    }
                } catch (e) {
                    // fds appear and vanish constantly during an operation;
                    // a mid-enumeration error just ends the scan early.
                }
            }

            return foundFile;
        }

        /**
         * Reads and parses /proc/<pid>/io into numeric key-value map.
         *
         * @param {number} pid
         * @returns {object|null}
         */
        _readProcessIo(pid) {
            if (!pid) return null;
            try {
                const [ok, contents] = GLib.file_get_contents(`/proc/${pid}/io`);
                if (!ok) return null;
                const str = (contents instanceof Uint8Array ? new TextDecoder().decode(contents) : contents.toString());
                const lines = str.split('\n');
                const io = {};
                for (const line of lines) {
                    const parts = line.split(':');
                    if (parts.length === 2) {
                        io[parts[0].trim()] = parseInt(parts[1].trim(), 10) || 0;
                    }
                }
                return io;
            } catch (e) {
                return null;
            }
        }

        /**
         * Periodic telemetry for an active Nautilus operation.
         *
         * Exact progress ("3.7 GB / 5.5 GB", "6 seconds left") is delivered
         * asynchronously by the isolated probe helper (see _startFileOpsProbe
         * and _onProbeLine); this tick only maintains honest throughput from
         * /proc rchar/wchar ("24 MB/s", "1.2 GB moved") and reverts the task
         * to indeterminate when probe readings go stale. The old code divided
         * /proc byte counters by the size of the largest open file, which is
         * not the operation total — progress rocketed to a capped 99% while
         * the real operation sat far below. Percentages are only ever shown
         * when they come from Nautilus itself.
         *
         * @param {object} task
         * @param {number} pid
         * @param {object|null} activeTransfer
         */
        _startNautilusIoMonitor(task, pid, activeTransfer = null) {
            if (!task || !pid) return;

            this._stopNautilusIoMonitor(task.id);

            const initialIo = this._readProcessIo(pid);
            const monitorState = {
                timerId: 0,
                pid,
                lastRead: initialIo?.rchar ?? 0,
                lastWrite: initialIo?.wchar ?? 0,
                lastTime: Date.now(),
                accumulatedCopied: 0,
            };

            monitorState.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, NAUTILUS_MONITOR_INTERVAL_MS, () => {
                if (this._destroyed || !this._activeTasks.has(task.id)) {
                    monitorState.timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._nautilusMonitorTick(task, monitorState);
                return GLib.SOURCE_CONTINUE;
            });

            this._nautilusMonitors.set(task.id, monitorState);
        }

        /**
         * One telemetry tick for an active Nautilus operation.
         *
         * @param {object} task
         * @param {object} monitorState - {pid, lastRead, lastWrite, lastTime, accumulatedCopied}
         */
        _nautilusMonitorTick(task, monitorState) {
            const now = Date.now();
            const dt = Math.max(0.1, (now - monitorState.lastTime) / 1000);
            const pid = monitorState.pid;

            // Exact numbers arrive asynchronously from the isolated probe
            // helper (see _onProbeLine). If they stop arriving, stop showing
            // numbers we can no longer confirm.
            if (task._lastRealProgressAt &&
                now - task._lastRealProgressAt > ATSPI_STALE_MS &&
                !task.indeterminate) {
                task.indeterminate = true;
                task.etaText = '';
            }

            const currentIo = this._readProcessIo(pid);
            if (currentIo) {
                const dRead = Math.max(0, (currentIo.rchar ?? 0) - monitorState.lastRead);
                const dWrite = Math.max(0, (currentIo.wchar ?? 0) - monitorState.lastWrite);
                monitorState.lastRead = currentIo.rchar ?? monitorState.lastRead;
                monitorState.lastWrite = currentIo.wchar ?? monitorState.lastWrite;
                monitorState.lastTime = now;

                const delta = Math.max(dRead, dWrite);
                if (delta > 0) {
                    monitorState.accumulatedCopied += delta;
                    task.speedText = formatSpeed(delta / dt);
                    if (task.indeterminate)
                        task.bytesText = formatBytes(monitorState.accumulatedCopied);
                } else {
                    task.speedText = '';
                }
            }

            this.emit('task-updated', task);
        }

        /**
         * Stops periodic I/O monitor for a task.
         *
         * @param {string} taskId
         */
        _stopNautilusIoMonitor(taskId) {
            if (!this._nautilusMonitors?.has(taskId)) return;
            const mon = this._nautilusMonitors.get(taskId);
            if (mon?.timerId) {
                GLib.source_remove(mon.timerId);
            }
            this._nautilusMonitors.delete(taskId);
        }

        /**
         * Ingests an inhibitor for long-running desktop operations (e.g. Nautilus file transfers).
         *
         * @param {string} inhibitorPath
         * @param {string} appId
         * @param {string} reason
         */
        _handleInhibitorAdded(inhibitorPath, appId, reason) {
            if (this._destroyed || !inhibitorPath) return;

            const isNautilus = appId && appId.toLowerCase().includes('nautilus');
            if (!isNautilus) return;

            const opLabel = deriveOperationLabel(reason);
            const opType = operationTypeFromLabel(opLabel);

            const pids = this._findNautilusPids();
            const activeTransfer = this._findNautilusActiveTransfer(pids);

            const taskId = `inhibitor:${inhibitorPath}`;
            const task = {
                id: taskId,
                appId: 'org.gnome.Nautilus',
                desktopId: 'org.gnome.Nautilus.desktop',
                title: opLabel,
                summary: opLabel,
                progress: 0.0,
                progressVisible: true,
                count: 0,
                countVisible: false,
                indeterminate: true,
                source: 'inhibitor',
                state: 'running',
                startTime: Date.now(),
                completedAt: null,
                canCancel: false,
                inhibitorPath: inhibitorPath,
                opType: opType,
                uri: activeTransfer?.uri || null,
                fileName: activeTransfer?.fileName || null,
                totalBytes: 0,
                etaText: '',
                speedText: '',
                bytesText: '',
                _lastRealProgressAt: 0,
            };

            this._activeTasks.set(taskId, task);
            this._activeInhibitors.set(inhibitorPath, taskId);

            if (pids.length > 0) {
                const pid = activeTransfer?.pid || pids[0];
                this._startNautilusIoMonitor(task, pid, activeTransfer);
                this._startFileOpsProbe(task, pid);
            }

            this.emit('task-added', task);
        }

        // ---------------------------------------------------------------------
        // Isolated AT-SPI progress helper (bin/gm-fileops-probe)
        // ---------------------------------------------------------------------

        /**
         * Spawns the out-of-process AT-SPI probe for a task. The helper reads
         * what Nautilus renders ("3.7 GB / 5.5 GB") and streams JSON lines;
         * AT-SPI IPC must never run inside gnome-shell — a slow a11y answer
         * blocks the compositor and freezes the screen.
         *
         * @param {object} task
         * @param {number} pid
         */
        _startFileOpsProbe(task, pid) {
            if (this._destroyed || !task || !pid) return;
            this._stopFileOpsProbe(task.id);

            const handle = this._spawnFileOpsProbe
                ? this._spawnFileOpsProbe(task, pid)
                : this._spawnProbeHelper(task, pid);
            if (handle)
                this._probeHandles.set(task.id, handle);
        }

        _spawnProbeHelper(task, pid) {
            const script = this._probeScriptPath;
            if (!script || !GLib.file_test(script, GLib.FileTest.EXISTS))
                return null;

            try {
                const subprocess = Gio.Subprocess.new(
                    ['gjs', '-m', script, String(pid), String(PROBE_INTERVAL_MS)],
                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
                const dataStream = Gio.DataInputStream.new(subprocess.get_stdout_pipe());
                const cancellable = new Gio.Cancellable();
                const handle = {
                    stop: () => {
                        try {
                            cancellable.cancel();
                            subprocess.force_exit();
                        } catch (e) {}
                    },
                };

                const readNext = () => {
                    dataStream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (src, res) => {
                        let line = null;
                        try {
                            line = src.read_line_finish_utf8(res)[0];
                        } catch (e) {
                            return;
                        }
                        if (line === null)
                            return; // helper exited
                        this._onProbeLine(task.id, line);
                        readNext();
                    });
                };
                readNext();
                return handle;
            } catch (e) {
                return null;
            }
        }

        /**
         * Applies one JSON update line from the probe helper.
         *
         * @param {string} taskId
         * @param {string} line
         */
        _onProbeLine(taskId, line) {
            if (this._destroyed) return;
            const task = this._activeTasks.get(taskId);
            if (!task) return;

            let update;
            try {
                update = JSON.parse(line);
            } catch (e) {
                return;
            }
            if (!update || typeof update !== 'object')
                return;

            if (typeof update.progress === 'number' && Number.isFinite(update.progress)) {
                const progress = Math.max(0, Math.min(1, update.progress));
                const bytesText = update.bytesText || '';
                const etaText = update.etaText || '';
                const unchanged = !task.indeterminate &&
                    task.progress === progress &&
                    task.bytesText === bytesText &&
                    task.etaText === etaText;
                task.progress = progress;
                task.indeterminate = false;
                task.progressVisible = true;
                if (bytesText) task.bytesText = bytesText;
                if (etaText) task.etaText = etaText;
                if (update.totalBytes > 0) task.totalBytes = update.totalBytes;
                task._lastRealProgressAt = Date.now();
                if (!unchanged)
                    this.emit('task-updated', task);
            }
            // progress:null lines are heartbeats: nothing new to show.
        }

        _stopFileOpsProbe(taskId) {
            const handle = this._probeHandles?.get(taskId);
            if (handle) {
                try {
                    handle.stop();
                } catch (e) {}
                this._probeHandles.delete(taskId);
            }
        }

        /**
         * True when a recently-used URI is Nautilus bookkeeping rather than a
         * user file; the tags/meta.db store is touched by every operation and
         * used to win the "completed file" slot every time.
         *
         * @param {string} uri
         * @returns {boolean}
         */
        _isInternalNautilusUri(uri) {
            if (!uri || typeof uri !== 'string') return true;
            const lower = uri.toLowerCase();
            return lower.includes('/.local/share/nautilus/') ||
                   lower.includes('/.cache/') ||
                   lower.includes('/.config/');
        }

        /**
         * Ingests inhibitor removal, marking the operation complete and querying recent files.
         *
         * @param {string} inhibitorPath
         */
        _handleInhibitorRemoved(inhibitorPath) {
            if (this._destroyed || !inhibitorPath) return;

            if (!this._activeInhibitors.has(inhibitorPath)) return;

            const taskId = this._activeInhibitors.get(inhibitorPath);
            this._activeInhibitors.delete(inhibitorPath);
            this._stopNautilusIoMonitor(taskId);
            this._stopFileOpsProbe(taskId);

            const task = this._activeTasks.get(taskId);
            if (!task) return;

            // Recent-file enrichment only helps operations that produce files,
            // and Nautilus's own metadata stores must never win the slot.
            if (['copy', 'extract', 'compress', 'transfer'].includes(task.opType)) {
                const recentFiles = this._queryRecentFiles(task.startTime);
                const topFile = (recentFiles || []).find(f => !this._isInternalNautilusUri(f.uri));
                if (topFile) {
                    if (topFile.title) task.title = topFile.title;
                    if (topFile.uri) task.uri = topFile.uri;
                }
            }

            task.indeterminate = false;
            task.progress = 1.0;
            task.progressVisible = false;
            task.speedText = '';
            task.etaText = 'Completed';
            task.state = 'completed';
            task.completedAt = Date.now();
            if (task.totalBytes > 0) {
                task.bytesText = formatBytes(task.totalBytes);
            }

            this._addRecentTask(task);

            this._activeTasks.delete(taskId);
            this.emit('task-completed', task);
            this.emit('task-removed', taskId);
        }

        /**
         * Queries recently used files from recently-used.xbel.
         *
         * @param {number} [startTimeMs=0] - Optional timestamp filter
         * @returns {Array<{ uri: string, title: string, timestamp: number, appName: string }>}
         */
        _queryRecentFiles(startTimeMs = 0) {
            const xbelPath = this._xbelFile;
            try {
                const file = Gio.File.new_for_path(xbelPath);
                if (!file.query_exists(null)) return [];

                const [ok, bytes] = file.load_contents(null);
                if (!ok || !bytes) return [];

                const text = new TextDecoder().decode(bytes);
                const bookmarkRegex = /<bookmark\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bookmark>)/g;
                const items = [];
                const seenUris = new Set();
                let match;

                const minTimestamp = startTimeMs > 0 ? Math.floor((startTimeMs - 10000) / 1000) : 0;

                while ((match = bookmarkRegex.exec(text)) !== null) {
                    const attrs = match[1] || '';
                    const content = match[2] || '';

                    const hrefMatch = attrs.match(/href="([^"]+)"/);
                    if (!hrefMatch) continue;
                    const uri = hrefMatch[1];

                    if (seenUris.has(uri)) continue;
                    seenUris.add(uri);

                    const modMatch = attrs.match(/modified="([^"]+)"/);
                    const modified = modMatch ? modMatch[1] : '';

                    const titleMatch = content.match(/<title>([^<]*)<\/title>/);
                    const titleMarkup = titleMatch ? titleMatch[1] : '';

                    const appMatch = content.match(/<bookmark:application[^>]*name="([^"]+)"/);
                    const appName = appMatch ? appMatch[1] : '';

                    let title = titleMarkup.trim();
                    if (!title) {
                        const decoded = GLib.uri_unescape_string(uri, null) ?? uri;
                        title = GLib.path_get_basename(decoded);
                    }

                    let timestamp = 0;
                    if (modified) {
                        try {
                            const dt = GLib.DateTime.new_from_iso8601(modified, null);
                            if (dt) timestamp = dt.to_unix();
                        } catch (e) {}
                    }

                    // Filter out files older than the transfer start time if minTimestamp is set
                    if (minTimestamp > 0 && timestamp > 0 && timestamp < minTimestamp) {
                        continue;
                    }

                    items.push({ uri, title, timestamp, appName });
                }

                // Prioritize Nautilus bookmarks, then newest timestamp
                items.sort((a, b) => {
                    const aNautilus = a.appName && a.appName.toLowerCase().includes('nautilus') ? 1 : 0;
                    const bNautilus = b.appName && b.appName.toLowerCase().includes('nautilus') ? 1 : 0;
                    if (aNautilus !== bNautilus) return bNautilus - aNautilus;
                    return b.timestamp - a.timestamp;
                });

                return items;
            } catch (e) {
                return [];
            }
        }

        // ---------------------------------------------------------------------
        // Protocol 4: Exported D-Bus Interface for CLI tasks (bin/gm-run)
        // ---------------------------------------------------------------------

        RegisterTask(title, appId) {
            if (this._destroyed) return '';

            const taskId = `cli-${GLib.uuid_string_random()}`;
            const cleanAppId = normalizeAppId(appId) || 'terminal';
            const taskTitle = title || 'CLI Command';

            const task = {
                id: taskId,
                appId: cleanAppId,
                desktopId: cleanAppId ? `${cleanAppId}.desktop` : '',
                title: taskTitle,
                summary: 'Running',
                progress: 0.0,
                progressVisible: true,
                count: 0,
                countVisible: false,
                indeterminate: true,
                source: 'cli',
                state: 'running',
                startTime: Date.now(),
                completedAt: null,
                canCancel: true,
                uri: null,
                etaText: '',
                speedText: '',
                bytesText: '',
            };

            this._activeTasks.set(taskId, task);
            this.emit('task-added', task);
            return taskId;
        }

        UpdateTask(taskId, progress, statusText) {
            if (this._destroyed) return;

            const task = this._activeTasks.get(taskId);
            if (!task) return;

            const val = Math.max(0.0, Math.min(1.0, Number(progress)));
            task.progress = val;
            task.indeterminate = false;
            if (statusText) task.summary = statusText;

            this.emit('task-updated', task);
        }

        CompleteTask(taskId, success) {
            if (this._destroyed) return;

            const task = this._activeTasks.get(taskId);
            if (!task) return;

            task.progress = 1.0;
            task.indeterminate = false;
            task.state = success ? 'completed' : 'failed';
            task.completedAt = Date.now();

            this._addRecentTask(task);
            this.emit('task-completed', task);

            this._activeTasks.delete(taskId);
            this.emit('task-removed', taskId);
        }

        RemoveTask(taskId) {
            if (this._destroyed) return;

            if (this._activeTasks.has(taskId)) {
                this._activeTasks.delete(taskId);
                this.emit('task-removed', taskId);
            }
        }

        GetActiveTasks() {
            if (this._destroyed) return '[]';
            const serialized = this.getAllActiveTasks().map(serializeTask);
            return JSON.stringify(serialized);
        }

        GetRecentTasks() {
            if (this._destroyed) return '[]';
            const serialized = this.getRecentTasks().map(serializeTask);
            return JSON.stringify(serialized);
        }

        // ---------------------------------------------------------------------
        // Public Accessors & Methods
        // ---------------------------------------------------------------------

        /**
         * Gets the active task for an application ID, URI, or task ID.
         *
         * @param {string} identifier
         * @returns {object|null}
         */
        getActiveTask(identifier) {
            if (this._destroyed || !identifier) return null;

            if (this._activeTasks.has(identifier)) {
                return this._activeTasks.get(identifier);
            }

            const cleanId = normalizeAppId(identifier).toLowerCase();
            const rawLower = String(identifier).toLowerCase();

            for (const task of this._activeTasks.values()) {
                if (task.id === identifier || task.id.toLowerCase() === rawLower) {
                    return task;
                }
                if (task.appId && task.appId.toLowerCase() === cleanId) {
                    return task;
                }
                if (task.desktopId && task.desktopId.toLowerCase() === rawLower) {
                    return task;
                }
            }

            return null;
        }

        /**
         * Returns an array of all active tasks.
         *
         * @returns {Array<object>}
         */
        getAllActiveTasks() {
            if (this._destroyed) return [];
            return Array.from(this._activeTasks.values());
        }

        /**
         * Returns a list of recently completed tasks (capped at MAX_RECENT_TASKS).
         *
         * @returns {Array<object>}
         */
        getRecentTasks() {
            return this._recentTasks.slice();
        }

        getSettings() {
            return this._settings;
        }

        clearRecentTasks() {
            this._recentTasks = [];
            this._saveRecentTasks();
            this.emit('recent-tasks-cleared');
        }

        /**
         * Cancels an active task by ID or AppID.
         *
         * @param {string} taskId
         * @returns {boolean}
         */
        cancelTask(taskId) {
            if (this._destroyed || !taskId) return false;

            const task = this.getActiveTask(taskId);
            if (!task) return false;

            task.state = 'cancelled';
            this._stopNautilusIoMonitor(task.id);
            this._stopFileOpsProbe(task.id);
            this._activeTasks.delete(task.id);
            this.emit('task-removed', task.id);

            if (task._notification) {
                const notif = task._notification;
                this._clearNotificationSignals(notif);
                if (typeof notif.close === 'function') {
                    try {
                        notif.close();
                    } catch (e) {}
                }
            }

            // Emits cancellation via protocol RPC
            if (this._dbusConnection) {
                try {
                    this._dbusConnection.emit_signal(
                        null,
                        TASK_MANAGER_OBJECT_PATH,
                        'org.gnome.Shell.Extensions.FUHGlobeGlobalMenu.TaskManager',
                        'TaskCancelled',
                        new GLib.Variant('(s)', [task.id])
                    );
                } catch (e) {}
            }

            return true;
        }

        // ---------------------------------------------------------------------
        // Recent Tasks Persistence & Helpers
        // ---------------------------------------------------------------------

        _addRecentTask(task) {
            if (!task) return;

            const entry = {
                id: task.id,
                appId: task.appId,
                desktopId: task.desktopId || '',
                title: task.title,
                summary: task.summary || '',
                progress: 1.0,
                source: task.source,
                state: task.state || 'completed',
                startTime: task.startTime,
                completedAt: task.completedAt || Date.now(),
                uri: task.uri || null,
            };

            // Deduplicate if task already exists in history
            this._recentTasks = this._recentTasks.filter(t => t.id !== entry.id);
            this._recentTasks.unshift(entry);

            if (this._recentTasks.length > MAX_RECENT_TASKS) {
                this._recentTasks = this._recentTasks.slice(0, MAX_RECENT_TASKS);
            }

            this._saveRecentTasks();
        }

        _loadRecentTasks() {
            try {
                const file = Gio.File.new_for_path(this._cacheFile);
                if (file.query_exists(null)) {
                    const [ok, bytes] = file.load_contents(null);
                    if (ok && bytes) {
                        const jsonStr = new TextDecoder().decode(bytes);
                        const parsed = JSON.parse(jsonStr);
                        if (Array.isArray(parsed)) {
                            this._recentTasks = parsed
                                .filter(item => item && typeof item === 'object' && typeof item.id === 'string')
                                .slice(0, MAX_RECENT_TASKS);
                            return;
                        }
                    }
                }
            } catch (e) {}

            this._recentTasks = [];
        }

        _saveRecentTasks() {
            try {
                const dir = GLib.path_get_dirname(this._cacheFile);
                GLib.mkdir_with_parents(dir, 0o755);
                const jsonStr = JSON.stringify(this._recentTasks, null, 2);
                GLib.file_set_contents(this._cacheFile, jsonStr);
            } catch (e) {}
        }

        _deriveAppTitle(cleanAppId) {
            if (!cleanAppId) return 'Task';

            const desktopId = `${cleanAppId}.desktop`;

            if (Shell && Shell.AppSystem) {
                try {
                    const app = Shell.AppSystem.get_default()?.lookup_app(desktopId);
                    if (app) {
                        const name = app.get_name();
                        if (name) return name;
                    }
                } catch (e) {}
            }

            const DesktopAppInfo = GioUnix?.DesktopAppInfo || Gio.DesktopAppInfo;
            if (DesktopAppInfo) {
                try {
                    const info = DesktopAppInfo.new(desktopId);
                    if (info) {
                        const name = info.get_name();
                        if (name) return name;
                    }
                } catch (e) {}
            }

            const parts = cleanAppId.split('.');
            const lastPart = parts[parts.length - 1];
            return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
        }

        // ---------------------------------------------------------------------
        // Teardown
        // ---------------------------------------------------------------------

        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;

            if (this._cancellable) {
                this._cancellable.cancel();
            }

            // Disconnect D-Bus signal subscriptions
            if (this._dbusConnection) {
                if (this._unitySubId) {
                    try {
                        this._dbusConnection.signal_unsubscribe(this._unitySubId);
                    } catch (e) {}
                    this._unitySubId = 0;
                }
                if (this._inhibitorAddedSubId) {
                    try {
                        this._dbusConnection.signal_unsubscribe(this._inhibitorAddedSubId);
                    } catch (e) {}
                    this._inhibitorAddedSubId = 0;
                }
                if (this._inhibitorRemovedSubId) {
                    try {
                        this._dbusConnection.signal_unsubscribe(this._inhibitorRemovedSubId);
                    } catch (e) {}
                    this._inhibitorRemovedSubId = 0;
                }
            }

            // Unexport D-Bus interface
            if (this._dbusExport) {
                try {
                    if (this._dbusConnection && this._dbusExport.has_connection(this._dbusConnection)) {
                        this._dbusExport.unexport();
                    }
                } catch (e) {}
                this._dbusExport = null;
            }

            if (this._dbusNameId) {
                try {
                    Gio.bus_unown_name(this._dbusNameId);
                } catch (e) {}
                this._dbusNameId = 0;
            }

            // Disconnect Main.messageTray listener
            if (this._messageTraySubId && Main && Main.messageTray) {
                try {
                    Main.messageTray.disconnect(this._messageTraySubId);
                } catch (e) {}
                this._messageTraySubId = 0;
            }

            // Clean up notification signal listeners
            for (const [notification, sigIds] of this._notificationSignals.entries()) {
                if (typeof notification.disconnect === 'function') {
                    for (const sigId of sigIds) {
                        try {
                            notification.disconnect(sigId);
                        } catch (e) {}
                    }
                }
            }
            this._notificationSignals.clear();

            // Clean up Nautilus I/O monitors
            for (const [taskId, mon] of this._nautilusMonitors.entries()) {
                if (mon?.timerId) {
                    GLib.source_remove(mon.timerId);
                }
            }
            this._nautilusMonitors.clear();

            // Kill every isolated probe helper
            for (const taskId of this._probeHandles.keys()) {
                this._stopFileOpsProbe(taskId);
            }
            this._probeHandles.clear();

            this._activeTasks.clear();
            this._activeInhibitors.clear();
        }
    }
);
