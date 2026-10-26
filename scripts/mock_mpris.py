#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# scripts/mock_mpris.py - Mock MPRIS Media Player for FUHGAWZ Global Menu Live Indicator Testing

import sys
import time
import gi
from gi.repository import Gio, GLib

MPRIS_XML = """
<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanControl" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <method name="PlayPause"/>
    <method name="Play"/>
    <method name="Pause"/>
    <method name="Stop"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg type="x" direction="in" name="Offset"/>
    </method>
    <method name="SetPosition">
      <arg type="o" direction="in" name="TrackId"/>
      <arg type="x" direction="in" name="Position"/>
    </method>
  </interface>
</node>
"""

class MockPlayer:
    def __init__(self, title="Blinding Lights", artist="The Weeknd", album="After Hours", duration_sec=30):
        self.title = title
        self.artist = artist
        self.album = album
        self.duration_sec = duration_sec
        self.position_sec = 0
        self.status = "Playing"
        self.loop = GLib.MainLoop()

        node_info = Gio.DBusNodeInfo.new_for_xml(MPRIS_XML)
        self.mpris_iface = node_info.interfaces[0]
        self.player_iface = node_info.interfaces[1]

        self.owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            "org.mpris.MediaPlayer2.MockPlayer",
            Gio.BusNameOwnerFlags.NONE,
            self.on_bus_acquired,
            None,
            None,
        )

    def on_bus_acquired(self, conn, name):
        self.conn = conn
        conn.register_object(
            "/org/mpris/MediaPlayer2",
            self.mpris_iface,
            self.handle_method_call,
            self.handle_get_property,
            None
        )
        conn.register_object(
            "/org/mpris/MediaPlayer2",
            self.player_iface,
            self.handle_method_call,
            self.handle_get_property,
            None
        )
        GLib.timeout_add_seconds(1, self.tick)
        print(f"🎵 Mock MPRIS player started on D-Bus: '{self.title}' by '{self.artist}'")
        print(f"⏱️ Running for {self.duration_sec} seconds... (Press Ctrl+C to stop)")

    def handle_method_call(self, conn, sender, object_path, interface_name, method_name, parameters, invocation):
        if method_name in ("PlayPause", "Play", "Pause"):
            self.status = "Paused" if self.status == "Playing" else "Playing"
            print(f"Playback status changed: {self.status}")
            self.emit_properties_changed({"PlaybackStatus": GLib.Variant("s", self.status)})
        elif method_name == "Stop":
            self.status = "Stopped"
            self.emit_properties_changed({"PlaybackStatus": GLib.Variant("s", self.status)})
            self.loop.quit()
        elif method_name == "SetPosition":
            _, pos = parameters.unpack()
            self.position_sec = max(0, min(self.duration_sec, pos / 1_000_000))
            print(f"Position set to: {self.position_sec:.1f}s")
            self.emit_properties_changed({"Position": GLib.Variant("x", int(self.position_sec * 1_000_000))})
        invocation.return_value(None)

    def handle_get_property(self, conn, sender, object_path, interface_name, property_name):
        if interface_name == "org.mpris.MediaPlayer2":
            if property_name == "Identity":
                return GLib.Variant("s", "Mock Media Player")
            elif property_name == "DesktopEntry":
                return GLib.Variant("s", "org.gnome.Music")
            elif property_name in ("CanQuit", "CanRaise", "HasTrackList"):
                return GLib.Variant("b", False)
        elif interface_name == "org.mpris.MediaPlayer2.Player":
            if property_name == "PlaybackStatus":
                return GLib.Variant("s", self.status)
            elif property_name == "Position":
                return GLib.Variant("x", int(self.position_sec * 1_000_000))
            elif property_name == "Metadata":
                return GLib.Variant("a{sv}", {
                    "mpris:trackid": GLib.Variant("o", "/org/mpris/MediaPlayer2/Track/1"),
                    "mpris:length": GLib.Variant("x", int(self.duration_sec * 1_000_000)),
                    "xesam:title": GLib.Variant("s", self.title),
                    "xesam:artist": GLib.Variant("as", [self.artist]),
                    "xesam:album": GLib.Variant("s", self.album),
                })
            elif property_name in ("CanControl", "CanPlay", "CanPause", "CanSeek"):
                return GLib.Variant("b", True)
            elif property_name in ("CanGoNext", "CanGoPrevious"):
                return GLib.Variant("b", False)
        return None

    def emit_properties_changed(self, changed_props):
        builder = GLib.VariantBuilder(GLib.VariantType("a{sv}"))
        for k, v in changed_props.items():
            builder.add_value(GLib.Variant("{sv}", (k, v)))
        invalidated = GLib.Variant("as", [])
        body = GLib.Variant("(sa{sv}as)", ("org.mpris.MediaPlayer2.Player", builder.end(), invalidated))
        self.conn.emit_signal(
            None,
            "/org/mpris/MediaPlayer2",
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
            body
        )

    def tick(self):
        if self.status == "Playing":
            self.position_sec += 1
            if self.position_sec >= self.duration_sec:
                print("Track finished!")
                self.loop.quit()
                return False
            pct = int((self.position_sec / self.duration_sec) * 100)
            print(f"▶ [{pct:02d}%] {int(self.position_sec)}s / {self.duration_sec}s - {self.title}")
        return True

    def run(self):
        try:
            self.loop.run()
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            Gio.bus_unown_name(self.owner_id)

if __name__ == "__main__":
    duration = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 30
    title = sys.argv[2] if len(sys.argv) > 2 else "Blinding Lights"
    artist = sys.argv[3] if len(sys.argv) > 3 else "The Weeknd"
    player = MockPlayer(title=title, artist=artist, duration_sec=duration)
    player.run()
