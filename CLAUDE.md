# codenameduck — CoopCentric

Caritech's replacement for the LG Pro:Centric server. Serves LG hospitality TVs / STBs
(Pro:Centric Smart, webOS) from our own Ubuntu VM, multi-tenant, one hostname per hotel.
Working name of the server: **coopcentric**.

## How LG Pro:Centric IP deployment actually works (verified from LG docs, Sep 2026)

- The TV is configured in Installation Menu → Pro:Centric: Mode `HTML`, Media Type `IP`,
  Receive Data `Enable`, Server = Domain Name (no scheme, no path) + Port.
- On every **power-off** the TV fetches `http://<host>:<port>/procentric/application/xait.xml`.
  On the next **power-on** it compares `versionNumber` and `Application/version` with the copy
  it has stored; if both are higher it loads the new app. If both are `0` it re-fetches on every
  power cycle (dev mode). Production: increment both by 1 per release (0–65535).
- `xait.xml` `<HcapDescriptor><url>` is absolute and can point anywhere:
  - remote-run: URL to `index.html` — TV runs it live from the web server
  - remote-deploy: URL to a `.zip` — TV downloads to local storage and runs from there
    (needs `<applicationStructure>` with `baseDirectory`, `classpathExtension`, `initialClass`)
- IP mode fields: `frequency=0`, `programNum=0`, `cTag=0`. Fixed values: `isAutoSelect=true`,
  `controlCode=AUTOSTART`, `priority=255`, `type=Hcap-h`.
- Server directory tree the TV expects (names are fixed):
  ```
  <docroot>/procentric/application/   xait.xml + app (or app.zip)
  <docroot>/procentric/system/        firmware, splash image, TV config, CP apps (not used yet)
  ```
- Verified: plain HTTP on port 80 through Nginx Proxy Manager returns 200 with the Host header
  intact. HTTPS support and redirect-following by the TV are NOT yet verified — do not force SSL
  or add http→https redirects on tenant hostnames.
- **Every NPM proxy host for a tenant needs "Websockets Support" switched on** — otherwise the
  TV's `/ws/tv` upgrade fails silently and sets fall back to 60 s polling (verified 2026-09-15:
  it was off for hoteldemo and the WebSocket never connected).
- There is **no PMS API on the TV**. Check-in/out logic lives on our server; the TV only has a
  `checkout` call that wipes guest data.

## TV-side API

Two LG JavaScript libraries, both vendored in `tv-app/lib/`:

| Library | Version | Sets | Style |
|---|---|---|---|
| `hcap.js` | 1.24.12.5984 | all Pro:Centric Smart | `hcap.<ns>.<method>({..., onSuccess, onFailure})` |
| `idcap.js` | 1.1.1 | Pro:Centric webOS 5.0+ (IDPN 1xx+) | `idcap.request("idcap://<path>", {parameters, onSuccess, onFailure})` — also returns a Promise |

Both define separate globals and can be loaded on the same page. Runtime detection: call
`idcap://configuration/property/get` with `key: "idpn"` under a 4 s timeout; on success use the
IDCAP path, otherwise fall back to `hcap.property.getProperty({key:"model_name"})`.
Useful read-only property keys on both: `model_name`, `serial_number`, `platform_version`,
`firmware_version`, `webos_version`, `idpn` (IDCAP only).

Async rule from LG docs: most calls execute in order, but channel change and file I/O do not —
completion is signalled by DOM events (`document.addEventListener(...)`), see IDCAP `Ref/Events`.
Never `return` a value from an onSuccess callback.

`tv-app/index.html` is currently the **probe app**: loads both libs, detects the platform,
prints model/serial/versions on screen. Keep it as `tv-app/probe.html` when the real renderer
replaces `index.html`.

## Target architecture

```
coopcentric VM (Ubuntu 24.04, Proxmox, behind NPM)
├── nginx
│   ├── one vhost per tenant: <hotel>.caritech.net → /srv/coopcentric/tenants/<hotel>/
│   └── admin vhost (later)
├── /srv/coopcentric/tenants/<hotel>/procentric/{application,system}/
│   application/ = xait.xml + tv-app build + layout.json for that tenant
└── admin app (later): tenants, sets, channel maps, layout editor → writes layout.json
```

Design principle: the TV app is a generic **renderer**. It boots, reads its tenant's
`layout.json` (zones: video, channel list, welcome text, images, etc.), and draws it.
Layout changes are published by rewriting `layout.json` — no xait version bump.
Only renderer code changes bump xait versions. The admin UI is digital-signage style:
everything configured from a web page, same UI for every tenant.

