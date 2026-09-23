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
            this._recentTasks = [];

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
                : (existingTask ? existingTask.progressVisible : (progress !== undefined && progress < 1.0));

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

            let filename = this.extractFilenameFromText(reason);
            if (!filename) {
                try {
                    let focusWindow = global.display?.focus_window || (Shell && Shell.WindowTracker && Shell.WindowTracker.get_default()?.focus_app?.get_windows()[0]);
                    if (focusWindow && typeof focusWindow.get_title === 'function') {
                        filename = this.extractFilenameFromText(focusWindow.get_title());
                    }
                } catch (e) {}
            }

            const taskId = `inhibitor:${inhibitorPath}`;
            const task = {
                id: taskId,
                appId: 'org.gnome.Nautilus',
                desktopId: 'org.gnome.Nautilus.desktop',
                title: 'Files',
                summary: reason || 'Transferring files',
                progress: 0.0,
                progressVisible: true,
                count: 0,
                countVisible: false,
                indeterminate: true, // File transfers use indeterminate hairline pulse
                source: 'inhibitor',
                state: 'running',
                startTime: Date.now(),
                completedAt: null,
                canCancel: false,
                inhibitorPath: inhibitorPath,
                uri: null,
                fileName: filename || null,
                etaText: '',
                speedText: '',
                bytesText: '',
            };

            this._activeTasks.set(taskId, task);
            this._activeInhibitors.set(inhibitorPath, taskId);
            this.emit('task-added', task);
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

            const task = this._activeTasks.get(taskId);
            if (task) {
                // Query recent files to enrich the completed transfer details
                const recentFiles = this._queryRecentFiles(task.startTime);
                if (recentFiles && recentFiles.length > 0) {
                    const topFile = recentFiles[0];
                    if (topFile.title) task.title = topFile.title;
                    if (topFile.uri) task.uri = topFile.uri;
                }

                task.indeterminate = false;
                task.progress = 1.0;
                task.progressVisible = false;
                task.state = 'completed';
                task.completedAt = Date.now();

                this._addRecentTask(task);
                this.emit('task-completed', task);

                this._activeTasks.delete(taskId);
                this.emit('task-removed', taskId);
            }
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
                summary: 'Running...',
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

            this._activeTasks.clear();
            this._activeInhibitors.clear();
        }
    }
);
