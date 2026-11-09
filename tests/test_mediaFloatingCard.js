import GLib from 'gi://GLib';
import { MediaFloatingCard, NUM_WAVE_BARS, OPEN_DELAY_MS, GRACE_PERIOD_MS, waveformBarHeights } from '../src/mediaFloatingCard.js';

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
    set_size(width, height) { this.width = width; this.height = height; }
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

anchor.isPinned = true;
card.showForActor(anchor, { title: 'Pinned playback' }, 'Playing');
await wait(OPEN_DELAY_MS + 50);
assert(card.isOpen(), 'card must be open');
card.hover = false;
card.emit('notify::hover');
await wait(GRACE_PERIOD_MS + 50);
assert(card.isOpen() && card.visible, 'pinned anchor must prevent card from closing after grace period');
anchor.isPinned = false;
card.hideCard();

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

// Verify isPointerOver in vertical bridge between anchor and card
const bridgeCard = new MediaFloatingCard(manager, { uiGroup, settings });
const bridgeAnchor = new MockActor(100, 0, 200, 28);
bridgeAnchor._mediaChip = new MockActor(100, 0, 200, 28);
bridgeAnchor._appMenuButton = new MockActor(0, 0, 80, 28);
bridgeCard.showForActor(bridgeAnchor, { title: 'Bridge Test', lengthMs: 200_000, positionMs: 50_000 }, 'Playing');
await wait(OPEN_DELAY_MS + 50);
bridgeCard.set_position(40, 36);
bridgeCard.width = 320;
bridgeCard.height = 240;

let pointerPos = [200, 32]; // Inside 8px gap between y=28 and y=36, x=200 is within [40, 360]
const savedGlobal = globalThis.global;
let focusedActor = null;
const stageHandlers = new Map();
let nextStageSignalId = 1;
const testStage = {
    connect(signal, handler) {
        const id = nextStageSignalId++;
        stageHandlers.set(id, { signal, handler });
        return id;
    },
    disconnect(id) { stageHandlers.delete(id); },
    emit(signal, event) {
        let result;
        for (const { signal: registered, handler } of stageHandlers.values()) {
            if (registered === signal)
                result = handler(this, event);
        }
        return result;
    },
    get_key_focus: () => focusedActor,
};
globalThis.global = { get_pointer: () => pointerPos, stage: testStage };

assert(bridgeCard.isPointerOver(), 'isPointerOver must return true when pointer is in vertical bridge between anchor and card');

pointerPos = [500, 32]; // Outside horizontal span of anchor & card
assert(!bridgeCard.isPointerOver(), 'isPointerOver must return false when pointer is outside horizontal bridge');

bridgeAnchor._appMenuButton.hover = true;
pointerPos = [40, 15]; // On the app-menu host, away from the media chip
assert(!bridgeCard.isPointerOver(), 'hovering the host app-menu button must not keep the media card open');
bridgeAnchor._appMenuButton.hover = false;
pointerPos = [50, 32]; // In the card gap, but outside the media chip's horizontal reach
assert(!bridgeCard.isPointerOver(), 'the hover bridge must not extend across the neighboring app-menu title');
bridgeCard.hover = true;
bridgeAnchor._mediaChip.hover = true;
pointerPos = [1200, 700];
assert(!bridgeCard.isPointerOver(), 'stale hover properties must not override pointer coordinates outside the card and chip');
bridgeCard.hover = false;
bridgeAnchor._mediaChip.hover = false;
focusedActor = bridgeAnchor._mediaChip;
assert(bridgeCard._hasKeyboardFocus(), 'keyboard focus on the media control must count as anchor focus');
focusedActor = null;

