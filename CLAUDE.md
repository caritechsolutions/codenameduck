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

### Part B2 — canvas editor UX, shared drawing module, fonts, templates (2026-09-17)

- `shared/zone-draw.js` is the one zone-drawing implementation: `DRAWERS` per type,
  `zoneElement`, `visibleZones`, `renderStage`, `tick` (clocks + `{{time}}`/`{{date}}`),
  `substitute`, `liveContext`, `applyStyle` (now also `fontFamily`, `fontStyle`, `valign`,
  `shadow` = soft/strong/outline or raw). The renderer's `render()` calls `renderStage`; the
  admin's `editor/LayoutPreview.jsx` calls the same with fake lineup/weather/guest. `shared/zones.css`
  is the matching stylesheet (build copies it to `dist/zones.css`; admin imports it). The server
  zone-type test scans `DRAWERS` in the shared module.
- Renderer: `show_screen` action (`{screen}`) pushes a screen like `fullscreen_tv`; text variables
  now include `guest_first`, `checkout_date` (blank until PMS), `time`, `date`.
- Fonts: `tv-app/fonts/*.woff2` (Inter, Roboto, Open Sans, Lato, Montserrat, Oswald, Playfair
  Display; OFL, Latin subsets, `LICENSES.txt`), `fonts.css` linked by index.html and by the admin
  (`/procentric/application/fonts/fonts.css`, same hostname). `shared/fonts.json` feeds the picker;
  `style.fontFamily` is the family name. nginx caches `fonts/` 30 days.
- Templates: `shared/layout-templates.json` (classic, fullscreen, welcome, info);
  `GET /api/admin/layout-templates`, `POST /api/admin/layouts {name, template}`.
- Editor: `editor/geometry.js` (GRID 8, `guideSnap` edges↔edges / centres↔centres, `alignZones`,
  `distributeZones`, front/back, multi-id `duplicateZone`/`removeZone`, `locked`, `errorsByZone`,
  action picker helpers), `CanvasEditor` (multi-select, guides, palette drop, click never moves),
  `Palette`, `EditorToolbar`, `ZonePanel` (typed controls, font picker, variables menu, menu action
  picker with pages/screens/apps), `LayoutEdit` (Canvas / Preview / Advanced tabs, screen tabs,
  undo/redo 50, Ctrl-D, Delete, inline errors). `menu.layout: "row"` draws items horizontally.

### Part B3 — apps (2026-09-17)

- Renderer: `tv.listApps()` at boot (IDCAP `application/list`; HCAP preloaded + application
  lists merged) → sent raw as `apps` in the register body. `tv.launchApp(id, params, noSplash)`
  sends `noSplash: true` by default. `visibilitychange` hidden → `pauseForBackground()` (pause
  `<video>` / `channel/stop`), visible → `resumeFromBackground()` (re-claim keys, `placeVideo`
  resumes, `tv_visibility {resumed, away_s}` event). LEFT/RIGHT also move menu focus.
- Server: migration 009 (`apps`, `group_apps`, `sets.apps_json`), `src/apps.js`
  (`normalizeAppList` accepts array / `{list|applications|apps|appList}` with `id|appId|name`,
  `title|name`, `icon|iconUrl`; keeps one raw entry per app; models seen), `routes/apps.js`
  (`GET/PATCH/DELETE /api/admin/apps`, `GET/PUT /api/admin/groups/:id/apps`). TV state carries
  `apps: [{id, name, icon}]` = enabled for the set's group (no group → none); WS pushes `apps`.
  LG icon paths are stored (`icon_url`) but never sent to the TV; only the admin override is.
- `apps` zone type (shared list + `drawApps` in `shared/zone-draw.js`): tiles of `env.apps`,
  `layout: row|grid`, `style.tileSize`; navigable like a menu; OK = `launch_app`. The editor's
  menu action picker offers discovered apps (`/api/admin/apps`) for "Launch app…".
- Admin **Apps** page: matrix apps × groups, Edit (display name, icon from Media), Raw, Forget.
- Unverified on hardware: LG's `application/list` field names (the Raw dialog shows them),
  whether `visibilitychange` fires while a native app is in front, and whether
  `tv/checkout/request` signs Netflix out — see the B3 test plan; Part C decides checkout.

### Part B2b — pages instead of screens, element actions, spatial navigation (2026-09-17)

