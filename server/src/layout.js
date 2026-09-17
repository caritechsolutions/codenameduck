'use strict';
// Layout resolution for a set: per-set override → group assignment → tenant default →
// built-in "unassigned" screen. Layout documents are v2 (pages, shared/layout-model.js); v1
// documents (screens) are upgraded on read and on save.
const path = require('path');
const { loadEsm } = require('./esm');
const model = loadEsm(path.resolve(__dirname, '../../shared/layout-model.js'));
const { upgradeLayout, validatePages, actionOf } = model;

function unassignedLayout({ tenant, set }) {
  const serial = set.serial || '—';
  return upgradeLayout({
    schema: 2,
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
    pages: [{ id: 'home', name: 'Home', zones: ['title', 'hint', 'serial_label', 'serial', 'model', 'room', 'clock', 'brand'], inherit: true }],
    home: 'home',
  });
}

function parseLayoutRow(row) {
  if (!row) return null;
  try {
    const doc = upgradeLayout(JSON.parse(row.json));
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


const ZONE_TYPES = require('../../shared/zone-types.json');   // single source of truth (see shared/README.md)

// Validate + normalise a layout document (schema 1). Returns { doc, errors }.
function validateLayout(input) {
  const errors = [];
  let doc = input;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { return { doc: null, errors: ['invalid JSON: ' + e.message] }; } }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { doc: null, errors: ['layout must be an object'] };
  if (doc.schema !== undefined && doc.schema !== 1 && doc.schema !== 2) errors.push('schema must be 1 or 2');
  doc = upgradeLayout(doc);
  const out = { schema: 2 };
  out.name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim().slice(0, 80) : 'Untitled';
  const c = doc.canvas && typeof doc.canvas === 'object' ? doc.canvas : {};
  out.canvas = {
    w: num(c.w, 1920), h: num(c.h, 1080),
    background: typeof c.background === 'string' ? c.background : '#0b1a2a',
    backgroundImage: typeof c.backgroundImage === 'string' && c.backgroundImage ? c.backgroundImage : null,
  };
  if (!Array.isArray(doc.zones)) { errors.push('zones must be an array'); out.zones = []; }
  else {
    const ids = new Set();
    out.zones = doc.zones.map((z, i) => {
      if (!z || typeof z !== 'object') { errors.push(`zone ${i} must be an object`); return null; }
      const id = typeof z.id === 'string' && z.id.trim() ? z.id.trim() : `zone${i + 1}`;
      if (ids.has(id)) errors.push(`duplicate zone id "${id}"`);
      ids.add(id);
      if (!ZONE_TYPES.includes(z.type)) errors.push(`zone "${id}": unknown type "${z.type}"`);
      for (const k of ['x', 'y', 'w', 'h']) if (z[k] !== undefined && !Number.isFinite(Number(z[k]))) errors.push(`zone "${id}": ${k} must be a number`);
      return { ...z, id, x: num(z.x, 0), y: num(z.y, 0), w: num(z.w, 200), h: num(z.h, 100) };
    }).filter(Boolean);
    if (out.zones.filter((z) => z.type === 'video').length > 1) errors.push('at most one video zone');
    for (const t of ['banner', 'digits', 'popup']) if (out.zones.filter((z) => z.type === t).length > 1) errors.push(`at most one ${t} zone`);
  }
  out.keys = doc.keys && typeof doc.keys === 'object' ? doc.keys : {};
  out.pages = doc.pages;
  out.home = doc.home;
  out.focus = doc.focus;
  out.back_on_home = doc.back_on_home;
  for (const e of validatePages(out)) errors.push(e);
  return { doc: out, errors };
}

// One-time rewrite of stored v1 layouts to v2 (idempotent; runs at startup).
function migrateStoredLayouts(db, log = () => {}) {
  const rows = db.prepare('SELECT id, name, json FROM layouts').all();
  let n = 0;
  const upd = db.prepare('UPDATE layouts SET json = ? WHERE id = ?');
  for (const r of rows) {
    let doc; try { doc = JSON.parse(r.json); } catch { continue; }
    if (doc && doc.schema === 2 && Array.isArray(doc.pages)) continue;
    const { doc: v2 } = validateLayout(doc);
    if (!v2) continue;
    v2.name = doc.name || r.name;
    upd.run(JSON.stringify(v2), r.id);
    n++;
  }
  if (n) log(`layouts: upgraded ${n} layout(s) to schema 2 (pages)`);
  return n;
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// Starter layouts: shared/layout-templates.json (also shown in the admin's "New layout"
// dialog). starterLayout() keeps the old name for the "classic" one.
const TEMPLATES = require('../../shared/layout-templates.json');
function layoutTemplates() { return TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, json: t.json })); }
function templateLayout(id, name = 'New layout') {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return { ...JSON.parse(JSON.stringify(t.json)), name };
}
function starterLayout(name = 'New layout') { return templateLayout('classic', name); }

module.exports = { unassignedLayout, makeLayoutResolver, validateLayout, starterLayout, templateLayout, layoutTemplates, migrateStoredLayouts, upgradeLayout, actionOf, model, ZONE_TYPES };
