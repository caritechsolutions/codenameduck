Files shared by server/, admin/ and tv-app/ so there is one source of truth.

- `zone-types.json` — every layout zone type. The renderer registers a drawer per type, the
  server validator accepts exactly this list, and the admin editor/palette reads it too.
  Adding a zone type = add it here + a renderer function + editor defaults; tests fail otherwise.
