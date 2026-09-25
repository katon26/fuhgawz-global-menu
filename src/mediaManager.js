// SPDX-License-Identifier: GPL-3.0-or-later
// Headless MPRIS ingestion, player arbitration, and media history.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

let Soup = null;
try {
    const imported = await import('gi://Soup?version=3.0');
    Soup = imported.default ?? imported;
} catch (error) {
    // GIO's URI backend is used as a fallback when libsoup is unavailable.
}

export const MAX_RECENT_TRACKS = 10;
export const MPRIS_ROOT_INTERFACE = 'org.mpris.MediaPlayer2';
export const MPRIS_PLAYER_INTERFACE = `${MPRIS_ROOT_INTERFACE}.Player`;
export const MPRIS_TRACKLIST_INTERFACE = `${MPRIS_ROOT_INTERFACE}.TrackList`;
export const MPRIS_OBJECT_PATH = '/org/mpris/MediaPlayer2';
const DBUS_INTERFACE = 'org.freedesktop.DBus';
const NO_TRACK_ID = '/org/mpris/MediaPlayer2/TrackList/NoTrack';

export function unrollVariant(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value.deep_unpack === 'function')
        return unrollVariant(value.deep_unpack());
    if (Array.isArray(value))
        return value.map(unrollVariant);
    if (typeof value === 'object') {
        const result = {};
        for (const [key, member] of Object.entries(value))
            result[key] = unrollVariant(member);
        return result;
    }
    return value;
}

export function isSpotify(name) {
    return typeof name === 'string' && name.toLowerCase().includes('spotify');
}

function normalizeArtist(value) {
    if (Array.isArray(value))
        return value.filter(item => typeof item === 'string' && item.trim()).join(', ');
    return typeof value === 'string' ? value : '';
}

function trackKey(track) {
    if (!track)
        return '';
    return `${track.player ?? ''}\u0000${track.trackId || track.title}\u0000${track.artist ?? ''}\u0000${track.album ?? ''}`;
}

function playerTitle(name) {
    if (isSpotify(name))
        return 'Music';
    const value = name.split('.').at(-1) ?? name;
    if (value.toLowerCase() === 'spotify')
        return 'Music';
    return value.length ? value[0].toUpperCase() + value.slice(1) : 'Media Player';
}

function cloneTrack(track) {
    return track ? { ...track } : null;
}

