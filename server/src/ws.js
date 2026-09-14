'use strict';
// WebSocket hub for TVs: /ws/tv?set_id=..&token=..  (token from /api/tv/register).
// Server → TV : {type:"hello"} {type:"layout", layout, context} {type:"lineup", lineup}
//               {type:"message", ...} {type:"command", command:{id,type,payload}}
// TV → server : {type:"hb", channel, volume, muted, uptime, power_mode} {type:"ack", command_id, ok, result}
const { WebSocketServer } = require('ws');
const { normalizeHost } = require('./tenants');
const { safeJson } = require('./state');

const PING_MS = 30000;

function createHub({ db, tenants, state, log = () => {} }) {
  const conns = new Map();          // set_id -> { ws, tenantId, sent: {layout, lineup} }
  const findSet = db.prepare('SELECT * FROM sets WHERE id = ? AND tenant_id = ?');
  const findTenant = db.prepare('SELECT * FROM tenants WHERE id = ?');
  const touch = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ip = COALESCE(?, ip) WHERE id = ?`);
  const heartbeat = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    last_hb = strftime('%Y-%m-%dT%H:%M:%fZ','now'), channel = COALESCE(@channel, channel),
    volume = COALESCE(@volume, volume), muted = COALESCE(@muted, muted), uptime_s = COALESCE(@uptime, uptime_s),
    power_mode = COALESCE(@power_mode, power_mode), app_version = COALESCE(@app_version, app_version) WHERE id = @id`);
  const insertEvent = db.prepare('INSERT INTO events (tenant_id, set_id, type, payload_json) VALUES (?, ?, ?, ?)');
  let commands = null;   // set later (circular)

  const wss = new WebSocketServer({ noServer: true });

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
      if (url.pathname !== '/ws/tv') { socket.destroy(); return; }
      const tenant = tenants.resolve(req.headers.host);
      const setId = Number(url.searchParams.get('set_id'));
      const token = url.searchParams.get('token') || '';
      const set = tenant && Number.isInteger(setId) && setId > 0 ? findSet.get(setId, tenant.id) : null;
      if (!set || !token || set.token !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, tenant, set));
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

  function onConnection(ws, req, tenant, set) {
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
    // only pushes real changes from here on.
    try {
      const st = state.build(tenant, set);
      conn.sent.layout = JSON.stringify(st.layout) + JSON.stringify(st.context);
      conn.sent.lineup = JSON.stringify(st.lineup);
      conn.sent.messages = JSON.stringify(st.messages);
    } catch (e) { log(`ws: state build failed for set ${set.id}: ${e.message}`); }
    sendJson(ws, { type: 'hello', set_id: set.id, server_time: new Date().toISOString() });
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
      });
      conn.alive = true;
    } else if (msg.type === 'ack') {
      if (commands) commands.ack(conn.setId, Number(msg.command_id), !!msg.ok, msg.result);
      insertEvent.run(conn.tenantId, conn.setId, 'command_ack', JSON.stringify({ command_id: msg.command_id, ok: !!msg.ok }));
    } else if (msg.type === 'event') {
      insertEvent.run(conn.tenantId, conn.setId, 'tv_' + String(msg.name || 'event').slice(0, 32), JSON.stringify(msg.payload || null).slice(0, 4000));
    } else if (msg.type === 'ping') {
      sendJson(conn.ws, { type: 'pong' });
    }
  }

  function sendJson(ws, obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }

  function send(setId, obj) { const c = conns.get(setId); if (!c) return false; sendJson(c.ws, obj); return true; }
  function isConnected(setId) { const c = conns.get(setId); return !!c && c.ws.readyState === c.ws.OPEN; }
  function connectedSetIds(tenantId) { return [...conns.values()].filter((c) => c.tenantId === tenantId).map((c) => c.setId); }

  // Recompute layout (and later lineup) for connected sets and push what changed.
  // setIds: restrict to some sets; otherwise every connected set of the tenant.
  function refresh(tenantId, { setIds = null, force = false } = {}) {
    const tenant = findTenant.get(tenantId);
    if (!tenant) return 0;
    let pushed = 0;
    for (const c of conns.values()) {
      if (c.tenantId !== tenantId) continue;
      if (setIds && !setIds.includes(c.setId)) continue;
      const set = findSet.get(c.setId, tenantId);
      if (!set) continue;
      const st = state.build(tenant, set);
      const layoutKey = JSON.stringify(st.layout) + JSON.stringify(st.context);
      if (force || c.sent.layout !== layoutKey) {
        c.sent.layout = layoutKey;
        sendJson(c.ws, { type: 'layout', layout: st.layout, context: st.context, room_number: st.room_number, group: st.group });
        pushed++;
      }
      const lineupKey = JSON.stringify(st.lineup);
      if (force || c.sent.lineup !== lineupKey) {
        c.sent.lineup = lineupKey;
        sendJson(c.ws, { type: 'lineup', lineup: st.lineup });
      }
      if (st.messages && (force || c.sent.messages !== JSON.stringify(st.messages))) {
        c.sent.messages = JSON.stringify(st.messages);
        sendJson(c.ws, { type: 'messages', messages: st.messages });
      }
    }
    return pushed;
  }

  // Push an unsaved layout to one set (admin "preview on set").
  function preview(setId, layout) {
    const c = conns.get(setId);
    if (!c) return false;
    const tenant = findTenant.get(c.tenantId);
    const set = findSet.get(setId, c.tenantId);
    sendJson(c.ws, { type: 'layout', layout, context: state.context(tenant, set), preview: true });
    c.sent.layout = null; // next refresh restores the real layout
    return true;
  }

  function closeAll() { for (const c of conns.values()) { try { c.ws.terminate(); } catch { /* ignore */ } } conns.clear(); wss.close(); }

  return { attach, send, isConnected, connectedSetIds, refresh, preview, closeAll,
    setCommands(c) { commands = c; }, get size() { return conns.size; } };
}

module.exports = { createHub };
