# CoopCentric platform — Phase 2 specification

Read `CLAUDE.md` first; it holds the verified facts about how LG Pro:Centric TVs fetch
`xait.xml` and load the app. This document specifies the full platform that replaces the
LG Pro:Centric server. In-room hotel TVs only for now; signage is out of scope.

Verified on the first real set (2026-09-14): **LG 43UM670H0UA**, webOS 8.3.0 (webOS 23),
firmware 03.25.80, **IDPN 306**, HCAP middleware 1.24.0 — both IDCAP and HCAP paths work.

## Goals

- Every TV is identified by serial number, assigned a **room number**, and placed in a **group**.
- **Layouts** are designed in the admin UI and assigned to groups (with per-set override).
- **Channel lineups** are defined per tenant and assigned to groups. IP channels now; RF
  channel types are modelled and stored from day one so RF works without a schema change.
- Admin can see the fleet (online/offline, model, firmware, room, group), push commands
  (reboot, message, tune, screenshot, power), and publish layout changes without touching
  `xait.xml`.
- Multi-tenant: one hotel per tenant, one hostname per tenant, one admin login scope per tenant
  plus a super-admin across tenants.

## Stack (decided)

- **Server:** Node.js 20 LTS, Express, `better-sqlite3` (one SQLite file per install at
  `/srv/coopcentric/data/coopcentric.db`), `ws` for WebSockets. Runs as a systemd service
  `coopcentric.service` on port 3000, proxied by the local nginx.
- **Admin UI:** Vite + React, served by the same Node process at `/admin`. Login with
  username/password (bcrypt), session cookie. Roles: `superadmin`, `tenant-admin`.
- **TV renderer (`tv-app/`):** vanilla JavaScript, bundled by esbuild with `--target=es2015`
  (older HCAP-only sets run older Chromium). No framework. Uses the vendored `hcap.js` and
  `idcap.js`. Probe stays available as `tv-app/probe.html`.
- Everything the TV needs is fetched from **its own tenant hostname** (same origin), so no CORS.

## Nginx layout per tenant hostname

```
server {
    listen 80;
    server_name {{HOSTNAME}};
    root /srv/coopcentric/tenants/{{NAME}};

    location /procentric/  { autoindex off; add_header Cache-Control "no-store"; }   # static, TV reads
    location /api/         { proxy_pass http://127.0.0.1:3000; }                     # tenant-scoped API
    location /ws/          { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1;
                             proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
    location /admin        { proxy_pass http://127.0.0.1:3000; }
    location = /           { return 302 /admin; }
}
```

The Node server resolves the tenant from the `Host` header. Keep the static `/procentric/` tree
on nginx — the TV's xait/app fetch must keep working even if Node is down.

## Data model (SQLite)

```
tenants        id, name (slug), hostname, display_name, created_at
users          id, tenant_id (null = superadmin), username, password_hash, role
groups         id, tenant_id, name, description
sets           id, tenant_id, serial (unique per tenant), mac, model, platform_version,
               firmware_version, idpn, api (idcap|hcap), room_number, group_id,
               layout_override_id, ip, last_seen, first_seen, online (derived), notes
layouts        id, tenant_id, name, version, json (layout document), updated_at
layout_assign  group_id -> layout_id           (one active layout per group)
channels       id, tenant_id, number, name, logo_url, type (ip|rf), params_json, enabled, sort
               params_json examples:
                 ip:  {"ipBroadcastType":"udp","ip":"239.1.1.10","port":5000}
                 ip:  {"url":"http://.../stream.m3u8","mimeType":"application/x-mpegURL"}  (media player path)
                 rf:  {"rfBroadcastType":"terrestrial","frequency":63000000,"programNumber":1}
                 rf:  {"rfBroadcastType":"satellite_2","frequency":..,"programNumber":..,"satelliteId":..,"polarization":"vertical"}
lineups        id, tenant_id, name
lineup_items   lineup_id, channel_id, position
lineup_assign  group_id -> lineup_id
messages       id, tenant_id, target_type (set|group|all), target_id, text, expires_at, created_at
commands       id, tenant_id, set_id, type, payload_json, status (queued|sent|acked|failed), result_json, created_at
events         id, tenant_id, set_id, type, payload_json, created_at   (heartbeats, key presses opt-in, errors)
```

