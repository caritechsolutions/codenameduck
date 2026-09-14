'use strict';
// Username/password auth with bcrypt hashes and opaque session ids in an HttpOnly cookie.
// Roles: superadmin (tenant_id NULL, may act on any tenant) and tenant-admin (bound to one).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'cc_session';
const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 10;

function hashPassword(pw) { return bcrypt.hashSync(String(pw), BCRYPT_ROUNDS); }
function verifyPassword(pw, hash) { try { return bcrypt.compareSync(String(pw), String(hash)); } catch { return false; } }
function randomPassword(len = 16) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Seed: when there are no users at all, create superadmin "admin" with a random password and
// return it so the caller can log it exactly once (journal).
function seedSuperadmin(db) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (n > 0) return null;
  const password = randomPassword();
  db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (NULL, 'admin', ?, 'superadmin')")
    .run(hashPassword(password));
  return { username: 'admin', password };
}

function createAuth(db) {
  const findUser = db.prepare(`SELECT * FROM users WHERE username = ? AND (tenant_id = ? OR tenant_id IS NULL)
                               ORDER BY tenant_id IS NULL LIMIT 1`);
  const insertSession = db.prepare('INSERT INTO sessions (id, user_id, expires_at, ip) VALUES (?, ?, ?, ?)');
  const findSession = db.prepare(`SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                                  WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const touchSession = db.prepare("UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const purge = db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')");

  // Very small brute-force brake: 8 failures per (ip, username) → 60 s lockout.
  const failures = new Map();
  function locked(key) { const f = failures.get(key); return f && f.count >= 8 && Date.now() - f.at < 60000; }
  function fail(key) { const f = failures.get(key) || { count: 0 }; f.count++; f.at = Date.now(); failures.set(key, f); }

  function login({ username, password, tenant, ip }) {
    const key = `${ip}|${username}`;
    if (locked(key)) return { error: 'too many attempts, wait a minute', status: 429 };
    const user = findUser.get(String(username || '').trim(), tenant.id);
    if (!user || !verifyPassword(password, user.password_hash)) { fail(key); return { error: 'invalid username or password', status: 401 }; }
    failures.delete(key);
    const id = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    insertSession.run(id, user.id, expires, ip || null);
    if (Math.random() < 0.05) purge.run();
    return { user: publicUser(user), sessionId: id, expires };
  }

  function cookieHeader(sessionId, expires) {
    const maxAge = Math.max(0, Math.floor((new Date(expires).getTime() - Date.now()) / 1000));
    return `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  }
  const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  function sessionFromRequest(req) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (!sid) return null;
    const row = findSession.get(sid);
    if (!row) return null;
    touchSession.run(sid);
    return row;
  }

  // req.tenant must already be set. Tenant-admins may only act on their own tenant's host.
  function requireAuth(req, res, next) {
    const row = sessionFromRequest(req);
    if (!row) return res.status(401).json({ error: 'not logged in' });
    if (row.role !== 'superadmin' && row.tenant_id !== req.tenant.id) {
      return res.status(403).json({ error: 'this account belongs to another tenant' });
    }
    req.user = publicUser(row);
    req.sessionId = row.session_id;
    next();
  }
  function requireSuperadmin(req, res, next) {
    if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'superadmin only' });
    next();
  }
  function logout(sessionId) { if (sessionId) deleteSession.run(sessionId); }

  return { login, logout, requireAuth, requireSuperadmin, cookieHeader, clearCookie, sessionFromRequest };
}

function publicUser(u) { return { id: u.id, username: u.username, role: u.role, tenant_id: u.tenant_id }; }

module.exports = { createAuth, seedSuperadmin, hashPassword, verifyPassword, randomPassword, parseCookies, COOKIE };
