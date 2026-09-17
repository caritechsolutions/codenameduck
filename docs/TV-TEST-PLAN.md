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

## Step 3b — fixes from the first step 3 TV session

Deploy, then `sudo coopcentric-tenant deploy` re-renders the managed vhost with the new cache
rules; check `curl -sI http://hoteldemo.caritech.net/procentric/application/index.html | grep -i cache`
says `no-store` and `.../lib/idcap.js` says `immutable`.

1. **Full screen with HLS.** Tune to the HLS channel, press PORTAL: the picture must fill the
   whole screen; PORTAL again returns it to the video rectangle. Then the same on a multicast
   channel (that path uses `video/size/set`). URL channels now play in an HTML5 `<video>`
   element inside the video zone; if the element cannot play a stream the renderer falls back to
   LG's media pipeline and logs the reason. Tell me which path the set reports: the set drawer's
   events show `tv_channel` with `mode: html5` or `mode: platform`.
2. **On-screen message.** Drawer → Message "Your taxi is here", 30 s → a boxed popup near the
   top of the screen; Messages page → a bar at the bottom. Both at once must be visible. Root
   cause was the OSD layer not being scaled to the TV's resolution, so it was drawn off screen.
3. **Digits and INFO.** Type 7: the digit shows top-right, tunes after 2.5 s (or OK). INFO shows
   "5  News  20:15" for ~3.5 s bottom-left.
4. **Errors.** Tune to the H.265 HLS channel: the drawer now shows a red "Last TV error" box
   (kind `media`, the HTML5 error, then the platform fallback error if that also fails) and
   `journalctl -u coopcentric` shows `TV ERROR set N: [media] …`. Pull the TV's network cable for
   a minute and plug it back in: events `tv_ws close` / `tv_ws open (reconnect)` appear.
5. **Instant On.** Groups → power mode WARM for "Standard rooms". The TV's drawer shows
   `Power / uptime: WARM …` on the next heartbeat. Power the set off and on with the remote: the
   app should be back immediately without a reload (WARM keeps it resident). Set NORMAL to
   revert; "— leave as is —" stops the server from touching it.
6. **Toast** still works (parameter is now `msg` only, text cut at 162 bytes).
7. Screenshot remains "capture uri not readable" — parked until LG's file-path doc is in the repo.

## Step 3c — persistent video, OSD placement, start channel, Instant On via instant_power

