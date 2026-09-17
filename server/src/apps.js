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

function createAppStore(db, { log = () => {} } = {}) {
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

  function toApi(row) {
    let models = []; try { models = JSON.parse(row.models_json || '[]'); } catch { /* ignore */ }
    let raw = null; try { raw = row.raw_json ? JSON.parse(row.raw_json) : null; } catch { /* ignore */ }
    return { id: row.id, app_id: row.app_id, title: row.title, icon_url: row.icon_url, type: row.type, name_override: row.name_override, icon_override: row.icon_override,
      name: row.name_override || row.title || row.app_id, icon: row.icon_override || null, models, raw, set_count: row.set_count || 0,
      group_ids: row.group_ids ? String(row.group_ids).split(',').map(Number) : [], first_seen: row.first_seen, last_seen: row.last_seen };
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
  function list(tenant) { return listAll.all(tenant.id).map(toApi); }
  function get(tenant, id) { const r = getOne.get(Number(id), tenant.id); return r ? toApi(r) : null; }
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
  function enabledFor(tenant, set) {
    if (!set.group_id) return [];
    return enabledForGroup.all(set.group_id).map(toTv);
  }
  return { record, list, get, updateOverrides, remove, setGroupApps, enabledFor, normalizeAppList };
}

module.exports = { createAppStore, normalizeAppList };