Channel `params_json` maps 1:1 onto the parameters of `idcap://tv/channel/change/request`
(see `docs/idcap-api-index.md` and LG's channel classes: RF class 1–6, IP class 1–2). Store
what the TV needs, don't reinterpret it.

## TV ↔ server protocol

All under the tenant hostname.

1. **Boot:** renderer detects API (IDCAP probe, HCAP fallback, as in `probe.html`), reads
   `serial_number`, `model_name`, `platform_version`, `firmware_version`, `webos_version`,
   `idpn`, `room_number`, then `POST /api/tv/register` with those. Response:
   ```json
   { "set_id": 12, "room_number": "204", "group": {"id":1,"name":"Standard rooms"},
     "layout": { ...layout document... }, "lineup": [ {number,name,logo_url,type,params}, ... ],
     "messages": [...], "ws_url": "/ws/tv", "poll_interval_s": 60 }
   ```
   Unknown serial → server creates the set with `room_number = null`, `group_id = null`,
   returns the tenant's **default layout** (a "This TV is not yet assigned — serial XXXX" screen
   showing the serial in large type so staff can find it in admin).
2. **Live channel:** WebSocket `/ws/tv?set_id=..&token=..` (token issued at register).
   Server pushes `{type:"layout"|"lineup"|"message"|"command", ...}`. Renderer acks commands
   with `{type:"ack", command_id, ok, result}`. If WS is unavailable, renderer falls back to
   `GET /api/tv/poll` every `poll_interval_s`.
3. **Heartbeat:** every 60 s over WS (or with poll): `{type:"hb", channel, volume, uptime}`.
   `online` = heartbeat within last 3 minutes.
4. **Room number:** when admin sets/changes a set's room, server queues command
   `set_property {key:"room_number", value:"204"}` so the TV's own property matches.

## Commands the renderer must implement (IDCAP first, HCAP equivalent where it exists)

| command | IDCAP | HCAP |
|---|---|---|
| `reboot` | `idcap://power/command` (powerCommand reboot) | `hcap.power.reboot` |
| `power` on/off | `idcap://power/command` | `hcap.power.setPowerMode` |
| `tune` {channel params} | `idcap://tv/channel/change/request` | `hcap.channel.requestChangeCurrentChannel` |
| `volume` {level} / `mute` | `idcap://audio/volumelevel/set`, `audio/mute/set` | `hcap.volume.*` |
| `message` {text, ttl} | on-screen overlay in renderer (not toast) | same |
| `toast` {text} | `idcap://utility/toastmsg/create` | `hcap.system.showToastMessage` |
| `screenshot` | `idcap://utility/screen/capture` → upload to `POST /api/tv/upload` | `hcap.system.requestScreenCaptureImage` |
| `set_property` {key,value} | `idcap://configuration/property/set` | `hcap.property.setProperty` |
| `reload_app` | `idcap://procentric/application/launch` | `hcap.system.launchHcapHtmlApplication` |
| `checkout` | `idcap://tv/checkout/request` | `hcap.checkout.request` |
| `launch_app` {app_id} | `idcap://application/launch` | `hcap.application.launchApplication` |

Verify each HCAP method name against `hcap.js` symbols before use — the table is the intent,
the library is the truth. Channel-change completion is signalled by the `channel_changed`
event, not the callback (LG async rule).

## Layout document (v1)

