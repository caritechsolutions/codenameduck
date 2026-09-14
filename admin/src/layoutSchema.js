// Client-side mirror of server/src/layout.js validateLayout — enough to give instant feedback
// while typing; the server re-validates on save.
export const ZONE_TYPES = ['video', 'text', 'image', 'channel_list', 'clock', 'menu', 'html', 'weather', 'app_launcher'];

export function validateLayoutText(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { doc: null, errors: ['Invalid JSON: ' + e.message] }; }
  return validateLayout(doc);
}

export function validateLayout(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { doc: null, errors: ['Layout must be an object'] };
  if (doc.schema !== undefined && doc.schema !== 1) errors.push('schema must be 1');
  if (!Array.isArray(doc.zones)) errors.push('zones must be an array');
  else {
    const ids = new Set();
    doc.zones.forEach((z, i) => {
      if (!z || typeof z !== 'object') { errors.push(`zone ${i} must be an object`); return; }
      const id = z.id || `zone${i + 1}`;
      if (ids.has(id)) errors.push(`duplicate zone id "${id}"`);
      ids.add(id);
      if (!ZONE_TYPES.includes(z.type)) errors.push(`zone "${id}": unknown type "${z.type}"`);
      for (const k of ['x', 'y', 'w', 'h']) if (z[k] !== undefined && !Number.isFinite(Number(z[k]))) errors.push(`zone "${id}": ${k} must be a number`);
    });
    if (doc.zones.filter((z) => z && z.type === 'video').length > 1) errors.push('at most one video zone');
    if (Array.isArray(doc.screens)) {
      doc.screens.forEach((s, i) => (s && Array.isArray(s.zones) ? s.zones : []).forEach((zid) => { if (!ids.has(zid)) errors.push(`screen "${(s && s.id) || i}" references unknown zone "${zid}"`); }));
    } else if (doc.screens !== undefined) errors.push('screens must be an array');
  }
  return { doc: errors.length ? null : doc, errors };
}