export const MediaManager = GObject.registerClass(
    {
        GTypeName: 'FUHGlobeMediaManager',
        Signals: {
            'player-changed': { param_types: [] },
            'track-changed': { param_types: [GObject.TYPE_JSOBJECT] },
            'status-changed': { param_types: [GObject.TYPE_STRING] },
            'recent-updated': { param_types: [GObject.TYPE_JSOBJECT] },
        },
    },
    class MediaManager extends GObject.Object {
        _init(settings = null, options = {}) {
            super._init();
            this._settings = settings;
            this._options = options;
            this._destroyed = false;
            this._dbusConnection = options.dbusConnection ?? this._getSessionBus();
            this._cancellable = new Gio.Cancellable();
            this._artDownloads = new Map();
            this._timers = new Set();
            this._players = new Map();
            this._ownerToName = new Map();
            this._sequence = 0;
            this._activePlayerName = null;
            this._activeTrack = null;
            this._playbackStatus = 'Stopped';
            this._settingsSignalId = 0;
            this._subscriptions = [];
            this._spotifyWatcherId = 0;
            this._spotifyPriority = options.spotifyPriority ?? this._readSpotifyPriority();

            const cacheRoot = GLib.build_filenamev([GLib.get_user_cache_dir(), 'fuhgawz-global-menu']);
            this._cacheFile = options.cacheFile ?? GLib.build_filenamev([cacheRoot, 'recent-tracks.json']);
            this._artCacheDir = options.artCacheDir ?? GLib.build_filenamev([cacheRoot, 'media-art']);
            this._recentTracks = this._loadRecentTracks();
            try {
                GLib.mkdir_with_parents(GLib.path_get_dirname(this._cacheFile), 0o755);
                GLib.mkdir_with_parents(this._artCacheDir, 0o755);
            } catch (error) {
                // Cache failure does not block MPRIS control or playback status.
            }

            this._connectSettings();
            this._subscribeToBus();
        }

        _getSessionBus() {
            try {
                return Gio.DBus.session;
            } catch (error) {
                return null;
            }
        }

        _readSpotifyPriority() {
            try {
                return this._settings?.get_boolean('media-spotify-priority') ?? true;
            } catch (error) {
                return true;
            }
        }

        _connectSettings() {
            if (!this._settings || typeof this._settings.connect !== 'function')
                return;
            try {
                this._settingsSignalId = this._settings.connect('changed::media-spotify-priority', () => {
                    if (this._destroyed)
                        return;
                    this._spotifyPriority = this._readSpotifyPriority();
                    this._refreshActivePlayer();
                });
            } catch (error) {
                this._settingsSignalId = 0;
            }
        }

        _subscribeToBus() {
            const bus = this._dbusConnection;
            if (!bus || typeof bus.signal_subscribe !== 'function')
                return;

            try {
                const propertiesId = bus.signal_subscribe(
                    null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', MPRIS_OBJECT_PATH,
                    null, Gio.DBusSignalFlags.NONE,
                    (_connection, sender, _path, _interface, _signal, parameters) => {
                        if (this._destroyed)
                            return;
                        try {
                            const [changedInterface, changed, invalidated] = parameters.deep_unpack();
                            this._handlePropertiesChanged(sender, changedInterface, changed, invalidated);
                        } catch (error) {
                            // Ignore malformed signals from unrelated bus clients.
                        }
                    }
                );
                this._subscriptions.push(propertiesId);
            } catch (error) {
                // Continue without media if the session bus denies subscriptions.
            }

            try {
                const ownerId = bus.signal_subscribe(
                    DBUS_INTERFACE, DBUS_INTERFACE, 'NameOwnerChanged', '/org/freedesktop/DBus',
                    null, Gio.DBusSignalFlags.NONE,
                    (_connection, _sender, _path, _interface, _signal, parameters) => {
                        if (this._destroyed)
                            return;
                        try {
                            const [name, oldOwner, newOwner] = parameters.deep_unpack();
                            this._handleNameOwnerChanged(name, oldOwner, newOwner);
                        } catch (error) {
                            // Ignore malformed bus-daemon signals.
                        }
                    }
                );
                this._subscriptions.push(ownerId);
            } catch (error) {
                // Name watches below still provide Spotify lifecycle notifications.
            }

            const watchName = this._options.watchName ?? ((connection, name, flags, appeared, vanished) => {
                if (typeof connection.watch_name === 'function')
                    return connection.watch_name(name, flags, appeared, vanished);
                return Gio.bus_watch_name_on_connection(connection, name, flags, appeared, vanished);
            });
            try {
                this._spotifyWatcherId = watchName(
                    bus, `${MPRIS_ROOT_INTERFACE}.spotify`, Gio.BusNameWatcherFlags.NONE,
                    (_connection, name, owner) => this._addPlayer(name, owner),
                    (_connection, name) => this._removePlayer(name)
                );
            } catch (error) {
                this._spotifyWatcherId = 0;
            }

            if (this._options.discoverPlayers !== false)
                this._discoverPlayers();
        }

        _call(busName, objectPath, interfaceName, methodName, parameters, replyType = null) {
            if (!this._dbusConnection || typeof this._dbusConnection.call !== 'function')
                return Promise.reject(new Error('The session D-Bus is unavailable'));

            return new Promise((resolve, reject) => {
                try {
                    this._dbusConnection.call(
                        busName, objectPath, interfaceName, methodName, parameters, replyType,
                        Gio.DBusCallFlags.NONE, 5000, this._cancellable,
                        (connection, result) => {
                            try {
                                resolve(connection.call_finish(result));
                            } catch (error) {
                                reject(error);
                            }
                        }
                    );
                } catch (error) {
                    reject(error);
                }
            });
        }

        _discoverPlayers() {
            const arrayReply = new GLib.VariantType('(as)');
            this._call(DBUS_INTERFACE, '/org/freedesktop/DBus', DBUS_INTERFACE, 'ListNames',
                new GLib.Variant('()', []), arrayReply)
                .then(result => result.deep_unpack()[0])
                .then(names => {
                    for (const name of names) {
                        if (name.startsWith(`${MPRIS_ROOT_INTERFACE}.`))
                            this._resolvePlayerOwner(name);
                    }
                })
                .catch(() => {});
        }

        _resolvePlayerOwner(name) {
            this._call(DBUS_INTERFACE, '/org/freedesktop/DBus', DBUS_INTERFACE, 'GetNameOwner',
                new GLib.Variant('(s)', [name]), new GLib.VariantType('(s)'))
                .then(result => this._addPlayer(name, result.deep_unpack()[0]))
                .catch(() => {});
        }

        _handleNameOwnerChanged(name, oldOwner, newOwner) {
            if (typeof name !== 'string' || !name.startsWith(`${MPRIS_ROOT_INTERFACE}.`))
                return;
            if (oldOwner)
                this._removePlayer(name, oldOwner);
            if (newOwner)
                this._addPlayer(name, newOwner);
        }

        _addPlayer(name, owner) {
            if (this._destroyed || !name || !owner || !name.startsWith(`${MPRIS_ROOT_INTERFACE}.`))
                return;
            const current = this._players.get(name);
            if (current?.owner === owner)
                return;
            if (current)
                this._removePlayer(name, current.owner);

            const state = {
                name,
                owner,
                title: 'Unknown Title',
                artist: '',
                album: '',
                artUrl: '',
                cachedArtUrl: null,
                trackId: NO_TRACK_ID,
                lengthUs: 0,
                positionUs: 0,
                positionTimestamp: GLib.get_monotonic_time(),
                status: 'Stopped',
                order: ++this._sequence,
            };
            this._players.set(name, state);
            this._ownerToName.set(owner, name);
            this._refreshActivePlayer();

            this._call(name, MPRIS_OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [MPRIS_PLAYER_INTERFACE]), new GLib.VariantType('(a{sv})'))
                .then(result => {
                    if (this._destroyed || this._players.get(name) !== state)
                        return;
                    const [properties] = result.deep_unpack();
                    this._handlePropertiesChanged(owner, MPRIS_PLAYER_INTERFACE, properties, []);
                })
                .catch(() => {});
        }

        _removePlayer(name, owner = null) {
            const state = this._players.get(name);
            if (!state || (owner && state.owner !== owner))
                return;
            this._rememberTrack(this._trackForPlayer(state));
            this._players.delete(name);
            this._ownerToName.delete(state.owner);
            this._refreshActivePlayer();
        }

        _handlePropertiesChanged(owner, changedInterface, changedProperties, invalidated = []) {
            if (this._destroyed || changedInterface !== MPRIS_PLAYER_INTERFACE)
                return;
            const name = this._ownerToName.get(owner) ??
                (typeof owner === 'string' && owner.startsWith(`${MPRIS_ROOT_INTERFACE}.`) ? owner : null);
            const state = name ? this._players.get(name) : null;
            if (!state)
                return;

            const changed = unrollVariant(changedProperties ?? {});
            const invalid = Array.isArray(invalidated) ? invalidated : [];
            const previousTrack = this._trackForPlayer(state);
            let positionChanged = false;

            if (Object.prototype.hasOwnProperty.call(changed, 'Metadata')) {
                const metadata = changed.Metadata ?? {};
                state.trackId = metadata['mpris:trackid'] ?? NO_TRACK_ID;
                state.title = metadata['xesam:title'] || 'Unknown Title';
                state.artist = normalizeArtist(metadata['xesam:artist']);
                state.album = metadata['xesam:album'] || '';
                state.artUrl = metadata['mpris:artUrl'] || '';
                state.lengthUs = Math.max(0, Number(metadata['mpris:length']) || 0);
                if (state.artUrl !== previousTrack?.artUrl)
                    state.cachedArtUrl = null;
                if (state.trackId === NO_TRACK_ID)
                    state.title = '';
            } else if (invalid.includes('Metadata')) {
                state.trackId = NO_TRACK_ID;
                state.title = '';
                state.artist = '';
                state.album = '';
                state.artUrl = '';
                state.cachedArtUrl = null;
                state.lengthUs = 0;
            }

            if (Object.prototype.hasOwnProperty.call(changed, 'PlaybackStatus')) {
                const status = changed.PlaybackStatus;
                if (['Playing', 'Paused', 'Stopped'].includes(status))
                    state.status = status;
            }
            if (Object.prototype.hasOwnProperty.call(changed, 'Position')) {
                state.positionUs = Math.max(0, Number(changed.Position) || 0);
                state.positionTimestamp = GLib.get_monotonic_time();
                positionChanged = true;
            } else if (Object.prototype.hasOwnProperty.call(changed, 'Metadata')) {
                state.positionUs = 0;
                state.positionTimestamp = GLib.get_monotonic_time();
            }

            if (state.status === 'Playing')
                state.order = ++this._sequence;

            const nextTrack = this._trackForPlayer(state);
            if (previousTrack && nextTrack && trackKey(previousTrack) !== trackKey(nextTrack))
                this._rememberTrack(previousTrack);

            if (state.artUrl.startsWith('file://'))
                state.cachedArtUrl = Gio.File.new_for_uri(state.artUrl).get_path();
            else if (/^https?:\/\//i.test(state.artUrl) && !state.cachedArtUrl)
                this._fetchRemoteArt(state);

            this._refreshActivePlayer(positionChanged);
        }

        _trackForPlayer(state) {
            if (!state || !state.title || state.trackId === NO_TRACK_ID)
                return null;
            return {
                trackId: state.trackId,
                title: state.title,
                artist: state.artist,
                album: state.album,
                artUrl: state.artUrl,
                cachedArtUrl: state.cachedArtUrl,
                lengthUs: state.lengthUs,
                lengthMs: Math.round(state.lengthUs / 1000),
                positionUs: this._positionForState(state),
                positionMs: Math.round(this._positionForState(state) / 1000),
                player: state.name,
                playerName: state.name,
                playerTitle: playerTitle(state.name),
                status: state.status,
                timestamp: Date.now(),
            };
        }

        _positionForState(state) {
            let position = state.positionUs;
            if (state.status === 'Playing')
                position += Math.max(0, GLib.get_monotonic_time() - state.positionTimestamp);
            return state.lengthUs > 0 ? Math.min(position, state.lengthUs) : position;
        }

        _refreshActivePlayer(positionChanged = false) {
            if (this._destroyed)
                return;
            const players = [...this._players.values()];
            const playing = players.filter(player => player.status === 'Playing' && this._trackForPlayer(player));
            const spotify = this._players.get(`${MPRIS_ROOT_INTERFACE}.spotify`);
            let selected = null;

            if (this._spotifyPriority && spotify?.status === 'Playing' && this._trackForPlayer(spotify))
                selected = spotify;
            else if (playing.length)
                selected = playing.sort((a, b) => b.order - a.order)[0];
            else {
                const current = this._activePlayerName ? this._players.get(this._activePlayerName) : null;
                if (current?.status === 'Paused' && this._trackForPlayer(current))
                    selected = current;
                else
                    selected = players.filter(player => player.status === 'Paused' && this._trackForPlayer(player))
                        .sort((a, b) => b.order - a.order)[0] ?? null;
            }

            const previousName = this._activePlayerName;
            const previousTrack = this._activeTrack;
            const previousStatus = this._playbackStatus;
            this._activePlayerName = selected?.name ?? null;
            this._activeTrack = selected ? this._trackForPlayer(selected) : null;
            this._playbackStatus = selected?.status ?? 'Stopped';

            if (previousName !== this._activePlayerName)
                this.emit('player-changed');
            const changedTrack = trackKey(previousTrack) !== trackKey(this._activeTrack);
            if (changedTrack || (positionChanged && this._activeTrack))
                this.emit('track-changed', cloneTrack(this._activeTrack));
            if (previousStatus !== this._playbackStatus)
                this.emit('status-changed', this._playbackStatus);
        }

        _loadRecentTracks() {
            try {
                const [, contents] = GLib.file_get_contents(this._cacheFile);
                const tracks = JSON.parse(new TextDecoder().decode(contents));
                if (!Array.isArray(tracks))
                    return [];
                return tracks.filter(track => track && typeof track.title === 'string')
                    .slice(0, MAX_RECENT_TRACKS).map(track => ({ ...track }));
            } catch (error) {
                return [];
            }
        }

        _rememberTrack(track) {
            if (!track || !track.title)
                return;
            const serialized = { ...track, timestamp: Date.now() };
            if (trackKey(this._recentTracks[0]) === trackKey(serialized))
                return;
            this._recentTracks.unshift(serialized);
            this._recentTracks = this._recentTracks.slice(0, MAX_RECENT_TRACKS);
            this._saveRecentTracks();
            this.emit('recent-updated', this.getRecentTracks());
        }

        _saveRecentTracks() {
            try {
                GLib.mkdir_with_parents(GLib.path_get_dirname(this._cacheFile), 0o755);
                GLib.file_set_contents(this._cacheFile, JSON.stringify(this._recentTracks));
            } catch (error) {
                // Keep in-memory history if the cache is read-only or full.
            }
        }

        async _downloadRemoteArt(url, cancellable) {
            if (typeof this._options.downloadArt === 'function')
                return this._options.downloadArt(url, cancellable);

            if (Soup?.Session) {
                const session = new Soup.Session();
                const message = Soup.Message.new('GET', url);
                return new Promise((resolve, reject) => {
                    session.send_and_read_async(message, GLib.PRIORITY_LOW, cancellable, (source, result) => {
                        try {
                            const bytes = source.send_and_read_finish(result);
                            if (message.status_code < 200 || message.status_code >= 300)
                                throw new Error(`Artwork request failed (${message.status_code})`);
                            resolve(bytes);
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
            }

            const file = Gio.File.new_for_uri(url);
            return new Promise((resolve, reject) => {
                file.load_bytes_async(cancellable, (source, result) => {
                    try {
                        const [bytes] = source.load_bytes_finish(result);
                        resolve(bytes);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        _fetchRemoteArt(state) {
            const url = state.artUrl;
            if (!url || this._artDownloads.has(url) || this._destroyed)
                return;
            const checksum = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
            const destination = GLib.build_filenamev([this._artCacheDir, `${checksum}.img`]);
            if (GLib.file_test(destination, GLib.FileTest.EXISTS)) {
                state.cachedArtUrl = destination;
                return;
            }

            const cancellable = new Gio.Cancellable();
            this._artDownloads.set(url, cancellable);
            this._downloadRemoteArt(url, cancellable).then(bytes => {
                if (this._destroyed || cancellable.is_cancelled())
                    return;
                GLib.mkdir_with_parents(this._artCacheDir, 0o755);
                const raw = typeof bytes.toArray === 'function' ? bytes.toArray() : bytes;
                GLib.file_set_contents(destination, raw);
                state.cachedArtUrl = destination;
                this._saveRecentTracks();
                if (this._activePlayerName === state.name) {
                    this._refreshActivePlayer();
                    this.emit('track-changed', cloneTrack(this._activeTrack));
                }
            }).catch(() => {}).finally(() => {
                if (this._artDownloads.get(url) === cancellable)
                    this._artDownloads.delete(url);
            });
        }

        getActiveTrack() {
            const player = this._activePlayerName ? this._players.get(this._activePlayerName) : null;
            if (!player)
                return null;
            return cloneTrack(this._trackForPlayer(player));
        }

        getRecentTracks() {
            return this._recentTracks.map(track => ({ ...track }));
        }

        getPlaybackStatus() {
            return this._playbackStatus;
        }

        _invokeCurrent(interfaceName, methodName, parameters = null) {
            const player = this._activePlayerName ? this._players.get(this._activePlayerName) : null;
            if (!player)
                return Promise.reject(new Error('No active MPRIS player'));
            return this._call(player.owner, MPRIS_OBJECT_PATH, interfaceName, methodName, parameters);
        }

        previous() {
            return this._invokeCurrent(MPRIS_PLAYER_INTERFACE, 'Previous', new GLib.Variant('()', []));
        }

        playPause() {
            return this._invokeCurrent(MPRIS_PLAYER_INTERFACE, 'PlayPause', new GLib.Variant('()', []));
        }

        next() {
            return this._invokeCurrent(MPRIS_PLAYER_INTERFACE, 'Next', new GLib.Variant('()', []));
        }

        seek(positionMs) {
            const player = this._activePlayerName ? this._players.get(this._activePlayerName) : null;
            const track = player ? this._trackForPlayer(player) : null;
            if (!player || !track)
                return Promise.reject(new Error('No active track to seek'));
            const targetUs = Math.max(0, Math.round((Number(positionMs) || 0) * 1000));
            if (track.trackId && track.trackId !== NO_TRACK_ID) {
                return this._call(player.owner, MPRIS_OBJECT_PATH, MPRIS_PLAYER_INTERFACE, 'SetPosition',
                    new GLib.Variant('(ox)', [track.trackId, targetUs]));
            }
            const offset = targetUs - track.positionUs;
            return this._call(player.owner, MPRIS_OBJECT_PATH, MPRIS_PLAYER_INTERFACE, 'Seek',
                new GLib.Variant('(x)', [offset]));
        }

        raise() {
            const player = this._activePlayerName ? this._players.get(this._activePlayerName) : null;
            if (!player)
                return Promise.reject(new Error('No active MPRIS player'));
            return this._call(player.owner, MPRIS_OBJECT_PATH, MPRIS_ROOT_INTERFACE, 'Raise', new GLib.Variant('()', []));
        }

        playRecentTrack(track) {
            if (!track?.player || !track?.trackId)
                return this.raise();
            const player = this._players.get(track.player);
            if (!player)
                return this.raise();
            return this._call(player.owner, MPRIS_OBJECT_PATH, MPRIS_TRACKLIST_INTERFACE, 'GoTo',
                new GLib.Variant('(o)', [track.trackId])).catch(() => this.raise());
        }

        destroy() {
            if (this._destroyed)
                return;
            this._destroyed = true;
            this._cancellable.cancel();
            for (const cancellable of this._artDownloads.values())
                cancellable.cancel();
            this._artDownloads.clear();
            for (const id of this._timers)
                GLib.source_remove(id);
            this._timers.clear();

            if (this._dbusConnection && typeof this._dbusConnection.signal_unsubscribe === 'function') {
                for (const id of this._subscriptions) {
                    try { this._dbusConnection.signal_unsubscribe(id); } catch (error) {}
                }
            }
            this._subscriptions = [];

            if (this._spotifyWatcherId) {
                try {
                    if (typeof this._options.unwatchName === 'function')
                        this._options.unwatchName(this._spotifyWatcherId);
                    else if (typeof this._dbusConnection?.unwatch_name === 'function')
                        this._dbusConnection.unwatch_name(this._spotifyWatcherId);
                    else
                        Gio.bus_unwatch_name(this._spotifyWatcherId);
                } catch (error) {}
                this._spotifyWatcherId = 0;
            }

            if (this._settings && this._settingsSignalId && typeof this._settings.disconnect === 'function') {
                try { this._settings.disconnect(this._settingsSignalId); } catch (error) {}
            }
            this._settingsSignalId = 0;
            this._players.clear();
            this._ownerToName.clear();
            this._activePlayerName = null;
            this._activeTrack = null;
            this._playbackStatus = 'Stopped';
        }
    }
);
