'use strict';
// Local PMS (Phase 3 Part C): reservations per tenant, occupancy derived from dates, a
// minute scheduler that checks guests in/out at the tenant's local check-in/out times, guest
// variables for the TV context, CSV/XLSX import with column mapping, and an audit log.
//
// Occupancy rule: a room is occupied on local date D by the reservation with
// checkin_date <= D < checkout_date and status in (booked, checked_in). Overlaps are rejected.
// What the TV shows: the reservation that is *checked in* for the set's room (the scheduler
// flips booked → checked_in at check-in time, manual "check in now" does it early).
const crypto = require('crypto');
const { readXlsx, serialToIso } = require('./xlsx');
const { isFactoryRoom } = require('./state');

const DEFAULT_CHECKIN = '14:00', DEFAULT_CHECKOUT = '11:00';
const FIELDS = ['room', 'first_name', 'last_name', 'checkin', 'checkout', 'lang', 'notes', 'vip'];
const REQUIRED = ['room', 'checkin', 'checkout'];
const DATE_FORMATS = ['auto', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD', 'excel'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ---- dates (tenant-local, via Intl; Node ships full ICU)
function serverTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
function validTz(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }
function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = {}; for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function nightsBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function validIsoDate(s) { if (!ISO.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }
function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }

// Parse one imported cell into YYYY-MM-DD according to the picked format ('auto' tries ISO,
// Excel serials, then day-first, then month-first). Returns null when it cannot.
function parseDate(value, format = 'auto') {
  if (value == null) return null;
  if (typeof value === 'number') return format === 'auto' || format === 'excel' ? serialToIso(value) : null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '');   // drop a time part
  const mk = (y, m, d) => { const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return validIsoDate(iso) ? iso : null; };
  const y4 = (y) => (y.length === 2 ? (Number(y) < 70 ? '20' + y : '19' + y) : y);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const ymdSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  switch (format) {
    case 'YYYY-MM-DD': return iso ? mk(iso[1], iso[2], iso[3]) : null;
    case 'YYYY/MM/DD': return ymdSlash ? mk(ymdSlash[1], ymdSlash[2], ymdSlash[3]) : null;
    case 'DD/MM/YYYY': case 'DD.MM.YYYY': case 'DD-MM-YYYY': return dmy ? mk(y4(dmy[3]), dmy[2], dmy[1]) : null;
    case 'MM/DD/YYYY': return dmy ? mk(y4(dmy[3]), dmy[1], dmy[2]) : null;
    case 'excel': { const n = Number(s); return Number.isFinite(n) ? serialToIso(n) : null; }
    default: {
      if (iso) return mk(iso[1], iso[2], iso[3]);
      if (ymdSlash) return mk(ymdSlash[1], ymdSlash[2], ymdSlash[3]);
      if (/^\d{4,6}(\.\d+)?$/.test(s)) { const n = Number(s); if (n > 20000 && n < 80000) return serialToIso(n); }
      if (dmy) return mk(y4(dmy[3]), dmy[2], dmy[1]) || mk(y4(dmy[3]), dmy[1], dmy[2]);
      const t = Date.parse(s); if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
      return null;
    }
  }
}

