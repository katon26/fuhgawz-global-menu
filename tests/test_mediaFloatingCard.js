import GLib from 'gi://GLib';
import { MediaFloatingCard, NUM_WAVE_BARS, OPEN_DELAY_MS, GRACE_PERIOD_MS } from '../src/mediaFloatingCard.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(`Assertion failed: ${message}`);
}

function wait(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

class MockActor {
    constructor(x = 0, y = 0, width = 32, height = 24, stageWidth = 1280, stageHeight = 800) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.stageWidth = stageWidth;
        this.stageHeight = stageHeight;
        this.visible = true;
        this.opacity = 255;
        this.hover = false;
        this.children = [];
        this._parent = null;
        this._signals = new Map();
        this._nextSignal = 1;
        this._easeOptions = [];
    }

    connect(signal, callback) {
        const id = this._nextSignal++;
        this._signals.set(id, { signal, callback });
        return id;
    }

    disconnect(id) { this._signals.delete(id); }

    emit(signal, ...args) {
        for (const { signal: registered, callback } of this._signals.values()) {
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

    remove_child(child) {
        this.children = this.children.filter(candidate => candidate !== child);
        if (child._parent === this)
            child._parent = null;
    }

    get_children() { return this.children.slice(); }
    get_parent() { return this._parent; }
    get_stage() { return { width: this.stageWidth, height: this.stageHeight }; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    set_position(x, y) { this.x = x; this.y = y; }
    show() { this.visible = true; }
    hide() { this.visible = false; }

    ease(options) {
        this._easeOptions.push({ ...options });
        this.opacity = options.opacity;
        options.onComplete?.();
    }

    destroy() {
        for (const child of this.children.slice())
            child.destroy?.();
        this.children = [];
        this._signals.clear();
        this._parent?.remove_child(this);
        this._destroyed = true;
        this.emit('destroy');
    }
}

class MockMediaManager {
    constructor() {
        this.handlers = new Map();
        this.nextId = 1;
        this.recent = [
            { title: 'Black Hole Sun', artist: 'Soundgarden', trackId: '/track/1', player: 'org.mpris.MediaPlayer2.spotify' },
            { title: 'Spoonman', artist: 'Soundgarden', trackId: '/track/2', player: 'org.mpris.MediaPlayer2.spotify' },
            { title: 'Fell on Black Days', artist: 'Soundgarden', trackId: '/track/3', player: 'org.mpris.MediaPlayer2.spotify' },
            { title: 'Fourth track', artist: 'Soundgarden', trackId: '/track/4', player: 'org.mpris.MediaPlayer2.spotify' },
        ];
        this.calls = [];
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, { signal, callback });
        return id;
    }

    disconnect(id) { this.handlers.delete(id); }
    getActiveTrack() { return this.track ?? null; }
    getPlaybackStatus() { return this.status ?? 'Stopped'; }
    getRecentTracks() { return this.recent.map(track => ({ ...track })); }
    previous() { this.calls.push('previous'); }
    playPause() { this.calls.push('playPause'); }
    next() { this.calls.push('next'); }
    seek(positionMs) { this.calls.push(['seek', positionMs]); }
    playRecentTrack(track) { this.calls.push(['recent', track.title]); }

    emit(signal, value) {
        for (const { signal: registered, callback } of this.handlers.values()) {
            if (registered === signal)
                callback(this, value);
        }
    }
}

class MockSettings {
    constructor() {
        this.style = 'wave';
        this.handlers = new Map();
        this.nextId = 1;
    }
    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, { signal, callback });
        return id;
    }
    disconnect(id) { this.handlers.delete(id); }
    get_string(key) { return key === 'media-visualizer-style' ? this.style : ''; }
    setVisualizerStyle(style) {
        this.style = style;
        for (const { signal, callback } of this.handlers.values()) {
            if (signal === 'changed::media-visualizer-style')
                callback(this, 'media-visualizer-style');
        }
    }
}

