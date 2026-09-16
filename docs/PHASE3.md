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

## Part C — basic PMS

Minimal but real: rooms have guests, layouts greet them, checkout cleans the TV.

### Data
```
rooms       id, tenant_id, room_number (unique per tenant), guest_name, guest_first,
            guest_lang, checkin_at, checkout_at, status (vacant|occupied), vip (bool), notes
pms_log     id, tenant_id, room_number, event (checkin|checkout|update), source (manual|api|csv),
            payload_json, created_at
```
Sets keep `room_number`; a set's guest is looked up by room at render time and pushed on
change. Multiple sets in one room all get the same guest.

### Admin
- **Rooms** page: table of rooms (auto-created from sets' room numbers, plus manual add),
  status, guest, dates; inline check-in (name, optional language, checkout date) and
  check-out buttons; bulk CSV import (room, guest, checkin, checkout).
- Check-out action: marks vacant, queues `checkout` command to every set in the room
  (LG `tv/checkout/request`), then pushes the vacant layout (group layout with variables
  blank; optional per-group "vacant layout").
- Check-in: pushes the guest variables to the room's sets immediately (`{{guest}}` etc.),
  optional welcome popup for N seconds (group setting).

### API for external PMS (so a real Opera/Mews/CSV bridge can come later)
- `POST /api/pms/checkin`, `POST /api/pms/checkout`, `POST /api/pms/update` with a per-tenant
  API key (Settings → PMS → generate key). JSON body: `{room, guest_name, guest_first?,
  lang?, checkin_at?, checkout_at?}`. Every call logged to `pms_log`. Idempotent.
- `GET /api/pms/rooms` for status.
- Document in `docs/PMS-API.md` with curl examples.

### Renderer
- New variables resolved from the register/poll payload and WS `guest` messages.
- `checkout` command already exists; after it, the renderer reloads itself
  (`procentric/application/launch` or `location.reload()`) so no guest state survives.

---

## Part D — deploy/operational

- `install.sh` unchanged in usage; must add `sharp` and any new deps.
- Migration for rooms/pms_log/apps/media.
- Tenant landing `/` → `/admin` already; add `/admin/status` public-less health for NPM checks
  (returns 200 with build hash) so Richard can see which build a tenant is on.

---

## Hardware facts to rely on (from LG docs, verified where noted)
- `system/nosignalimage/set` modes: `off` | `default` (Commercial TV, IDPN 100).
- `application/list` returns installed apps; `application/launch { id, params?, noSplash? }`.
- `instant_power` property is read/write, values 0/1; WARM switching unsupported while 0.
- `tv/checkout/request` exists (IDPN 100); parameters to be checked in the doc before use.
- HTML5 `<video>` plays HLS incl. HEVC on this set (verified); LG media pipeline does not
  play HEVC HLS (verified) — keep HTML5 primary.