- Layout schema **2** (`shared/layout-model.js`, import-free ESM; the server loads it with
  `server/src/esm.js` `loadEsm()`): `pages: [{id, name, zones, inherit}]`, `home`, `keys`
  values are action objects, `focus: {color, width, radius}`, `back_on_home: none|fullscreen_tv`.
  `upgradeLayout()` converts v1 on every path (validator, `parseLayoutRow`, renderer
  `applyLayout`, editor load) and `migrateStoredLayouts()` rewrites the layouts table once at
  startup: screens → pages (the `fullscreen` screen is dropped), hidden zones → one page each
  (inherit on), `show_page/show_screen → goto_page`, `close_page → back`, `home → goto_page
  home`, `toggle_menu → fullscreen_tv`. `validatePages()` checks page ids, refs and actions.
- Actions (`ACTION_TYPES`): `none | goto_page(page) | back | fullscreen_tv | tune(number) |
  launch_app(app_id) | toggle(zone)` (`reload` still accepted). Zones of type `text`, `image`,
  and the new `button` (label, icon, `focusStyle`) carry `action: {type, …}` and become
  focusable; menu items keep the flat form (`{label, action, page|number|app_id|zone}`).
  `actionOf()` normalises every spelling.
- Global zone types (`video, channel_list, banner, digits, popup, clock`) placed on home are
  shown on pages with `inherit !== false` (`pageZoneIds`). `visibleZoneList(layout, page,
  {toggled, fullscreen})` is the one visibility rule (renderer + preview).
- Renderer: `state.page/pageStack/fullscreen/toggled`; `doAction()`; spatial navigation over
  DOM rects (`focusTargets()` = menu items, app tiles, focusable zones; `spatialNext()` in the
  model: same-row/column candidates win, otherwise sideways offset is penalised); OK runs the
  focused action; BACK: leave fullscreen → pop page stack → home → `back_on_home`. PORTAL/GUIDE
  default to `fullscreen_tv`. Focus ring = CSS vars `--focus-color/width/radius` set on the stage
  (`shared/zones.css`). Preview messages carry `page`; `tv_page` events on page changes.
- Editor: `PageNavigator.jsx` (add/rename/duplicate/delete/home/reorder, drag), `ActionPicker`
  in `ZonePanel` (pages + built-ins, secondary field per type), Layout panel has focus ring, BACK
  on home, current page name/inherit; `LayoutEdit` keeps `pageId`, Preview follows it (+
  full-screen checkbox), "Preview on set" posts `{json, page}`. `geometry.js` page helpers:
  `addPage/renamePage/removePage/duplicatePage/movePage/setHomePage/setPageInherit`.
- Templates are v2; the welcome template uses two `button` zones.

### Part B3b — app activation (2026-09-17)

- Renderer: after `application/list`, `readAppStatus()` calls `application/register/status {id}`
  per discovered app (IDCAP only) and sends the raw replies as `apps_status` with the register.
  Command `register_apps {tokenList: [{id, token}] | accountNumber}` → `tv.registerApps()`
  (`application/register`), waits ≤20 s for the `application_registration_result_received`
  DOM event (now wired in `platform.js`), acks `{ok, result}`, sends `apps_registration` and a
  fresh `apps_status` event. Unknown LG field names are passed through raw.
- Server: migration 010 (`set_app_status`, `set_app_registration`); `apps.js` `normalizeAuth()`
  (registered/authorized/ok/true… → activated, unregistered/fail… → not; else unknown),
  `recordStatus/recordRegistration`, `enabledFor()` drops apps the *set itself* reported as not
  activated (unknown counts as activated so HCAP sets keep their apps); `list()` adds
  `activation` (activated | not_activated | partial | unknown), counts and `auth_status`. The hub
  turns `tv_apps_status` / `tv_apps_registration` events into table rows and re-pushes `apps`.
  Tenant config in `settings_json.app_activation`; `GET/PUT /api/admin/apps/activation`,
  `POST /api/admin/apps/activation/run {group_id?|set_ids?}` queues `register_apps` (deduped);
  register queues it automatically for sets without a successful registration.
- Admin Apps page: Activation column + greyed rows for not-activated apps (admin only), Raw
  dialog shows the register/status value, Activation panel (tokens per app id, account number,
  register on all sets / a group, per-set results).

### Part B3c — editor page isolation, app licences, Netflix launch (2026-09-17)

