Files shared by server/, admin/ and tv-app/ so there is one source of truth.

- `zone-types.json` — every layout zone type. The renderer registers a drawer per type, the
  server validator accepts exactly this list, and the admin editor/palette reads it too.
  Adding a zone type = add it here + a renderer function + editor defaults; tests fail otherwise.
- `zone-draw.js` — the zone drawing code (text/image/clock/channel list/menu/html/weather,
  variable substitution, style application). The TV renderer imports it, and so does the
  admin's in-editor preview, so what the editor shows is what the set draws. `zones.css` is
  the matching stylesheet (copied into `tv-app/dist/` by the build, imported by the admin).
- `fonts.json` — the bundled open-licence fonts (files in `tv-app/fonts/`, served from the
  tenant hostname). The admin font picker lists these; `style.fontFamily` holds the family.
- `layout-templates.json` — the starter layouts ("New layout from template"); the server's
  `POST /api/admin/layouts {template}` and `starterLayout()` read it.