## Phase 1 — what to build now

1. `install.sh` — idempotent, meant to be run as
   `curl -fsSL https://raw.githubusercontent.com/caritechsolutions/codenameduck/main/install.sh | sudo bash`
   on a fresh Ubuntu 24.04 VM. Installs nginx + unzip, creates `/srv/coopcentric`, clones/updates
   the repo into `/opt/coopcentric`, installs `bin/*` to `/usr/local/bin`, reloads nginx.
   Re-running updates code and re-deploys `tv-app/` into every existing tenant.
2. `bin/coopcentric-tenant` — `new <name> <hostname>` creates the tenant tree, renders
   `nginx/tenant.conf.tmpl` into `/etc/nginx/sites-available/<hostname>`, enables it, writes
   `xait.xml` from `tv-app/xait.xml.tmpl` (dev mode 0/0, url = `http://<hostname>/procentric/application/index.html`),
   copies `tv-app/` into `procentric/application/`, chowns to www-data, `nginx -t && reload`.
   Also `list`, `remove <name>`, `bump <name>` (increments both xait versions).
3. `nginx/tenant.conf.tmpl` — the vhost below, with `{{HOSTNAME}}` and `{{NAME}}`:
   ```
   server {
       listen 80;
       server_name {{HOSTNAME}};
       root /srv/coopcentric/tenants/{{NAME}};
       access_log /var/log/nginx/{{NAME}}.access.log;
       location /procentric/ { autoindex off; add_header Cache-Control "no-store"; }
   }
   ```
4. `tv-app/` — probe app as-is (already written), plus `xait.xml.tmpl`.

First tenant already exists by hand on the VM: name `hoteldemo`, host `hoteldemo.caritech.net`.
`install.sh` must adopt it without breaking it.

## Later phases (do not build yet)

- Renderer + `layout.json` schema
- Admin app (runtime not yet decided) with layout editor, tenants, sets, channel maps
- Set registry: TVs POST model/serial/firmware on boot; admin shows fleet status
- Remote-deploy (.zip) mode for production
- `/procentric/system/` — firmware, splash, cloning
- Verify HTTPS / redirect behaviour of the TV fetch
- Signage (webOS Signage) support via IDCAP — separate server-settings mechanism, unread

## Conventions

- Bash scripts: `set -euo pipefail`, idempotent, print what they did.
- One change at a time; wait for Richard to confirm on the real VM/TV before moving on.
- No secrets in the repo. Tenant hostnames are fine.
- LG API references: `docs/` holds text extracts of the LG doc pages we've read; the full
  HTML API references are in Richard's downloaded library packages (not committed).


## Phase 2 — the platform (added 2026-09-14)

Phase 1 is done and verified on a real set (43UM670H0UA, webOS 8.3.0, IDPN 306).
The full platform spec is in `docs/PLATFORM.md` — read it before any Phase 2 work.
`docs/idcap-api-index.md` lists every IDCAP endpoint with a one-line description.

Decisions already made (do not re-open):
- Node.js 20 + Express + better-sqlite3 + ws; admin UI = Vite + React under /admin;
  TV renderer = vanilla JS bundled by esbuild (target es2015).
- Sets are keyed by serial number; room number and group are assigned in admin; layouts and
  channel lineups are assigned to groups with per-set override.
- IP channels now, RF channel types modelled in the schema from day one.
- Follow the build order in PLATFORM.md; each step must end with something testable on the TV.

### Phase 2 step 1 — server skeleton + renderer v0 (built 2026-09-14, awaiting TV verification)

- `server/` — Node 20 + Express + better-sqlite3. `src/index.js` entry, `src/app.js` builds the
  app (testable), `src/migrations/*.sql` forward-only migrations (full PLATFORM.md schema in
  `001_init.sql`), `src/tenants.js` resolves the tenant from the `Host` header (tenants table is
  mirrored from `/srv/coopcentric/tenants/*/procentric/application/xait.xml` on startup and lazily
  on an unknown host), `src/routes/tv.js` = `POST /api/tv/register` + `GET /api/tv/poll`,
  `src/layout.js` = override → group → tenant default → built-in "unassigned" layout.
  `GET /healthz` is not tenant-scoped. Tests: `cd server && npm test` (node:test, in-memory DB).
- `systemd/coopcentric.service` runs the server as `www-data` on 127.0.0.1:3000, DB at
  `/srv/coopcentric/data/coopcentric.db`.
