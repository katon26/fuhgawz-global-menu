import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { MediaManager, MPRIS_PLAYER_INTERFACE, MPRIS_OBJECT_PATH } from '../src/mediaManager.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(`Assertion failed: ${message}`);
}

class MockSettings {
    constructor() {
        this.values = new Map([['media-spotify-priority', true]]);
        this.handlers = new Map();
        this.nextId = 1;
    }

    get_boolean(key) { return this.values.get(key) ?? false; }

    set_boolean(key, value) {
        this.values.set(key, value);
        for (const handler of this.handlers.values())
            handler(key);
    }

    connect(_signal, handler) {
        const id = this.nextId++;
        this.handlers.set(id, handler);
        return id;
    }

    disconnect(id) { this.handlers.delete(id); }
}

class FakeBus {
    constructor() {
        this.subscriptions = new Map();
        this.watchers = new Map();
        this.calls = [];
        this.initialProperties = null;
        this.nextId = 1;
        this.unsubscribed = [];
        this.unwatched = [];
    }

    signal_subscribe(sender, iface, signal, path, _arg0, _flags, callback) {
        const id = this.nextId++;
        this.subscriptions.set(id, { sender, iface, signal, path, callback });
        return id;
    }

    signal_unsubscribe(id) {
        this.unsubscribed.push(id);
        this.subscriptions.delete(id);
    }

    watch_name(name, _flags, appeared, vanished) {
        const id = this.nextId++;
        this.watchers.set(id, { name, appeared, vanished });
        return id;
    }

    unwatch_name(id) {
        this.unwatched.push(id);
        this.watchers.delete(id);
    }

    emit(sender, iface, signal, path, params) {
        for (const subscription of this.subscriptions.values()) {
            if (subscription.signal === signal && subscription.path === path &&
                (!subscription.iface || subscription.iface === iface) &&
                (!subscription.sender || subscription.sender === sender)) {
                subscription.callback(this, sender, path, iface, signal, params);
            }
        }
    }

    call(busName, path, iface, method, params, _replyType, _flags, _timeout, _cancellable, callback) {
        this.calls.push({ busName, path, iface, method, params });
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const result = method === 'GetAll'
                ? new GLib.Variant('(a{sv})', [this.initialProperties ?? {}])
                : new GLib.Variant('()', []);
            callback(this, { result });
            return GLib.SOURCE_REMOVE;
        });
    }

    call_finish(result) {
        if (result.error)
            throw result.error;
        return result.result;
    }
}

function metadata(title, artist, trackNumber = 1) {
    return new GLib.Variant('a{sv}', {
        'mpris:trackid': new GLib.Variant('o', `/org/mpris/MediaPlayer2/track/${trackNumber}`),
        'xesam:title': new GLib.Variant('s', title),
        'xesam:artist': new GLib.Variant('as', Array.isArray(artist) ? artist : [artist]),
        'xesam:album': new GLib.Variant('s', 'Superunknown'),
        'mpris:artUrl': new GLib.Variant('s', 'file:///tmp/flower.jpg'),
        'mpris:length': new GLib.Variant('x', 4_200_000),
    });
}

function propertiesChanged(bus, owner, values) {
    const params = new GLib.Variant('(sa{sv}as)', [MPRIS_PLAYER_INTERFACE, values, []]);
    bus.emit(owner, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', MPRIS_OBJECT_PATH, params);
}

function announce(bus, wellKnown, owner) {
    const params = new GLib.Variant('(sss)', [wellKnown, '', owner]);
    bus.emit('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
        '/org/freedesktop/DBus', params);
}

console.log('Testing MediaManager headless MPRIS ingestion and priority engine...');

// A player already in the session when the extension starts may not re-emit its properties.
const startupBus = new FakeBus();
startupBus.initialProperties = {
    Metadata: metadata('Already Playing', 'Startup Artist', 77),
    PlaybackStatus: new GLib.Variant('s', 'Playing'),
};
const startupManager = new MediaManager(null, {
    dbusConnection: startupBus,
    cacheFile: GLib.build_filenamev([GLib.dir_make_tmp('fuhgawz-media-startup-XXXXXX'), 'recent.json']),
    discoverPlayers: false,
});
announce(startupBus, 'org.mpris.MediaPlayer2.spotify', ':1.39');
await new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});
assert(startupBus.calls.some(call => call.method === 'GetAll'), 'adding a player must fetch its current MPRIS properties');
assert(startupManager.getActiveTrack()?.title === 'Already Playing', 'an already-playing player must be visible immediately after discovery');
startupManager.destroy();

const cacheRoot = GLib.dir_make_tmp('fuhgawz-media-manager-XXXXXX');
const bus = new FakeBus();
const settings = new MockSettings();
const manager = new MediaManager(settings, {
    dbusConnection: bus,
    cacheFile: GLib.build_filenamev([cacheRoot, 'recent-tracks.json']),
    artCacheDir: GLib.build_filenamev([cacheRoot, 'media-art']),
    discoverPlayers: false,
});

assert(manager.getActiveTrack() === null, 'initial active track must be null');
assert(manager.getPlaybackStatus() === 'Stopped', 'initial playback status must be Stopped');
assert(manager.getRecentTracks().length === 0, 'initial recent track list must be empty');
assert(bus.subscriptions.size >= 2, 'must subscribe to PropertiesChanged and NameOwnerChanged');
assert([...bus.watchers.values()].some(({ name }) => name === 'org.mpris.MediaPlayer2.spotify'),
    'must watch Spotify for immediate player lifecycle updates');

