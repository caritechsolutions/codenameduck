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

// A token LG answered "fail" for is withheld for a while, not for ever: 1 h after the first
// failure, doubling per consecutive failure, capped at 24 h (D4). A transient failure (set offline,
// LG's service unreachable during a power cut) heals itself; a wrong app id costs one register
// call per window. A "success" result or an edit clears the failure.
const RETRY_BASE_MS = 60 * 60 * 1000, RETRY_MAX_MS = 24 * 60 * 60 * 1000;
function retryAt(row) {
  if (!row || !row.failed_at) return null;
  const t = Date.parse(row.failed_at);
  if (!Number.isFinite(t)) return null;
  const n = Math.max(1, Number(row.failed_count) || 1);
  return new Date(t + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, n - 1))).toISOString();
}

function createLicenceStore(db, { dataDir = null, log = () => {}, now = () => new Date() } = {}) {
  const key = loadOrCreateKey(dataDir, log);
  const nowMs = () => { const n = now(); return n instanceof Date ? n.getTime() : new Date(n).getTime(); };
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
  const upd = db.prepare(`UPDATE licences SET filename = ?, token_enc = ?, token_tail = ?, uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failed_model = NULL, failed_at = NULL, failed_message = NULL, failed_count = 0 WHERE id = ?`);

  const readable = (r) => { try { decrypt(r.token_enc); return true; } catch { return false; } };
  const toApi = (r) => ({ id: r.id, app_id: r.app_id, filename: r.filename, tail: r.token_tail, uploaded_at: r.uploaded_at,
    failed: r.failed_model || r.failed_at ? { model: r.failed_model, at: r.failed_at, message: r.failed_message, count: Number(r.failed_count) || 1, retry_at: retryAt(r) } : null,
    readable: readable(r) });   // false = secret.key no longer matches the stored blob → replace the file
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
    db.prepare('UPDATE licences SET app_id = ?, failed_model = NULL, failed_at = NULL, failed_message = NULL, failed_count = 0 WHERE id = ?').run(v, r.id);   // editing the id re-enables registration
    return toApi(qById.get(r.id));
  }
  function remove(id) { return db.prepare('DELETE FROM licences WHERE id = ?').run(Number(id)).changes > 0; }
  // Why a licence is not offered right now: inside its retry window after a "fail", or its blob
  // cannot be decrypted (secret.key changed). null = offered.
  function withheldReason(r) {
    if (r.failed_at) {
      const until = retryAt(r);
      if (until && Date.parse(until) > nowMs()) return { reason: `failed on ${r.failed_model || '?'} at ${r.failed_at}${r.failed_message ? ': ' + r.failed_message : ''} — retried after ${until}`, retry_at: until };
    }
    if (!readable(r)) return { reason: 'cannot decrypt the stored token (secret.key changed?) — replace the .lic file', retry_at: null };
    return null;
  }
  // Decrypted tokens for the sets: [{id, token}]. Licences inside their failure window (see
  // retryAt) and unreadable ones are left out; includeFailed ignores the window.
  function tokens({ includeFailed = false } = {}) {
    const out = [];
    for (const r of qAll.all()) {
      if (!includeFailed && r.failed_at && withheldReason(r) && withheldReason(r).retry_at) continue;
      try { out.push({ id: r.app_id, token: decrypt(r.token_enc) }); } catch (e) { log(`licences: cannot decrypt token for ${r.app_id}: ${e.message}`); }
    }
    return out;
  }
  // [{id, reason, retry_at}] for every licence tokens() leaves out — goes down to the sets in the
  // activation payload so a boot without tokens explains itself.
  function withheld() {
    const out = [];
    for (const r of qAll.all()) { const w = withheldReason(r); if (w) out.push({ id: r.app_id, ...w }); }
    return out;
  }
  // LG's application_registration_result_received said tokenResult "fail" for this app.
  function markFailed(appId, model, message) {
    const r = qByApp.get(String(appId || '').toLowerCase());
    if (!r) return null;
    const count = r.failed_at ? (Number(r.failed_count) || 1) + 1 : 1;
    db.prepare(`UPDATE licences SET failed_model = ?, failed_at = ?, failed_message = ?, failed_count = ? WHERE id = ?`).run(String(model || 'unknown model').slice(0, 80), new Date(nowMs()).toISOString(), message == null ? null : String(message).slice(0, 300), count, r.id);
    const row = qById.get(r.id);
    log(`licences: ${r.app_id} registration FAILED on ${model || '?'}${message ? ': ' + message : ''} (failure ${count}) — retried after ${retryAt(row)}`);
    return toApi(row);
  }
  // A "success" result clears the failure (and its backoff).
  function clearFailed(appId) {
    const r = qByApp.get(String(appId || '').toLowerCase());
    if (!r || !r.failed_at) return false;
    db.prepare('UPDATE licences SET failed_model = NULL, failed_at = NULL, failed_message = NULL, failed_count = 0 WHERE id = ?').run(r.id);
    log(`licences: ${r.app_id} registered successfully — failure cleared`);
    return true;
  }
  return { list, put, setAppId, remove, tokens, withheld, markFailed, clearFailed, retryAt, appIdForFilename, KNOWN_IDS, encrypt, decrypt };
}

module.exports = { createLicenceStore, appIdForFilename, isTokenish, retryAt, KNOWN_IDS };
