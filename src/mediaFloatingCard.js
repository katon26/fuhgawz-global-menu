// SPDX-License-Identifier: GPL-3.0-or-later
// Interactive MPRIS hover card with Cairo progress/equalizer rendering.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import cairo from 'cairo';

let St = null;
try {
    const imported = await import('gi://St');
    St = imported.default ?? imported;
} catch (error) {
    St = null;
}

let Clutter = null;
try {
    const imported = await import('gi://Clutter');
    Clutter = imported.default ?? imported;
} catch (error) {
    Clutter = null;
}

let Atk = null;
try {
    const imported = await import('gi://Atk');
    Atk = imported.default ?? imported;
} catch (error) {
    Atk = null;
}

let Main = null;
try {
    Main = await import('resource:///org/gnome/shell/ui/main.js');
} catch (error) {
    Main = null;
}

const hasShellStage = typeof global !== 'undefined' && Boolean(global.stage);
const hasStWidget = Boolean(St?.BoxLayout && hasShellStage);
const hasStDrawingArea = Boolean(St?.DrawingArea && hasShellStage);

export const CARD_WIDTH = 320;
export const ALBUM_ART_SIZE = 80;
export const NUM_WAVE_BARS = 16;
export const OPEN_DELAY_MS = 150;
export const GRACE_PERIOD_MS = 250;
export const FADE_DURATION_MS = 150;
const PULSE_INTERVAL_MS = 33;
const BAR_PROFILE = [0.30, 0.45, 0.68, 0.86, 0.72, 0.56, 0.75, 1.0, 0.80, 0.58, 0.76, 0.62, 0.47, 0.36, 0.26, 0.18];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function roundedPill(cr, x, y, width, height, radius) {
    if (width <= 0 || height <= 0)
        return;
    const r = Math.min(radius, width / 2, height / 2);
    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

function toUnit(value) {
    const number = Number(value) || 0;
    return number > 1 ? number / 255 : number;
}

function progressForTrack(track) {
    const length = Number(track?.lengthMs) || 0;
    const position = Number(track?.positionMs) || 0;
    return length > 0 ? clamp(position / length, 0, 1) : 0;
}

function progressAfterKeyboardSeek(keyName, current, lengthMs) {
    if (!(lengthMs > 0))
        return null;
    const step = 5_000 / lengthMs;
    switch (keyName) {
    case 'Left': return clamp(current - step, 0, 1);
    case 'Right': return clamp(current + step, 0, 1);
    case 'Home': return 0;
    case 'End': return 1;
    default: return null;
    }
}

function seekToProgress(owner, progress, track) {
    const result = owner._mediaManager?.seek?.(Math.round(progress * track.lengthMs));
    result?.catch?.(() => {});
}

function setAccessibleName(actor, name) {
    if (typeof actor?.set_accessible_name === 'function')
        actor.set_accessible_name(name);
    else if (actor)
        actor.accessible_name = name;
}

function setTooltipText(actor, text) {
    if (typeof actor?.set_tooltip_text === 'function')
        actor.set_tooltip_text(text);
    else if (actor && 'tooltip_text' in actor)
        actor.tooltip_text = text;
}

class MockActor {
    constructor(params = {}) {
        this.x = params.x ?? 0;
        this.y = params.y ?? 0;
        this.width = params.width ?? 0;
        this.height = params.height ?? 0;
        this.opacity = params.opacity ?? 255;
        this.visible = params.visible ?? true;
        this.reactive = params.reactive ?? true;
        this.track_hover = params.track_hover ?? false;
        this.can_focus = params.can_focus ?? false;
        this.icon_size = params.icon_size ?? null;
        this.style_class = params.style_class ?? '';
        this.text = params.text ?? '';
        this.icon_name = params.icon_name ?? '';
        this.gicon = params.gicon ?? null;
        this.hover = false;
        this.children = [];
        this._signals = new Map();
        this._nextSignalId = 1;
        this._parent = null;
        this._easeOptions = [];
    }

    connect(signal, callback) {
        const id = this._nextSignalId++;
        this._signals.set(id, { signal, callback });
        return id;
    }

    disconnect(id) { this._signals.delete(id); }

    emit(signal, ...args) {
        for (const { signal: registered, callback } of [...this._signals.values()]) {
            if (registered === signal)
                callback(this, ...args);
        }
    }

    add_child(child) {
        if (!this.children.includes(child)) {
            this.children.push(child);
            child._parent = this;
        }
    }

    set_child(child) {
        for (const current of this.children.slice())
            this.remove_child(current);
        if (child)
            this.add_child(child);
    }

    remove_child(child) {
        this.children = this.children.filter(current => current !== child);
        if (child._parent === this)
            child._parent = null;
    }

    get_children() { return this.children.slice(); }
    get_parent() { return this._parent; }
    get_stage() { return { width: 1280, height: 800 }; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    set_position(x, y) { this.x = x; this.y = y; }
    show() { this.visible = true; }
    hide() { this.visible = false; }

    ease(options) {
        this._easeOptions.push({ ...options });
        if (options.opacity !== undefined)
            this.opacity = options.opacity;
        options.onComplete?.();
    }

    destroy() {
        if (this._mockActorDestroyed)
            return;
        this._mockActorDestroyed = true;
        for (const child of this.children.slice())
            child.destroy?.();
        this.children = [];
        this.emit('destroy');
        this._signals.clear();
        this._parent?.remove_child(this);
    }
}

class MockButton extends MockActor {
    constructor(params = {}) {
        super({ ...params, reactive: true, can_focus: true });
        this.tooltip_text = params.tooltip_text ?? '';
        this.accessible_name = params.accessible_name ?? this.tooltip_text;
        this.child = params.child ?? null;
        if (this.child)
            this.add_child(this.child);
    }
}

class MockLabel extends MockActor {
    constructor(params = {}) {
        super(params);
        this.clutter_text = { ellipsize: null };
        this.tooltip_text = params.tooltip_text ?? '';
    }
}

class MockWaveArea extends MockActor {
    constructor(owner) {
        super({ style_class: 'fuhgawz-media-wave-area', width: CARD_WIDTH - 128, height: 36, reactive: true, can_focus: true });
        this._owner = owner;
        this._animTimerId = 0;
        this.repaintCount = 0;
        this.progress = 0;
        this.visualizerStyle = 'wave';
        this._phase = 0;
        this._destroyed = false;
        this.accessible_name = 'Track progress';
        this.accessibleMinimumValue = 0;
        this.accessibleMaximumValue = 100;
        this.accessibleValue = 0;
    }

    update(track, status, style) {
        if (this._destroyed)
            return;
        this.progress = progressForTrack(track);
        this.accessibleValue = this.progress * 100;
        this.visualizerStyle = style;
        if (status === 'Playing' && this._owner.visible)
            this.startAnimation();
        else
            this.stopAnimation();
        this.queue_repaint();
    }

    queue_repaint() {
        if (!this._destroyed)
            this.repaintCount++;
    }

    startAnimation() {
        if (this._animTimerId || this._destroyed)
            return;
        this._animTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULSE_INTERVAL_MS, () => {
            if (this._destroyed || !this._owner.visible || this._owner._playbackStatus !== 'Playing') {
                this._animTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._phase += 0.15;
            this.progress = progressForTrack(this._owner._currentTrack());
            this.accessibleValue = this.progress * 100;
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopAnimation() {
        if (this._animTimerId) {
            GLib.source_remove(this._animTimerId);
            this._animTimerId = 0;
        }
    }

    _handleKeyboardScrub(keyName) {
        const track = this._owner._currentTrack();
        const nextProgress = progressAfterKeyboardSeek(keyName, this.progress, Number(track?.lengthMs));
        if (nextProgress === null)
            return false;
        this.progress = nextProgress;
        this.accessibleValue = this.progress * 100;
        seekToProgress(this._owner, nextProgress, track);
        this.queue_repaint();
        return true;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this.stopAnimation();
        super.destroy();
    }
}

let MediaWaveAreaClass = MockWaveArea;
if (hasStDrawingArea) {
    MediaWaveAreaClass = GObject.registerClass(
        { GTypeName: 'FUHGlobeMediaWaveArea' },
        class MediaWaveArea extends St.DrawingArea {
            _init(owner) {
                super._init({
                    style_class: 'fuhgawz-media-wave-area',
                    reactive: true,
                    can_focus: true,
                    x_expand: true,
                });
                this._owner = owner;
                this._animTimerId = 0;
                this._destroyed = false;
                this._progress = 0;
                this._phase = 0;
                this._visualizerStyle = 'wave';
                this._dragging = false;
                this._accessibleValue = null;
                this._accessibleSignalIds = [];
                this._lastAccessiblePercent = null;
                setAccessibleName(this, 'Track progress');
                this._setupAccessibleValue();
                this._repaintSignalId = this.connect('repaint', () => this._paint());
                this._pressSignalId = this.connect('button-press-event', (_area, event) => {
                    if (event.get_button() !== 1)
                        return Clutter.EVENT_PROPAGATE;
                    this._dragging = true;
                    this._seekFromEvent(event);
                    return Clutter.EVENT_STOP;
                });
                this._motionSignalId = this.connect('motion-event', (_area, event) => {
                    if (this._dragging)
                        this._seekFromEvent(event);
                    return this._dragging ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
                });
                this._releaseSignalId = this.connect('button-release-event', (_area, event) => {
                    if (event.get_button() === 1) {
                        this._dragging = false;
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
                this._themeSignalId = this.connect('style-changed', () => this.queue_repaint());
                this._destroySignalId = this.connect('destroy', () => {
                    this._destroyed = true;
                    this.stopAnimation();
                });
                this._keySignalId = this.connect('key-press-event', (_area, event) => {
                    const key = event.get_key_symbol();
                    const keyName = key === Clutter.KEY_Left ? 'Left'
                        : key === Clutter.KEY_Right ? 'Right'
                            : key === Clutter.KEY_Home ? 'Home'
                                : key === Clutter.KEY_End ? 'End' : null;
                    return this._handleKeyboardScrub(keyName)
                        ? Clutter.EVENT_STOP
                        : Clutter.EVENT_PROPAGATE;
                });
            }

            update(track, status, style) {
                if (this._destroyed)
                    return;
                this._progress = progressForTrack(track);
                this._emitAccessibleValueChanged();
                this._visualizerStyle = style;
                if (status === 'Playing' && this._owner.visible)
                    this.startAnimation();
                else
                    this.stopAnimation();
                this.queue_repaint();
            }

            startAnimation() {
                if (this._animTimerId || this._destroyed)
                    return;
                this._animTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULSE_INTERVAL_MS, () => {
                    if (this._destroyed || !this._owner.visible || this._owner._playbackStatus !== 'Playing') {
                        this._animTimerId = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    this._phase += 0.15;
                    this._progress = progressForTrack(this._owner._currentTrack());
                    this._emitAccessibleValueChanged();
                    this.queue_repaint();
                    return GLib.SOURCE_CONTINUE;
                });
            }

            stopAnimation() {
                if (this._animTimerId) {
                    GLib.source_remove(this._animTimerId);
                    this._animTimerId = 0;
                }
            }

            _handleKeyboardScrub(keyName) {
                const track = this._owner._currentTrack();
                const nextProgress = progressAfterKeyboardSeek(keyName, this._progress, Number(track?.lengthMs));
                if (nextProgress === null)
                    return false;
                this._progress = nextProgress;
                this._emitAccessibleValueChanged(true);
                seekToProgress(this._owner, nextProgress, track);
                this.queue_repaint();
                return true;
            }

            _setupAccessibleValue() {
                if (!St.GenericAccessible || Atk?.Role?.SLIDER === undefined || typeof this.set_accessible !== 'function')
                    return;
                try {
                    const accessible = St.GenericAccessible.new_for_actor(this);
                    accessible.set_role(Atk.Role.SLIDER);
                    accessible.set_name('Track progress');
                    this._accessibleSignalIds = [
                        accessible.connect('get-current-value', () => this._progress * 100),
                        accessible.connect('get-minimum-value', () => 0),
                        accessible.connect('get-maximum-value', () => 100),
                        accessible.connect('get-minimum-increment', () => 1),
                        accessible.connect('set-current-value', (_accessible, value) => {
                            const track = this._owner._currentTrack();
                            if (!(Number(track?.lengthMs) > 0))
                                return false;
                            const progress = clamp(Number(value) / 100, 0, 1);
                            this._progress = progress;
                            this._emitAccessibleValueChanged(true);
                            seekToProgress(this._owner, progress, track);
                            this.queue_repaint();
                            return true;
                        }),
                    ];
                    this._accessibleValue = accessible;
                    this.set_accessible(accessible);
                    this._emitAccessibleValueChanged(true);
                } catch (error) {
                    this._accessibleValue = null;
                    this._accessibleSignalIds = [];
                }
            }

            _emitAccessibleValueChanged(force = false) {
                if (!this._accessibleValue)
                    return;
                const value = this._progress * 100;
                const roundedValue = Math.round(value);
                if (!force && roundedValue === this._lastAccessiblePercent)
                    return;
                this._lastAccessiblePercent = roundedValue;
                try { this._accessibleValue.emit('value-changed', value, null); } catch (error) {}
            }

            _seekFromEvent(event) {
                const [stageX] = event.get_coords();
                const [actorX] = this.get_transformed_position();
                const width = this.get_surface_size()[0];
                const fraction = width > 0 ? clamp((stageX - actorX) / width, 0, 1) : 0;
                const track = this._owner._currentTrack();
                if (track?.lengthMs > 0)
                    this._owner._mediaManager?.seek(Math.round(fraction * track.lengthMs))?.catch?.(() => {});
                this._progress = fraction;
                this._emitAccessibleValueChanged(true);
                this.queue_repaint();
            }

            _paint() {
                if (this._destroyed)
                    return;
                const cr = this.get_context();
                try {
                    const [width, height] = this.get_surface_size();
                    if (width <= 0 || height <= 0)
                        return;
                    this._paintCairo(cr, width, height);
                } finally {
                    cr.$dispose();
                }
            }

            _paintCairo(cr, width, height) {
                cr.save();
                cr.setOperator(cairo.Operator.CLEAR);
                cr.paint();
                cr.restore();

                const themeNode = this.get_theme_node();
                const color = themeNode.get_foreground_color();
                const red = toUnit(color.red);
                const green = toUnit(color.green);
                const blue = toUnit(color.blue);
                const progress = clamp(this._progress, 0, 1);

                if (this._visualizerStyle === 'bar') {
                    const barHeight = 3;
                    const y = (height - barHeight) / 2;
                    cr.setSourceRGBA(red, green, blue, 0.22);
                    roundedPill(cr, 0, y, width, barHeight, barHeight / 2);
                    cr.fill();
                    cr.setSourceRGBA(red, green, blue, 1);
                    roundedPill(cr, 0, y, width * progress, barHeight, barHeight / 2);
                    cr.fill();
                    return;
                }

                const gap = 3;
                const barWidth = Math.max(2, (width - gap * (NUM_WAVE_BARS - 1)) / NUM_WAVE_BARS);
                const centerY = height / 2;
                const playing = this._owner._playbackStatus === 'Playing';
                const heights = BAR_PROFILE.map((base, index) => {
                    const pulse = playing ? 0.68 + 0.32 * Math.sin(this._phase + index * 0.73) : 0.16;
                    return Math.max(3, height * base * pulse * 0.82);
                });

                for (let index = 0; index < NUM_WAVE_BARS; index++) {
                    const x = index * (barWidth + gap);
                    const barHeight = heights[index];
                    roundedPill(cr, x, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
                    cr.setSourceRGBA(red, green, blue, 0.22);
                    cr.fill();
                }

                cr.save();
                cr.rectangle(0, 0, width * progress, height);
                cr.clip();
                for (let index = 0; index < NUM_WAVE_BARS; index++) {
                    const x = index * (barWidth + gap);
                    const barHeight = heights[index];
                    roundedPill(cr, x, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
                    cr.setSourceRGBA(red, green, blue, 1);
                    cr.fill();
                }
                cr.restore();
            }

            destroy() {
                if (this._destroyed)
                    return;
                this._destroyed = true;
                this.stopAnimation();
                for (const id of [this._repaintSignalId, this._pressSignalId, this._motionSignalId, this._releaseSignalId, this._themeSignalId, this._destroySignalId, this._keySignalId]) {
                    if (id) {
                        try { this.disconnect(id); } catch (error) {}
                    }
                }
                this._repaintSignalId = 0;
                this._pressSignalId = 0;
                this._motionSignalId = 0;
                this._releaseSignalId = 0;
                this._themeSignalId = 0;
                this._destroySignalId = 0;
                this._keySignalId = 0;
                for (const id of this._accessibleSignalIds) {
                    try { this._accessibleValue?.disconnect(id); } catch (error) {}
                }
                this._accessibleSignalIds = [];
                try { this.set_accessible(null); } catch (error) {}
                this._accessibleValue = null;
                Clutter.Actor.prototype.destroy.call(this);
            }
        }
    );
}

class MediaFloatingCardLogic {
    _initLogic(mediaManager, options = {}) {
        this._mediaManager = mediaManager;
        this._options = options;
        this._uiGroup = options.uiGroup ?? Main?.layoutManager?.uiGroup ?? Main?.uiGroup ?? null;
        this._openDelayMs = Math.max(0, options.openDelayMs ?? OPEN_DELAY_MS);
        this._gracePeriodMs = Math.max(0, options.gracePeriodMs ?? GRACE_PERIOD_MS);
        this._fadeDurationMs = Math.max(0, options.fadeDurationMs ?? FADE_DURATION_MS);
        this._anchorActor = null;
        this._anchorHoverSignalId = 0;
        this._selfHoverSignalId = 0;
        this._keySignalId = 0;
        this._keyboardFocusSignalIds = [];
        this._focusExitTimerId = 0;
        this._openTimerId = 0;
        this._graceTimerId = 0;
        this._isOpen = false;
        this._destroyed = false;
        this._playbackStatus = 'Stopped';
        this._trackInfo = null;
        this._visualizerStyle = this._readVisualizerStyle();
        this._managerSignalIds = [];
        this._settingsSignalIds = [];
        this._buttonSignals = [];
        this._recentItems = [];
        this._fadeSerial = 0;
        this._focusOnOpen = false;

        this._buildCardWidgets();
        this._selfHoverSignalId = this.connect('notify::hover', () => this._onHoverChanged());
        this._keySignalId = this.connect('key-press-event', (_actor, event) => {
            const key = event?.get_key_symbol?.();
            const keyName = key === Clutter?.KEY_Escape || event?.keyName === 'Escape' ? 'Escape' : null;
            return this._handleKeyPress(keyName)
                ? Clutter?.EVENT_STOP ?? true
                : Clutter?.EVENT_PROPAGATE ?? false;
        });
        if (this._uiGroup) {
            try {
                this._uiGroup.add_child(this);
                this._uiGroup.set_child_above_sibling?.(this, null);
            } catch (error) {
                this._uiGroup = null;
            }
        }

        if (this._mediaManager && typeof this._mediaManager.connect === 'function') {
            this._managerSignalIds.push(this._mediaManager.connect('track-changed', (_manager, track) => {
                this.updateState(track, this._mediaManager.getPlaybackStatus?.() ?? this._playbackStatus);
            }));
            this._managerSignalIds.push(this._mediaManager.connect('status-changed', (_manager, status) => {
                this.updateState(this._currentTrack(), status);
            }));
            this._managerSignalIds.push(this._mediaManager.connect('recent-updated', () => this._updateRecentTracks()));
        }
        if (this._options.settings && typeof this._options.settings.connect === 'function') {
            try {
                this._settingsSignalIds.push(this._options.settings.connect('changed::media-visualizer-style', () => {
                    if (!this._destroyed)
                        this.updateState(this._trackInfo, this._playbackStatus);
                }));
            } catch (error) {
                this._settingsSignalIds = [];
            }
        }

        this._updateRecentTracks();
        if (this._mediaManager) {
            const initialTrack = this._mediaManager.getActiveTrack?.() ?? null;
            const initialStatus = this._mediaManager.getPlaybackStatus?.() ?? 'Stopped';
            if (initialTrack || initialStatus !== 'Stopped')
                this.updateState(initialTrack, initialStatus);
        }
    }

    _readVisualizerStyle() {
        try {
            return this._options.settings?.get_string('media-visualizer-style') === 'bar' ? 'bar' : 'wave';
        } catch (error) {
            return 'wave';
        }
    }

    _buildCardWidgets() {
        if (hasStWidget) {
            this._topBox = new St.BoxLayout({ style_class: 'fuhgawz-media-top-box', x_expand: true });
            this._albumArtContainer = new St.Bin({
                style_class: 'fuhgawz-media-art',
                width: ALBUM_ART_SIZE,
                height: ALBUM_ART_SIZE,
                x_expand: false,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                clip_to_allocation: true,
            });
            this._albumArtIcon = new St.Icon({
                style_class: 'fuhgawz-media-art-icon',
                icon_name: 'audio-x-generic-symbolic',
                icon_size: 32,
            });
            this._albumArtContainer.set_child(this._albumArtIcon);
            this._topBox.add_child(this._albumArtContainer);

            this._metadataBox = new St.BoxLayout({
                style_class: 'fuhgawz-media-metadata-box',
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._titleLabel = new St.Label({ style_class: 'fuhgawz-media-title', text: 'No media playing', x_expand: true });
            this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._artistLabel = new St.Label({ style_class: 'fuhgawz-media-artist', text: '', x_expand: true });
            this._artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._metadataBox.add_child(this._titleLabel);
            this._metadataBox.add_child(this._artistLabel);

            this._controlsBox = new St.BoxLayout({ style_class: 'fuhgawz-media-controls', x_expand: true });
            this._prevBtn = this._createControlButton('media-skip-backward-symbolic', 'Previous track', () => this._invoke('previous'));
            this._playPauseBtn = this._createControlButton('media-playback-start-symbolic', 'Play or pause', () => this._invoke('playPause'), true);
            this._nextBtn = this._createControlButton('media-skip-forward-symbolic', 'Next track', () => this._invoke('next'));
            this._controlsBox.add_child(this._prevBtn);
            this._controlsBox.add_child(this._playPauseBtn);
            this._controlsBox.add_child(this._nextBtn);
            this._metadataBox.add_child(this._controlsBox);

            this._waveBox = new St.BoxLayout({ style_class: 'fuhgawz-media-wave-container', x_expand: true });
        this._waveArea = new MediaWaveAreaClass(this);
        this._watchFocusableActor(this._waveArea);
        this._waveBox.add_child(this._waveArea);
            this._metadataBox.add_child(this._waveBox);
            this._topBox.add_child(this._metadataBox);
            this.add_child(this._topBox);

            this._recentDrawer = new St.BoxLayout({
                style_class: 'fuhgawz-media-recent-drawer',
                vertical: true,
                x_expand: true,
                visible: false,
            });
            this._recentTitle = new St.Label({ style_class: 'fuhgawz-media-recent-title', text: 'Recently played' });
            this._recentListBox = new St.BoxLayout({ style_class: 'fuhgawz-media-recent-list', vertical: true, x_expand: true });
            this._recentDrawer.add_child(this._recentTitle);
            this._recentDrawer.add_child(this._recentListBox);
            this.add_child(this._recentDrawer);
            return;
        }

        this.width = CARD_WIDTH;
        this.height = 240;
        this._topBox = new MockActor({ style_class: 'fuhgawz-media-top-box' });
        this._albumArtContainer = new MockActor({ style_class: 'fuhgawz-media-art', width: ALBUM_ART_SIZE, height: ALBUM_ART_SIZE });
        this._albumArtIcon = new MockActor({ style_class: 'fuhgawz-media-art-icon', icon_name: 'audio-x-generic-symbolic' });
        this._albumArtContainer.set_child(this._albumArtIcon);
        this._metadataBox = new MockActor({ style_class: 'fuhgawz-media-metadata-box' });
        this._titleLabel = new MockLabel({ style_class: 'fuhgawz-media-title', text: 'No media playing' });
        this._artistLabel = new MockLabel({ style_class: 'fuhgawz-media-artist' });
        this._controlsBox = new MockActor({ style_class: 'fuhgawz-media-controls' });
        this._prevBtn = this._createControlButton('media-skip-backward-symbolic', 'Previous track', () => this._invoke('previous'));
        this._playPauseBtn = this._createControlButton('media-playback-start-symbolic', 'Play or pause', () => this._invoke('playPause'), true);
        this._nextBtn = this._createControlButton('media-skip-forward-symbolic', 'Next track', () => this._invoke('next'));
        this._waveBox = new MockActor({ style_class: 'fuhgawz-media-wave-container' });
        this._waveArea = new MockWaveArea(this);
        this._watchFocusableActor(this._waveArea);
        this._waveBox.add_child(this._waveArea);
        this._metadataBox.add_child(this._titleLabel);
        this._metadataBox.add_child(this._artistLabel);
        this._metadataBox.add_child(this._controlsBox);
        this._metadataBox.add_child(this._waveBox);
        this._topBox.add_child(this._albumArtContainer);
        this._topBox.add_child(this._metadataBox);
        this.add_child(this._topBox);
        this._recentDrawer = new MockActor({ style_class: 'fuhgawz-media-recent-drawer', visible: false });
        this._recentTitle = new MockLabel({ style_class: 'fuhgawz-media-recent-title', text: 'Recently played' });
        this._recentListBox = new MockActor({ style_class: 'fuhgawz-media-recent-list' });
        this._recentDrawer.add_child(this._recentTitle);
        this._recentDrawer.add_child(this._recentListBox);
        this.add_child(this._recentDrawer);
    }

    _createControlButton(iconName, tooltip, callback, primary = false) {
        const styleClass = primary
            ? 'fuhgawz-media-ctrl-btn fuhgawz-media-play-btn'
            : 'fuhgawz-media-ctrl-btn';
        if (hasStWidget) {
            const iconSize = 16;
            const icon = new St.Icon({ icon_name: iconName, icon_size: iconSize });
            const button = new St.Button({
                style_class: styleClass,
                child: icon,
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            setAccessibleName(button, tooltip);
            setTooltipText(button, tooltip);
            const id = button.connect('clicked', callback);
            this._buttonSignals.push([button, id]);
            this._watchFocusableActor(button);
            if (primary)
                this._playPauseIcon = icon;
            return button;
        }
        const icon = new MockActor({ icon_name: iconName, icon_size: 16 });
        const button = new MockButton({ style_class: styleClass, child: icon, tooltip_text: tooltip, accessible_name: tooltip });
        const id = button.connect('clicked', callback);
        this._buttonSignals.push([button, id]);
        this._watchFocusableActor(button);
        if (primary)
            this._playPauseIcon = icon;
        return button;
    }

    _invoke(method, ...args) {
        try {
            const result = this._mediaManager?.[method]?.(...args);
            result?.catch?.(() => {});
            return result;
        } catch (error) {
            return null;
        }
    }

    _currentTrack() {
        return this._mediaManager?.getActiveTrack?.() ?? this._trackInfo;
    }

    _setText(label, value) {
        if (!label)
            return;
        const text = value ?? '';
        if (typeof label.set_text === 'function')
            label.set_text(text);
        else
            label.text = text;
        label.tooltip_text = text;
    }

    _setIcon(icon, name) {
        if (!icon)
            return;
        if (typeof icon.set_icon_name === 'function')
            icon.set_icon_name(name);
        else
            icon.icon_name = name;
    }

    _setArtwork(track) {
        const path = track?.cachedArtUrl;
        if (path && Gio.File.new_for_path(path).query_exists(null)) {
            try {
                const fileIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(path) });
                if (typeof this._albumArtIcon.set_gicon === 'function')
                    this._albumArtIcon.set_gicon(fileIcon);
                else
                    this._albumArtIcon.gicon = fileIcon;
                this._albumArtIcon.icon_size = ALBUM_ART_SIZE;
                return;
            } catch (error) {
                // Keep the player icon when an artwork file is unreadable.
            }
        }
        const player = track?.player ?? '';
        this._albumArtIcon.gicon = null;
        this._setIcon(this._albumArtIcon, player.toLowerCase().includes('spotify')
            ? 'audio-x-generic-symbolic'
            : 'audio-x-generic-symbolic');
        this._albumArtIcon.icon_size = 32;
    }

    updateState(trackInfo, playbackStatus = 'Stopped') {
        if (this._destroyed)
            return;
        this._trackInfo = trackInfo ? { ...trackInfo } : null;
        this._playbackStatus = playbackStatus || 'Stopped';
        this._visualizerStyle = this._readVisualizerStyle();

        this._setText(this._titleLabel, this._trackInfo?.title || 'No media playing');
        const artist = this._trackInfo?.artist || '';
        const album = this._trackInfo?.album || '';
        this._setText(this._artistLabel, artist && album ? `${artist} · ${album}` : (artist || album));
        this._setArtwork(this._trackInfo);

        const playing = this._playbackStatus === 'Playing';
        const iconName = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._setIcon(this._playPauseIcon, iconName);
        const playPauseLabel = playing ? 'Pause playback' : 'Resume playback';
        setAccessibleName(this._playPauseBtn, playPauseLabel);
        setTooltipText(this._playPauseBtn, playPauseLabel);
        this._waveArea.update(this._trackInfo, this._playbackStatus, this._visualizerStyle);
    }

    _updateRecentTracks() {
        if (!this._recentListBox || this._destroyed)
            return;
        const tracks = (this._mediaManager?.getRecentTracks?.() ?? []).slice(0, 3);
        for (const item of this._recentItems) {
            this._unwatchFocusableActor(item);
            const signalIndex = this._buttonSignals.findIndex(([actor]) => actor === item);
            if (signalIndex >= 0) {
                const [, signalId] = this._buttonSignals[signalIndex];
                try { item.disconnect(signalId); } catch (error) {}
                this._buttonSignals.splice(signalIndex, 1);
            }
            item.destroy?.();
        }
        this._recentItems = [];

        for (const track of tracks) {
            const button = this._createRecentButton(track);
            this._recentItems.push(button);
            this._recentListBox.add_child(button);
        }
        this._recentDrawer.visible = tracks.length > 0;
    }

    _createRecentButton(track) {
        const title = track.title || 'Unknown track';
        const description = track.artist ? `${title} · ${track.artist}` : title;
        if (hasStWidget) {
            const label = new St.Label({ style_class: 'fuhgawz-media-recent-label', text: description, x_expand: true });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const button = new St.Button({
                style_class: 'fuhgawz-media-recent-item',
                child: label,
                reactive: true,
                can_focus: true,
            });
            setAccessibleName(button, `Play ${description}`);
            setTooltipText(button, description);
            const id = button.connect('clicked', () => this._invoke('playRecentTrack', track));
            this._buttonSignals.push([button, id]);
            this._watchFocusableActor(button);
            return button;
        }
        const button = new MockButton({ style_class: 'fuhgawz-media-recent-item', text: description, tooltip_text: description, accessible_name: `Play ${description}` });
        const id = button.connect('clicked', () => this._invoke('playRecentTrack', track));
        this._buttonSignals.push([button, id]);
        this._watchFocusableActor(button);
        return button;
    }

    showForActor(anchorActor, trackInfo = null, playbackStatus = null) {
        if (this._destroyed || !anchorActor)
            return;
        if (this._anchorActor !== anchorActor)
            this._setAnchor(anchorActor);
        const currentTrack = trackInfo ?? this._mediaManager?.getActiveTrack?.() ?? this._trackInfo;
        const currentStatus = playbackStatus ?? this._mediaManager?.getPlaybackStatus?.() ?? this._playbackStatus;
        this.updateState(currentTrack, currentStatus);
        this._cancelGraceTimer();
        if (this._isOpen) {
            this._positionCard();
            return;
        }
        if (!this._openTimerId) {
            this._openTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._openDelayMs, () => {
                this._openTimerId = 0;
                if (this._destroyed || !this._anchorActor)
                    return GLib.SOURCE_REMOVE;
                this._openCard();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    showForKeyboardActor(anchorActor, trackInfo = null, playbackStatus = null) {
        if (this._destroyed || !anchorActor)
            return;
        const alreadyOpen = this._isOpen;
        this._focusOnOpen = !alreadyOpen;
        this._cancelKeyboardFocusClose();
        this.showForActor(anchorActor, trackInfo, playbackStatus);
        if (alreadyOpen) {
            this._focusOnOpen = false;
            return;
        }
        if (this._openTimerId) {
            GLib.source_remove(this._openTimerId);
            this._openTimerId = 0;
            this._openCard();
        }
    }

    _focusFirstControl() {
        const stage = typeof global !== 'undefined' ? global.stage : null;
        if (stage?.set_key_focus && this._prevBtn)
            stage.set_key_focus(this._prevBtn);
    }

    _watchFocusableActor(actor) {
        if (typeof actor?.connect !== 'function')
            return;
        for (const signal of ['key-focus-in', 'key-focus-out']) {
            try {
                const id = actor.connect(signal, () => {
                    if (signal === 'key-focus-in')
                        this._cancelKeyboardFocusClose();
                    else
                        this.scheduleKeyboardFocusClose();
                });
                this._keyboardFocusSignalIds.push([actor, id]);
            } catch (error) {
                // Some non-Shell actors used by headless tests do not expose key focus signals.
            }
        }
    }

    _unwatchFocusableActor(actor) {
        const keep = [];
        for (const [registeredActor, id] of this._keyboardFocusSignalIds) {
            if (registeredActor === actor) {
                try { registeredActor.disconnect(id); } catch (error) {}
            } else {
                keep.push([registeredActor, id]);
            }
        }
        this._keyboardFocusSignalIds = keep;
    }

    _cancelKeyboardFocusClose() {
        if (this._focusExitTimerId) {
            GLib.source_remove(this._focusExitTimerId);
            this._focusExitTimerId = 0;
        }
    }

    scheduleKeyboardFocusClose() {
        if (this._focusExitTimerId || this._destroyed || !this._isOpen)
            return;
        this._focusExitTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._gracePeriodMs, () => {
            this._focusExitTimerId = 0;
            if (this._destroyed || !this._isOpen)
                return GLib.SOURCE_REMOVE;
            const stage = typeof global !== 'undefined' ? global.stage : null;
            const focusedActor = stage?.get_key_focus?.() ?? null;
            const pointerIsInside = Boolean(this.hover || this._anchorActor?.hover);
            const keyboardIsInside = focusedActor === this._anchorActor || this._isActorInsideCard(focusedActor);
            if (!pointerIsInside && !keyboardIsInside)
                this.hideCard();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isActorInsideCard(actor) {
        let current = actor;
        while (current) {
            if (current === this)
                return true;
            current = current.get_parent?.() ?? current._parent ?? null;
        }
        return false;
    }

    _hasKeyboardFocus() {
        const stage = typeof global !== 'undefined' ? global.stage : null;
        const focusedActor = stage?.get_key_focus?.() ?? null;
        return focusedActor === this._anchorActor || this._isActorInsideCard(focusedActor);
    }

    _handleKeyPress(keyName) {
        if (keyName !== 'Escape')
            return false;
        const stage = typeof global !== 'undefined' ? global.stage : null;
        const focusedActor = stage?.get_key_focus?.() ?? null;
        const restoreFocus = this._isActorInsideCard(focusedActor);
        const anchor = this._anchorActor;
        this.hideCard();
        if (restoreFocus && anchor && stage?.set_key_focus) {
            anchor.suppressNextKeyboardCardOpen?.();
            stage.set_key_focus(anchor);
        }
        return true;
    }

    _setAnchor(actor) {
        if (this._anchorActor && this._anchorHoverSignalId) {
            try { this._anchorActor.disconnect(this._anchorHoverSignalId); } catch (error) {}
        }
        this._anchorActor = actor;
        this._anchorHoverSignalId = actor.connect('notify::hover', () => this._onHoverChanged());
    }

    _onHoverChanged() {
        if (this._destroyed)
            return;
        if (this._anchorActor?.hover || this.hover || this._hasKeyboardFocus()) {
            this._cancelGraceTimer();
            this._cancelKeyboardFocusClose();
            return;
        }
        if (this._openTimerId) {
            GLib.source_remove(this._openTimerId);
            this._openTimerId = 0;
        }
        if (this._isOpen)
            this._startGraceTimer();
    }

    _startGraceTimer() {
        if (this._graceTimerId || this._destroyed)
            return;
        this._graceTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._gracePeriodMs, () => {
            this._graceTimerId = 0;
            if (!this._anchorActor?.hover && !this.hover && !this._hasKeyboardFocus())
                this.hideCard();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelGraceTimer() {
        if (this._graceTimerId) {
            GLib.source_remove(this._graceTimerId);
            this._graceTimerId = 0;
        }
    }

    _monitorBounds() {
        const monitors = Main?.layoutManager?.monitors ?? [];
        if (monitors.length) {
            const point = this._anchorActor?.get_transformed_position?.() ?? [0, 0];
            return monitors.find(monitor => point[0] >= monitor.x && point[0] < monitor.x + monitor.width) ??
                Main.layoutManager.primaryMonitor ?? monitors[0];
        }
        const stage = this._anchorActor?.get_stage?.() ?? global.stage;
        return { x: 0, y: 0, width: stage?.width ?? CARD_WIDTH + 24, height: stage?.height ?? 600 };
    }

    _positionCard() {
        if (!this._anchorActor)
            return;

        const monitor = this._monitorBounds();
        const monitorX = Number.isFinite(Number(monitor?.x)) ? Number(monitor.x) : 0;
        const monitorY = Number.isFinite(Number(monitor?.y)) ? Number(monitor.y) : 0;
        const monitorWidth = Number.isFinite(Number(monitor?.width)) && Number(monitor.width) > 0
            ? Number(monitor.width)
            : CARD_WIDTH + 24;
        const monitorHeight = Number.isFinite(Number(monitor?.height)) && Number(monitor.height) > 0
            ? Number(monitor.height)
            : 600;

        let anchorX = monitorX + monitorWidth / 2;
        let anchorY = monitorY;
        let anchorWidth = 0;
        let anchorHeight = 0;
        try {
            [anchorX, anchorY] = this._anchorActor.get_transformed_position();
            [anchorWidth, anchorHeight] = this._anchorActor.get_transformed_size();
        } catch (error) {
            const extents = this._anchorActor.get_transformed_extents?.();
            anchorX = extents?.x ?? this._anchorActor.x ?? 0;
            anchorY = extents?.y ?? this._anchorActor.y ?? 0;
            anchorWidth = extents?.width ?? this._anchorActor.width ?? 0;
            anchorHeight = extents?.height ?? this._anchorActor.height ?? 0;
        }

        if (!Number.isFinite(anchorX))
            anchorX = monitorX + monitorWidth / 2;
        if (!Number.isFinite(anchorY))
            anchorY = monitorY;
        if (!Number.isFinite(anchorWidth) || anchorWidth < 0)
            anchorWidth = 0;
        if (!Number.isFinite(anchorHeight) || anchorHeight < 0)
            anchorHeight = 0;

        const measuredWidth = this.get_width?.() || this.width || CARD_WIDTH;
        const measuredHeight = this.get_height?.() || this.height || 240;
        const width = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : CARD_WIDTH;
        const height = Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 240;
        const margin = 12;
        const minX = monitorX + margin;
        const maxX = Math.max(minX, monitorX + monitorWidth - width - margin);
        const x = clamp(anchorX + anchorWidth / 2 - width / 2, minX, maxX);
        const below = anchorY + anchorHeight + 8;
        const minY = monitorY + margin;
        const maxY = Math.max(minY, monitorY + monitorHeight - height - margin);
        const y = below <= maxY ? Math.max(minY, below) : clamp(anchorY - height - 8, minY, maxY);
        this.set_position?.(Math.round(x), Math.round(y));
    }

    _openCard() {
        this._positionCard();
        this.visible = true;
        this._isOpen = true;
        this._fadeSerial++;
        this._easeOpacity(255);
        this._waveArea.update(this._trackInfo, this._playbackStatus, this._visualizerStyle);
        if (this._focusOnOpen) {
            this._focusOnOpen = false;
            this._focusFirstControl();
        }
    }

    _easeOpacity(opacity) {
        if (typeof this.ease === 'function') {
            const serial = this._fadeSerial;
            this.ease({
                opacity,
                duration: this._fadeDurationMs,
                mode: Clutter?.AnimationMode?.EASE_OUT_QUAD,
                onComplete: () => {
                    if (opacity === 0 && !this._isOpen && serial === this._fadeSerial)
                        this.visible = false;
                },
            });
        } else {
            this.opacity = opacity;
            if (opacity === 0)
                this.visible = false;
        }
    }

    hideCard() {
        if (this._destroyed)
            return;
        if (this._openTimerId) {
            GLib.source_remove(this._openTimerId);
            this._openTimerId = 0;
        }
        this._cancelGraceTimer();
        this._cancelKeyboardFocusClose();
        if (!this._isOpen && !this.visible)
            return;
        this._isOpen = false;
        this._fadeSerial++;
        this._waveArea.stopAnimation();
        this._easeOpacity(0);
    }

    isOpen() {
        return this._isOpen;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._isOpen = false;
        if (this._openTimerId)
            GLib.source_remove(this._openTimerId);
        if (this._graceTimerId)
            GLib.source_remove(this._graceTimerId);
        this._openTimerId = 0;
        this._graceTimerId = 0;
        this._cancelKeyboardFocusClose();

        if (this._anchorActor && this._anchorHoverSignalId) {
            try { this._anchorActor.disconnect(this._anchorHoverSignalId); } catch (error) {}
        }
        this._anchorHoverSignalId = 0;
        this._anchorActor = null;
        if (this._selfHoverSignalId) {
            try { this.disconnect(this._selfHoverSignalId); } catch (error) {}
            this._selfHoverSignalId = 0;
        }
        if (this._keySignalId) {
            try { this.disconnect(this._keySignalId); } catch (error) {}
            this._keySignalId = 0;
        }
        if (this._mediaManager && typeof this._mediaManager.disconnect === 'function') {
            for (const id of this._managerSignalIds) {
                try { this._mediaManager.disconnect(id); } catch (error) {}
            }
        }
        this._managerSignalIds = [];
        if (this._options.settings && typeof this._options.settings.disconnect === 'function') {
            for (const id of this._settingsSignalIds) {
                try { this._options.settings.disconnect(id); } catch (error) {}
            }
        }
        this._settingsSignalIds = [];
        for (const [actor, id] of this._buttonSignals) {
            try { actor.disconnect(id); } catch (error) {}
        }
        this._buttonSignals = [];
        for (const [actor, id] of this._keyboardFocusSignalIds) {
            try { actor.disconnect(id); } catch (error) {}
        }
        this._keyboardFocusSignalIds = [];

        // Disconnect actor signals before disposing the actors. St actors can
        // become unusable immediately after destroy(), so teardown must not
        // call disconnect() on the waveform or recent-row actors afterward.
        this._waveArea?.destroy?.();

        for (const item of this._recentItems)
            item.destroy?.();
        this._recentItems = [];
        if (this._uiGroup) {
            try { this._uiGroup.remove_child(this); } catch (error) {}
        }
        this._uiGroup = null;
        this._mediaManager = null;

        if (hasStWidget)
            Clutter.Actor.prototype.destroy.call(this);
        else
            MockActor.prototype.destroy.call(this);
    }
}

let MediaFloatingCardClass;
if (hasStWidget) {
    MediaFloatingCardClass = GObject.registerClass(
        { GTypeName: 'FUHGlobeMediaFloatingCard' },
        class MediaFloatingCard extends St.BoxLayout {
            _init(mediaManager = null, options = {}) {
                super._init({
                    style_class: 'popup-menu popup-menu-content fuhgawz-media-popover-card',
                    vertical: true,
                    reactive: true,
                    track_hover: true,
                    width: CARD_WIDTH,
                    visible: false,
                    opacity: 0,
                });
                this._initLogic(mediaManager, options);
            }
        }
    );
} else {
    MediaFloatingCardClass = class MediaFloatingCard extends MockActor {
        constructor(mediaManager = null, options = {}) {
            super({
                style_class: 'popup-menu popup-menu-content fuhgawz-media-popover-card',
                vertical: true,
                reactive: true,
                track_hover: true,
                width: CARD_WIDTH,
                height: 240,
                visible: false,
                opacity: 0,
            });
            this._initLogic(mediaManager, options);
        }
    };
}

for (const name of Object.getOwnPropertyNames(MediaFloatingCardLogic.prototype)) {
    if (name === 'constructor')
        continue;
    Object.defineProperty(MediaFloatingCardClass.prototype, name,
        Object.getOwnPropertyDescriptor(MediaFloatingCardLogic.prototype, name));
}

export const MediaWaveArea = MediaWaveAreaClass;
export const MediaFloatingCard = MediaFloatingCardClass;
