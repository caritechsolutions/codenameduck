'use strict';
// Command queue: admin (or the server itself) queues a command for a set; the hub delivers it
// over WebSocket when the set is connected, otherwise the TV picks it up on its next poll.
// The renderer acks with {type:"ack", command_id, ok, result}.
const { safeJson } = require('./state');

const TYPES = ['reboot', 'power', 'tune', 'volume', 'mute', 'message', 'toast', 'screenshot',
  'set_property', 'reload_app', 'checkout', 'launch_app', 'register_apps'];

function createCommands(db, hub, log = () => {}) {
  const insert = db.prepare(`INSERT INTO commands (tenant_id, set_id, type, payload_json) VALUES (?, ?, ?, ?)`);
  const get = db.prepare('SELECT * FROM commands WHERE id = ?');
  const markSent = db.prepare(`UPDATE commands SET status = 'sent', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'queued'`);
  const markDone = db.prepare(`UPDATE commands SET status = ?, result_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND set_id = ?`);
  const dupQueued = db.prepare(`SELECT id FROM commands WHERE set_id = ? AND type = ? AND status = 'queued' AND payload_json = ?`);
  const recent = db.prepare('SELECT * FROM commands WHERE set_id = ? ORDER BY id DESC LIMIT ?');
  const expire = db.prepare(`UPDATE commands SET status = 'failed', result_json = '{"error":"expired"}'
    WHERE status IN ('queued','sent') AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`);

  function queue(tenant, set, type, payload = {}, { dedupe = false } = {}) {
    if (!TYPES.includes(type)) throw new Error(`unknown command type ${type}`);
    const payloadJson = JSON.stringify(payload || {});
    if (dedupe) { const d = dupQueued.get(set.id, type, payloadJson); if (d) return get.get(d.id); }
    const id = insert.run(tenant.id, set.id, type, payloadJson).lastInsertRowid;
    const cmd = get.get(id);
    if (hub && hub.isConnected(set.id)) {
      hub.send(set.id, { type: 'command', command: { id: cmd.id, type: cmd.type, payload: safeJson(cmd.payload_json) } });
      markSent.run(cmd.id);
      cmd.status = 'sent';
    }
    log(`command #${id} ${type} for set ${set.id} (${set.serial}) ${cmd.status}`);
    return cmd;
  }

  function ack(setId, commandId, ok, result) {
    const info = markDone.run(ok ? 'acked' : 'failed', JSON.stringify(result === undefined ? null : result), commandId, setId);
    if (info.changes > 0 && !ok) {
      const c = get.get(commandId);
      log(`command #${commandId} ${c ? c.type : '?'} FAILED on set ${setId}: ${result && result.error ? result.error : JSON.stringify(result)}`);
    }
    return info.changes > 0;
  }

  function sent(commandIds) { for (const id of commandIds) markSent.run(id); }

  return { queue, ack, sent, recent: (setId, n = 20) => recent.all(setId, n).map(rowToApi), expire: () => expire.run().changes, TYPES };
}

function rowToApi(c) {
  return { id: c.id, set_id: c.set_id, type: c.type, payload: safeJson(c.payload_json), status: c.status,
    result: safeJson(c.result_json, null), created_at: c.created_at, updated_at: c.updated_at };
}

module.exports = { createCommands, rowToApi, TYPES };