1. **PORTAL on HLS.** Tune the H.265 HLS channel, press PORTAL: the picture fills the screen
   with audio and keeps playing; PORTAL again: back to the rectangle, still playing, no zap
   needed. The `<video>` element is now created once and only repositioned. Same on multicast
   (only `video/size/set` is called; the set's events show no `tv_channel` during the switch).
2. **Hidden video.** Make a screen without the video zone (e.g. an "info" screen reached from a
   menu item `show_page`, or a second screen mapped to a key). Opening it must stop audio/video
   (tuner: `channel/stop`, so the set leaves the multicast group; HLS: `<video>` pauses); leaving
   it resumes (`channel/replay` / play) without a re-tune. Check with `journalctl`/drawer events:
   no `tv_channel` event for the round trip.
3. **Start channel.** After the lineup loads the set's own start channel is programmed with the
   first multicast/RF channel (`tv/channel/startchannel/set`; events show `tv_start_channel`).
   Power the set off and on: it should come up on that channel instead of raster/no-signal before
   the app draws. If the lineup has URL channels only, the start channel is disabled.
4. **OSD placement.** Layouts → add zone "banner", drag it (e.g. top centre), Save. INFO shows the
   banner there. Same for "digits" (typed channel numbers) and "popup" (message command). Delete
   the zone → default positions (bottom-left, top-right, upper centre).
5. **Instant On.** Groups → "Instant On (instant_power=1)". The drawer's Power line shows
   "Instant On on" after the next heartbeat (the set reports the property back). Power off/on with
   the remote: the TV handles WARM itself; the app must be back instantly. The renderer no longer
   calls `powermode/set` at all; the admin "Power off" still uses `power/command powerOff`. Set
   "Normal (instant_power=0)" and confirm it reverts.
6. **Channel forms.** New fields: IP multicast has Source address (IGMPv3) and Video codec
   (MPEG2/H264/HEVC); RF has Video codec and, for terrestrial_2 (DVB-T2), PLP ID. Try HEVC on a
   multicast channel if you have one; CSV export/import carries the new columns.

## Phase 3 Part A — fixes from the 3c hardware test

1. **Banner zone saves.** Layouts → add zone "banner" (or "digits"/"popup") → Save & publish
   must succeed (the block was the admin's own validator, not the server). All three lists —
   renderer, admin, server — now read `shared/zone-types.json`.
2. **Instant On is now a visible command.** Groups → Instant On. Open each set's drawer: a
   `set_property {instant_power: 1}` command appears, goes `sent` → `acked` (result shows the
   value the TV read back and whether it took a number or a string) or `failed` with the TV's
   reason (also in the journal as `command #N set_property FAILED …`). The renderer writes,
   reads back, and if the value did not stick retries with the other type. After `acked`, the
   drawer's Power line shows "Instant On on" on the next heartbeat. A set that later registers
   reporting 0 while its group says WARM gets the command again automatically. Tell me the
   result text: `sent_as: number` or `string` is the answer to LG's value-type question.
3. **No "No Signal" over the layout.** With an HLS-only lineup, power-cycle the set: the layout
   must come up without LG's No Signal OSD (the renderer calls `nosignalimage/set off` before
   starting an HTML5 channel and `default` before a tuner channel). Zap to a multicast channel
   and back: the OSD state follows. If the OSD still appears on HLS, tell me: the fallback is to
   park the tuner on a stopped multicast channel as a silent background source.

## Phase 3 Part A2 — instant_power as string, external input

1. **Instant On.** Groups → Instant On. The set's drawer shows `set_property {instant_power: 1}`
   → `acked` with result `value: "1", sent_as: string` (the TV only accepts string property
   values). The Power line shows "Instant On on" after the next heartbeat. Remote power off/on:
   the app must be back instantly. Then set Normal and confirm `value: "0"`.
2. **No external-input OSD.** Put the set on an HDMI input (INPUT key), then reload the app
   (drawer → Reload app) or power-cycle: the renderer must switch the set back to TV before the
   HLS channel starts; the layout appears without LG's "check the power of the external devices"
   message. The drawer's events show `tv_input {from: "HDMI", to: "TV"}`. A set already on TV
   logs nothing.
3. HLS-only lineup power-cycle again: no OSD of either kind (`nosignalimage/set off` still runs
   for the tuner case).

## Phase 3 Part A3 — instant_power values

1. Groups → Instant On (2). Drawer: `set_property instant_power` acks with `value: "2"`; the Power
   line shows "Instant On (2)". Remote power off → the set goes straight to WARM(WAIT) and comes
   back instantly on power on.
2. Switch to "Always On (10)" and "Off (0)": each acks with the matching string and the label
   follows on the next heartbeat. "Instant On with update-on-off (1)" is there for completeness;
   expect a slower return from standby.

## Phase 3 Part B1 — media library, no boot raster

1. **No tuner raster at boot.** Lineup whose first channel is HLS, layout with a solid canvas
   background. Power-cycle the set: the video square must show the layout background until the
   stream has frames, then the picture — never a flash of the last tuner raster. The `url('TV:')`
   hole now only exists after a tuner channel is selected; the `<video>` element is invisible until
   its `playing` event. Then CH+ to a multicast channel: the hole appears and the tuner picture
   shows as before. Back to HLS: background, then stream.
2. **Media page.** Admin → Media. Drop a PNG/JPG, an SVG and a short MP4 onto the page: tiles
   appear with thumbnails (MP4 shows a ▶ glyph), width×height and size. Upload a text file
   renamed `.png`: rejected with "unsupported file type". Rename a file (Enter or Rename button).
3. **Same-origin on the TV.** In a layout, add an image zone → Library… → pick the PNG. Save &
   publish: the picture shows on the set. In the nginx access log the request is
   `/procentric/application/media/<uuid>.png` with `Cache-Control: public, max-age=31536000,
   immutable` (check with `curl -I http://<host>/procentric/application/media/<uuid>.png`).
   `sudo coopcentric-tenant deploy <name>` must leave `media/` in place.
4. **Canvas background from the library.** Canvas panel (nothing selected) → Background image →
   Library… → pick a photo. Publish: the set shows it behind the zones.
5. **Delete is blocked while in use.** Media → select that PNG → Delete: a dialog lists "Layout
   …" with a link, and "The hotel logo" when it is the logo. Remove the zone, publish, delete
   again: gone from the grid and from `media/` on disk.
6. **Logo via the library.** Settings → Upload logo: the file lands in Media with the "logo"
   badge; a `{{logo}}` image zone updates on the set (force redraw is pushed). Media → select
   another image → "Use as hotel logo": the badge moves, the zone follows.
7. **Legacy assets.** hoteldemo's existing `assets/` files keep working (Settings shows them
   under "Legacy assets" only while any exist).

## Phase 3 Part B2 — canvas editor, templates, fonts, in-editor preview