```json
{
  "schema": 1,
  "name": "Standard room",
  "canvas": {"w": 1920, "h": 1080, "background": "#0b1a2a", "backgroundImage": null},
  "zones": [
    {"id":"tv",      "type":"video",       "x":0,"y":0,"w":1920,"h":1080, "source":"lineup", "startChannel":"first"},
    {"id":"welcome", "type":"text",        "x":80,"y":60,"w":900,"h":120, "text":"Welcome to {{hotel}}, {{guest}}", "style":{...}},
    {"id":"logo",    "type":"image",       "x":1600,"y":40,"w":260,"h":120, "src":"/procentric/application/assets/logo.png"},
    {"id":"chlist",  "type":"channel_list","x":80,"y":760,"w":600,"h":280, "style":{...}},
    {"id":"clock",   "type":"clock",       "x":1700,"y":980,"w":180,"h":60, "format":"HH:mm"},
    {"id":"menu",    "type":"menu",        "x":80,"y":200,"w":420,"h":520,
       "items":[{"label":"Live TV","action":"fullscreen_tv"},{"label":"Netflix","action":"launch_app","app_id":"netflix"},
                {"label":"Hotel info","action":"show_page","page":"info"}]},
    {"id":"info",    "type":"html",        "x":0,"y":0,"w":1920,"h":1080, "hidden":true, "html":"..."}
  ],
  "keys": {"PORTAL":"toggle_menu","BACK":"close_page"},
  "screens": [{"id":"home","zones":["tv","welcome","logo","chlist","clock","menu"]},
              {"id":"fullscreen","zones":["tv"]}]
}
```

Zone types for v1: `video`, `text`, `image`, `channel_list`, `clock`, `menu`, `html`,
`weather` (server-side fetched, cached), `app_launcher`. Text supports `{{hotel}}`,
`{{room}}`, `{{guest}}` (guest name comes later with PMS; blank until then).

The video zone drives `idcap://video/size/set` (or HCAP `hcap.video.setVideoSize`) to place
live TV inside the layout, and uses the assigned lineup for channel up/down. IP channels of
the `url` form use the media player path (`tv/media/startup → create → control play`) instead
of `tv/channel`.

## Admin UI (React)

Pages: Login · Dashboard (fleet status counts, offline list) · Sets (table, filters, bulk
group/room edit, detail drawer with live status, commands, screenshot) · Groups · Layouts
(list, duplicate, **canvas editor**: drag/resize zones on a 16:9 canvas, zone property panel,
live JSON view, "Preview on set" pushes an unsaved layout to one TV) · Channels (CRUD, import
CSV, RF/IP forms driven by channel class) · Lineups (drag ordering, assign to groups) ·
Messages · Tenant settings (name, hostname, default layout, logo upload → tenant assets dir)
· Users. Superadmin: Tenants page (create = runs the same logic as `coopcentric-tenant new`).

Publish flow: saving a layout that is assigned to a group pushes it over WS to every online set
in that group immediately; offline sets pick it up at next register/poll. No xait version bump.

## Build order for Claude Code (each step ends with something testable on the real TV)

1. Server skeleton: Node service, SQLite migrations, tenant resolution by Host, `/api/tv/register`
   + `/api/tv/poll`, default "unassigned" layout, systemd unit, nginx template update,
   `install.sh` extended (installs Node 20 from NodeSource, builds admin + tv-app, restarts service).
   Renderer v0: register, show returned layout with `text`/`image`/`clock` zones only.
2. Admin: login, Sets, Groups, room assignment, layout JSON editor (textarea), assign to group.
   WS push of layout changes. Heartbeats + online status.
3. Channels + lineups + `video` and `channel_list` zones; remote-key handling
   (CH+/-, number entry, PORTAL/menu). Commands: tune, volume, message, reboot, screenshot.
4. Canvas layout editor.
5. Weather/html/app_launcher zones, messages, checkout, users/roles, CSV channel import.

Keep `tv-app/probe.html` deployable at all times. Keep every install re-runnable with
`curl … install.sh | sudo bash`.

## Open items (do not block on these)

- HTTPS for the xait fetch is supported by the TV via property `https_xait_xml`
  (0 = http, 1 = https by IP, 2 = https by domain, since IDPN 300). Not enabled yet; the TV
  would need our CA/cert registered via `idcap://security/certificatelist/register` unless the
  cert is publicly trusted. Park until the platform works over HTTP.
- PMS (Opera etc.) integration for guest name and auto checkout — server-side later.
- RF: model and store it now; test when an RF headend is available.
- Remote-deploy (.zip) mode for production resilience.
- `/procentric/system/` — firmware, splash, cloning via LG's expected files.
