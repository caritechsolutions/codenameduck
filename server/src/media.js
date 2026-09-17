'use strict';
// Per-tenant media library (Phase 3 B1). Images (png/jpg/gif/webp/svg) and short MP4 clips are
// written to tenants/<name>/procentric/application/media/<uuid>.<ext> so the TV loads them from
// its own hostname with immutable cache headers (the name is unique per upload). sharp makes a
// JPEG thumbnail (max 320 px) and reads width/height; MP4 gets no thumbnail and null dimensions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 10 * 1024 * 1024;
const THUMB_PX = 320;
const TYPES = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  mp4: { kind: 'video', mime: 'video/mp4' },
};
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4' };

let sharpMod;
function loadSharp() {
  if (sharpMod !== undefined) return sharpMod;
  try { sharpMod = require('sharp'); } catch (e) { sharpMod = null; }
  return sharpMod;
}

function extFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  if (!m) return null;
  const e = m[1].toLowerCase().replace('jpeg', 'jpg');
  return TYPES[e] ? e : null;
}
function extFromMime(ct) {
  const base = String(ct || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || null;
}
// Sniff the magic bytes so a renamed executable cannot land in the library.
function sniffExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  const head = buf.slice(0, 512).toString('utf8').replace(/^﻿/, '').replace(/^\s+/, '');
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

function cleanName(s, fallback) {
  const v = String(s == null ? '' : s).trim().replace(/[\x00-\x1f]/g, '').slice(0, 120);
  return v || fallback;
}

function createMediaStore(db, tenantsDir, { log = () => {} } = {}) {
  const dirFor = (tenant) => path.join(tenantsDir, tenant.name, 'procentric', 'application', 'media');
  const fileFor = (tenant, row) => path.join(dirFor(tenant), `${row.uuid}.${row.ext}`);
  const thumbFor = (tenant, row) => path.join(dirFor(tenant), 'thumbs', `${row.uuid}.jpg`);
  const urlFor = (row) => `/procentric/application/media/${row.uuid}.${row.ext}`;
  const thumbUrlFor = (row) => (row.has_thumb ? `/procentric/application/media/thumbs/${row.uuid}.jpg` : null);

  function toApi(row) {
    return { id: row.id, uuid: row.uuid, kind: row.kind, ext: row.ext, mime: row.mime, name: row.name, bytes: row.bytes,
      width: row.width, height: row.height, url: urlFor(row), thumb_url: thumbUrlFor(row), created_at: row.created_at };
  }
  function list(tenant) {
    return db.prepare('SELECT * FROM media WHERE tenant_id = ? ORDER BY created_at DESC, id DESC').all(tenant.id).map(toApi);
  }
  function getRow(tenant, id) { return db.prepare('SELECT * FROM media WHERE id = ? AND tenant_id = ?').get(Number(id), tenant.id) || null; }
  function get(tenant, id) { const r = getRow(tenant, id); return r ? toApi(r) : null; }

  async function probe(buf, ext) {
    const sharp = loadSharp();
    const out = { width: null, height: null, thumb: null };
    if (TYPES[ext].kind !== 'image') return out;
    if (!sharp) { log('media: sharp is not installed, no thumbnails'); return out; }
    try {
      const meta = await sharp(buf).metadata();
      out.width = meta.width || null; out.height = meta.height || null;
      out.thumb = await sharp(buf).resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#0b1a2a' }).jpeg({ quality: 80 }).toBuffer();
    } catch (e) {
      log(`media: sharp could not read ${ext}: ${e.message}`);
    }
    return out;
  }

  // Validate, sniff, write file + thumb, insert row. Returns the API row.
  async function save(tenant, { buf, name, contentType }) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('empty upload');
    if (buf.length > MAX_BYTES) throw badRequest(`file is larger than ${MAX_BYTES / 1024 / 1024} MB`);
    const sniffed = sniffExt(buf);
    if (!sniffed) throw badRequest('unsupported file type (PNG, JPG, GIF, WebP, SVG or MP4)');
    const claimed = extFromName(name) || extFromMime(contentType);
    if (claimed && claimed !== sniffed) log(`media: upload named ${name || contentType} looks like ${sniffed}, storing as ${sniffed}`);
    const e = sniffed;
    const type = TYPES[e];
    const dims = await probe(buf, e);
    const uuid = crypto.randomUUID();
    const row = { uuid, ext: e, has_thumb: dims.thumb ? 1 : 0 };
    const dir = dirFor(tenant);
    fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
    fs.writeFileSync(fileFor(tenant, row), buf);
    if (dims.thumb) fs.writeFileSync(thumbFor(tenant, row), dims.thumb);
    const display = cleanName(name ? String(name).replace(/\.[a-z0-9]+$/i, '') : '', `${type.kind}-${uuid.slice(0, 8)}`);
    const info = db.prepare('INSERT INTO media (tenant_id, uuid, kind, ext, mime, name, bytes, width, height, has_thumb) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(tenant.id, uuid, type.kind, e, type.mime, display, buf.length, dims.width, dims.height, row.has_thumb);
    return get(tenant, info.lastInsertRowid);
  }

  function rename(tenant, id, name) {
    const row = getRow(tenant, id);
    if (!row) return null;
    const v = cleanName(name, '');
    if (!v) throw badRequest('name required');
    db.prepare('UPDATE media SET name = ? WHERE id = ?').run(v, row.id);
    return get(tenant, row.id);
  }

  // Layouts (and the tenant logo) that reference this file, by URL substring.
  function references(tenant, id) {
    const row = getRow(tenant, id);
    if (!row) return { layouts: [], logo: false };
    const needle = `/${row.uuid}.${row.ext}`;
    const layouts = db.prepare('SELECT id, name FROM layouts WHERE tenant_id = ? AND instr(json, ?) > 0 ORDER BY name').all(tenant.id, needle);
    const t = db.prepare('SELECT settings_json FROM tenants WHERE id = ?').get(tenant.id);
    let logo = false;
    try { logo = String((JSON.parse((t && t.settings_json) || '{}') || {}).logo_url || '').indexOf(needle) >= 0; } catch { /* ignore */ }
    return { layouts, logo };
  }

  function remove(tenant, id, { force = false } = {}) {
    const row = getRow(tenant, id);
    if (!row) return { ok: false, status: 404, error: 'media not found' };
    const refs = references(tenant, id);
    if (!force && (refs.layouts.length || refs.logo)) return { ok: false, status: 409, error: 'media is in use', ...refs };
    db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    for (const f of [fileFor(tenant, row), thumbFor(tenant, row)]) { try { fs.unlinkSync(f); } catch { /* gone already */ } }
    return { ok: true, ...refs };
  }

  return { list, get, save, rename, remove, references, dirFor, urlFor, MAX_BYTES, TYPES };
}

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

// Decode an upload: raw body (Content-Type image/* or video/mp4, file name in X-Filename,
// URI-encoded) or JSON {data_url, name}.
function decodeMediaUpload(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) {
    let name = null;
    if (req.headers['x-filename']) { try { name = decodeURIComponent(String(req.headers['x-filename'])); } catch { name = String(req.headers['x-filename']); } }
    return { buf: req.body, contentType: req.headers['content-type'], name };
  }
  if (req.body && typeof req.body.data_url === 'string') {
    const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(req.body.data_url);
    if (!m) return { error: 'data_url must be a base64 data URL' };
    return { buf: Buffer.from(m[2], 'base64'), contentType: m[1], name: req.body.name || null };
  }
  return { error: 'no file data' };
}

module.exports = { createMediaStore, decodeMediaUpload, sniffExt, extFromName, MAX_BYTES };
