'use strict';
// The state a TV needs: resolved layout, lineup, messages, pending commands. Shared by the
// register/poll routes and the WebSocket hub so every path returns the same shape.
const { makeLayoutResolver } = require('./layout');

const FACTORY_ROOM = /^\[TV\]/i;   // LG factory default room_number is "[TV]<serial>" — never a room
function isFactoryRoom(v) { return !v || FACTORY_ROOM.test(String(v)); }

function createStateBuilder(db, { pollIntervalS = 60 } = {}) {
  const resolveLayout = makeLayoutResolver(db);
  const findGroup = db.prepare('SELECT id, name FROM groups WHERE id = ? AND tenant_id = ?');
  const pendingCommands = db.prepare(`SELECT id, type, payload_json FROM commands
    WHERE set_id = ? AND status IN ('queued','sent') ORDER BY id`);

  function context(tenant, set) {
    return { hotel: tenant.display_name || tenant.name, room: set.room_number || '', guest: '', serial: set.serial };
  }

  function commandsFor(set) {
    return pendingCommands.all(set.id).map((c) => ({ id: c.id, type: c.type, payload: safeJson(c.payload_json) }));
  }

  function build(tenant, set) {
    const group = set.group_id ? findGroup.get(set.group_id, tenant.id) : null;
    return {
      set_id: set.id,
      serial: set.serial,
      room_number: set.room_number,
      group: group || null,
      context: context(tenant, set),
      layout: resolveLayout(tenant, set),
      lineup: [],            // step 3
      messages: [],          // step 5
      commands: commandsFor(set),
      ws_url: '/ws/tv',
      poll_interval_s: pollIntervalS,
      server_time: new Date().toISOString(),
    };
  }

  return { build, resolveLayout, context, commandsFor };
}

function safeJson(s, fallback = {}) { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } }

module.exports = { createStateBuilder, isFactoryRoom, safeJson };