const clickAwayCard = new MediaFloatingCard(manager, { uiGroup, settings, gracePeriodMs: 0 });
const clickAwayAnchor = new MockActor(100, 400, 80, 28);
clickAwayAnchor._mediaChip = new MockActor(100, 400, 80, 28);
clickAwayAnchor.isPinned = true;
clickAwayAnchor.unpin = () => { clickAwayAnchor.isPinned = false; };
clickAwayCard.showForActor(clickAwayAnchor, { title: 'Click away test' }, 'Playing', { immediate: true });
assert(clickAwayCard.isOpen(), 'click-away test card opens immediately');
const makeStagePress = (source, coords) => ({
    type: 'button-press',
    get_source: () => source,
    get_coords: () => coords,
});
const insideCardResult = testStage.emit('captured-event', makeStagePress(clickAwayCard._playPauseBtn, [220, 500]));
assert(clickAwayCard.isOpen(), 'clicking a card control must not dismiss the card');
assert(!insideCardResult, 'card-control clicks must propagate to the control');
const insideAnchorResult = testStage.emit('captured-event', makeStagePress(clickAwayAnchor._mediaChip, [120, 410]));
assert(clickAwayCard.isOpen(), 'clicking the media chip must not be treated as an outside click');
assert(!insideAnchorResult, 'media-chip clicks must propagate to the chip');
const outsideClickResult = testStage.emit('captured-event', makeStagePress(new MockActor(900, 700, 40, 30), [900, 700]));
assert(!clickAwayCard.isOpen(), 'a click outside the card and chip must dismiss the card');
assert(!clickAwayAnchor.isPinned, 'outside dismissal must release the media-chip pin');
assert(!outsideClickResult, 'outside clicks must propagate to the underlying application');
assert(stageHandlers.size === 0, 'hiding the card must disconnect its captured-event listener');
clickAwayCard.destroy();

const windowClickCard = new MediaFloatingCard(manager, { uiGroup, settings, gracePeriodMs: 0 });
const windowClickAnchor = new MockActor(100, 400, 80, 28);
windowClickAnchor._mediaChip = new MockActor(100, 400, 80, 28);
windowClickAnchor.isPinned = true;
windowClickAnchor.unpin = () => { windowClickAnchor.isPinned = false; };
windowClickCard.showForActor(windowClickAnchor, { title: 'Window click test' }, 'Playing', { immediate: true });
assert(windowClickCard._dismissLayer?.reactive, 'an open card must install a reactive desktop click dismissal layer');
assert(uiGroup.children.includes(windowClickCard._dismissLayer), 'the dismissal layer must be attached to the Shell UI group while open');
const backgroundClickResult = windowClickCard._dismissLayer.emit('button-press-event', makeStagePress(null, [900, 700]));
assert(!windowClickCard.isOpen(), 'a click delivered to the transparent background layer must dismiss the card');
assert(backgroundClickResult === true, 'the dismissing background click must be consumed after closing the card');
assert(!windowClickAnchor.isPinned, 'a background click must release an explicit keyboard pin');
assert(!uiGroup.children.includes(windowClickCard._dismissLayer), 'hiding the card must remove its background dismissal layer immediately');
windowClickCard.destroy();

const hoverExitCard = new MediaFloatingCard(manager, { uiGroup, settings, gracePeriodMs: 20 });
const hoverExitAnchor = new MockActor(100, 100, 80, 28);
hoverExitAnchor._mediaChip = new MockActor(100, 100, 80, 28);
hoverExitCard.showForActor(hoverExitAnchor, { title: 'Hover exit test' }, 'Playing', { immediate: true });
hoverExitCard.hover = true;
pointerPos = [1400, 800];
testStage.emit('captured-event', { type: 'motion', get_coords: () => pointerPos });
assert(hoverExitCard._graceTimerId > 0, 'stage pointer motion outside the card must start hover dismissal');
await wait(40);
assert(!hoverExitCard.isOpen(), 'a hover-opened card must close after stage motion leaves the card and chip');
assert(stageHandlers.size === 0, 'automatic hover dismissal must disconnect the stage listener');
hoverExitCard.destroy();

const negativeMonitorAnchor = new MockActor(-400, 100, 80, 28);
negativeMonitorAnchor._mediaChip = new MockActor(-400, 100, 80, 28);
const negativeMonitorCard = new MediaFloatingCard(manager, { uiGroup, settings });
negativeMonitorCard.showForActor(negativeMonitorAnchor, { title: 'Negative monitor test' }, 'Playing', { immediate: true });
pointerPos = [-360, 110];
assert(negativeMonitorCard.isPointerOver(), 'negative stage coordinates on a left-hand monitor must remain valid pointer positions');
negativeMonitorCard.destroy();

