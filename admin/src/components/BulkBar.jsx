import React, { useState } from 'react';
import { post } from '../api.js';
import { useToast } from './ui.jsx';

export default function BulkBar({ ids, onDone }) {
  const toast = useToast();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(type, payload = {}) {
    setBusy(true);
    try { const r = await post('/commands', { type, payload, set_ids: ids }); toast(`${type}: ${r.sent} sent live, ${r.queued} queued`); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>{ids.length} selected</b>
      <button className="sm" disabled={busy} onClick={() => run('reload_app')}>Reload app</button>
      <button className="sm" disabled={busy} onClick={() => run('reboot')}>Reboot</button>
      <button className="sm" disabled={busy} onClick={() => run('power', { mode: 'off' })}>Power off</button>
      <button className="sm" disabled={busy} onClick={() => run('screenshot')}>Screenshot</button>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message to all selected…" style={{ maxWidth: 320 }} aria-label="Bulk message" />
      <button className="sm" disabled={busy || !msg.trim()} onClick={() => run('message', { text: msg.trim(), ttl_s: 60 })}>Send message</button>
    </div>
  );
}
