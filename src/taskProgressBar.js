// SPDX-License-Identifier: GPL-3.0-or-later
// src/taskProgressBar.js - Cairo Zero-Reflow Hairline Progress Bar Widget

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import cairo from 'cairo';

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

const hasClutterContext = typeof global !== 'undefined' && Boolean(global.stage);
const hasStDrawingArea = Boolean(St?.DrawingArea && hasClutterContext);

// GNOME Libadwaita accent color: #3584e4 (rgb: 53, 132, 228)
export const ACCENT_COLOR = '#3584e4';
const ACCENT_R = 53 / 255;
const ACCENT_G = 132 / 255;
const ACCENT_B = 228 / 255;

// GNOME Libadwaita success color: #2ec27e (rgb: 46, 194, 126)
export const SUCCESS_COLOR = '#2ec27e';
const SUCCESS_R = 46 / 255;
const SUCCESS_G = 194 / 255;
const SUCCESS_B = 126 / 255;

export const BAR_HEIGHT = 2; // 2px high hairline along bottom edge
export const CORNER_RADIUS = 1; // 1px corner radius for rounded hairline ends
const PULSE_INTERVAL_MS = 30; // ~33 FPS smooth indeterminate pulse
const PULSE_STEP = 0.03;

/**
 * Helper to construct a rounded rectangle hairline path in Cairo.
 * Clamps radius to half dimensions so small widths/heights do not distort.
 */
