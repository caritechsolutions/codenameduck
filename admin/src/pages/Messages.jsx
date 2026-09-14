import React, { useState } from 'react';
import { get, post, del } from '../api.js';
import { useAsync, Field, Empty, useToast } from '../components/ui.jsx';
import { timeAgo, fmtDate } from '../util.js';

export default function Messages() {
  const toast = useToast();
  const messages = useAsync(() => get('/messages'), []);
  const groups = useAsync(() => get('/groups'), []);
  const sets = useAsync(() => get('/sets'), []);
  const [text, setText] = useState('');
  const [targetType, setTargetType] = useState('all');
  const [targetId, setTargetId] = useState('');
  const [ttl, setTtl] = useState('60');
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault(); setBusy(true);
    try {
      const body = { text: text.trim(), target_type: targetType, target_id: targetType === 'all' ? null : Number(targetId), ttl_minutes: ttl ? Number(ttl) : null };
      const r = await post('/messages', body);
      toast(`Message sent · pushed to ${r.pushed} online set(s)`); setText(''); messages.reload();
    } catch (err) { toast(err.message, 'bad'); } finally { setBusy(false); }
  }
  async function remove(m) { try { await del(`/messages/${m.id}`); messages.reload(); } catch (err) { toast(err.message, 'bad'); } }
  const targetOk = targetType === 'all' || targetId;
  return (
    <>
      <div className="topbar"><h1>Messages</h1></div>
      <p className="muted small">A message is shown as a bar at the bottom of the TV until it expires or is deleted. Target one set, a group, or every set. (One-off pop-ups with a countdown are the "message" command in a set's drawer.)</p>
      <form className="card" onSubmit={send} style={{ marginBottom: 14 }}>
        <Field label="Text"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="The pool is closed for maintenance until 16:00" aria-label="Message text" /></Field>
        <div className="row">
          <Field label="To"><select value={targetType} onChange={(e) => { setTargetType(e.target.value); setTargetId(''); }} aria-label="Target type"><option value="all">All sets</option><option value="group">A group</option><option value="set">One set</option></select></Field>
          {targetType === 'group' && <Field label="Group"><select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Target group"><option value="">—</option>{(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
          {targetType === 'set' && <Field label="Set"><select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Target set"><option value="">—</option>{(sets.data || []).map((s) => <option key={s.id} value={s.id}>{s.room_number ? `Room ${s.room_number}` : s.serial}</option>)}</select></Field>}
          <Field label="Expires after (minutes, empty = until deleted)"><input value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" aria-label="Expires minutes" /></Field>
          <div style={{ flex: '0 0 auto', paddingBottom: 12 }}><button className="primary" disabled={busy || !text.trim() || !targetOk}>Send</button></div>
        </div>
      </form>
      <div className="card" style={{ padding: 0 }}>
        {messages.data && messages.data.length === 0 ? <Empty>No messages yet.</Empty> : (
          <table>
            <thead><tr><th>Sent</th><th>To</th><th>Text</th><th>Expires</th><th></th></tr></thead>
            <tbody>{(messages.data || []).map((m) => (
              <tr key={m.id} style={m.expired ? { opacity: .5 } : undefined}>
                <td className="muted small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(m.created_at)}</td>
                <td><span className="pill">{m.target_name}</span></td>
                <td>{m.text}</td>
                <td className="muted small">{m.expired ? 'expired' : m.expires_at ? fmtDate(m.expires_at) : 'until deleted'}</td>
                <td style={{ textAlign: 'right' }}><button className="sm danger" onClick={() => remove(m)}>{m.expired ? 'Remove' : 'Take down'}</button></td>
              </tr>))}</tbody>
          </table>)}
      </div>
    </>
  );
}