console.log('Testing MediaFloatingCard layout, interaction, painting, and cleanup...');
assert(NUM_WAVE_BARS === 16, 'visualizer must draw 16 bars');
assert(OPEN_DELAY_MS === 150, 'hover open delay must be 150ms');
assert(GRACE_PERIOD_MS === 250, 'card grace period must be 250ms');

const manager = new MockMediaManager();
const uiGroup = new MockActor(0, 0, 1280, 800);
const settings = new MockSettings();
const card = new MediaFloatingCard(manager, { uiGroup, settings });
assert(card instanceof MediaFloatingCard, 'card must be constructible in headless test mode');
const originalArtworkIcon = card._albumArtIcon;
const statefulArtworkIcon = {
    icon_name: null,
    icon_size: 0,
    set_icon_name(name) { this.icon_name = name; },
};
Object.defineProperty(statefulArtworkIcon, 'gicon', {
    get() { return this._gicon ?? null; },
    set(value) {
        this._gicon = value;
        if (value === null)
            this.icon_name = null;
    },
});
card._albumArtIcon = statefulArtworkIcon;
card._setArtwork({ title: 'Fallback art', player: 'org.mpris.MediaPlayer2.example' });
assert(statefulArtworkIcon.icon_name === 'audio-x-generic-symbolic',
    'missing album artwork must retain a visible symbolic fallback icon');
card._albumArtIcon = originalArtworkIcon;
assert(card.style_class.includes('popup-menu-content'),
    'media card must inherit the active GNOME popup surface colors');
assert(!card.visible && card.opacity === 0, 'card must start hidden and transparent');
assert(card._topBox.children.includes(card._albumArtContainer), 'album art must be in the top row');
assert(card._topBox.children.includes(card._metadataBox), 'metadata must sit beside the art');
assert(card._albumArtContainer.width === 80 && card._albumArtContainer.height === 80,
    'album art must be sized to the approved 80×80 thumbnail');
assert(card._metadataBox.children.indexOf(card._controlsBox) > card._metadataBox.children.indexOf(card._artistLabel),
    'controls must follow track title and artist metadata');
assert(card._metadataBox.children.indexOf(card._waveBox) > card._metadataBox.children.indexOf(card._controlsBox),
    'visualizer must sit below playback controls');
assert(card._recentItems.length === 3, 'recent drawer must show at most three items');
assert(card._prevBtn.reactive && card._playPauseBtn.reactive && card._nextBtn.reactive,
    'transport controls must be pointer reactive');
assert(card._prevBtn.can_focus && card._playPauseBtn.can_focus && card._nextBtn.can_focus,
    'transport controls must be keyboard focusable');
assert(card._prevBtn.accessible_name === 'Previous track' &&
    card._playPauseBtn.accessible_name === 'Play or pause' &&
    card._nextBtn.accessible_name === 'Next track',
    'icon-only transport buttons must have descriptive accessible names');
assert(card._prevBtn.children[0].icon_size === 16 &&
    card._playPauseBtn.children[0].icon_size === 16 &&
    card._nextBtn.children[0].icon_size === 16,
    'transport controls must use the standard 16px symbolic icon size');
const buttonSignalCount = card._buttonSignals.length;
const focusSignalCount = card._keyboardFocusSignalIds.length;
for (let index = 0; index < 10; index++)
    manager.emit('recent-updated', []);
assert(card._buttonSignals.length === buttonSignalCount,
    'refreshing recent tracks must not retain signal handlers for destroyed rows');
assert(card._keyboardFocusSignalIds.length === focusSignalCount,
    'refreshing recent tracks must disconnect focus handlers from destroyed rows');

card._prevBtn.emit('clicked');
card._playPauseBtn.emit('clicked');
card._nextBtn.emit('clicked');
card._recentItems[0].emit('clicked');
assert(manager.calls.map(call => Array.isArray(call) ? call[0] : call).join(',') ===
    'previous,playPause,next,recent', 'card controls and recent rows must call MediaManager');

