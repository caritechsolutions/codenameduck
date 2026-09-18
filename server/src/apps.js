'use strict';
// Apps discovered on the sets (Phase 3 B3). The renderer sends idcap://application/list (or the
// HCAP equivalents) at register; we keep one row per (tenant, LG app id) with the models it was
// seen on, and the admin enables apps per group with display-name / icon overrides.

const MAX_APPS = 200;

// LG's list shape is not documented in our extracts: accept an array or {list|applications|apps|
// appList: [...]}, and pick the id/title/icon from the usual key names. raw = the first entry
// verbatim so the admin can show what the set really sent.
function normalizeAppList(raw) {
  let arr = raw;
  if (raw && !Array.isArray(raw)) arr = raw.list || raw.applications || raw.apps || raw.appList || raw.application || raw.result || [];
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr.slice(0, MAX_APPS)) {
    if (!a) continue;
    if (typeof a === 'string') { out.push({ id: a.slice(0, 200), title: null, icon: null, type: null, raw: a }); continue; }
    if (typeof a !== 'object') continue;
    const id = a.id || a.appId || a.app_id || a.applicationId || a.name;
    if (!id || typeof id !== 'string') continue;
    const title = a.title || a.name || a.appName || a.displayName || null;
    const icon = a.icon || a.iconUrl || a.icon_url || a.largeIcon || a.iconPath || null;
    const type = a.type || a.category || a.appType || null;
    out.push({ id: id.slice(0, 200), title: title ? String(title).slice(0, 200) : null, icon: icon ? String(icon).slice(0, 500) : null, type: type ? String(type).slice(0, 60) : null, raw: a });
  }
  return out;
}

// LG's register/status reply shape is not in our doc extracts: read the usual field names and
// map them to activated true/false/null (+ the raw status string for the admin).
// LG 43UM670H0UA register/status replies (2026-09-18): { auth: true|false, auth_status: "authSuccess" |
// "notRequired" | ... }. `auth` is read first (it is the first key below); the words cover replies
// without it and older shapes.
const YES = /^(registered|activated|authorized|authorised|authsuccess|notrequired|ok|success|true|yes|valid|done|1)$/i;
const NO = /^(unregistered|not[_ ]?registered|unactivated|unauthorized|unauthorised|authneeded|authfail(ed|ure)?|fail(ed|ure)?|false|no|invalid|none|error|0)$/i;
function normalizeAuth(raw) {
  if (raw == null) return { activated: null, status: null };
  if (typeof raw === 'boolean') return { activated: raw, status: String(raw) };
  if (typeof raw === 'string' || typeof raw === 'number') { const v = String(raw); return { activated: YES.test(v) ? true : NO.test(v) ? false : null, status: v.slice(0, 80) }; }
  if (typeof raw !== 'object') return { activated: null, status: null };
  if (typeof raw.auth === 'boolean') return { activated: raw.auth, status: typeof raw.auth_status === 'string' && raw.auth_status ? raw.auth_status.slice(0, 80) : `auth=${raw.auth}` };
  for (const k of ['auth', 'auth_status', 'authStatus', 'status', 'registered', 'activated', 'activation', 'result', 'state', 'value']) {
    if (raw[k] === undefined || raw[k] === null) continue;
    const v = raw[k];
    if (typeof v === 'boolean') return { activated: v, status: `${k}=${v}` };
    if (typeof v === 'string' || typeof v === 'number') { const sv = String(v); if (YES.test(sv)) return { activated: true, status: sv.slice(0, 80) }; if (NO.test(sv)) return { activated: false, status: sv.slice(0, 80) }; return { activated: null, status: sv.slice(0, 80) }; }
  }
  return { activated: null, status: null };
}