// ---- CSV (RFC 4180-ish; comma, semicolon or tab, auto-detected on the first line)
function parseCsvRows(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, (first.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  return { rows, delimiter: delim };
}
function toCsvLine(vals) { return vals.map((v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }

// Guess a column mapping from header names (English/Dutch/German hotel exports).
const GUESSES = {
  room: /^(room|kamer|zimmer|rm|room ?(no|nr|number)|kamernummer|unit)$/i,
  first_name: /^(first ?name|firstname|voornaam|vorname|given ?name|guest ?first)$/i,
  last_name: /^(last ?name|lastname|surname|achternaam|nachname|family ?name|name|naam|guest|guest ?name)$/i,
  checkin: /^(check ?-?in|checkin ?date|arrival|arrival ?date|arrive|aankomst|anreise|from|start|van)$/i,
  checkout: /^(check ?-?out|checkout ?date|departure|departure ?date|depart|vertrek|abreise|to|end|tot)$/i,
  lang: /^(lang|language|taal|sprache|locale)$/i,
  notes: /^(notes?|remarks?|comment|opmerking|bemerkung|memo)$/i,
  vip: /^(vip|vip ?level)$/i,
};
function guessMapping(headers) {
  const m = {};
  headers.forEach((h, i) => { const t = String(h || '').trim(); for (const f of FIELDS) if (m[f] === undefined && GUESSES[f].test(t)) m[f] = i; });
  return m;
}

function createPms(db, { hub = null, commands = null, log = () => {}, now = undefined } = {}) {
  const clock = now || (() => new Date());
  const attach = (deps) => { if (deps.hub) hub = deps.hub; if (deps.commands) commands = deps.commands; };
  const qTenant = db.prepare('SELECT * FROM tenants WHERE id = ?');
  const qTenants = db.prepare('SELECT * FROM tenants');
  const qById = db.prepare('SELECT * FROM reservations WHERE id = ? AND tenant_id = ?');
  const qOverlap = db.prepare(`SELECT * FROM reservations WHERE tenant_id = ? AND room_number = ? AND status IN ('booked','checked_in')
    AND checkin_date < ? AND checkout_date > ? AND id != ? ORDER BY checkin_date LIMIT 1`);
  const qOccupant = db.prepare(`SELECT * FROM reservations WHERE tenant_id = ? AND room_number = ? AND status = 'checked_in'
    ORDER BY checked_in_at DESC, id DESC LIMIT 1`);
  const qOnDate = db.prepare(`SELECT * FROM reservations WHERE tenant_id = ? AND status IN ('booked','checked_in') AND checkin_date <= ? AND checkout_date > ? ORDER BY room_number`);
  const qRoomSets = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND room_number = ?');
  const qGroup = db.prepare('SELECT * FROM groups WHERE id = ? AND tenant_id = ?');
  const ins = db.prepare(`INSERT INTO reservations (tenant_id, room_number, first_name, last_name, checkin_date, checkout_date, lang, vip, notes, source, status)
    VALUES (@tenant_id, @room_number, @first_name, @last_name, @checkin_date, @checkout_date, @lang, @vip, @notes, @source, 'booked')`);
  const upd = db.prepare(`UPDATE reservations SET room_number = @room_number, first_name = @first_name, last_name = @last_name, checkin_date = @checkin_date,
    checkout_date = @checkout_date, lang = @lang, vip = @vip, notes = @notes, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`);
  const setStatus = db.prepare(`UPDATE reservations SET status = ?, checked_in_at = COALESCE(?, checked_in_at), checked_out_at = COALESCE(?, checked_out_at),
    checkin_date = COALESCE(?, checkin_date), checkout_date = COALESCE(?, checkout_date), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
  const insLog = db.prepare('INSERT INTO pms_log (tenant_id, reservation_id, event, source, payload_json) VALUES (?, ?, ?, ?, ?)');
  const qDup = db.prepare(`SELECT id FROM reservations WHERE tenant_id = ? AND room_number = ? AND checkin_date = ? AND checkout_date = ? AND first_name = ? AND last_name = ? AND status != 'cancelled'`);
  const qLog = db.prepare('SELECT * FROM pms_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?');

  const settingsOf = (tenant) => { try { return JSON.parse(tenant.settings_json || '{}') || {}; } catch { return {}; } };
  function pmsSettings(tenant) {
    const st = settingsOf(tenant);
    const tz = st.timezone && validTz(st.timezone) ? st.timezone : serverTz();
    return { timezone: tz, checkin_time: validTime(st.checkin_time) ? st.checkin_time : DEFAULT_CHECKIN, checkout_time: validTime(st.checkout_time) ? st.checkout_time : DEFAULT_CHECKOUT,
      checkout_message: st.checkout_message || null, hotel: tenant.display_name || tenant.name };
  }
  const today = (tenant, at) => localParts(at || clock(), pmsSettings(tenant).timezone).date;
  const logEvent = (tenantId, resId, event, source, payload) => insLog.run(tenantId, resId, event, source, payload ? JSON.stringify(payload) : null);

  const toApi = (r) => r && ({ id: r.id, room_number: r.room_number, first_name: r.first_name, last_name: r.last_name, guest: [r.first_name, r.last_name].filter(Boolean).join(' '),
    checkin_date: r.checkin_date, checkout_date: r.checkout_date, nights: nightsBetween(r.checkin_date, r.checkout_date), lang: r.lang, vip: !!r.vip, notes: r.notes,
    source: r.source, status: r.status, checked_in_at: r.checked_in_at, checked_out_at: r.checked_out_at, created_at: r.created_at, updated_at: r.updated_at });

  // ---- validation
  function normalise(input, base) {
    const b = base || {};
    const pick = (k, d) => (input && input[k] !== undefined ? input[k] : b[k] !== undefined ? b[k] : d);
    const room = String(pick('room_number', '') ?? '').trim().slice(0, 32);
    const v = {
      room_number: room,
      first_name: String(pick('first_name', '') ?? '').trim().slice(0, 80),
      last_name: String(pick('last_name', '') ?? '').trim().slice(0, 80),
      checkin_date: String(pick('checkin_date', '') ?? '').trim(),
      checkout_date: String(pick('checkout_date', '') ?? '').trim(),
      lang: (pick('lang', null) || null) && String(pick('lang', '')).trim().toLowerCase().slice(0, 8) || null,
      vip: pick('vip', 0) ? 1 : 0,
      notes: pick('notes', null) == null ? null : String(pick('notes', '')).slice(0, 1000) || null,
    };
    return v;
  }
  function validate(tenantId, v, excludeId = 0) {
    const errors = [];
    if (!v.room_number) errors.push('room is required');
    if (!validIsoDate(v.checkin_date)) errors.push('check-in date must be YYYY-MM-DD');
    if (!validIsoDate(v.checkout_date)) errors.push('check-out date must be YYYY-MM-DD');
    if (!errors.length && v.checkout_date <= v.checkin_date) errors.push('check-out must be after check-in');
    if (!v.first_name && !v.last_name) errors.push('a guest name is required');
    if (!errors.length) {
      const o = qOverlap.get(tenantId, v.room_number, v.checkout_date, v.checkin_date, excludeId);
      if (o) errors.push(`room ${v.room_number} already has ${[o.first_name, o.last_name].filter(Boolean).join(' ')} from ${o.checkin_date} to ${o.checkout_date} (reservation #${o.id})`);
    }
    return errors;
  }
  const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

  // ---- CRUD
  function create(tenant, input, { source = 'manual', by = null } = {}) {
    const v = normalise(input);
    const errors = validate(tenant.id, v);
    if (errors.length) throw bad(errors.join('; '));
    const info = ins.run({ ...v, tenant_id: tenant.id, source });
    const row = qById.get(info.lastInsertRowid, tenant.id);
    logEvent(tenant.id, row.id, 'created', source, { by, ...toApi(row) });
    afterChange(tenant, row);
    return toApi(row);
  }
  function update(tenant, id, input, { source = 'manual', by = null } = {}) {
    const cur = qById.get(Number(id), tenant.id);
    if (!cur) throw bad('reservation not found', 404);
    if (cur.status === 'cancelled' || cur.status === 'checked_out') throw bad(`reservation is ${cur.status.replace('_', ' ')} and can no longer be edited`, 409);
    const v = normalise(input, cur);
    const errors = validate(tenant.id, v, cur.id);
    if (errors.length) throw bad(errors.join('; '));
    upd.run({ ...v, id: cur.id });
    const row = qById.get(cur.id, tenant.id);
    logEvent(tenant.id, row.id, 'updated', source, { by, changes: diff(cur, row) });
    afterChange(tenant, row, cur);
    return toApi(row);
  }
  function diff(a, b) { const out = {}; for (const k of ['room_number', 'first_name', 'last_name', 'checkin_date', 'checkout_date', 'lang', 'vip', 'notes']) if (a[k] !== b[k]) out[k] = [a[k], b[k]]; return out; }
  function cancel(tenant, id, { source = 'manual', by = null } = {}) {
    const cur = qById.get(Number(id), tenant.id);
    if (!cur) throw bad('reservation not found', 404);
    if (cur.status === 'cancelled') return toApi(cur);
    if (cur.status === 'checked_in') return doCheckout(tenant, cur, { source, by, cancelled: true });
    setStatus.run('cancelled', null, null, null, null, cur.id);
    logEvent(tenant.id, cur.id, 'cancelled', source, { by });
    return toApi(qById.get(cur.id, tenant.id));
  }
  function checkinNow(tenant, id, { source = 'manual', by = null } = {}) {
    const cur = qById.get(Number(id), tenant.id);
    if (!cur) throw bad('reservation not found', 404);
    if (cur.status === 'checked_in') return toApi(cur);
    if (cur.status !== 'booked') throw bad(`reservation is ${cur.status.replace('_', ' ')}`, 409);
    const d = today(tenant);
    let cin = null;
    if (cur.checkin_date > d) {   // early arrival: the stay starts today (overlap re-checked)
      const o = qOverlap.get(tenant.id, cur.room_number, cur.checkout_date, d, cur.id);
      if (o) throw bad(`room ${cur.room_number} is still occupied by ${[o.first_name, o.last_name].filter(Boolean).join(' ')} until ${o.checkout_date}`, 409);
      cin = d;
    }
    if (cur.checkout_date <= d) throw bad('check-out date is in the past — move it first', 409);
    return doCheckin(tenant, cur, { source, by, checkinDate: cin });
  }
  function checkoutNow(tenant, id, { source = 'manual', by = null } = {}) {
    const cur = qById.get(Number(id), tenant.id);
    if (!cur) throw bad('reservation not found', 404);
    if (cur.status === 'checked_out') return toApi(cur);
    if (cur.status !== 'checked_in' && cur.status !== 'booked') throw bad(`reservation is ${cur.status.replace('_', ' ')}`, 409);
    return doCheckout(tenant, cur, { source, by });
  }

  // ---- transitions (shared by scheduler, manual buttons and the API)
  function doCheckin(tenant, row, { source, by = null, checkinDate = null } = {}) {
    setStatus.run('checked_in', clock().toISOString(), null, checkinDate, null, row.id);
    const r = qById.get(row.id, tenant.id);
    logEvent(tenant.id, r.id, 'checked_in', source, { by, room: r.room_number, guest: [r.first_name, r.last_name].filter(Boolean).join(' ') });
    log(`pms ${tenant.name}: check-in room ${r.room_number} ${r.first_name} ${r.last_name} (${source})`);
    const sets = qRoomSets.all(tenant.id, r.room_number);
    for (const s of sets) {
      const g = s.group_id ? qGroup.get(s.group_id, tenant.id) : null;
      if (g && g.welcome_popup_s > 0 && commands) commands.queue(tenant, s, 'message', { text: `Welcome ${[r.first_name, r.last_name].filter(Boolean).join(' ')}`, ttl_s: g.welcome_popup_s }, { dedupe: true });
    }
    if (hub) hub.refresh(tenant.id, { setIds: sets.map((s) => s.id) });
    return toApi(r);
  }
  function doCheckout(tenant, row, { source, by = null, cancelled = false } = {}) {
    const d = today(tenant);
    const cout = row.checkout_date > d && d > row.checkin_date ? d : null;   // early departure: the stay ends today
    setStatus.run(cancelled ? 'cancelled' : 'checked_out', null, clock().toISOString(), null, cout, row.id);
    const r = qById.get(row.id, tenant.id);
    logEvent(tenant.id, r.id, cancelled ? 'cancelled' : 'checked_out', source, { by, room: r.room_number, was_checked_in: row.status === 'checked_in' });
    log(`pms ${tenant.name}: check-out room ${r.room_number} ${r.first_name} ${r.last_name} (${source})`);
    if (row.status === 'checked_in') {
      const sets = qRoomSets.all(tenant.id, r.room_number);
      const msg = pmsSettings(tenant).checkout_message;
      for (const s of sets) if (commands) commands.queue(tenant, s, 'checkout', { message: msg }, { dedupe: true });
      if (hub) hub.refresh(tenant.id, { setIds: sets.map((s) => s.id) });
    }
    return toApi(r);
  }
  // A room change or a name edit on a checked-in guest must reach the sets right away.
  function afterChange(tenant, row, before) {
    if (!hub) return;
    const rooms = new Set([row.room_number, before && before.room_number].filter(Boolean));
    const ids = [];
    for (const rn of rooms) for (const s of qRoomSets.all(tenant.id, rn)) ids.push(s.id);
    if (ids.length) hub.refresh(tenant.id, { setIds: ids });
  }

  // ---- what a set shows
  function occupant(tenant, room) { return isFactoryRoom(room) ? null : qOccupant.get(tenant.id, String(room)); }
  const BLANK = { guest: '', guest_first: '', guest_last: '', checkin_date: '', checkout_date: '', nights: '', guest_lang: '', vip: false, occupied: false };
  function guestContext(tenant, set) {
    const r = set && set.room_number ? occupant(tenant, set.room_number) : null;
    if (!r) return { ...BLANK };
    return { guest: [r.first_name, r.last_name].filter(Boolean).join(' '), guest_first: r.first_name || '', guest_last: r.last_name || '', checkin_date: r.checkin_date, checkout_date: r.checkout_date,
      nights: String(nightsBetween(r.checkin_date, r.checkout_date)), guest_lang: r.lang || '', vip: !!r.vip, occupied: true };
  }

  // ---- scheduler: run every minute; idempotent, catches up after downtime
  function tick(at) {
    const t = at || clock();
    let checkins = 0, checkouts = 0, expired = 0;
    for (const tenant of qTenants.all()) {
      const s = pmsSettings(tenant);
      const { date, time } = localParts(t, s.timezone);
      // check-outs first so a same-day turnover frees the room before the next guest arrives
      for (const r of db.prepare(`SELECT * FROM reservations WHERE tenant_id = ? AND status = 'checked_in' AND checkout_date <= ?`).all(tenant.id, date)) {
        if (r.checkout_date < date || time >= s.checkout_time) { doCheckout(tenant, r, { source: 'scheduler' }); checkouts++; }
      }
      for (const r of db.prepare(`SELECT * FROM reservations WHERE tenant_id = ? AND status = 'booked' AND checkin_date <= ?`).all(tenant.id, date)) {
        if (r.checkout_date <= date && (r.checkout_date < date || time >= s.checkout_time)) {   // never arrived: the stay is over
          setStatus.run('checked_out', null, null, null, null, r.id); logEvent(tenant.id, r.id, 'expired', 'scheduler', { room: r.room_number }); expired++; continue;
        }
        if (r.checkin_date < date || time >= s.checkin_time) { doCheckin(tenant, r, { source: 'scheduler' }); checkins++; }
      }
    }
    return { checkins, checkouts, expired };
  }

  // ---- queries for the admin
  function list(tenantId, { from = null, to = null, status = null, q = null, room = null, group_id = null, arrivals = null, departures = null, limit = 2000 } = {}) {
    const where = ['r.tenant_id = @tenant_id']; const p = { tenant_id: tenantId, limit };
    if (from) { where.push('r.checkout_date > @from'); p.from = from; }
    if (to) { where.push('r.checkin_date <= @to'); p.to = to; }
    if (status) { const st = String(status).split(',').filter((x) => ['booked', 'checked_in', 'checked_out', 'cancelled'].includes(x)); if (st.length) where.push(`r.status IN (${st.map((x) => `'${x}'`).join(',')})`); }
    if (room) { where.push('r.room_number = @room'); p.room = String(room); }
    if (arrivals) { where.push("r.checkin_date = @arrivals AND r.status IN ('booked','checked_in')"); p.arrivals = arrivals; }
    if (departures) { where.push("r.checkout_date = @departures AND r.status IN ('booked','checked_in','checked_out')"); p.departures = departures; }
    if (q) { where.push("(r.first_name LIKE @q OR r.last_name LIKE @q OR r.room_number LIKE @q OR r.notes LIKE @q OR (r.first_name || ' ' || r.last_name) LIKE @q)"); p.q = `%${String(q).trim()}%`; }
    if (group_id) { where.push('r.room_number IN (SELECT room_number FROM sets WHERE tenant_id = @tenant_id AND group_id = @group_id)'); p.group_id = Number(group_id); }
    return db.prepare(`SELECT r.* FROM reservations r WHERE ${where.join(' AND ')} ORDER BY r.checkin_date, r.room_number LIMIT @limit`).all(p).map(toApi);
  }
  function get(tenant, id) { const r = qById.get(Number(id), tenant.id); if (!r) throw bad('reservation not found', 404); return toApi(r); }
  // Rooms known to the tenant (sets' rooms + rooms with reservations) with their state on a date.
  function rooms(tenant, date, { group_id = null } = {}) {
    const d = date || today(tenant);
    const map = new Map();
    for (const s of db.prepare('SELECT s.room_number, s.group_id, g.name AS group_name FROM sets s LEFT JOIN groups g ON g.id = s.group_id WHERE s.tenant_id = ? AND s.room_number IS NOT NULL').all(tenant.id)) {
      if (isFactoryRoom(s.room_number)) continue;
      const cur = map.get(s.room_number) || { room_number: s.room_number, sets: 0, group_id: null, group_name: null };
      cur.sets++; if (s.group_id && !cur.group_id) { cur.group_id = s.group_id; cur.group_name = s.group_name; }
      map.set(s.room_number, cur);
    }
    for (const r of db.prepare("SELECT DISTINCT room_number FROM reservations WHERE tenant_id = ? AND status != 'cancelled'").all(tenant.id)) if (!map.has(r.room_number)) map.set(r.room_number, { room_number: r.room_number, sets: 0, group_id: null, group_name: null });
    const onDate = new Map(qOnDate.all(tenant.id, d, d).map((r) => [r.room_number, r]));
    const out = [];
    for (const room of map.values()) {
      if (group_id && room.group_id !== Number(group_id)) continue;
      const r = onDate.get(room.room_number) || null;
      const occ = occupant(tenant, room.room_number);
      out.push({ ...room, date: d, reservation: r ? toApi(r) : null, occupied: !!r, checked_in: !!occ && (!r || occ.id === r.id), current: occ ? toApi(occ) : null,
        arriving: !!r && r.checkin_date === d, departing: !!r && r.checkout_date === d });
    }
    return out.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }
  function exportCsv(tenantId, { from = null, to = null } = {}) {
    const rows = list(tenantId, { from, to, limit: 100000 });
    const head = ['id', 'room', 'first_name', 'last_name', 'checkin_date', 'checkout_date', 'nights', 'lang', 'vip', 'status', 'source', 'notes', 'created_at'];
    return [toCsvLine(head), ...rows.map((r) => toCsvLine([r.id, r.room_number, r.first_name, r.last_name, r.checkin_date, r.checkout_date, r.nights, r.lang, r.vip ? 1 : 0, r.status, r.source, r.notes, r.created_at]))].join('\r\n') + '\r\n';
  }
  function recentLog(tenantId, limit = 100) { return qLog.all(tenantId, Math.min(500, Math.max(1, Number(limit) || 100))).map((l) => ({ ...l, payload: l.payload_json ? JSON.parse(l.payload_json) : null, payload_json: undefined })); }

  // ---- import
  function parseUpload({ filename = '', content_base64 = '', text = null } = {}) {
    const name = String(filename || '');
    let rows, kind;
    if (/\.xlsx$/i.test(name)) { try { rows = readXlsx(Buffer.from(String(content_base64 || ''), 'base64')); } catch (e) { throw bad(`${name}: ${e.message}`); } kind = 'xlsx'; }
    else { const src = text != null ? String(text) : Buffer.from(String(content_base64 || ''), 'base64').toString('utf8'); rows = parseCsvRows(src).rows; kind = 'csv'; }
    if (!rows.length) throw bad('the file has no rows');
    const headers = rows[0].map((h) => String(h ?? '').trim());
    const body = rows.slice(1, 5001);
    return { kind, headers, rows: body, total: rows.length - 1, truncated: rows.length - 1 > body.length, guess: guessMapping(headers) };
  }
  // Apply a mapping to raw rows → candidate reservations with per-row problems (no DB writes).
  function prepareImport(tenant, { rows = [], mapping = {}, date_format = 'auto' } = {}) {
    if (!Array.isArray(rows)) throw bad('rows must be an array');
    for (const f of REQUIRED) if (mapping[f] == null || mapping[f] === '') throw bad(`map a column to "${f.replace('_', ' ')}" first`);
    if (mapping.first_name == null && mapping.last_name == null) throw bad('map a column to first name or last name');
    if (!DATE_FORMATS.includes(date_format)) throw bad('unknown date format');
    const cell = (row, f) => (mapping[f] == null || mapping[f] === '' ? null : row[Number(mapping[f])]);
    const out = [];
    const seen = [];   // rooms/dates within the file, so two rows in the same file cannot overlap either
    rows.slice(0, 5000).forEach((row, i) => {
      const cin = parseDate(cell(row, 'checkin'), date_format), cout = parseDate(cell(row, 'checkout'), date_format);
      const rawName = mapping.last_name != null && mapping.first_name == null ? splitName(cell(row, 'last_name')) : null;
      const v = normalise({
        room_number: cell(row, 'room'), first_name: rawName ? rawName.first : cell(row, 'first_name'), last_name: rawName ? rawName.last : cell(row, 'last_name'),
        checkin_date: cin || '', checkout_date: cout || '', lang: cell(row, 'lang'), notes: cell(row, 'notes'), vip: /^(1|true|yes|y|ja|x|vip)$/i.test(String(cell(row, 'vip') ?? '').trim()),
      });
      const errors = [];
      const dup = v.room_number && cin && cout ? qDup.get(tenant.id, v.room_number, v.checkin_date, v.checkout_date, v.first_name, v.last_name) : null;
      if (dup) { out.push({ index: i, value: v, errors: [`already imported (reservation #${dup.id})`], raw: row, duplicate: true }); return; }
      if (!cin && cell(row, 'checkin') != null && String(cell(row, 'checkin')).trim() !== '') errors.push(`bad check-in date "${cell(row, 'checkin')}"`);
      if (!cout && cell(row, 'checkout') != null && String(cell(row, 'checkout')).trim() !== '') errors.push(`bad check-out date "${cell(row, 'checkout')}"`);
      errors.push(...validate(tenant.id, v).filter((e) => !(e.includes('YYYY-MM-DD') && errors.length)));
      const clash = seen.find((s) => s.room === v.room_number && s.cin < v.checkout_date && v.checkin_date < s.cout);
      if (!errors.length && clash) errors.push(`overlaps row ${clash.index + 1} in this file (room ${v.room_number})`);
      if (!errors.length) seen.push({ room: v.room_number, cin: v.checkin_date, cout: v.checkout_date, index: i });
      out.push({ index: i, value: v, errors, raw: row });
    });
    return out;
  }
  function splitName(full) { const s = String(full ?? '').trim(); if (!s) return { first: '', last: '' }; if (s.includes(',')) { const [l, f] = s.split(',').map((x) => x.trim()); return { first: f || '', last: l }; } const parts = s.split(/\s+/); return parts.length === 1 ? { first: '', last: parts[0] } : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }; }
  function commitImport(tenant, args, { by = null } = {}) {
    const prepared = prepareImport(tenant, args);
    const imported = [], skipped = [];
    const run = db.transaction(() => {
      for (const p of prepared) {
        if (p.errors.length) { skipped.push({ row: p.index + 1, reason: p.errors.join('; '), values: p.raw }); continue; }
        try {
          const info = ins.run({ ...p.value, tenant_id: tenant.id, source: 'import' });
          logEvent(tenant.id, info.lastInsertRowid, 'imported', 'import', { by, row: p.index + 1 });
          imported.push(toApi(qById.get(info.lastInsertRowid, tenant.id)));
        } catch (e) { skipped.push({ row: p.index + 1, reason: e.message, values: p.raw }); }
      }
    });
    run();
    log(`pms ${tenant.name}: import by ${by || '?'}: ${imported.length} imported, ${skipped.length} skipped`);
    if (hub && imported.length) hub.refresh(tenant.id);
    return { imported: imported.length, skipped, reservations: imported };
  }
  function skippedCsv(skipped, headers = []) {
    return [toCsvLine(['row', 'reason', ...headers]), ...skipped.map((s) => toCsvLine([s.row, s.reason, ...(s.values || [])]))].join('\r\n') + '\r\n';
  }
  // Named mapping profiles per tenant.
  function profiles(tenantId) { return db.prepare('SELECT id, name, mapping_json, created_at FROM import_profiles WHERE tenant_id = ? ORDER BY name').all(tenantId).map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, ...JSON.parse(p.mapping_json) })); }
  function saveProfile(tenantId, { name, mapping, date_format = 'auto' }) {
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw bad('profile name required');
    if (!mapping || typeof mapping !== 'object') throw bad('mapping required');
    const clean = {}; for (const f of FIELDS) if (mapping[f] != null && mapping[f] !== '') clean[f] = Number(mapping[f]);
    db.prepare('INSERT INTO import_profiles (tenant_id, name, mapping_json) VALUES (?, ?, ?) ON CONFLICT(tenant_id, name) DO UPDATE SET mapping_json = excluded.mapping_json').run(tenantId, n, JSON.stringify({ mapping: clean, date_format: DATE_FORMATS.includes(date_format) ? date_format : 'auto' }));
    return profiles(tenantId).find((p) => p.name === n);
  }
  function deleteProfile(tenantId, id) { return db.prepare('DELETE FROM import_profiles WHERE id = ? AND tenant_id = ?').run(Number(id), tenantId).changes > 0; }

  // ---- external API key
  const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
  function generateKey(tenant) {
    const key = 'ccpms_' + crypto.randomBytes(24).toString('base64url');
    db.prepare("UPDATE tenants SET pms_api_key_hash = ?, pms_api_key_prefix = ?, pms_api_key_created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hashKey(key), key.slice(0, 12), tenant.id);
    return { key, prefix: key.slice(0, 12) };
  }
  function revokeKey(tenant) { db.prepare('UPDATE tenants SET pms_api_key_hash = NULL, pms_api_key_prefix = NULL, pms_api_key_created_at = NULL WHERE id = ?').run(tenant.id); }
  function keyInfo(tenant) { const t = qTenant.get(tenant.id); return t && t.pms_api_key_hash ? { prefix: t.pms_api_key_prefix, created_at: t.pms_api_key_created_at } : null; }
  function authenticate(tenant, key) {
    const t = qTenant.get(tenant.id);
    if (!t || !t.pms_api_key_hash || !key) return false;
    const a = Buffer.from(t.pms_api_key_hash, 'hex'), b = Buffer.from(hashKey(key), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return { attach, create, update, cancel, checkinNow, checkoutNow, get, list, rooms, exportCsv, recentLog, occupant, guestContext, tick, today, pmsSettings,
    parseUpload, prepareImport, commitImport, skippedCsv, profiles, saveProfile, deleteProfile, generateKey, revokeKey, keyInfo, authenticate, toApi,
    FIELDS, DATE_FORMATS };
}

module.exports = { createPms, parseDate, parseCsvRows, guessMapping, localParts, addDays, nightsBetween, DATE_FORMATS, FIELDS };