- `tv-app/` is now source: `src/main.js` → `npm run build` (esbuild, es2015) → `tv-app/dist/`
  (index.html + app.js + probe.html + lib/ + version.txt). `coopcentric-tenant deploy` rsyncs
  **dist/**, never the source tree. Renderer v0 draws `text`, `image`, `clock` zones, polls
  when `ws_url` is null, re-registers on 401. Without LG middleware it only registers when
  `?serial=…` is in the URL (no phantom sets from laptops).
- `nginx/tenant.conf.tmpl` now proxies `/api/`, `/ws/`, `/admin` to Node (with
  `proxy_set_header Host $host` — required for tenant resolution) and redirects `/` to `/admin`.
  Vhosts rendered by the tool carry a `coopcentric-managed` marker and are re-rendered on every
  deploy. A hand-made vhost is left alone until `sudo coopcentric-tenant vhost <name> --adopt`
  (keeps a `.bak-<timestamp>` copy, rolls back if `nginx -t` fails). **hoteldemo's vhost on the
  VM is hand-made and must be adopted once** before the TV can reach `/api/tv/register`.
- `install.sh` additionally installs Node from NodeSource (keyring + apt source, no remote
  script execution), runs `npm ci` in `server/` and `tv-app/`, builds, installs and restarts
  the service, and checks `/healthz`. `admin/` is built only once it exists (step 2).

### Phase 2 step 2 — admin, WebSocket push, heartbeats (built 2026-09-14)

- Auth: `server/src/auth.js` — bcryptjs hashes, opaque session id in HttpOnly cookie `cc_session`,
  `sessions` table. First boot with no users seeds superadmin `admin` with a random password
  printed once to the journal. Tenant-admins are confined to their tenant's hostname.
- Admin API `server/src/routes/admin.js`: login/logout/me, dashboard, sets (patch room/group/
  override/notes, delete), groups (+ layout assignment), layouts (validate/save/duplicate/delete,
  saving = publish), preview-on-set, tenant default layout. `server/src/state.js` builds the TV
  state payload shared by register/poll/WS; `commands.js` queues commands and delivers over WS.
- WS hub `server/src/ws.js` at `/ws/tv?set_id&token`: hello, layout/lineup/messages/command
  pushes, `hb` heartbeats (channel/volume/uptime/power_mode/app_version), `ack`. Online = last
  seen < 3 min. `hub.refresh(tenantId)` recomputes per connected set and pushes only changes.
- Factory room rule: LG ships `room_number = [TV]<serial>`; `isFactoryRoom()` treats it as
  unassigned. Admin-assigned room wins and is written back with a `set_property` command.
- Admin UI `admin/` (Vite + React, base `/admin/`, built to `admin/dist`, served by Node):
  Login, Dashboard, Sets (drawer with assignment, live status, commands, delete), Groups,
  Layouts (+ JSON editor with validation, assign to groups, preview on set). Tests: Vitest.
- Renderer: WebSocket client with reconnect/backoff, 60 s heartbeat, commands `set_property`
  and `reload_app`, re-registers on 401 or `deleted`. Renderer e2e tests: `cd tv-app && npm run
  build && npm test` (headless Chromium + `test/fake-idcap.js`; skips if Playwright is missing).
- **Testing gotcha:** Chromium in the dev container follows the HTTP proxy and DNS, so never
  point a browser test at a real tenant hostname — it will hit the production VM. Tests use
  `127.0.0.1` tenants or a `.test` hostname.
- Per-step TV checklists live in `docs/TV-TEST-PLAN.md`.

### Phase 2 step 3 — channels, lineups, video, keys, commands (built 2026-09-14)

- `server/src/channels.js` validates channel params (ip multicast / ip url / rf classes) and
  parses/produces CSV; `routes/channels.js` = channels + lineups CRUD, group lineup assignment,
  CSV import/export. Lineup precedence: set override → group → tenant default → none.
  `POST /api/tv/upload` stores screenshots under `<data>/screenshots/<set>.jpg|png`;
  `POST /api/admin/commands` is the bulk endpoint (set_ids | group_id | all).
- `tv-app/src/platform.js` is the IDCAP/HCAP adapter (tune via channel or media path, video
  size, key table, volume, toast, power, screenshot, launch, checkout). `main.js` renders
  `video` (transparent `url('TV:')` hole + `video/size/set` after `channel_changed`),
  `channel_list`, `menu`, `html`; handles CH±, digits, PORTAL/GUIDE, INFO, BACK, UP/DOWN/OK;
  runs every command in the PLATFORM.md table and acks. Claimed keys: CH±, 0-9, PORTAL, GUIDE,
  INFO, BACK, LAST_CH (attribute 1); volume/mute stay with the TV.
- Unverified on hardware, flagged in the test plan: IDCAP `toastmsg/create` param name (we send
  both `msg` and `message`), `power/command powerOff`, the screenshot capture URI being
  fetchable via XHR, and HCAP parameter names for volume/toast/launch.

### Phase 2 step 4 — canvas layout editor (built 2026-09-14)

- `admin/src/editor/geometry.js` = pure helpers (snap/clamp/drag/resize, immutable doc edits,
  zone defaults per type, screens/keys helpers) with unit tests; `CanvasEditor.jsx` = pointer
  drag/resize with 10 px snapping (Alt free, Shift aspect, video keeps 16:9), arrow nudges;
  `ZonePanel.jsx` = per-type property panel + canvas/screens/key-map panel; `LayoutThumb.jsx`.
  `LayoutEdit.jsx` hosts Canvas/JSON tabs over one document, undo, preview-on-set.
- Layout list API now returns `json` so thumbnails render.

### Phase 2 step 5 — weather/html/app_launcher, messages, checkout, users, settings, tenants (built 2026-09-14)

- `server/src/weather.js` (Open-Meteo, injectable fetcher, 15 min cache) → `GET /api/tv/weather`
  and `GET /api/admin/weather`; `assets.js` writes tenant uploads to
  `tenants/<name>/procentric/application/assets/` (deploy excludes `assets/`); `routes/tenant.js`
  = tenant settings (`tenants.settings_json`: timezone, weather, logo_url, guest_placeholder,
  checkout_message), assets, messages (targets set/group/all, expiry, pushed live), checkout
  (removes set messages + queues `checkout`), users/roles + own password, superadmin tenants
  (create runs `sudo coopcentric-tenant new`; install.sh writes `/etc/sudoers.d/coopcentric`).
- TV context now carries `guest` (placeholder until PMS), `logo`, `units`; `{{logo}}` works in
  image src. Renderer: `weather` zone, persistent message bar, `app_launcher` menu, checkout
  clears local state and shows the configured message.
- Admin pages: Messages, Users (+ change my password), Settings (hotel, defaults, weather,
  logo, assets), Tenants (superadmin). Image zone panel has an asset picker.

### Phase 2 step 3b — fixes after the first step 3 TV session (2026-09-15)

- Renderer: the overlay layer (banner, digits, popup, message bar) is scaled with the stage, so
  OSD elements exist on 720p sets (they were drawn off-screen before). Video coordinates scale
  straight from the layout canvas to `display_resolution`. The `fullscreen` screen expands the
  video zone to the whole canvas. URL channels play in an HTML5 `<video>` inside the zone (so
  resizing the zone moves them); on element error the renderer falls back to LG's media
  pipeline. One-off `message` commands use a popup, persistent messages the bottom bar.
- TV events (`error`, `ws`, `media`, `channel`, `platform`) go to the events table via WS or
  `POST /api/tv/events` while offline; `tv_error` also hits the journal; the newest one is
  `last_error` on the set (admin drawer). Toast sends `{msg}` only (162-byte cap).
- Groups have `power_mode` (WARM = Instant On) applied by the renderer via `power/powermode/set`.
- Vhost: `xait.xml`/`index.html` no-store, `lib/` and the content-hashed `app.<hash>.js`
  immutable; `tv-app/build.mjs` hashes the bundle and rewrites index.html.

### Phase 2 step 3c — persistent video, OSD placement zones, start channel, instant_power (2026-09-15)

- Renderer keeps one `#videohost` (tuner hole + the single `<video>` element) for the life of
  the app; `render()` only recreates `.zone` elements and repositions the host. Moving a playing
  `<video>` in the DOM pauses it — that was the black screen on PORTAL. Hidden video zone →
  `channel/stop` / `video.pause()`, shown again → `channel/replay` / `play()`; never a re-tune.
- Layout zone types `banner`, `digits`, `popup` only place/style the renderer's OSD elements
  (global, not per screen; defaults when absent). Canvas editor and server validation know them.
- Start channel: `tv/channel/startchannel/set` with the first tuner channel of the lineup,
  `channelType unknown` (HCAP `UNKNOWN`) when there is none.
- Instant On: LG blocks NORMAL↔WARM until property `instant_power` is 1, and the TV handles WARM
  itself afterwards. The group power mode therefore writes `instant_power` (1/0) via
  `configuration/property/set`; the renderer never calls `powermode/set`. `sets.instant_power`
  is what the set reports (register + heartbeat), shown in the drawer.
- Channel model: `sourceAddress` (IGMPv3) and `videoStreamType` (MPEG2/H264/HEVC → LG enum
  2/27/36) on IP multicast, `plpId` (DVB-T2) and `videoStreamType` on RF; CSV columns added.
- `tv-app/test/fixtures/tiny.webm` is a VP8 clip generated with Chromium's MediaRecorder; the
  step 3c test plays it through the real `<video>` path and asserts the same element instance is
  still playing after PORTAL.

## Phase 3 (spec: docs/PHASE3.md)

### Part A — fixes from the 3c hardware test (2026-09-16)

- `shared/zone-types.json` is the single list of layout zone types, read by the server
  validator, both admin lists (`layoutSchema.js`, `editor/geometry.js`) and the renderer, which
  self-checks its drawers against it and exposes `window.__cc.zoneTypes`. The admin's own
  validator had a stale copy and was what rejected `banner` zones.
- Instant On is applied through a visible `set_property {instant_power}` command queued by the
  server on group save, set→group assignment and register (when the set disagrees); the renderer
  writes, reads back, retries with the other value type, acks with `sent_as`/`value`, and a
  refusal becomes a failed command + journal line. The renderer no longer applies it on its own.
- HTML5 channels: `system/nosignalimage/set off` before playing and no `url('TV:')` hole on the
  video host; tuner channels restore `default` and the hole.

### Part A2 — hardware corrections (2026-09-16)

- `configuration/property/set` accepts **string values only** (TV: `'value' is not string
  type`); `platform.setProperty` always sends strings, `setPropertyVerified` writes the string,
  reads back, and only tries a number as a last resort. Expect instant_power acks to read `"1"`.
- The "No Signal" text over an HLS-only layout was LG's *external-input* OSD: the set was on
  HDMI. `ensureTvInput()` runs at boot and before every HTML5 channel: `externalinput/get`, and
  if `type` ≠ `TV` → `externalinput/set {type:"TV", index:0}` + `tv_input` event. HCAP:
  `hcap.externalinput.getCurrentExternalInput/setCurrentExternalInput` ({type: enum, index}).
- HCAP no-signal call is `hcap.system.setNoSignalImage({ noSignalImage: false })` (boolean).

### Part A3 — instant_power values (2026-09-17)

- LG `instant_power` has four values: `0` off, `1` Instant On with update-on-off (passes through
  STANDBY, slow to become ready), `2` Instant On (remote off goes straight to WARM(WAIT)), `10`
  Always On. `groups.instant_power` (migration 007, old WARM→2/NORMAL→0) is the desired value,
  NULL = leave the set alone; the admin default choice is Instant On (2). Commands carry the value
  as a **string**; `sets.instant_power` stores the real reported value (unknown values ignored).

### Part B1 — media library + no boot raster (2026-09-17)

- Renderer: `#videohost` is created in `idle` mode with **no** `url('TV:')` background; the hole
  is set only by `setHostMode(false)` when a tuner channel is selected. In html5 mode the host is
  transparent and the `<video>` has `visibility:hidden` until `data-ready="1"` (set on
  `playing`/`loadeddata`, cleared on `emptied`/stop), so the layout background shows until the
  stream has frames. Test: `tv-app/test/renderer-phase3b1.test.js`.
- Media library: migration `008_media.sql` (`media` table), `server/src/media.js` store —
  files at `tenants/<name>/procentric/application/media/<uuid>.<ext>`, thumbnails
  `media/thumbs/<uuid>.jpg` (sharp, ≤320 px), width/height recorded; type is decided by magic
  bytes (png/jpg/gif/webp/svg/mp4), 10 MB cap. `routes/media.js`: `GET/POST /api/admin/media`
  (`?as=logo` sets `settings.logo_url`), `PATCH /media/:id` rename, `GET /media/:id/references`,
  `DELETE` → 409 `{layouts:[{id,name}], logo}` while a layout JSON or the logo contains the URL.
  nginx: `/procentric/application/media/` immutable one-year cache; `coopcentric-tenant deploy`
  excludes `media/`. `sharp` is a server dependency (prebuilt binaries via `npm ci`).
- Admin: `pages/Media.jsx` (drag-drop upload, grid, rename, delete dialog naming the layouts),
  `components/MediaPicker.jsx` (modal: library / `{{logo}}` / URL / upload) used by the image
  zone and the canvas background image in `ZonePanel`; Settings uploads the logo through the
  library and lists old `assets/` files only as "Legacy assets".