- Editor: `editor/geometry.js` `editableZoneIds(doc, page)` (the page's own zones + OSD placement
  zones on home) and `ghostZoneIds()` (inherited globals on a non-home page). `CanvasEditor` draws
  only those two sets: ghosts are `.czone.ghost` (pointer-events none, `data-ghost="1"`, label
  "inherited from Home"), never selectable; zones of other pages are not in the DOM. Marquee select
  on empty canvas (`.marquee`), page-scoped z-order (`moveZoneOrder(doc, id, dir, pageId)`),
  `LayoutEdit` drops any selected id that is not editable on the current page.
- Licences: migration 011 `licences` (one row per app id), `server/src/licences.js` — AES-256-GCM
  with `<dataDir>/secret.key` (32 hex bytes; `install.sh` creates it as www-data mode 600, the
  server creates it on first use otherwise), blob `v1:<iv>:<tag>:<ct>`; `appIdForFilename` maps
  `NETFLIX_`/`AMAZON_`/`AirPlay_`/`GOOGLE CAST_` → `netflix`/`amazon`/`airplay`/`googlecast` (the
  last two are guesses, editable). `routes/licences.js` (superadmin): `GET/POST /api/admin/licences`
  (`{files:[{filename, content, app_id?}]}` → `{added, replaced, errors, licences}`),
  `PATCH /:id {app_id}`, `DELETE /:id`; only `tail` (last 6 chars) leaves the server. Tokens are per
  SI partner → global. Admin page `pages/Licences.jsx` (superadmin nav "App licences").
- Activation: `apps.registerPayload(tenant)` = all licence tokens + the tenant's `accountNumber`
  (the only per-tenant option left; `PUT /api/admin/apps/activation {accountNumber}`, config
  returns `{accountNumber, licensed:[ids]}`). The TV state payload carries it as `activation`; the
  renderer registers at boot (IDCAP only, once per boot) when a licensed app is missing from
  `application/list` or its `register/status` is not authorised, then re-reads list+status and
  sends `apps_list` / `apps_status` / `apps_registration` events (`ws.js` records `tv_apps_list`).
  The server still queues `register_apps` once for sets without a recorded success. Result event
  fields per LG: `id`, `tokenResult` (bool), `errorMessage`.
- Netflix (docs/lg/netflix.md): tenant setting `netflix_hotel_id` (Settings; `^[A-Za-z0-9_.-]{1,64}$`);
  without it `enabledFor()` drops netflix, `toApi` sets `requires: 'netflix_hotel_id'`, and the
  renderer refuses to launch with an on-screen note. Launch params
  `{reason, params:{hotel_id, launcher_version:'1.0'}}`: `launcher` from tiles/menus/commands,
  `hotKey` on the remote's NETFLIX key (`KEY.NETFLIX = 0x40D`, claimed) in NORMAL, `boot` +
  `params.reason:'netflix'` when `power/powermode/get` says WARM; Netflix launches with
  `noSplash:false`. Register body carries `service_country` (`configuration/servicecountry/get`,
  raw); the server records a `service_country` event and a `tv_error` for Others/ZZ/unknown.
- `docs/TENANT-NETWORK-CHECKLIST.md`: NPM websockets, `*.pool.ntp.org`,
  `https://GR.lgtvsdp.com/rest/sdp/v13.0/initservices`, TV time, service country, hotel id.
- Amazon (`amazon`) is token-only and STB-6500 / webOS 5.0 only; nothing app-specific is sent.

### Part C — local PMS: reservations calendar (2026-09-17)

- Spec in `docs/PHASE3.md` Part C (rewritten). Migration 012: `reservations`, `pms_log`,
  `import_profiles`, `groups.vacant_layout_id` / `welcome_popup_s`, `tenants.pms_api_key_*`.
