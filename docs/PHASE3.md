# CoopCentric — Phase 3 specification

Read CLAUDE.md, docs/PLATFORM.md, docs/RENDERER-NOTES.md and docs/TV-TEST-PLAN.md first.
Phase 2 (steps 1–5, 3b, 3c) is deployed on the real VM and tested on a 43UM670H0UA
(webOS 8.3, IDPN 306). Confirmed on hardware: registration, WS push, layouts, HLS via HTML5
`<video>` (including H.265), full screen, hidden-video pause/resume, digits/INFO/message OSD,
toast, tune, reboot, power off, cache headers.

Phase 3 has four parts. Do them in order, one commit each, tests green before moving on,
and a TV test list per part in TV-TEST-PLAN.md.

---

## Part A — bugs from the 3c hardware test

1. **Layout validator rejects new zone types.** Saving a layout with a `banner` zone fails
   with `zone "banner": unknown type "banner"`. The server-side schema check was not updated
   for `banner`, `digits`, `popup`. Fix, and add a test that every zone type the renderer
   registers is accepted by the validator (single source of truth for the type list).

2. **Instant On never applied.** Group set to Instant On; `tv_instant_power` keeps reporting
   `"0"`, no error event. Find out whether the `set_property instant_power` command is
   queued at all on group save and on set→group assignment, whether it is acked, and what the
   TV returns. Log the property/set failure reason as a `tv_error` if the TV refuses. Verify
   the value type LG expects (the property list shows `[0 or 1]`; try number and string).

3. **"No Signal" OSD over the layout after restart.** Lineup is HLS-only, so the start channel
   is disabled (`channelType: unknown`); the tuner therefore has no channel and the TV draws
   its own "No Signal" overlay above the page. Fix: when the active channel plays via HTML5,
   call `idcap://system/nosignalimage/set` with `mode: "off"` (HCAP: check `hcap.property` /
   `hcap.system` for the equivalent) at boot and whenever switching to an HTML5 channel, and
   restore `default` when switching to a tuner channel. Also make sure no `url('TV:')` hole is
   present while HTML5 is the active mode. Confirm on hardware; if the OSD still shows, fall
   back to tuning the tuner to the first tuner channel in the tenant (any lineup) as a silent
   background source, with `channel/stop` so it doesn't consume bandwidth.

---

## Part B — layout editor: make it a product

Goal: a hotel manager, not a developer, can build a screen in ten minutes. Everything below
is on the existing Vite+React admin; the layout JSON schema stays backward compatible.

### B1. Media library (per tenant)
- New page **Media**: upload images (PNG/JPG/SVG/WebP, up to 10 MB) and short MP4 clips
  (for a future `video_loop` zone). Drag-and-drop upload, grid with thumbnails, rename,
  delete (blocked if referenced by a layout — show where).
- Stored under `/srv/coopcentric/tenants/<name>/procentric/application/media/<uuid>.<ext>`
  so the TV loads them same-origin, long-cache headers (immutable, hashed names).
- Server generates thumbnails (use `sharp`) and records width/height.
- `image` zones and the canvas background pick from the library (picker modal) or accept a
  URL. `{{logo}}` remains and is just the tenant logo from Settings, which now lives in the
  library too.

### B2. Canvas editor UX
- Left: zone palette (drag onto canvas) grouped: Video, Text, Image, Channel list, Menu,
  Clock, Weather, Banner/Digits/Popup (OSD), HTML.
- Centre: 16:9 canvas with snap-to-grid (8 px), smart guides, alignment toolbar (left /
  centre / right / top / middle / bottom, distribute), z-order (bring forward/back),
  lock/hide per zone, multi-select, arrow-key nudge, Ctrl-D duplicate, undo/redo (50 steps).
- Right: property panel with typed controls (colour picker, font picker from a bundled set of
  open-licence fonts served same-origin, size slider, alignment, padding, opacity, radius,
  shadow). No raw JSON needed; keep the JSON tab as "Advanced".
- **Templates**: ship 4 starter layouts (Classic: video left, menu right; Full-screen TV with
  overlay bar; Welcome page with big photo; Info/Menu page). "New layout from template".
- **Preview**: in-editor preview renders with the real renderer code (share the renderer's
  zone drawing module between tv-app and admin — factor it so both import the same code),
  with fake channel data. "Preview on set" already exists; keep it.
- **Screens**: visual tabs for `home`, `fullscreen`, plus user-defined pages (e.g. `info`,
  `dining`). A `menu` item's action picker lists the pages, apps (B3) and built-ins.
- Text zones: WYSIWYG-lite (bold/italic/size/colour per zone, line breaks), variables menu
  for `{{hotel}} {{room}} {{guest}} {{guest_first}} {{checkout_date}} {{time}} {{date}}`.
- Validation errors shown inline on the zone, never as a blocking alert.

### B3. Apps
- Renderer at register sends the result of `idcap://application/list` (HCAP:
  `hcap.application.getApplicationList` / `hcap.preloadedApplication` — check symbols) so the
  server knows which app IDs exist on each model (Netflix, YouTube, Prime, Disney+, browser…).
- Admin **Apps** page per tenant: table of discovered apps across the fleet (id, title, icon
  if LG provides one, models seen on), enable/disable per group, display name and icon
  override (from Media library).
- New zone type `apps`: a row/grid of enabled app tiles (icon + name), remote-navigable,
  OK launches via `idcap://application/launch { id, noSplash }`. A `menu` item can also
  target an app. On `visibilitychange` hidden → pause video (already done); on return →
  resume and re-register keys if needed.
