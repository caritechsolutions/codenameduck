# Renderer notes — patterns taken from LG's own sample apps

Source: LG Pro:Centric sample apps (copied, minus binaries, into `docs/lg-samples/`).
These are the mechanics the `tv-app` renderer must use. Everything below is from LG code,
not inferred.

## 1. Showing live video inside the layout

The TV video plane sits *behind* the web page. You make it visible by giving an element a
transparent "hole":

```html
<div id="tv" style="position:absolute; left:500px; top:350px; width:379px; height:218px;
                    background-image: url('TV:');"></div>
```

then tell the TV where to draw the video so it lines up with that element:

```js
idcap.request("idcap://video/size/set", { parameters: { x:500, y:350, width:379, height:218 } });
```

Do the `video/size/set` **after** the `idcap::channel_changed` event reports `result == true`
(LG's channel sample does exactly this). Full-screen TV = hide the app: LG's tvLayer sample
uses `document.body.style.visibility = "hidden"` + `document.body.style.backgroundImage =
"url('TV:')"`, and restores with `visibility = "visible"` + `backgroundImage = "url('')"`.
Coordinates are in the OSD resolution (`display_resolution` property: 1280x720 / 1920x1080 /
3840x2160). Our layout canvas is 1920x1080; scale if the set reports otherwise.

`osd_transparency_level` (property, 0–100) controls how much of the page shows over video.

## 2. Tuning

```js
// IP multicast
idcap.request("idcap://tv/channel/change/request",
  { parameters: { channelType:"ip", ip:"239.1.1.10", port:5000, ipBroadcastType:"udp" } });
// RF terrestrial (class 2)
idcap.request("idcap://tv/channel/change/request",
  { parameters: { channelType:"rf", frequency:63000000, programNumber:1, rfBroadcastType:"terrestrial" } });
```

Result arrives on `document.addEventListener("idcap::channel_changed", fn)` with
`param.result` / `param.errorMessage`. `idcap://tv/channel/get` returns the current channel
(logicalNumber, ip, port, ipBroadcastType, …). `channel/stop` / `channel/replay` stop and
restart AV without changing channel.

For HLS/HTTP/RTSP streams use the media path instead: `tv/media/startup → create {url,
mimeType} → control {command:"play"}`; `destroy` + `shutdown` before tuning a channel again.
Channel_Media sample shows switching between the two.

## 3. Remote-control keys

Keys arrive as normal `keydown` events; use `event.keyCode`. LG's key codes (from the
samples — same table for HCAP and IDCAP):

```
NUM_0..9  0x30–0x39     LEFT 0x25  UP 0x26  RIGHT 0x27  DOWN 0x28  ENTER 0x0D
CH_UP 0x1AB  CH_DOWN 0x1AC  VOL_UP 0x1BF  VOL_DOWN 0x1C0  MUTE 0x1C1
BACK 0x1CD  EXIT 0x3E9  INFO 0x1C9  GUIDE 0x1CA  PORTAL 0x25A  MENU 0x12  SETTINGS 0x263
RED 0x193 GREEN 0x194 YELLOW 0x195 BLUE 0x196
PLAY 0x19F PAUSE 0x13 STOP 0x19D REWIND 0x19C FAST_FORWARD 0x1A1
TV 0x2DA  SMART_HOME 0x2DE  POWER 0x199 (not delivered to apps)
```

**Who handles a key** is set per key via the key table:

```js
idcap.request("idcap://system/key/add",
  { parameters: { keycode:0, virtualKeycode:"CH_UP", attribute:1 } });
```

attribute `0` = TV firmware handles it (e.g. TV does its own channel up), `1`/`2` = delivered
to the app. `idcap://system/key/reset` restores factory table. The renderer should claim
CH_UP/CH_DOWN/numbers/PORTAL/GUIDE/INFO so the lineup is ours; leave VOL/MUTE with the TV
unless a layout says otherwise. `block_hotkey` property makes PORTAL/GUIDE/INFO always
focus the app. `idcap://configuration/idcapmode/set` (`mode` 0/1…) governs app visibility vs
key control — tvLayer sample toggles it; read `Configuration/configuration_idcapmode` doc
before using.

## 4. Lifecycle

- `webOSLaunch` / `webOSRelaunch` events on `document` (relaunch only if `handlesRelaunch`).
- `visibilitychange` (or `webkitvisibilitychange`) — pause media / stop audio when hidden,
  resume when shown. This matters when the guest launches Netflix and comes back.
- Back key: use `history.pushState` per screen and handle `popstate`; an empty stack sends
  the user to LG's home, so the renderer keeps at least one entry.
- Storage: `localStorage` works (16 MB cap) but is wiped on factory reset and on app update —
  keep state on the server, cache only.
- `PORTAL` → `window.location.href = ""` is LG's "restart app" idiom.

## 5. Power / Instant On

`tvPower_wol` sample: `idcap://power/powermode/get|set` (NORMAL / WARM), `power/command`,
Wake-on-LAN. In WARM (instant-on) mode the app stays loaded while the screen is off — the
renderer must handle `idcap::power_*` events and not assume a fresh boot per power cycle.
Heartbeats should carry the power mode.

## 6. HCAP equivalents

The HCAP samples (`Channel_Sample_App`, `Key_Sample_App`, `tvLayer_Sample_App`, …) are the
same scenarios with `hcap.channel.requestChangeCurrentChannel`, `hcap.video.setVideoSize`,
`hcap.key.addKeyItem`, `hcap.mode.setHcapMode`, and events named without the `idcap::`
prefix (`channel_changed`). Use them as the reference for the HCAP adapter.
