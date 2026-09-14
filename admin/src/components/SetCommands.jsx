import React, { useState } from 'react';
import { post } from '../api.js';
import { useToast } from '../components/ui.jsx';
import { timeAgo } from '../util.js';

// Command buttons for one set. Step 2 ships the always-available ones; step 3 adds tune,
// volume, message, screenshot once the renderer implements them.
export default function SetCommands({ set, detail, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  async function run(type, payload = {}) {
    setBusy(type);
    try {
      const c = await post(`/sets/${set.id}/commands`, { type, payload });
      toast(`${type} ${c.status === 'sent' ? 'sent to the TV' : 'queued (TV offline — delivered on next contact)'}`);
      onDone && onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(null); }
  }
  async function refresh() {
    setBusy('refresh');
    try { const r = await post(`/sets/${set.id}/refresh`); toast(r.pushed ? 'Layout re-sent over WebSocket' : 'Set is not connected; it will pick the layout up on its next poll'); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(null); }
  }
  const cmds = (detail && detail.commands) || [];
  return (
    <div className="section">
      <h3>Commands</h3>
      <div className="actions">
        <button className="sm" disabled={!!busy} onClick={refresh}>Re-send layout</button>
        <button className="sm" disabled={!!busy} onClick={() => run('reload_app')}>Reload app</button>
        <button className="sm" disabled={!!busy} onClick={() => run('reboot')}>Reboot TV</button>
        <button className="sm" disabled={!!busy} onClick={() => run('set_property', { key: 'room_number', value: set.room_number || '' })} title="Write the admin room number into the TV's room_number property">Sync room to TV</button>
      </div>
      {cmds.length > 0 && (
        <table style={{ marginTop: 10 }}><tbody>
          {cmds.slice(0, 8).map((c) => <tr key={c.id}><td className="muted small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(c.created_at)}</td><td>{c.type}</td>
            <td><span className={'pill ' + (c.status === 'acked' ? 'ok' : c.status === 'failed' ? 'bad' : c.status === 'sent' ? 'accent' : '')}>{c.status}</span></td>
            <td className="small mono muted">{c.result && c.result.error ? c.result.error : ''}</td></tr>)}
        </tbody></table>)}
    </div>
  );
}