const aboveCard = new MediaFloatingCard(manager, { uiGroup, settings });
const aboveAnchor = new MockActor(100, 400, 200, 28);
aboveAnchor._mediaChip = new MockActor(100, 400, 200, 28);
aboveCard.showForActor(aboveAnchor, { title: 'Above Bridge Test' }, 'Playing');
await wait(OPEN_DELAY_MS + 50);
aboveCard.set_position(40, 152);
aboveCard.width = 320;
aboveCard.height = 240;
pointerPos = [200, 396]; // 4px gap when the card flips above the panel anchor
assert(aboveCard.isPointerOver(), 'isPointerOver must retain the pointer bridge when the card is above its anchor');
aboveCard.destroy();

// Verify scrubbing calculation and guard during drag
bridgeCard._waveArea.width = 200;
bridgeCard._waveArea.x = 60;
assert(Math.abs(bridgeCard._waveArea._scrubFraction({ x: 160 }) - 0.5) < 0.01,
    'scrubFraction must compute correct fraction based on wave position and width');
assert(bridgeCard._waveArea._scrubFraction({ x: 60 }) === 0, 'scrubFraction at left edge must be 0');
assert(bridgeCard._waveArea._scrubFraction({ x: 260 }) === 1, 'scrubFraction at right edge must be 1');

// Dragging guard in update()
bridgeCard._waveArea._dragging = true;
bridgeCard._waveArea._progress = 0.75;
bridgeCard._waveArea.update({ lengthMs: 200_000, positionMs: 10_000 }, 'Playing');
assert(bridgeCard._waveArea._progress === 0.75, 'active drag must not be overwritten by incoming update()');
bridgeCard._waveArea._dragging = false;

let restoredFocus = null;
globalThis.global.stage.set_key_focus = actor => {
    restoredFocus = actor;
    focusedActor = actor;
};
focusedActor = bridgeCard._prevBtn;
assert(bridgeCard._isActorInsideCard(focusedActor), 'focused transport buttons must be recognized as children of the card');
bridgeCard._handleKeyPress('Escape');
assert(restoredFocus === bridgeAnchor._mediaChip,
    'Escape must return keyboard focus to the media button that opened the card');

bridgeCard.destroy();
globalThis.global = savedGlobal;

// Test waveformBarHeights when playing vs paused
const playingHeights = waveformBarHeights(24, true, 0);
const pausedHeights = waveformBarHeights(24, false, 0);

assert(pausedHeights.length === 16, 'paused waveform must have 16 bars');
const minPaused = Math.min(...pausedHeights);
const maxPaused = Math.max(...pausedHeights);
assert(maxPaused > minPaused + 5, `paused waveform bars must retain dynamic heights, got min=${minPaused}, max=${maxPaused}`);

// Test scrubCommit on waveArea
const scrubTestCard = new MediaFloatingCard(manager, { uiGroup, settings });
scrubTestCard._waveArea.width = 200;
scrubTestCard._waveArea.x = 0;
let soughtMs = null;
manager.seek = function (ms) {
    soughtMs = ms;
    return Promise.resolve();
};
scrubTestCard._trackInfo = { title: 'Scrub Track', lengthMs: 120_000, positionMs: 10_000 };
scrubTestCard._waveArea._scrubCommit({ x: 100 }, { force: true });
assert(soughtMs === 60_000, `scrubCommit at 50% of 120,000ms must seek to 60,000ms, got ${soughtMs}`);
assert(scrubTestCard._waveArea._progress === 0.5, 'scrubCommit must set progress to 0.5');

// Test seeking state guards in MediaFloatingCard
let seekingFlag = false;
manager.isSeeking = () => seekingFlag;

// updateState should preserve trackInfo and active playback status while isSeeking
seekingFlag = true;
scrubTestCard._playbackStatus = 'Playing';
scrubTestCard.updateState(null, 'Stopped');
assert(scrubTestCard._trackInfo?.title === 'Scrub Track',
    'updateState with null track while isSeeking must retain existing trackInfo');
assert(scrubTestCard._playbackStatus === 'Playing',
    'updateState with Stopped status while isSeeking must retain active Playing status');

// _startGraceTimer should NOT schedule hide while isSeeking
scrubTestCard._startGraceTimer();
assert(scrubTestCard._graceTimerId === 0,
    '_startGraceTimer must be a no-op while isSeeking is true');

seekingFlag = false;
scrubTestCard.destroy();

console.log('MediaFloatingCard test suite passed successfully!');