function drawRoundedHairline(cr, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    const clampedR = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - clampedR, y + clampedR, clampedR, -Math.PI / 2, 0);
    cr.arc(x + w - clampedR, y + h - clampedR, clampedR, 0, Math.PI / 2);
    cr.arc(x + clampedR, y + h - clampedR, clampedR, Math.PI, Math.PI);
    cr.arc(x + clampedR, y + clampedR, clampedR, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

/**
 * Common logic implementation for TaskProgressBar.
 */
class BaseProgressBarLogic {
    _initLogic(params = {}) {
        this._progress = 0.0;
        this._indeterminate = false;
        this._completed = false;
        this._pulseOffset = 0.0;
        this._pulseTimerId = 0;
        this._destroyed = false;
        this._destroySignalId = 0;

        if (typeof this.connect === 'function') {
            this._destroySignalId = this.connect('destroy', () => {
                this._cleanup();
            });
        }

        if (params.progress !== undefined) {
            this.setProgress(params.progress);
        }
        if (params.indeterminate !== undefined) {
            this.setIndeterminate(params.indeterminate);
        }
        if (params.completed !== undefined) {
            this.setCompleted(params.completed);
        }
    }

    get progress() {
        return this._progress;
    }

    set progress(value) {
        this.setProgress(value);
    }

    get indeterminate() {
        return this._indeterminate;
    }

    set indeterminate(value) {
        this.setIndeterminate(value);
    }

    get completed() {
        return this._completed;
    }

    set completed(value) {
        this.setCompleted(value);
    }

    /**
     * Sets whether progress bar is in completed state (drawing success green).
     * @param {boolean} completed
     */
    setCompleted(completed) {
        if (this._destroyed) return;
        const flag = Boolean(completed);
        if (this._completed === flag) return;

        this._completed = flag;
        if (typeof this.notify === 'function') {
            this.notify('completed');
        }
        this.queue_repaint();
    }

    /**
     * Sets progress fraction and triggers zero-reflow redraw.
     * @param {number} fraction - Clamped between 0.0 and 1.0
     */
    setProgress(fraction) {
        if (this._destroyed) return;
        const val = Number(fraction);
        const clamped = Number.isFinite(val) ? Math.max(0.0, Math.min(1.0, val)) : 0.0;
        if (Math.abs(this._progress - clamped) < 0.0001) return;

        this._progress = clamped;
        if (typeof this.notify === 'function') {
            this.notify('progress');
        }
        this.queue_repaint();
    }

    /**
     * Toggles indeterminate animated pulse for operations without byte metrics.
     * @param {boolean} indeterminate
     */
    setIndeterminate(indeterminate) {
        if (this._destroyed) return;
        const flag = Boolean(indeterminate);
        if (this._indeterminate === flag) return;

        this._indeterminate = flag;
        if (this._indeterminate) {
            this._startPulseAnimation();
        } else {
            this._stopPulseAnimation();
        }

        if (typeof this.notify === 'function') {
            this.notify('indeterminate');
        }
        this.queue_repaint();
    }

    _startPulseAnimation() {
        if (this._pulseTimerId || this._destroyed) return;
        this._pulseOffset = 0.0;
        this._pulseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULSE_INTERVAL_MS, () => {
            if (!this._indeterminate || this._destroyed) {
                this._pulseTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._pulseOffset = (this._pulseOffset + PULSE_STEP) % 1.0;
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPulseAnimation() {
        if (this._pulseTimerId) {
            GLib.source_remove(this._pulseTimerId);
            this._pulseTimerId = 0;
        }
        this._pulseOffset = 0.0;
    }

    /**
     * Helper to acquire Cairo context, measure bounds, paint, and safely dispose.
     */
    _vfuncRepaintHelper() {
        if (this._destroyed) return;

        let cr = null;
        if (typeof this.get_context === 'function') {
            cr = this.get_context();
        }
        if (!cr) return;

        try {
            let width = 0;
            let height = 0;
            if (typeof this.get_surface_size === 'function') {
                const size = this.get_surface_size();
                width = size?.[0] ?? 0;
                height = size?.[1] ?? 0;
            } else {
                width = this.width ?? 0;
                height = this.height ?? 0;
            }

            if (width <= 0 || height <= 0) return;

            this._paintCairo(cr, width, height);
        } finally {
            if (typeof cr.$dispose === 'function') {
                cr.$dispose();
            }
        }
    }

    /**
     * Performs pure 2D Cairo drawing on the context.
     * @param {cairo.Context} cr - Cairo rendering context
     * @param {number} width - Allocated surface width
     * @param {number} height - Allocated surface height
     */
    _paintCairo(cr, width, height) {
        if (!cr || width <= 0 || height <= 0) return;

        // Clear previous frame to ensure zero ghosting across repaints
        cr.save();
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        const y = Math.max(0, height - BAR_HEIGHT);
        const r = this._completed ? SUCCESS_R : ACCENT_R;
        const g = this._completed ? SUCCESS_G : ACCENT_G;
        const b = this._completed ? SUCCESS_B : ACCENT_B;

        // 1. Draw subtle background track along the bottom edge
        cr.setSourceRGBA(r, g, b, 0.20);
        drawRoundedHairline(cr, 0, y, width, BAR_HEIGHT, CORNER_RADIUS);
        cr.fill();

        // 2. Draw indeterminate pulsing bar or determinate active progress
        if (this._indeterminate) {
            const pulseWidth = Math.max(24, width * 0.35);
            const totalTravel = width + pulseWidth;
            const pulseStart = -pulseWidth + totalTravel * this._pulseOffset;
            const pulseEnd = pulseStart + pulseWidth;

            cr.save();
            drawRoundedHairline(cr, 0, y, width, BAR_HEIGHT, CORNER_RADIUS);
            cr.clip();

            const grad = new cairo.LinearGradient(pulseStart, 0, pulseEnd, 0);
            grad.addColorStopRGBA(0.0, r, g, b, 0.0);
            grad.addColorStopRGBA(0.5, r, g, b, 1.0);
            grad.addColorStopRGBA(1.0, r, g, b, 0.0);

            cr.setSource(grad);
            cr.paint();
            cr.restore();
        } else if (this._progress > 0) {
            const barWidth = Math.min(width, Math.max(0, width * this._progress));
            if (barWidth > 0) {
                cr.setSourceRGBA(r, g, b, 1.0);
                drawRoundedHairline(cr, 0, y, barWidth, BAR_HEIGHT, CORNER_RADIUS);
                cr.fill();
            }
        }
    }

    _cleanup() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._stopPulseAnimation();
        this._indeterminate = false;
        if (this._destroySignalId && typeof this.disconnect === 'function') {
            try {
                this.disconnect(this._destroySignalId);
            } catch (e) {}
            this._destroySignalId = 0;
        }
    }
}

let TaskProgressBarClass;

if (hasStDrawingArea) {
    TaskProgressBarClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskProgressBar',
            Properties: {
                'progress': GObject.ParamSpec.double(
                    'progress',
                    'Progress',
                    'Task completion fraction between 0.0 and 1.0',
                    GObject.ParamFlags.READWRITE,
                    0.0,
                    1.0,
                    0.0
                ),
                'indeterminate': GObject.ParamSpec.boolean(
                    'indeterminate',
                    'Indeterminate',
                    'Whether the task is in an indeterminate pulsing state',
                    GObject.ParamFlags.READWRITE,
                    false
                ),
                'completed': GObject.ParamSpec.boolean(
                    'completed',
                    'Completed',
                    'Whether the task is in a completed state',
                    GObject.ParamFlags.READWRITE,
                    false
                ),
            },
        },
        class TaskProgressBar extends St.DrawingArea {
            _init(params = {}) {
                const { progress, indeterminate, completed, ...actorParams } = params;
                const cleanParams = { ...actorParams };
                if (Clutter) {
                    if (!('reactive' in cleanParams)) cleanParams.reactive = false;
                    if (!('style_class' in cleanParams)) cleanParams.style_class = 'fuhgawz-task-progress-bar';
                    if (!('x_expand' in cleanParams)) cleanParams.x_expand = true;
                    if (!('y_align' in cleanParams)) {
                        cleanParams.y_align = Clutter.ActorAlign?.END ?? 3;
                    }
                    if (!('height' in cleanParams)) cleanParams.height = BAR_HEIGHT;
                }
                super._init(cleanParams);
                this._initLogic(params);
            }

            vfunc_repaint() {
                this._vfuncRepaintHelper();
            }

            vfunc_get_preferred_height(_forWidth) {
                return [BAR_HEIGHT, BAR_HEIGHT];
            }

            vfunc_get_preferred_width(_forHeight) {
                return [0, 0];
            }

            destroy() {
                if (this._destroyed) return;
                this._cleanup();
                super.destroy();
            }
        }
    );
} else {
    TaskProgressBarClass = GObject.registerClass(
        {
            GTypeName: 'FUHGlobeTaskProgressBar',
            Properties: {
                'progress': GObject.ParamSpec.double(
                    'progress',
                    'Progress',
                    'Task completion fraction between 0.0 and 1.0',
                    GObject.ParamFlags.READWRITE,
                    0.0,
                    1.0,
                    0.0
                ),
                'indeterminate': GObject.ParamSpec.boolean(
                    'indeterminate',
                    'Indeterminate',
                    'Whether the task is in an indeterminate pulsing state',
                    GObject.ParamFlags.READWRITE,
                    false
                ),
                'completed': GObject.ParamSpec.boolean(
                    'completed',
                    'Completed',
                    'Whether the task is in a completed state',
                    GObject.ParamFlags.READWRITE,
                    false
                ),
            },
            Signals: {
                'destroy': {},
            },
        },
        class TaskProgressBar extends GObject.Object {
            _init(params = {}) {
                super._init();
                this.height = params.height ?? BAR_HEIGHT;
                this.width = params.width ?? 0;
                this._initLogic(params);
            }

            queue_repaint() {
                // No-op in headless test environment; St.DrawingArea handles queue_repaint natively
            }

            destroy() {
                if (this._destroyed) return;
                this._cleanup();
                this.emit('destroy');
            }
        }
    );

    TaskProgressBarClass.prototype.vfunc_repaint = function() {
        this._vfuncRepaintHelper();
    };

    TaskProgressBarClass.prototype.vfunc_get_preferred_height = function() {
        return [BAR_HEIGHT, BAR_HEIGHT];
    };

    TaskProgressBarClass.prototype.vfunc_get_preferred_width = function() {
        return [0, 0];
    };
}

// Copy shared methods and accessors to prototype
const protoDescriptors = Object.getOwnPropertyDescriptors(BaseProgressBarLogic.prototype);
for (const [name, descriptor] of Object.entries(protoDescriptors)) {
    if (name !== 'constructor') {
        Object.defineProperty(TaskProgressBarClass.prototype, name, descriptor);
    }
}

export const TaskProgressBar = TaskProgressBarClass;