1. **New layout from template.** Layouts → New layout: four template cards with thumbnails
   (Classic, Full-screen TV with overlay bar, Welcome page with big photo, Info / menu page).
   Create one of each and assign to the test group: each must draw on the set as the editor's
   Preview tab shows it (same drawing code). Welcome page: pick a photo for the `photo` zone
   from the Media library first; "Watch TV" opens the full-screen tuner, BACK returns.
2. **Fonts on the set.** Classic uses Inter, Full-screen uses Roboto, Welcome uses Playfair
   Display + Inter, Info uses Montserrat. The set must render them (served from
   `/procentric/application/fonts/`, check `curl -I http://<host>/procentric/application/fonts/inter.woff2`
   → 200, `Cache-Control: public, max-age=2592000`). If a family falls back to LG's font, tell me
   which model/webOS — variable WOFF2 may need static files on old Chromium.
3. **Variables tick.** A text zone with `{{time}}` / `{{date}}` (Full-screen template bar) must
   update within a minute without a layout push. `{{guest_first}}` and `{{checkout_date}}` are
   blank until Part C (PMS) — the Preview tab shows sample values.
4. **Editor UX (in the browser, no set needed).** Palette drag onto the canvas lands the zone
   where dropped; shift-click selects several; drag moves them together with magenta guides
   when edges/centres line up (8 px grid, Alt = free); toolbar align/distribute/front/back;
   lock (padlock in the label, no move/resize); eye toggles the zone on the current screen;
   Ctrl-D duplicates; Delete removes; Ctrl-Z / Ctrl-Shift-Z undo/redo up to 50 steps.
   Property panel: font picker, size slider, B/I, alignment, colour swatches, padding/radius/
   opacity sliders, text shadow; "Insert variable…" drops `{{…}}` at the caret.
5. **Screens as tabs.** Tabs above the canvas; "+ screen" adds e.g. `channels`; a menu item's
   action picker lists "Open page …" (hidden zones), "Go to screen …" and built-ins. On the set:
   OK on "Go to screen channels" shows that screen, BACK returns to home (screen stack).
6. **Inline validation.** Advanced tab → change a zone type to `bogus`: a red "!" badge appears
   on that zone in the canvas and the message in its panel; nothing pops up; Save is disabled
   until fixed.
7. **Preview tab.** Draws with sample channels ("BBC Two" current), weather, guest "Jane",
   room 214; hidden pages can be opened from the "Open page" selector; the fullscreen tab shows
   the video placeholder over the whole canvas. Compare against the set after publishing.

## Phase 3 Part B3 — apps

1. **Discovery.** Power-cycle the set. Journal shows `register … apps=N`. Admin → Apps lists
   the LG apps (Netflix, YouTube, Prime, browser, …) with the model in "Seen on". Click **Raw**
   on one row and tell me the exact shape LG returned (keys for id / title / icon) — the server
   normalises `id|appId|name`, `title|name`, `icon|iconUrl`; if the columns look wrong the
   raw entry says why. On an HCAP-only set the list comes from
   `hcap.preloadedApplication.getPreloadedApplicationList` + `hcap.application.getApplicationList`.
2. **Enable per group.** Tick Netflix and YouTube for the test group. In a layout add an
   **Apps (tiles)** zone (palette → Menu) and publish: tiles appear on the set at once (WS `apps`
   push), in the order ticked. Untick one: it disappears live.
3. **Navigation + launch.** UP/DOWN/LEFT/RIGHT move the highlight across menus and tiles, OK
   launches with `application/launch { id, params: {}, noSplash: true }`. Netflix must open
   without LG's splash. If a launch fails, the drawer shows a `tv_error` with LG's message. A
   `menu` item can target an app too (action "Launch app…", pick from the discovered list).
4. **Back from the app.** Press EXIT / PORTAL in Netflix: our app is in front again, the HTML5
   channel resumes (tuner channels: `channel/replay`), keys are re-claimed (CH± work), and the
   drawer's events show `tv_visibility {hidden:false, resumed:true, away_s}`. Tell me whether
   the page really got `visibilitychange` while Netflix was in front — if not, LG kept our app
   running and the pause/resume never fired (harmless but worth knowing).
5. **Icons.** Apps → Edit → icon from the Media library: the tile shows it. LG's own icon path
   (`/usr/palm/…`) is recorded but never used (not reachable by the page).
6. **Checkout vs app sign-ins (document, don't fix yet).** Sign in to Netflix on the set, then
   Sets → drawer → Checkout. Reopen Netflix: is it signed out? Report yes/no. If no, we look at
   `tv/checkout/request` parameters and `application/uninstall` + `install` (Part C).
