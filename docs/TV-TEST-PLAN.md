# What to test on the real TV, per Phase 2 step

Each step ends with something Richard checks on the 43UM670H0UA (hoteldemo). Deploy with

```
curl -fsSL https://raw.githubusercontent.com/caritechsolutions/codenameduck/<branch>/install.sh | sudo COOPCENTRIC_BRANCH=<branch> bash
```

then power-cycle the TV (dev-mode xait 0/0 reloads the app on every power cycle).

## Step 2 — admin, live push, heartbeats

Server side, once, after the install finishes:

1. `sudo journalctl -u coopcentric | grep -A2 'INITIAL SUPERADMIN'` — the generated `admin`
   password is printed exactly once, on the first boot with an empty users table.
2. Open `http://hoteldemo.caritech.net/admin`, log in as `admin`.

On the TV / in admin:

1. **Sets** lists the 43UM670H0UA as *online · live* (green dot, "live" = WebSocket connected),
   with the room-on-TV shown as `[TV]<serial>` and flagged "factory default", and room = "no room".
2. Delete the junk set `TEST0001` from its drawer (Danger zone → Delete).
3. **Groups** → New group "Standard rooms". **Layouts** → New layout "Standard room"
   (starter JSON). In the layout editor, change the welcome text, click **Save & publish**.
4. Open the set's drawer, set Room = 204, Group = Standard rooms, Save. Within a second the TV
   must switch from the "not yet assigned" screen to the layout: "Welcome to hoteldemo",
   "Room 204", clock. (Video/channel_list zones are still placeholders until step 3.)
5. In the drawer, the commands table shows `set_property → acked`. Power-cycle the TV: it should
   now report room 204 in the "Room on TV" line (LG property written by the renderer).
6. Edit the layout text again and Save & publish → TV redraws immediately without a power cycle.
7. Dashboard: online count 1, "1 live". Unplug the TV's network for 4 minutes → it turns offline
   (red) and appears in "Offline sets"; plug back in → online again within ~60 s (poll) or
   immediately (WebSocket reconnect).
8. "Reboot TV" and "Reload app" buttons in the drawer: reboot must reboot the set; reload must
   reload the app. Both should show `acked` in the commands table.

## Step 3 — channels, lineups, live video, remote keys, commands

Prerequisite: an IP multicast (or HLS URL) stream reachable from the TV's network.

1. **Channels** → New channel: number 5, name, IP multicast `239.x.x.x:port` (udp). Add a second
   one. Optionally an HLS URL channel (uses the TV's media player instead of the tuner).
2. **Lineups** → New lineup, add both channels, Save & publish, tick group "Standard rooms".
3. **Layouts** → open "Standard room". The starter JSON has a `video` zone (right) and a
   `channel_list` zone (left). Save & publish. Within a second the TV must show live video
   inside the video rectangle, the channel list on the left with the current channel highlighted,
   and a channel banner ("5  Name") for ~3 s.
4. Remote: **CH+ / CH−** walk the lineup (banner + highlight follow). **Digits** ("7" then wait
   2.5 s, or digit + OK) jump by channel number; an unknown number shows "no such channel".
   **INFO** shows the banner. **PORTAL** (or GUIDE) toggles the full-screen screen (video only)
   and back. If the layout has a `menu` zone: **UP/DOWN** move focus, **OK** activates, **BACK**
   closes a page. **VOL+/−/MUTE** stay with the TV firmware.
5. Admin set drawer: **Tune to** a channel → TV changes and command shows `acked`. **Volume**
   set + **Mute** → TV follows; the drawer's "Channel / volume" line updates on the next
   heartbeat (≤60 s). **Message** → red bar at the bottom of the TV for the given seconds.
   **Toast** → LG system toast. **Screenshot** → after a few seconds a "Screenshot … ago" link
   appears in the drawer; open it. If instead the command shows `acked` with a note like
   "capture uri not readable", tell me the note text — the TV's capture URI scheme needs a
   different fetch path. **Reboot**, **Power off**, **Checkout**, **Reload app**: each `acked`
   and the TV does it (power off: TV goes to standby; power *on* from the app is not possible).
6. Select two or more sets with the checkboxes → bulk bar: message / reboot to all selected.
7. Edit the lineup (remove the current channel) → TV retunes to the first channel immediately.
8. HLS URL channel (if defined): switching to it and back to a multicast channel must work
   (media player start/stop is sequenced as in LG's Channel_Media sample).

## Step 4 — canvas layout editor

1. **Layouts** now shows a thumbnail per layout. Open "Standard room": the **Canvas** tab shows
   the 16:9 canvas with the zones. Click the welcome text zone → the right panel shows its
   properties. Drag it somewhere else, resize it with a corner handle, change the text.
   **Save & publish** → the TV redraws with the new position within a second.
2. Resize the **video** zone by a corner: it keeps 16:9 (hold Alt to break it). Save → live
   video on the TV moves/resizes to the new rectangle (video/size/set) without retuning.
3. "Add zone: menu" → a menu appears; edit its items (e.g. "Full screen" = fullscreen_tv, "Info"
   = show_page → page id `info`); add an `html` zone with id `info` (it is hidden = a page).
   Save. On the TV: UP/DOWN move the highlight, OK on "Info" opens the page, BACK closes it,
   PORTAL toggles full-screen video.
4. Click empty canvas → the panel shows canvas background, screens and remote-key mapping. Map
   RED → `home`. Save. RED on the remote returns to the home screen.
5. **Preview on a set** pushes the unsaved canvas to the live TV; Save afterwards makes it
   permanent, or reload the page to discard (the TV falls back on its next real update).
6. **JSON** tab shows the same document; a change there is reflected on the canvas and vice
   versa. Ctrl+Z undoes canvas edits; Delete removes the selected zone.

## Step 5 — weather, messages, checkout, users, settings, tenants

1. **Settings**: set hotel name, latitude/longitude, click "Check weather now" (server fetches
   Open-Meteo). Upload a logo. Save.
2. **Layouts** → add a `weather` zone and an `image` zone with src `{{logo}}`. Save & publish.
   TV shows "☀ 24°C Clear" and the logo. (Weather refreshes every 15 min on the TV.)
3. **Messages** → send "Pool closed today" to all sets, 60 min. TV shows a red bar at the
   bottom immediately; "Take down" removes it immediately. Send one to the set's group and one
   to the set only; the most recent one shows.
4. **Set drawer → Checkout**: confirm. The TV runs LG checkout (`tv/checkout/request`) — LG
   recommends a reboot afterwards; watch whether the set reboots itself or needs "Reboot TV".
   The set-targeted message disappears; the command shows `acked`; if a checkout message is
   configured in Settings it appears for 20 s.
5. **Users**: create a tenant-admin, log in as them in a private window: same pages, no
   "Tenants" entry, cannot see other tenants' users. Change your own password from the Users
   page; the seeded `admin` password from the journal should now be changed.
6. **Tenants** (superadmin): create a test tenant (e.g. `hotelb` / `hotelb.caritech.net`). The
   server runs `sudo coopcentric-tenant new` (install.sh added /etc/sudoers.d/coopcentric). The
   output appears below the table; `coopcentric-tenant list` on the VM shows it; its /admin
   answers once DNS points at the VM. If it fails with a sudo error, send me the output.
7. **Channels → Import CSV**: Export first, edit, import — existing numbers update, new ones
   are created, bad lines are reported.
8. Re-run `install.sh`: uploaded logo/assets must survive (deploy excludes `assets/`).