let playerChanges = 0;
let trackChanges = 0;
let statusChanges = 0;
manager.connect('player-changed', () => playerChanges++);
manager.connect('track-changed', () => trackChanges++);
manager.connect('status-changed', () => statusChanges++);

const spotifyOwner = ':1.40';
const vlcOwner = ':1.41';
announce(bus, 'org.mpris.MediaPlayer2.spotify', spotifyOwner);
announce(bus, 'org.mpris.MediaPlayer2.vlc', vlcOwner);
propertiesChanged(bus, vlcOwner, {
    Metadata: metadata('Other Song', 'Other Artist', 9),
    PlaybackStatus: new GLib.Variant('s', 'Playing'),
});
propertiesChanged(bus, spotifyOwner, {
    Metadata: metadata('Flower', ['Soundgarden'], 1),
    PlaybackStatus: new GLib.Variant('s', 'Playing'),
    Position: new GLib.Variant('x', 1_250_000),
});

const active = manager.getActiveTrack();
assert(active?.title === 'Flower', 'active metadata title must come from Spotify');
assert(active?.artist === 'Soundgarden', 'artist arrays must be converted to a display string');
assert(active?.album === 'Superunknown', 'album metadata must be parsed');
assert(active?.artUrl === 'file:///tmp/flower.jpg', 'art URL metadata must be parsed');
assert(active?.lengthUs === 4_200_000 && active?.lengthMs === 4_200,
    'MPRIS duration in microseconds must be exposed in UI milliseconds');
assert(manager.getPlaybackStatus() === 'Playing', 'active playback status must be Playing');
assert(playerChanges > 0 && trackChanges > 0 && statusChanges > 0,
    'player, track, and status signals must emit on player updates');

// Spotify paused means a currently playing generic MPRIS player wins.
propertiesChanged(bus, spotifyOwner, { PlaybackStatus: new GLib.Variant('s', 'Paused') });
assert(manager.getActiveTrack()?.title === 'Other Song', 'playing non-Spotify player must win over paused Spotify');
assert(manager.getPlaybackStatus() === 'Playing', 'selected player status must follow the active player');

// Track transitions are persisted as a newest-first FIFO with a ten-item cap.
propertiesChanged(bus, vlcOwner, {
    Metadata: metadata('Track 0', 'Artist', 10),
    PlaybackStatus: new GLib.Variant('s', 'Playing'),
});
for (let i = 1; i <= 12; i++) {
    propertiesChanged(bus, vlcOwner, { Metadata: metadata(`Track ${i}`, 'Artist', 10 + i) });
}
const recent = manager.getRecentTracks();
assert(recent.length === 10, `recent track history must cap at 10, got ${recent.length}`);
assert(recent[0].title === 'Track 11', `most recent transition must be first, got ${recent[0].title}`);
assert(recent.at(-1).title === 'Track 2', `oldest retained transition must be Track 2, got ${recent.at(-1).title}`);
const [, savedCache] = GLib.file_get_contents(GLib.build_filenamev([cacheRoot, 'recent-tracks.json']));
assert(JSON.parse(new TextDecoder().decode(savedCache)).length === 10, 'recent history must be persisted as JSON');
const restored = new MediaManager(null, {
    dbusConnection: new FakeBus(),
    cacheFile: GLib.build_filenamev([cacheRoot, 'recent-tracks.json']),
    artCacheDir: GLib.build_filenamev([cacheRoot, 'media-art']),
    discoverPlayers: false,
});
assert(restored.getRecentTracks().length === 10, 'recent history must be restored from JSON at startup');
assert(restored.getRecentTracks()[0].title === 'Track 11', 'restored history must preserve newest-first order');
restored.destroy();

// MPRIS transport methods use the selected player's owner and correct interfaces.
await manager.previous();
await manager.playPause();
await manager.next();
await manager.seek(1_250);
await manager.raise();
assert(bus.calls.filter(call => call.method !== 'GetAll').map(call => call.method).join(',') === 'Previous,PlayPause,Next,SetPosition,Raise',
    'transport methods must call the expected MPRIS methods');
const seekCall = bus.calls.find(call => call.method === 'SetPosition');
const [trackId, positionUs] = seekCall.params.deep_unpack();
assert(trackId === '/org/mpris/MediaPlayer2/track/22', 'absolute seek must carry current MPRIS track ID');
assert(positionUs === 1_250_000, 'seek input in milliseconds must convert to microseconds');

manager._removePlayer('org.mpris.MediaPlayer2.vlc', vlcOwner);
assert(manager.getRecentTracks()[0]?.title === 'Track 12',
    'removing a player must preserve its final track in recent history');

let eventsAfterDestroy = 0;
manager.connect('track-changed', () => eventsAfterDestroy++);
manager.destroy();
manager.destroy();
assert(bus.subscriptions.size === 0, 'destroy must unsubscribe every D-Bus signal');
assert(bus.unwatched.length > 0 && bus.watchers.size === 0, 'destroy must remove D-Bus name watchers');
assert(settings.handlers.size === 0, 'destroy must disconnect GSettings handlers');
propertiesChanged(bus, vlcOwner, { Metadata: metadata('After Destroy', 'Nobody', 99) });
assert(eventsAfterDestroy === 0, 'destroyed manager must ignore late D-Bus events');

console.log('MediaManager test suite passed successfully!');
