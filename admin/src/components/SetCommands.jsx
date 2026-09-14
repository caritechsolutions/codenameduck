import React, { useEffect, useState } from 'react';
import { post } from '../api.js';
import { useToast, Field } from '../components/ui.jsx';
import { timeAgo } from '../util.js';

// Command panel for one set. Every button queues a command; the TV acks it over WebSocket.
export default function SetCommands({ set, detail, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [lineup, setLineup] = useState([]);
  const [tuneId, setTuneId] = useState('');
  const [volume, setVolume] = useState(set.volume == null ? 20 : set.volume);
  const [message, setMessage] = useState('');
  const [ttl, setTtl] = useState(30);
  const [shotStamp, setShotStamp] = useState(set.screenshot_at || null);
  const [shotOpen, setShotOpen] = useState(false);

  useEffect(() => {
    // The set's resolved lineup (override → group → tenant default) comes with the detail.
    setLineup((detail && detail.lineup && detail.lineup.channels) || []);
  }, [detail && detail.lineup && detail.lineup.id, detail && detail.lineup && detail.lineup.channels && detail.lineup.channels.length]); // eslint-disable-line
  useEffect(() => { if (detail && detail.screenshot_at && detail.screenshot_at !== shotStamp) setShotStamp(detail.screenshot_at); }, [detail && detail.screenshot_at]); // eslint-disable-line

  async function run(type, payload = {}, label) {
    setBusy(type);
    try {
      const c = await post(`/sets/${set.id}/commands`, { type, payload });
      toast(`${label || type} ${c.status === 'sent' ? 'sent to the TV' : 'queued (TV offline — delivered on next contact)'}`);
      onDone && onDone();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(null); }
  }
  async function refresh() {
    setBusy('refresh');
    try { const r = await post(`/sets/${set.id}/refresh`); toast(r.pushed ? 'Layout re-sent over WebSocket' : 'Set is not connected; it will pick the layout up on its next poll'); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(null); }
  }
  const cmds = (detail && detail.commands) || [];
  const live = !!set.ws;
  return (
    <div className="section">
      <h3>Commands {live ? <span className="pill ok">live</span> : <span className="pill">queued until online</span>}</h3>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button className="sm" disabled={!!busy} onClick={refresh}>Re-send layout</button>
        <button className="sm" disabled={!!busy} onClick={() => run('reload_app', {}, 'Reload app')}>Reload app</button>
        <button className="sm" disabled={!!busy} onClick={() => run('reboot', {}, 'Reboot')}>Reboot TV</button>
        <button className="sm" disabled={!!busy} onClick={() => run('power', { mode: 'off' }, 'Power off')}>Power off</button>
        <button className="sm" disabled={!!busy} onClick={() => run('screenshot', {}, 'Screenshot')}>Screenshot</button>
        <button className="sm" disabled={!!busy} onClick={() => run('checkout', {}, 'Checkout')} title="LG checkout: wipes guest data on the set">Checkout</button>
        <button className="sm" disabled={!!busy} onClick={() => run('set_property', { key: 'room_number', value: set.room_number || '' }, 'Room sync')} title="Write the admin room number into the TV's room_number property">Sync room to TV</button>
      </div>
      <div className="row">
        <Field label="Tune to">
          <div className="inline" style={{ width: '100%' }}>
            <select value={tuneId} onChange={(e) => setTuneId(e.target.value)} aria-label="Tune channel">
              <option value="">{lineup.length ? '— channel —' : 'no lineup assigned'}</option>
              {lineup.map((c) => <option key={c.id} value={c.id}>{c.number} {c.name}</option>)}
            </select>
            <button className="sm" disabled={!tuneId || !!busy} onClick={() => run('tune', { channel_id: Number(tuneId) }, 'Tune')}>Tune</button>
          </div>
        </Field>
        <Field label={`Volume ${volume}`}>
          <div className="inline" style={{ width: '100%' }}>
            <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
            <button className="sm" disabled={!!busy} onClick={() => run('volume', { level: volume }, 'Volume')}>Set</button>
            <button className="sm" disabled={!!busy} onClick={() => run('mute', { mute: !set.muted }, set.muted ? 'Unmute' : 'Mute')}>{set.muted ? 'Unmute' : 'Mute'}</button>
          </div>
        </Field>
      </div>
      <Field label="On-screen message">
        <div className="inline" style={{ width: '100%' }}>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your taxi is waiting at reception" aria-label="Message text" />
          <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} style={{ width: 80 }} title="seconds (0 = until replaced)" aria-label="Message seconds" />
          <button className="sm" disabled={!message.trim() || !!busy} onClick={() => run('message', { text: message.trim(), ttl_s: ttl }, 'Message')}>Show</button>
          <button className="sm" disabled={!message.trim() || !!busy} onClick={() => run('toast', { text: message.trim() }, 'Toast')} title="LG system toast (small, short)">Toast</button>
        </div>
      </Field>
      {shotStamp && (
        <div style={{ marginTop: 8 }}>
          <div className="inline"><span className="muted small">Screenshot {timeAgo(shotStamp)}</span><button className="sm ghost" onClick={() => setShotOpen(!shotOpen)}>{shotOpen ? 'hide' : 'show'}</button></div>
          {shotOpen && <img src={`/api/admin/sets/${set.id}/screenshot?t=${encodeURIComponent(shotStamp)}`} alt="latest screenshot" style={{ width: '100%', borderRadius: 8, marginTop: 6, border: '1px solid var(--border)' }} />}
        </div>)}
      {cmds.length > 0 && (
        <table style={{ marginTop: 10 }}><tbody>
          {cmds.slice(0, 8).map((c) => <tr key={c.id}><td className="muted small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(c.created_at)}</td><td>{c.type}{c.payload && Object.keys(c.payload).length ? <span className="muted small"> {JSON.stringify(c.payload).slice(0, 40)}</span> : null}</td>
            <td><span className={'pill ' + (c.status === 'acked' ? 'ok' : c.status === 'failed' ? 'bad' : c.status === 'sent' ? 'accent' : '')}>{c.status}</span></td>
            <td className="small mono muted">{c.result && (c.result.error || c.result.note) ? (c.result.error || c.result.note) : ''}</td></tr>)}
        </tbody></table>)}
    </div>
  );
}