const anchor = new MockActor(1240, 10, 30, 24);
anchor.hover = true;
card.showForActor(anchor, {
    title: 'Flower', artist: 'Soundgarden', album: 'Superunknown',
    playerTitle: 'Music', lengthMs: 240_000, positionMs: 30_000,
}, 'Playing');
assert(card._playPauseBtn.tooltip_text === 'Pause playback',
    'playback-state changes must update the play button description');
assert(!card.isOpen(), 'card must wait for the hover-open delay');
assert(card._openTimerId > 0, 'hover enter must create an open-delay timeout');
await wait(OPEN_DELAY_MS + 50);
assert(card.isOpen() && card.visible, 'card must open after the 150ms delay');
assert(card._waveArea._animTimerId > 0, 'playing state must schedule wave repaint pulses');
assert(card._waveArea.can_focus, 'track progress must be reachable with keyboard navigation');
assert(card._waveArea.accessible_name === 'Track progress',
    'track progress must expose a descriptive accessible name');
assert(card._waveArea.accessibleMinimumValue === 0 && card._waveArea.accessibleMaximumValue === 100,
    'track progress must expose a bounded accessible slider range');
assert(Math.abs(card._waveArea.accessibleValue - 12.5) < 0.01,
    'track progress must expose its current percentage to assistive technology');
assert(card.x <= 1280 - 12 - 320, `card must clamp within the monitor right edge (x=${card.x})`);
assert(card._easeOptions.some(({ opacity }) => opacity === 255), 'opening must use an opacity transition');
settings.setVisualizerStyle('bar');
assert(card._waveArea.visualizerStyle === 'bar', 'changing the visualizer preference must update the open card immediately');
settings.setVisualizerStyle('wave');
assert(card._waveArea.visualizerStyle === 'wave', 'the wave preference must be restored without reopening the card');

const repaintCount = card._waveArea.repaintCount;
manager.track = { title: 'Flower', lengthMs: 240_000, positionMs: 90_000 };
await wait(OPEN_DELAY_MS / 3);
assert(card._waveArea.accessibleValue > 12.5,
    'playback animation must notify assistive technology when progress advances');
manager.track = null;
const repaintCountAfterAccessibleProgress = card._waveArea.repaintCount;
await wait(OPEN_DELAY_MS / 3);
assert(card._waveArea.repaintCount > repaintCountAfterAccessibleProgress &&
    repaintCountAfterAccessibleProgress > repaintCount,
    'playing animation must queue Cairo repaints');

anchor.hover = false;
anchor.emit('notify::hover');
assert(card._graceTimerId > 0, 'leaving the anchor must start the 250ms grace period');
await wait(80);
card.hover = true;
card.emit('notify::hover');
await wait(GRACE_PERIOD_MS);
assert(card.isOpen(), 'entering the card must cancel its grace-period close');

card.updateState({ title: 'Flower', artist: 'Soundgarden', lengthMs: 240_000, positionMs: 60_000 }, 'Paused');
assert(Math.abs(card._waveArea.accessibleValue - 25) < 0.01,
    'accessible slider value must follow playback progress updates');
assert(card._waveArea._animTimerId === 0, 'paused playback must stop animation timers');
const repaintsBeforeUpdate = card._waveArea.repaintCount;
card.updateState({ title: 'Flower (Live)', artist: 'Soundgarden', lengthMs: 240_000, positionMs: 80_000 }, 'Paused');
assert(card._waveArea.repaintCount > repaintsBeforeUpdate, 'track-position changes must repaint progress');
assert(card._waveArea._handleKeyboardScrub('Right'), 'right arrow must be handled by the seek control');
assert(Math.abs(card._waveArea.progress - (80_000 + 5_000) / 240_000) < 0.001,
    'right arrow must advance seeking by five seconds');
