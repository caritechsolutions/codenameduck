'use strict';
// The state a TV needs: resolved layout, lineup, messages, pending commands. Shared by the
// register/poll routes and the WebSocket hub so every path returns the same shape.
const { makeLayoutResolver } = require('./layout');
const { rowToApi: channelToApi } = require('./channels');

const FACTORY_ROOM = /^\[TV\]/i;   // LG factory default room_number is "[TV]<serial>" — never a room
function isFactoryRoom(v) { return !v || FACTORY_ROOM.test(String(v)); }

function createStateBuilder(db, { pollIntervalS = 60, apps = null } = {}) {
  const resolveLayout = makeLayoutResolver(db);
  const findGroup = db.prepare('SELECT id, name, instant_power FROM groups WHERE id = ? AND tenant_id = ?');
  const pendingCommands = db.prepare(`SELECT id, type, payload_json FROM commands
    WHERE set_id = ? AND status IN ('queued','sent') ORDER BY id`);
  const lineupItems = db.prepare(`SELECT c.* FROM lineup_items li JOIN channels c ON c.id = li.channel_id
    WHERE li.lineup_id = ? AND c.enabled = 1 ORDER BY li.position`);
  const groupLineup = db.prepare('SELECT lineup_id FROM lineup_assign WHERE group_id = ?');
  const lineupExists = db.prepare('SELECT id FROM lineups WHERE id = ? AND tenant_id = ?');
  const activeMessages = db.prepare(`SELECT id, text, created_at, expires_at FROM messages
    WHERE tenant_id = @tenant_id AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND (target_type = 'all' OR (target_type = 'set' AND target_id = @set_id) OR (target_type = 'group' AND target_id = @group_id))
    ORDER BY id DESC LIMIT 5`);

  // Lineup precedence mirrors layouts: per-set override → group → tenant default → none.
  function resolveLineup(tenant, set) {
    let id = null;
    if (set.lineup_override_id && lineupExists.get(set.lineup_override_id, tenant.id)) id = set.lineup_override_id;
    if (!id && set.group_id) { const g = groupLineup.get(set.group_id); if (g) id = g.lineup_id; }
    if (!id && tenant.default_lineup_id) id = tenant.default_lineup_id;
    if (!id) return { id: null, channels: [] };
    return { id, channels: lineupItems.all(id).map(channelToApi) };
  }

  function settingsOf(tenant) { try { return JSON.parse(tenant.settings_json || '{}') || {}; } catch { return {}; } }
  function context(tenant, set) {
    const st = settingsOf(tenant);
    return { hotel: tenant.display_name || tenant.name, room: set.room_number || '', guest: st.guest_placeholder || '', serial: set.serial,
      logo: st.logo_url || '', units: (st.weather && st.weather.units) || 'metric', netflix_hotel_id: st.netflix_hotel_id ? String(st.netflix_hotel_id) : '' };
  }

  function commandsFor(set) {
    return pendingCommands.all(set.id).map((c) => ({ id: c.id, type: c.type, payload: safeJson(c.payload_json) }));
  }

  function build(tenant, set) {
    const group = set.group_id ? findGroup.get(set.group_id, tenant.id) : null;
    const lineup = resolveLineup(tenant, set);
    return {
      set_id: set.id,
      serial: set.serial,
      room_number: set.room_number,
      group: group ? { id: group.id, name: group.name } : null,
      instant_power: group && group.instant_power != null ? group.instant_power : null,   // desired LG instant_power (0/1/2/10)
      context: context(tenant, set),
      layout: resolveLayout(tenant, set),
      lineup: lineup.channels,
      lineup_id: lineup.id,
      messages: activeMessages.all({ tenant_id: tenant.id, set_id: set.id, group_id: set.group_id || -1 }),
      apps: apps ? apps.enabledFor(tenant, set) : [],      // enabled for the set's group: [{id, name, icon}]
      activation: apps ? apps.registerPayload(tenant) : null,   // {tokenList, accountNumber} the set registers at boot when needed
      commands: commandsFor(set),
      ws_url: '/ws/tv',
      poll_interval_s: pollIntervalS,
      server_time: new Date().toISOString(),
    };
  }

  return { build, resolveLayout, resolveLineup, context, commandsFor };
}

function safeJson(s, fallback = {}) { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } }

module.exports = { createStateBuilder, isFactoryRoom, safeJson };
