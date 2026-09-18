'use strict';
// LG app licence tokens (Phase 3 B3c). One .lic file per SI product (NETFLIX_*.lic, AMAZON_*.lic,
// AirPlay_*.lic, GOOGLE CAST_*.lic); each file is a single base64 token. Tokens are per SI
// partner, so they are global (all tenants) and superadmin-only. Stored AES-256-GCM encrypted
// with the key in <dataDir>/secret.key (created by install.sh or on first use, mode 600); the UI
// only ever sees the last 6 characters.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIXES = [
  [/^netflix/i, 'netflix'],
  [/^amazon/i, 'amazon'],
  [/^air\s*play/i, 'airplay'],        // our guess — confirm against application/list on the set
  [/^google\s*cast/i, 'googlecast'],  // our guess — confirm against application/list on the set
];
const KNOWN_IDS = ['netflix', 'amazon', 'airplay', 'googlecast'];

function appIdForFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  for (const [re, id] of PREFIXES) if (re.test(base)) return id;
  return null;
}
function isTokenish(s) { return typeof s === 'string' && s.length >= 16 && s.length <= 8192 && /^[A-Za-z0-9+/=_\-.]+$/.test(s); }

function loadOrCreateKey(dataDir, log) {
  if (!dataDir) { log('licences: no data dir — using an ephemeral encryption key (tokens will not survive a restart)'); return crypto.randomBytes(32); }
  const file = path.join(dataDir, 'secret.key');
  try {
    const hex = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
    throw new Error('secret.key is not 32 hex bytes');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const key = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
    log(`licences: created ${file} (mode 600)`);
    return key;
  }
}

function createLicenceStore(db, { dataDir = null, log = () => {} } = {}) {
  const key = loadOrCreateKey(dataDir, log);
  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return `v1:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
  };
  const decrypt = (blob) => {
    const [v, iv, tag, ct] = String(blob).split(':');
    if (v !== 'v1') throw new Error('unknown token format');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8');
  };
  const qAll = db.prepare('SELECT * FROM licences ORDER BY app_id');
  const qByApp = db.prepare('SELECT * FROM licences WHERE app_id = ?');
  const qById = db.prepare('SELECT * FROM licences WHERE id = ?');
  const ins = db.prepare('INSERT INTO licences (app_id, filename, token_enc, token_tail) VALUES (?, ?, ?, ?)');
  const upd = db.prepare(`UPDATE licences SET filename = ?, token_enc = ?, token_tail = ?, uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failed_model = NULL, failed_at = NULL, failed_message = NULL WHERE id = ?`);

  const toApi = (r) => ({ id: r.id, app_id: r.app_id, filename: r.filename, tail: r.token_tail, uploaded_at: r.uploaded_at,
    failed: r.failed_model || r.failed_at ? { model: r.failed_model, at: r.failed_at, message: r.failed_message } : null });
  function list() { return qAll.all().map(toApi); }
  // Add or replace the token for an app. Returns {row, replaced}.
  function put({ filename, content, app_id }) {
    const token = String(content == null ? '' : content).replace(/\s+/g, '');
    if (!isTokenish(token)) { const e = new Error(`${filename || 'file'}: not a licence token (expected one base64 string)`); e.status = 400; return { error: e }; }
    const id = String(app_id || appIdForFilename(filename) || '').trim().toLowerCase().slice(0, 100);
    if (!id) { const e = new Error(`${filename || 'file'}: cannot tell which app this licence is for — name it NETFLIX_*.lic, AMAZON_*.lic, AirPlay_*.lic or GOOGLE CAST_*.lic, or set the app id`); e.status = 400; return { error: e }; }
    const enc = encrypt(token), tail = token.slice(-6);
    const existing = qByApp.get(id);
    if (existing) { upd.run(String(filename || '').slice(0, 200), enc, tail, existing.id); return { row: toApi(qById.get(existing.id)), replaced: true }; }
    const info = ins.run(id, String(filename || '').slice(0, 200), enc, tail);
    return { row: toApi(qById.get(info.lastInsertRowid)), replaced: false };
  }
  function setAppId(id, appId) {
    const r = qById.get(Number(id));
    if (!r) return null;
    const v = String(appId || '').trim().toLowerCase().slice(0, 100);
    if (!v) { const e = new Error('app id required'); e.status = 400; throw e; }
    if (qByApp.get(v) && qByApp.get(v).id !== r.id) { const e = new Error(`a licence for ${v} already exists`); e.status = 409; throw e; }
    db.prepare('UPDATE licences SET app_id = ?, failed_model = NULL, failed_at = NULL, failed_message = NULL WHERE id = ?').run(v, r.id);   // editing the id re-enables registration
    return toApi(qById.get(r.id));
  }
  function remove(id) { return db.prepare('DELETE FROM licences WHERE id = ?').run(Number(id)).changes > 0; }
  // Decrypted tokens for the sets: [{id, token}]. Licences LG answered "fail" for are left out
  // until they are replaced or renamed (includeFailed lists them anyway).
  function tokens({ includeFailed = false } = {}) {
    const out = [];
    for (const r of qAll.all()) {
      if (!includeFailed && (r.failed_model || r.failed_at)) continue;
      try { out.push({ id: r.app_id, token: decrypt(r.token_enc) }); } catch (e) { log(`licences: cannot decrypt token for ${r.app_id}: ${e.message}`); }
    }
    return out;
  }
  // LG's application_registration_result_received said tokenResult "fail" for this app.
  function markFailed(appId, model, message) {
    const r = qByApp.get(String(appId || '').toLowerCase());
    if (!r) return null;
    db.prepare(`UPDATE licences SET failed_model = ?, failed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failed_message = ? WHERE id = ?`).run(String(model || 'unknown model').slice(0, 80), message == null ? null : String(message).slice(0, 300), r.id);
    log(`licences: ${r.app_id} registration FAILED on ${model || '?'}${message ? ': ' + message : ''} — not retried until the token or id is edited`);
    return toApi(qById.get(r.id));
  }
  return { list, put, setAppId, remove, tokens, markFailed, appIdForFilename, KNOWN_IDS, encrypt, decrypt };
}

module.exports = { createLicenceStore, appIdForFilename, isTokenish, KNOWN_IDS };
