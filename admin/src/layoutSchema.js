// Client-side mirror of server/src/layout.js validateLayout — enough to give instant feedback
// while typing; the server re-validates on save.
import SHARED_ZONE_TYPES from '../../shared/zone-types.json';
import { upgradeLayout, validatePages } from '../../shared/layout-model.js';
export const ZONE_TYPES = SHARED_ZONE_TYPES;   // single source of truth shared with server and renderer

export function validateLayoutText(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { doc: null, errors: ['Invalid JSON: ' + e.message] }; }
  return validateLayout(doc);
}

export function validateLayout(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { doc: null, errors: ['Layout must be an object'] };
  if (doc.schema !== undefined && doc.schema !== 1 && doc.schema !== 2) errors.push('schema must be 1 or 2');
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
    if (doc.screens !== undefined && !Array.isArray(doc.screens)) errors.push('screens must be an array');
    if (doc.pages !== undefined && !Array.isArray(doc.pages)) errors.push('pages must be an array');
  }
  // pages / actions (v1 input is upgraded first: screens → pages, hidden zones → pages)
  const v2 = Array.isArray(doc.zones) ? upgradeLayout(doc) : null;
  if (v2) for (const e of validatePages(v2)) errors.push(e);
  return { doc: errors.length ? null : v2, errors };
}
