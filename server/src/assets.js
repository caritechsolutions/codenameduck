'use strict';
// Per-tenant static assets (logos, backgrounds) written into the tenant's procentric/application/
// assets/ directory so the TV loads them from its own hostname. coopcentric-tenant deploy leaves
// assets/ alone.
const fs = require('fs');
const path = require('path');

const SAFE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}\.(png|jpe?g|gif|webp|svg)$/i;

function createAssetStore(tenantsDir) {
  function dirFor(tenant) { return path.join(tenantsDir, tenant.name, 'procentric', 'application', 'assets'); }
  function urlFor(name) { return `/procentric/application/assets/${name}`; }
  function list(tenant) {
    const d = dirFor(tenant);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => SAFE.test(f)).map((f) => {
      const st = fs.statSync(path.join(d, f));
      return { name: f, url: urlFor(f), bytes: st.size, mtime: st.mtime.toISOString() };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  function save(tenant, name, buf) {
    if (!SAFE.test(name)) throw new Error('file name must be letters/digits/._- ending in .png .jpg .gif .webp or .svg');
    const d = dirFor(tenant);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name), buf);
    return { name, url: urlFor(name), bytes: buf.length };
  }
  function remove(tenant, name) {
    if (!SAFE.test(name)) return false;
    const f = path.join(dirFor(tenant), name);
    if (!fs.existsSync(f)) return false;
    fs.unlinkSync(f);
    return true;
  }
  return { list, save, remove, dirFor, urlFor, SAFE };
}

// Decode an upload: raw image body (Content-Type image/*) or JSON {data_url, name}.
function decodeImageUpload(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) {
    const ct = String(req.headers['content-type'] || '');
    const ext = /png/.test(ct) ? 'png' : /gif/.test(ct) ? 'gif' : /webp/.test(ct) ? 'webp' : /svg/.test(ct) ? 'svg' : 'jpg';
    return { buf: req.body, ext, name: req.headers['x-filename'] ? String(req.headers['x-filename']) : null };
  }
  if (req.body && typeof req.body.data_url === 'string') {
    const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/i.exec(req.body.data_url);
    if (!m) return { error: 'data_url must be a base64 image' };
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    return { buf: Buffer.from(m[2], 'base64'), ext, name: req.body.name || null };
  }
  return { error: 'no image data' };
}

module.exports = { createAssetStore, decodeImageUpload };