- Checkout (Part C) must clear app sign-ins: `tv/checkout/request` — verify on hardware
  whether it also resets Netflix; if not, look for `application/uninstall`/reinstall or the
  data-clear option in the checkout parameters and document what LG supports.

---

## Part C — basic local PMS (reservations calendar)

No external PMS. The platform keeps its own reservations and derives room occupancy from dates.

### Data
```
reservations  id, tenant_id, room_number, first_name, last_name, checkin_date (DATE),
              checkout_date (DATE), lang, vip (bool), notes, source (manual|import),
              status (booked|checked_in|checked_out|cancelled), created_at, updated_at
pms_log       id, tenant_id, reservation_id, event, source, payload_json, created_at
```
Rule: a room is occupied on date D by the reservation with checkin_date <= D < checkout_date
and status in (booked, checked_in). Overlapping reservations for the same room are rejected
on save/import with a clear message.

### Admin — Rooms & Reservations
- Calendar view: rooms down the left, days across the top (week/month), reservation bars
  spanning check-in to check-out; click a bar to edit, click an empty cell to add. Today
  column highlighted. Filter by group.
- List view: table with search, sort, status, and "arrivals today" / "departures today" tabs.
- Reservation form: room (picker from known rooms + free text), first name, last name,
  check-in date, check-out date, language, VIP, notes.
- Manual "Check in now" / "Check out now" buttons override the dates.

### Automation (server scheduler, every minute, tenant-timezone aware)
- At the tenant's check-in time on checkin_date (default 14:00): status → checked_in, push
  guest variables to the room's sets, optional welcome popup for N seconds (group setting).
- At check-out time on checkout_date (default 11:00) or on manual check-out: status →
  checked_out, queue `checkout` command to the room's sets (LG tv/checkout/request), then
  push the vacant layout with blank variables. Optional per-group "vacant layout".
- Sets that register or reconnect get the current occupant resolved from today's date.

### Import
- Import page: upload CSV or XLSX exported from another system. Show the first rows, map
  columns to room / first name / last name / check-in / check-out (optional lang, notes) with
  a date-format picker; preview with per-row validation (bad date, unknown room, overlap);
  import valid rows; download a report of skipped rows.
- Save the column mapping per tenant as a named profile for one-click re-import.
- Export: CSV of reservations for a date range.

### Renderer
- Variables: {{guest}} (first + last), {{guest_first}}, {{guest_last}}, {{checkin_date}},
  {{checkout_date}}, {{nights}}; blank when vacant. Pushed live on change.
- After a `checkout` command the renderer reloads itself so no guest state survives.

### API (small, for later bridges)
- POST /api/pms/reservations, PATCH /api/pms/reservations/:id, GET /api/pms/rooms?date=
  with a per-tenant API key; every write logged to pms_log. Documented in docs/PMS-API.md.

---

## Part D — offline-capable deployment (remote-deploy mode)

Today the TV fetches index.html from the server every boot, so an unreachable server means no
portal. Implement LG's remote-deploy mode and make the renderer offline-first:

1. Per-tenant app bundle. On every tv-app build or tenant publish, build
   `procentric/application/app.zip` containing the renderer (index.html, hashed app.js, lib/,
   fonts/, shared CSS), the tenant's media library, and `state.json` — a snapshot of everything
   `/api/tv/register` would return for that tenant (layouts, lineups, apps/licences status,
   settings). `xait.xml` switches to the remote-deploy form: `<url>` → app.zip,
   `<applicationStructure>` with `baseDirectory /`, `classpathExtension /`, `initialClass
   index.html`. Server manages `versionNumber`/`version`: increment both by 1 (wrap at 65535)
   whenever app.zip content changes; layout/lineup changes do not bump (they're pushed live).
   Keep remote-run as a per-tenant mode switch (Settings → Deployment: remote-run for
   development, remote-deploy for production); `coopcentric-tenant` gets `bundle <name>` and
   `mode <name> run|deploy`.
2. Renderer offline-first. On boot: render immediately from the last good state in localStorage
   (fallback: the bundled `state.json`), then try `/api/tv/register`; if the server answers,
   apply and cache; if not, keep running from cache, retry with backoff, and reconnect WS when it
   returns. Video, channel zapping, pages, apps and Netflix registration must all work with the
   server down. Media zones resolve to bundled files first, server URLs second.
3. Cross-origin. A locally stored app has a different origin than the tenant hostname: verify
   how webOS reports it (`location.origin` at boot — log it) and configure CORS on `/api/` and
   `/ws/` to accept it, authenticating by the set token, not by origin. Tenant is resolved from
   the hostname baked into `state.json` (`tenant_host`) and sent as a header, not from the
   request Host.
4. Update path. After publishing a new bundle, TVs pick it up at their next power-off/on (xait
   comparison) — show per-set app build in the fleet table and a "bundle version pending"
   indicator. Admin button "Publish bundle" plus a dry-run diff of what changed.
5. Tests: bundle contents; renderer boots with the server unreachable (Chromium with `/api`
   blocked) and shows the layout, tunes, and navigates; then the server comes back and state
   syncs; xait version increments only on bundle change.
6. Also: `/admin/status` with the build hash.

---

## Hardware facts to rely on (from LG docs, verified where noted)
- `system/nosignalimage/set` modes: `off` | `default` (Commercial TV, IDPN 100).
- `application/list` returns installed apps; `application/launch { id, params?, noSplash? }`.
- `instant_power` property is read/write, values 0/1; WARM switching unsupported while 0.
- `tv/checkout/request` exists (IDPN 100); parameters to be checked in the doc before use.
- HTML5 `<video>` plays HLS incl. HEVC on this set (verified); LG media pipeline does not
  play HEVC HLS (verified) — keep HTML5 primary.