function createAppStore(db, { log = () => {}, licences = null } = {}) {
  const findByAppId = db.prepare('SELECT * FROM apps WHERE tenant_id = ? AND app_id = ?');
  const insert = db.prepare(`INSERT INTO apps (tenant_id, app_id, title, icon_url, type, models_json, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE apps SET title = COALESCE(?, title), icon_url = COALESCE(?, icon_url), type = COALESCE(?, type), models_json = ?,
      raw_json = COALESCE(raw_json, ?), last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
  const listAll = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM sets s WHERE s.tenant_id = a.tenant_id AND s.apps_json IS NOT NULL AND instr(s.apps_json, '"' || a.app_id || '"') > 0) AS set_count,
      (SELECT group_concat(ga.group_id) FROM group_apps ga WHERE ga.app_id = a.id) AS group_ids
    FROM apps a WHERE a.tenant_id = ? ORDER BY COALESCE(a.name_override, a.title, a.app_id) COLLATE NOCASE`);
  const getOne = db.prepare('SELECT * FROM apps WHERE id = ? AND tenant_id = ?');
  const enabledForGroup = db.prepare(`SELECT a.* FROM group_apps ga JOIN apps a ON a.id = ga.app_id WHERE ga.group_id = ? ORDER BY ga.position, a.id`);
  const clearGroup = db.prepare('DELETE FROM group_apps WHERE group_id = ?');
  const addGroup = db.prepare('INSERT INTO group_apps (group_id, app_id, position) VALUES (?, ?, ?)');
  const setApps = db.prepare('UPDATE sets SET apps_json = ? WHERE id = ?');
  const upsertStatus = db.prepare(`INSERT INTO set_app_status (set_id, app_id, activated, status, raw_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(set_id, app_id) DO UPDATE SET activated = excluded.activated, status = excluded.status, raw_json = excluded.raw_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const statusForSet = db.prepare('SELECT app_id, activated FROM set_app_status WHERE set_id = ?');
  const statusAgg = db.prepare(`SELECT
      SUM(CASE WHEN s.activated = 1 THEN 1 ELSE 0 END) AS activated_sets,
      SUM(CASE WHEN s.activated = 0 THEN 1 ELSE 0 END) AS unactivated_sets,
      COUNT(*) AS reported_sets,
      (SELECT status FROM set_app_status s2 WHERE s2.app_id = s.app_id AND s2.set_id IN (SELECT id FROM sets WHERE tenant_id = ?) ORDER BY s2.updated_at DESC LIMIT 1) AS auth_status
    FROM set_app_status s JOIN sets st ON st.id = s.set_id WHERE st.tenant_id = ? AND s.app_id = ?`);
  const upsertReg = db.prepare(`INSERT INTO set_app_registration (set_id, ok, result_json) VALUES (?, ?, ?)
    ON CONFLICT(set_id) DO UPDATE SET ok = excluded.ok, result_json = excluded.result_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const regForSet = db.prepare('SELECT ok FROM set_app_registration WHERE set_id = ?');
  const regResults = db.prepare(`SELECT r.set_id, r.ok, r.result_json, r.updated_at, st.serial, st.room_number, st.model FROM set_app_registration r JOIN sets st ON st.id = r.set_id WHERE st.tenant_id = ? ORDER BY r.updated_at DESC`);

  function tenantSettings(tenantId) {
    let st = {}; try { st = JSON.parse((db.prepare('SELECT settings_json FROM tenants WHERE id = ?').get(tenantId) || {}).settings_json || '{}') || {}; } catch { /* ignore */ }
    return st;
  }
  function toApi(row, tenantId) {
    let models = []; try { models = JSON.parse(row.models_json || '[]'); } catch { /* ignore */ }
    const st = tenantId ? tenantSettings(tenantId) : {};
    const requires = row.app_id === 'netflix' && !(st.netflix_hotel_id && String(st.netflix_hotel_id).trim()) ? 'netflix_hotel_id' : null;
    const licensed = licences ? licences.list().some((l) => l.app_id === row.app_id) : false;
    let raw = null; try { raw = row.raw_json ? JSON.parse(row.raw_json) : null; } catch { /* ignore */ }
    const agg = tenantId ? statusAgg.get(tenantId, tenantId, row.app_id) : null;
    const reported = (agg && agg.reported_sets) || 0, act = (agg && agg.activated_sets) || 0, unact = (agg && agg.unactivated_sets) || 0;
    const activation = !reported || (!act && !unact) ? 'unknown' : act && !unact ? 'activated' : !act && unact ? 'not_activated' : 'partial';
    return { id: row.id, app_id: row.app_id, title: row.title, icon_url: row.icon_url, type: row.type, name_override: row.name_override, icon_override: row.icon_override,
      name: row.name_override || row.title || row.app_id, icon: row.icon_override || null, models, raw, set_count: row.set_count || 0,
      group_ids: row.group_ids ? String(row.group_ids).split(',').map(Number) : [], first_seen: row.first_seen, last_seen: row.last_seen,
      activation, activated_sets: act, unactivated_sets: unact, reported_sets: reported, auth_status: (agg && agg.auth_status) || null, requires, licensed };
  }
  // What a set launches: {id, name, icon} for the tiles/menus. Icons: admin override only —
  // LG's icon paths are TV-local and not fetchable by the page, so we never send them down.
  function toTv(row) { return { id: row.app_id, name: row.name_override || row.title || row.app_id, icon: row.icon_override || null }; }

  // Called at register with whatever the set sent. Returns the number of app rows touched.
  function record(tenant, set, rawList) {
    const list = normalizeAppList(rawList);
    if (!list.length) return 0;
    const model = set.model || null;
    const tx = db.transaction(() => {
      for (const a of list) {
        const row = findByAppId.get(tenant.id, a.id);
        const rawJson = JSON.stringify(a.raw).slice(0, 4000);
        if (!row) { insert.run(tenant.id, a.id, a.title, a.icon, a.type, JSON.stringify(model ? [model] : []), rawJson); continue; }
        let models = []; try { models = JSON.parse(row.models_json || '[]'); } catch { /* ignore */ }
        if (model && !models.includes(model)) models.push(model);
        update.run(a.title, a.icon, a.type, JSON.stringify(models), rawJson, row.id);
      }
      setApps.run(JSON.stringify(list.map((a) => a.id)), set.id);
    });
    tx();
    return list.length;
  }
  function list(tenant) { return listAll.all(tenant.id).map((r) => toApi(r, tenant.id)); }
  function get(tenant, id) { const r = getOne.get(Number(id), tenant.id); return r ? toApi(r, tenant.id) : null; }
  function updateOverrides(tenant, id, { name_override, icon_override }) {
    const r = getOne.get(Number(id), tenant.id);
    if (!r) return null;
    const name = name_override === undefined ? r.name_override : (String(name_override || '').trim().slice(0, 80) || null);
    const icon = icon_override === undefined ? r.icon_override : (String(icon_override || '').trim().slice(0, 500) || null);
    db.prepare('UPDATE apps SET name_override = ?, icon_override = ? WHERE id = ?').run(name, icon, r.id);
    return get(tenant, id);
  }
  function remove(tenant, id) {
    const r = getOne.get(Number(id), tenant.id);
    if (!r) return false;
    db.prepare('DELETE FROM apps WHERE id = ?').run(r.id);
    return true;
  }
  // Replace the enabled set for a group (ordered). Unknown ids are rejected.
  function setGroupApps(tenant, groupId, appIds) {
    const ids = [...new Set((appIds || []).map(Number).filter(Number.isInteger))];
    for (const id of ids) if (!getOne.get(id, tenant.id)) { const e = new Error(`unknown app ${id}`); e.status = 400; throw e; }
    db.transaction(() => { clearGroup.run(groupId); ids.forEach((id, i) => addGroup.run(groupId, id, i)); })();
    return ids;
  }
  // Enabled for the set's group, minus apps this set reported as NOT activated (unknown counts
  // as activated, so HCAP sets and sets that never answered register/status still get them).
  // Netflix additionally needs the tenant's netflix_hotel_id (LG: hotel_id launch parameter).
  function enabledFor(tenant, set) {
    if (!set.group_id) return [];
    const blocked = new Set(set.id ? statusForSet.all(set.id).filter((r) => r.activated === 0).map((r) => r.app_id) : []);
    const st = tenantSettings(tenant.id);
    if (!(st.netflix_hotel_id && String(st.netflix_hotel_id).trim())) blocked.add('netflix');
    return enabledForGroup.all(set.group_id).filter((r) => !blocked.has(r.app_id)).map(toTv);
  }
  // Status as the set reported it: {app_id: raw} or [{id, ...}]. Returns rows written.
  function recordStatus(tenant, set, statusMap) {
    if (!statusMap || typeof statusMap !== 'object') return 0;
    const entries = Array.isArray(statusMap) ? statusMap.filter((x) => x && typeof x === 'object' && (x.id || x.appId)).map((x) => [x.id || x.appId, x]) : Object.entries(statusMap);
    let n = 0;
    db.transaction(() => {
      for (const [appId, raw] of entries.slice(0, MAX_APPS)) {
        if (!appId || typeof appId !== 'string') continue;
        const a = normalizeAuth(raw);
        upsertStatus.run(set.id, appId.slice(0, 200), a.activated === null ? null : (a.activated ? 1 : 0), a.status, JSON.stringify(raw).slice(0, 2000));
        n++;
      }
    })();
    return n;
  }
  function statusOf(set) { return statusForSet.all(set.id); }
  // The set's registration report: ok (all tokens succeeded), result (first raw LG event) and
  // results (one per token: {id, tokenResult "success"|"fail", errorMessage}). A "fail" marks the
  // licence so it is not retried until it is edited.
  function recordRegistration(tenant, set, { ok, result, results }) {
    upsertReg.run(set.id, ok == null ? null : (ok ? 1 : 0), JSON.stringify(results && results.length ? { ok, results } : (result == null ? null : result)).slice(0, 4000));
    if (licences && Array.isArray(results)) {
      for (const r of results) {
        if (r && r.id && /^fail/i.test(String(r.tokenResult ?? '')) ) licences.markFailed(r.id, set.model, r.errorMessage || r.detail || null);
      }
    }
  }
  // Licensed apps this set itself reported as not authorised (register/status) — the only reason
  // to register a token (re-registering an authorised app resets its sign-in on the set).
  function unauthorizedLicensed(set) {
    if (!set || !set.id || !licences) return [];
    const lic = new Set(licences.tokens().map((t) => t.id));
    return statusForSet.all(set.id).filter((r) => r.activated === 0 && lic.has(r.app_id)).map((r) => r.app_id);
  }
  function hasRegistered(set) { const r = regForSet.get(set.id); return !!(r && r.ok === 1); }
  function activationResults(tenant) {
    return regResults.all(tenant.id).map((r) => { let result = null; try { result = JSON.parse(r.result_json); } catch { /* ignore */ } return { set_id: r.set_id, serial: r.serial, room_number: r.room_number, model: r.model, ok: r.ok == null ? null : !!r.ok, result, updated_at: r.updated_at }; });
  }
  // Tenant-level activation config (settings_json.app_activation): {accountNumber}. Tokens are
  // per SI partner and live in the global licence store (superadmin → App licences).
  function activationConfig(tenant) {
    const st = tenantSettings(tenant.id);
    const c = st.app_activation && typeof st.app_activation === 'object' ? st.app_activation : {};
    return { accountNumber: c.accountNumber ? String(c.accountNumber) : '', licensed: licences ? licences.tokens().map((l) => l.id) : [] };   // tokens actually offered (failed ones excluded)
  }
  function setActivationConfig(tenant, { accountNumber }) {
    const row = db.prepare('SELECT settings_json FROM tenants WHERE id = ?').get(tenant.id);
    let st = {}; try { st = JSON.parse((row && row.settings_json) || '{}') || {}; } catch { /* ignore */ }
    st.app_activation = { accountNumber: String(accountNumber || '').trim().slice(0, 100) };
    db.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(JSON.stringify(st), tenant.id);
    return activationConfig(tenant);
  }
  // Payload for application/register (register_apps command + boot registration): every stored
  // licence token as tokenList [{id, token}], plus the tenant's accountNumber when set.
  // {tokenList, accountNumber} for a set. onlyIds restricts the tokens (server-side auto-queue
  // sends just the apps the set reported as not authorised); failed licences are never included.
  function registerPayload(tenant, onlyIds = null) {
    const p = {};
    let toks = licences ? licences.tokens() : [];
    if (Array.isArray(onlyIds)) toks = toks.filter((t) => onlyIds.includes(t.id));
    if (toks.length) p.tokenList = toks;
    const cfg = activationConfig(tenant);
    if (cfg.accountNumber) p.accountNumber = cfg.accountNumber;
    // The ids the set must ask register/status for: every licence on file (failed ones too, so
    // the admin still sees their state) and, with an account number, the controlled apps LG
    // activates that way. Never the 100+ other apps.
    const ids = new Set((licences ? licences.list() : []).map((l) => l.app_id));
    if (cfg.accountNumber) for (const id of ['netflix', 'amazon']) ids.add(id);
    if (ids.size) p.status_ids = [...ids];
    return Object.keys(p).length ? p : null;
  }
  return { record, list, get, updateOverrides, remove, setGroupApps, enabledFor, normalizeAppList, normalizeAuth,
    recordStatus, statusOf, recordRegistration, hasRegistered, unauthorizedLicensed, activationResults, activationConfig, setActivationConfig, registerPayload };
}

module.exports = { createAppStore, normalizeAppList, normalizeAuth };
