'use strict';
// Layout resolution for a set: per-set override → group assignment → tenant default →
// built-in "unassigned" screen. Layout documents follow docs/PLATFORM.md "Layout document (v1)".

function unassignedLayout({ tenant, set }) {
  const serial = set.serial || '—';
  return {
    schema: 1,
    name: 'Unassigned',
    builtin: 'unassigned',
    canvas: { w: 1920, h: 1080, background: '#0b1a2a', backgroundImage: null },
    zones: [
      { id: 'title', type: 'text', x: 120, y: 200, w: 1680, h: 110,
        text: 'This TV is not yet assigned',
        style: { fontSize: 72, fontWeight: 'bold', color: '#ffffff' } },
      { id: 'hint', type: 'text', x: 120, y: 330, w: 1680, h: 60,
        text: `Find this serial number in CoopCentric admin (${tenant.hostname}) and give it a room and a group.`,
        style: { fontSize: 34, color: '#8fb3c9' } },
      { id: 'serial_label', type: 'text', x: 120, y: 500, w: 400, h: 60,
        text: 'Serial', style: { fontSize: 36, color: '#8fb3c9' } },
      { id: 'serial', type: 'text', x: 120, y: 560, w: 1680, h: 160,
        text: serial, style: { fontSize: 140, fontWeight: 'bold', color: '#ffd166', letterSpacing: 6 } },
      { id: 'model', type: 'text', x: 120, y: 780, w: 1680, h: 50,
        text: `Model ${set.model || '—'} · firmware ${set.firmware_version || '—'} · ${set.api ? set.api.toUpperCase() : '?'}${set.idpn ? ' IDPN ' + set.idpn : ''}`,
        style: { fontSize: 30, color: '#8fb3c9' } },
      { id: 'room', type: 'text', x: 120, y: 840, w: 1680, h: 50,
        text: `Room number on set: ${set.room_number || 'not set'}`,
        style: { fontSize: 30, color: '#8fb3c9' } },
      { id: 'clock', type: 'clock', x: 1560, y: 980, w: 260, h: 60, format: 'HH:mm',
        style: { fontSize: 40, color: '#ffffff', align: 'right' } },
      { id: 'brand', type: 'text', x: 120, y: 980, w: 800, h: 60,
        text: `CoopCentric · ${tenant.display_name || tenant.name}`,
        style: { fontSize: 28, color: '#5c7a8f' } },
    ],
    keys: {},
    screens: [{ id: 'home', zones: ['title', 'hint', 'serial_label', 'serial', 'model', 'room', 'clock', 'brand'] }],
  };
}

function parseLayoutRow(row) {
  if (!row) return null;
  try {
    const doc = JSON.parse(row.json);
    doc.id = row.id;
    doc.version = row.version;
    doc.updated_at = row.updated_at;
    return doc;
  } catch {
    return null;
  }
}

function makeLayoutResolver(db) {
  const byId = db.prepare('SELECT * FROM layouts WHERE id = ? AND tenant_id = ?');
  const byGroup = db.prepare(`SELECT l.* FROM layout_assign a JOIN layouts l ON l.id = a.layout_id
                              WHERE a.group_id = ? AND l.tenant_id = ?`);
  return function resolveLayout(tenant, set) {
    let doc = null;
    if (set.layout_override_id) doc = parseLayoutRow(byId.get(set.layout_override_id, tenant.id));
    if (!doc && set.group_id) doc = parseLayoutRow(byGroup.get(set.group_id, tenant.id));
    if (!doc && tenant.default_layout_id) doc = parseLayoutRow(byId.get(tenant.default_layout_id, tenant.id));
    return doc || unassignedLayout({ tenant, set });
  };
}

module.exports = { unassignedLayout, makeLayoutResolver };
