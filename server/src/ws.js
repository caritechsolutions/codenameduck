'use strict';
// WebSocket hub for TVs: /ws/tv?set_id=..&token=..  (token from /api/tv/register).
// Server → TV : {type:"hello"} {type:"layout", layout, context} {type:"lineup", lineup}
//               {type:"message", ...} {type:"command", command:{id,type,payload}}
// TV → server : {type:"hb", channel, volume, muted, uptime, power_mode} {type:"ack", command_id, ok, result}
const { WebSocketServer } = require('ws');
const { normalizeHost } = require('./tenants');
const { safeJson } = require('./state');

const PING_MS = 30000;
const INSTANT_POWER_VALUES = [0, 1, 2, 10];
function parseInstantPower(v) { if (v == null || v === '') return null; const n = Number(v); return INSTANT_POWER_VALUES.includes(n) ? n : null; }

function createHub({ db, tenants, state, apps = null, log = () => {} }) {
  const conns = new Map();          // set_id -> { ws, tenantId, sent: {layout, lineup} }
  const findSet = db.prepare('SELECT * FROM sets WHERE id = ? AND tenant_id = ?');
  const findTenant = db.prepare('SELECT * FROM tenants WHERE id = ?');
  const touch = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ip = COALESCE(?, ip) WHERE id = ?`);
  const heartbeat = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    last_hb = strftime('%Y-%m-%dT%H:%M:%fZ','now'), channel = COALESCE(@channel, channel),
    volume = COALESCE(@volume, volume), muted = COALESCE(@muted, muted), uptime_s = COALESCE(@uptime, uptime_s),
    power_mode = COALESCE(@power_mode, power_mode), app_version = COALESCE(@app_version, app_version),
    instant_power = COALESCE(@instant_power, instant_power) WHERE id = @id`);
  const insertEvent = db.prepare('INSERT INTO events (tenant_id, set_id, type, payload_json) VALUES (?, ?, ?, ?)');
  let commands = null;   // set later (circular)

  const wss = new WebSocketServer({ noServer: true });

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
      if (url.pathname !== '/ws/tv') { socket.destroy(); return; }
      const tenant = (url.searchParams.get('tenant') && tenants.resolve(url.searchParams.get('tenant'))) || tenants.resolve(req.headers.host);   // Part D: bundled app names its tenant
      const setId = Number(url.searchParams.get('set_id'));
      const token = url.searchParams.get('token') || '';
      const set = tenant && Number.isInteger(setId) && setId > 0 ? findSet.get(setId, tenant.id) : null;
      if (!set || !token || set.token !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, tenant, set, url.searchParams));
    });
    const timer = setInterval(() => {
      for (const [setId, c] of conns) {
        if (c.alive === false) { log(`ws: set ${setId} timed out`); c.ws.terminate(); continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* ignore */ }
      }
    }, PING_MS);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }

  function onConnection(ws, req, tenant, set, query = new URLSearchParams()) {
    const prev = conns.get(set.id);
    if (prev && prev.ws !== ws) { try { prev.ws.close(4000, 'replaced'); } catch { /* ignore */ } }
    const conn = { ws, tenantId: tenant.id, setId: set.id, alive: true, sent: {} };
    conns.set(set.id, conn);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    touch.run(ip || null, set.id);
    log(`ws: set ${set.id} (${set.serial}) connected from ${ip}`);
    insertEvent.run(tenant.id, set.id, 'ws_connect', null);

    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data) => onMessage(conn, data));
    ws.on('close', () => {
      if (conns.get(set.id) === conn) conns.delete(set.id);
      insertEvent.run(tenant.id, set.id, 'ws_disconnect', null);
      log(`ws: set ${set.id} disconnected`);
    });
    ws.on('error', (err) => log(`ws: set ${set.id} error ${err.message}`));

    // The TV already holds the state it got from register/poll; remember it so refresh()
    // only pushes real changes from here on — unless the set says (sv= in the query) that its
    // state is older than the tenant's current state_version: anything that changed between its
    // register answer and this connect would otherwise be lost until the next poll/boot (D4b).
    const clientVersion = query.get('sv') != null && query.get('sv') !== '' ? Number(query.get('sv')) : null;
    const current = (findTenant.get(tenant.id) || {}).state_version || 1;
    const behind = clientVersion != null && Number.isFinite(clientVersion) && clientVersion < current;
    if (!behind) {
      try {
        const st = state.build(tenant, set);
        conn.sent.layout = JSON.stringify(st.layout) + JSON.stringify(st.context) + String(st.instant_power == null ? '' : st.instant_power) + JSON.stringify(st.tv_osd);
        conn.sent.lineup = JSON.stringify(st.lineup);
        conn.sent.messages = JSON.stringify(st.messages);
        conn.sent.apps = JSON.stringify(st.apps || []);
      } catch (e) { log(`ws: state build failed for set ${set.id}: ${e.message}`); }
    } else log(`ws: set ${set.id} connected with state v${clientVersion} < v${current} — pushing the current state`);
    sendJson(ws, { type: 'hello', set_id: set.id, server_time: new Date().toISOString() });
    if (behind) refresh(tenant.id, { setIds: [set.id], bump: false });
    // Deliver anything queued while the set was away.
    const pending = state.commandsFor(set);
    for (const c of pending) sendJson(ws, { type: 'command', command: c });
    if (commands && pending.length) commands.sent(pending.map((c) => c.id));
  }

  function onMessage(conn, data) {
    const msg = safeJson(String(data), null);
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hb') {
      heartbeat.run({
        id: conn.setId,
        channel: msg.channel == null ? null : String(msg.channel).slice(0, 32),
        volume: Number.isFinite(Number(msg.volume)) && msg.volume !== null ? Number(msg.volume) : null,
        muted: msg.muted == null ? null : (msg.muted ? 1 : 0),
        uptime: Number.isFinite(Number(msg.uptime)) && msg.uptime !== null ? Math.floor(Number(msg.uptime)) : null,
        power_mode: msg.power_mode ? String(msg.power_mode).slice(0, 16) : null,
        app_version: msg.app_version ? String(msg.app_version).slice(0, 64) : null,
        instant_power: parseInstantPower(msg.instant_power),
      });
      conn.alive = true;
    } else if (msg.type === 'ack') {
      if (commands) commands.ack(conn.setId, Number(msg.command_id), !!msg.ok, msg.result);
      insertEvent.run(conn.tenantId, conn.setId, 'command_ack', JSON.stringify({ command_id: msg.command_id, ok: !!msg.ok }));
    } else if (msg.type === 'event') {
      recordTvEvent(conn.tenantId, conn.setId, msg);
    } else if (msg.type === 'ping') {
      sendJson(conn.ws, { type: 'pong' });
    }
  }

  // TV-side events (errors, media, ws lifecycle). Errors also go to the journal.
  function recordTvEvent(tenantId, setId, ev) {
    const name = 'tv_' + String(ev.name || 'event').replace(/[^a-z0-9_]/gi, '').slice(0, 32);
    const payload = ev.payload && typeof ev.payload === 'object' ? { ...ev.payload } : { value: ev.payload };
    if (ev.at) payload.at = String(ev.at).slice(0, 32);
    insertEvent.run(tenantId, setId, name, JSON.stringify(payload).slice(0, 4000));
    if (name === 'tv_error') log(`TV ERROR set ${setId}: [${payload.kind || '?'}] ${payload.message || ''}`);
    // app activation reports (B3b): keep the per-set tables and re-push the enabled apps
    if (apps && (name === 'tv_apps_status' || name === 'tv_apps_registration' || name === 'tv_apps_list')) {
      try {
        const tenant = findTenant.get(tenantId);
        if (name === 'tv_apps_status') apps.recordStatus(tenant, { id: setId }, payload.status);
        else if (name === 'tv_apps_list') apps.record(tenant, findSet.get(setId, tenantId) || { id: setId }, payload.apps);
        else apps.recordRegistration(tenant, findSet.get(setId, tenantId) || { id: setId }, { ok: payload.ok, result: payload.result, results: payload.results, internet: payload.internet });
        refresh(tenantId, { setIds: [setId] });
      } catch (e) { log(`apps status for set ${setId} failed: ${e.message}`); }
    }
  }
  function sendJson(ws, obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }

  function send(setId, obj) { const c = conns.get(setId); if (!c) return false; sendJson(c.ws, obj); return true; }
  function isConnected(setId) { const c = conns.get(setId); return !!c && c.ws.readyState === c.ws.OPEN; }
  function connectedSetIds(tenantId) { return [...conns.values()].filter((c) => c.tenantId === tenantId).map((c) => c.setId); }

  // Recompute layout (and later lineup) for connected sets and push what changed.
  // setIds: restrict to some sets; otherwise every connected set of the tenant.
  const bumpVersion = db.prepare('UPDATE tenants SET state_version = state_version + 1 WHERE id = ?');
  function refresh(tenantId, { setIds = null, force = false, bump = true } = {}) {
    // Every refresh follows a change that can reach the sets: advance the tenant's state version
    // first so whatever goes out (and whatever a poll answers) carries a number newer than the
    // bundle's state.json and the sets' caches. (bump:false = a catch-up push at connect, nothing changed.)
    if (bump) bumpVersion.run(tenantId);
    const tenant = findTenant.get(tenantId);
    if (!tenant) return 0;
    let pushed = 0;
    for (const c of conns.values()) {
      if (c.tenantId !== tenantId) continue;
      if (setIds && !setIds.includes(c.setId)) continue;
      const set = findSet.get(c.setId, tenantId);
      if (!set) continue;
      const st = state.build(tenant, set);
      let touched = false;
      const layoutKey = JSON.stringify(st.layout) + JSON.stringify(st.context) + String(st.instant_power == null ? '' : st.instant_power) + JSON.stringify(st.tv_osd);
      if (force || c.sent.layout !== layoutKey) {
        c.sent.layout = layoutKey;
        sendJson(c.ws, { type: 'layout', layout: st.layout, context: st.context, room_number: st.room_number, group: st.group, instant_power: st.instant_power, tv_osd: st.tv_osd, state_version: st.state_version });
        touched = true;
      }
      const lineupKey = JSON.stringify(st.lineup);
      if (force || c.sent.lineup !== lineupKey) {
        c.sent.lineup = lineupKey;
        sendJson(c.ws, { type: 'lineup', lineup: st.lineup, lineup_id: st.lineup_id, state_version: st.state_version });
        touched = true;
      }
      const msgKey = JSON.stringify(st.messages || []);
      if (force || c.sent.messages !== msgKey) {
        c.sent.messages = msgKey;
        sendJson(c.ws, { type: 'messages', messages: st.messages || [], state_version: st.state_version });
        touched = true;
      }
      const appsKey = JSON.stringify(st.apps || []);
      if (force || c.sent.apps !== appsKey) {
        c.sent.apps = appsKey;
        sendJson(c.ws, { type: 'apps', apps: st.apps || [], state_version: st.state_version });
        touched = true;
      }
      if (touched) pushed++;
    }
    return pushed;
  }

  // Push an unsaved layout to one set (admin "preview on set").
  function preview(setId, layout, page = null) {
    const c = conns.get(setId);
    if (!c) return false;
    const tenant = findTenant.get(c.tenantId);
    const set = findSet.get(setId, c.tenantId);
    sendJson(c.ws, { type: 'layout', layout, context: state.context(tenant, set), preview: true, page: page || undefined });
    c.sent.layout = null; // next refresh restores the real layout
    return true;
  }

  function closeAll() { for (const c of conns.values()) { try { c.ws.terminate(); } catch { /* ignore */ } } conns.clear(); wss.close(); }
  // Drop every connection but keep accepting new ones (tests simulate a server outage).
  function dropAll() { for (const c of conns.values()) { try { c.ws.terminate(); } catch { /* ignore */ } } conns.clear(); }

  return { attach, send, isConnected, connectedSetIds, refresh, preview, closeAll, dropAll, recordTvEvent,
    setCommands(c) { commands = c; }, get size() { return conns.size; } };
}

module.exports = { createHub, parseInstantPower, INSTANT_POWER_VALUES };