assert(manager.calls.at(-1)[0] === 'seek' && manager.calls.at(-1)[1] === 85_000,
    'right arrow must send the new position to MediaManager');
assert(Math.abs(card._waveArea.accessibleValue - (85_000 / 240_000 * 100)) < 0.01,
    'keyboard seeking must update the accessible slider value');
assert(card._waveArea._handleKeyboardScrub('Home'), 'Home must seek to the track start');
assert(manager.calls.at(-1)[1] === 0, 'Home must seek to zero');
assert(card._waveArea._handleKeyboardScrub('End'), 'End must seek to the track end');
assert(manager.calls.at(-1)[1] === 240_000, 'End must seek to the track duration');
assert(!card._waveArea._handleKeyboardScrub('Escape'), 'unhandled keys must propagate');

card.hover = false;
card.emit('notify::hover');
await wait(GRACE_PERIOD_MS + 50);
assert(!card.isOpen() && !card.visible, 'leaving both anchor and card must close after the grace period');
assert(card._easeOptions.some(({ opacity }) => opacity === 0), 'closing must fade the card opacity');

card.showForActor(anchor, { title: 'Keyboard playback' }, 'Playing');
await wait(OPEN_DELAY_MS + 50);
assert(card.isOpen(), 'card must be available for keyboard interaction after opening');
card.emit('key-press-event', { keyName: 'Escape' });
assert(!card.isOpen() && !card.visible, 'Escape must close the transient media card');

let focusHandoffCount = 0;
card._focusFirstControl = () => focusHandoffCount++;
card.showForKeyboardActor(anchor, { title: 'Keyboard playback' }, 'Playing');
assert(card.isOpen() && card._openTimerId === 0,
    'keyboard focus must open the card immediately without a hover delay');
assert(focusHandoffCount === 1,
    'opening from keyboard focus must hand focus to the transport controls');
card.showForKeyboardActor(anchor, { title: 'Keyboard playback' }, 'Playing');
assert(focusHandoffCount === 1,
    'focusing the anchor while the card is already open must preserve the current control focus');
card.emit('key-press-event', { keyName: 'Escape' });
assert(!card.isOpen(), 'Escape must close a card opened from keyboard focus');

card.showForActor(anchor, { title: 'Pending' }, 'Playing');
assert(card._openTimerId > 0, 'a new hover must schedule its open timeout');
const signalCount = manager.handlers.size;
assert(card._keyboardFocusSignalIds.some(([actor]) => actor === card._waveArea),
    'the track progress actor must be included in keyboard-focus signal cleanup');
let focusDisconnectAfterWaveDestroy = false;
const originalWaveDisconnect = card._waveArea.disconnect.bind(card._waveArea);
card._waveArea.disconnect = id => {
    if (card._waveArea._destroyed)
        focusDisconnectAfterWaveDestroy = true;
    originalWaveDisconnect(id);
};
const unallocatedAnchor = new MockActor(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
card.showForKeyboardActor(unallocatedAnchor, { title: 'Pending' }, 'Playing');
assert(Number.isFinite(card.x) && Number.isFinite(card.y),
    'opening from an anchor without allocated geometry must use a safe finite position');
card.destroy();
assert(!focusDisconnectAfterWaveDestroy,
    'destroy must disconnect focus handlers before disposing their actors');
assert(card._destroyed, 'destroy must set its destroyed state');
assert(card._openTimerId === 0 && card._graceTimerId === 0, 'destroy must clear hover timeouts');
assert(card._waveArea._animTimerId === 0, 'destroy must clear the wave animation timeout');
assert(manager.handlers.size === 0 && signalCount > 0, 'destroy must disconnect manager signals');
assert(settings.handlers.size === 0, 'destroy must disconnect the visualizer settings signal');
assert(!uiGroup.children.includes(card), 'destroy must unparent the card from the shared UI group');

console.log('MediaFloatingCard test suite passed successfully!');