- `server/src/pms.js` `createPms(db, {log, now})` + `attach({hub, commands})`: occupancy rule
  (`checkin <= D < checkout`, status booked|checked_in; overlaps rejected naming the other
  reservation), CRUD, `checkinNow` (early arrival moves checkin_date to today, refused while the
  room is still occupied) / `checkoutNow` (early departure moves checkout_date), cancel (a
  checked-in guest is checked out), `guestContext(tenant, set)` = the *checked-in* reservation of
  the set's room → context `guest, guest_first, guest_last, checkin_date, checkout_date, nights,
  guest_lang, vip, occupied` (blank when vacant; `guest_placeholder` is no longer used),
  `tick(now)` scheduler (tenant `timezone` via Intl, `checkin_time` default 14:00 / `checkout_time`
  11:00 in tenant settings; check-outs before check-ins; booked stays whose dates passed are
  `expired`), welcome popup = `message` command `{text:"Welcome <guest>", ttl_s}` when the group
  has `welcome_popup_s`, check-out queues `checkout {message}` to every set in the room and
  refreshes. `state.js` swaps in the group's vacant layout while `pms.occupant()` is null.
  `app.js` runs the tick 2 s after start and every minute (`scheduler:false` in tests, `now`
  injectable; `startServer({now})` in testlib).
- Import: `pms.parseUpload({filename, content_base64})` (CSV auto-delimiter or `.xlsx` via the
  dependency-free `server/src/xlsx.js`: first sheet, shared/inline strings, date-styled cells →
  ISO), `guessMapping(headers)` (EN/NL/DE header names), `prepareImport({rows, mapping,
  date_format})` per-row errors (bad date, room, name, overlap with DB and within the file,
  already imported), `commitImport` (transaction; skipped rows with reasons; `skippedCsv`),
  `parseDate(value, format)` formats `auto|YYYY-MM-DD|DD/MM/YYYY|MM/DD/YYYY|DD.MM.YYYY|DD-MM-YYYY|
  YYYY/MM/DD|excel` (auto = ISO, Excel serial, day-first, then month-first). Profiles per tenant.
- Routes `server/src/routes/pms.js`: admin `/reservations` CRUD + `/:id/checkin|checkout`,
  `/rooms?date&group_id`, `/reservations/export` (CSV), `/import/parse|preview|commit|report`,
  `/import-profiles`, `/pms/settings|key|log`; external `/api/pms/*` with `Authorization: Bearer`
  or `X-Api-Key` (sha256-hashed key on the tenant row, shown once), idempotent POST; `docs/PMS-API.md`.
- Admin: `pages/Reservations.jsx` (nav "Rooms": calendar rooms × days week/month with bars,
  today column, group filter, list/arrivals/departures tabs, reservation modal with check-in/out
  now + cancel), `pages/ImportReservations.jsx` (`/rooms/import`), Groups vacant layout + welcome
  popup, Settings time zone / check-in / check-out times + PMS API key card (guest placeholder
  field removed). Shared `VARIABLES` gained `guest_last`, `checkin_date`, `nights`.
- Renderer: `checkout` command → `tv/checkout/request`, `localStorage.clear()`, the checkout
  message is kept in `cc_checkout_note`, ack `{checkout, reload}`, then `tv.reloadApp()` after
  1.5 s; on boot the note is shown once as a popup. Whether LG's checkout signs Netflix out is a
  hardware check (TV test plan Part C, step 5).

### Part B3d — token registration only when not authorised (2026-09-18)

- Hardware facts (43UM670H0UA): `application_registration_result_received` fires **once per
  token** with `tokenResult` = the string `"success"` / `"fail"` (+ `errorMessage`), not a
  boolean. Re-registering an already authorised app **resets its sign-in** (Netflix lost its
  account on every reboot). `amazon` registers and launches on this set despite LG's "STB-6500
  only" note. `airplay` answers `"fail"` — the real AirPlay app id is unknown (ask LG).
- Rule: a token is registered only for an app whose `register/status` reports not authorised.
  Never because an id is absent from `application/list`, never for an authorised app. Applies to
  the renderer boot path (`bootRegisterApps`), the `register_apps` command (`registrationPlan()`
  filters the payload; nothing left → ack `{ok:true, skipped}` without calling LG) and the
  server's auto-queue at register (`apps.unauthorizedLicensed(set)` from the set's own
  `apps_status`; payload = those tokens only via `registerPayload(tenant, onlyIds)`).
- Evidence: `apps_registration_reason` event (`trigger boot|command|server_register`, per app
  `{id, in_list, status (raw), activated}`, `sending`, `skipped`). `apps_registration` carries
  `results: [{id, tokenResult, errorMessage, ok}]`; `ok` = all success / any fail / null.
  Renderer `registerApps()` waits for one event per token (3 s grace after the first, 20 s cap).
- Migration 013: `licences.failed_model/failed_at/failed_message`. `licences.markFailed()` on a
  `"fail"` result (hub → `apps.recordRegistration` with the set's model); failed rows are left
  out of `tokens()` until `put` (replace) or `setAppId` clears them; App licences page shows
  "failed on <model>". `hasRegistered()` is no longer used for queuing.
- Renderer ignores a failed `channel_changed` while no tuner channel is selected (LG fires one
  at boot when the start channel is disabled): `channel_event {ignored:true}` instead of `tv_error`.
