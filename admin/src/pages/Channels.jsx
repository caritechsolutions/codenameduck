import React, { useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';
import ChannelForm, { emptyChannel, describeParams } from '../components/ChannelForm.jsx';

export default function Channels() {
  const toast = useToast();
  const channels = useAsync(() => get('/channels'), []);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [importing, setImporting] = useState(false);

  async function save(ch) {
    try {
      if (ch.id) await put(`/channels/${ch.id}`, ch); else await post('/channels', ch);
      toast('Saved · lineups using it were pushed'); setEditing(null); channels.reload();
    } catch (e) { toast((e.errors && e.errors.join('; ')) || e.message, 'bad'); throw e; }
  }
  async function toggle(ch) {
    try { await put(`/channels/${ch.id}`, { enabled: !ch.enabled }); channels.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove() {
    try { await del(`/channels/${removing.id}`); toast('Channel deleted'); setRemoving(null); channels.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  return (
    <>
      <div className="topbar"><h1>Channels</h1>
        <div className="actions">
          <a className="btn" href="/api/admin/channels.csv">Export CSV</a>
          <button onClick={() => setImporting(true)}>Import CSV</button>
          <button className="primary" onClick={() => setEditing(emptyChannel())}>New channel</button>
        </div></div>
      <p className="muted small">IP channels tune by multicast (udp/rtp ip:port) or by stream URL (HLS/MP4/RTSP via the TV's media player). RF channels are stored with LG's own parameters so they work once an RF headend is connected.</p>
      <div className="card" style={{ padding: 0 }}>
        {channels.data && channels.data.length === 0 ? <Empty>No channels yet. Add one, or import a CSV.</Empty> : (
          <table>
            <thead><tr><th className="num">#</th><th>Name</th><th>Type</th><th>Source</th><th>Logo</th><th>Enabled</th><th></th></tr></thead>
            <tbody>{(channels.data || []).map((c) => (
              <tr key={c.id} style={c.enabled ? undefined : { opacity: .55 }}>
                <td className="num"><b>{c.number}</b></td>
                <td>{c.name}</td>
                <td><span className={'pill ' + (c.type === 'rf' ? 'warn' : 'accent')}>{c.type.toUpperCase()}</span></td>
                <td className="mono small">{describeParams(c)}</td>
                <td>{c.logo_url ? <img src={c.logo_url} alt="" style={{ height: 22, maxWidth: 80, objectFit: 'contain' }} /> : <span className="muted">—</span>}</td>
                <td><input type="checkbox" checked={c.enabled} onChange={() => toggle(c)} aria-label={`enabled ${c.number}`} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="sm" onClick={() => setEditing(c)}>Edit</button> <button className="sm danger" onClick={() => setRemoving(c)}>Delete</button></td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {editing && <Modal title={editing.id ? `Edit channel ${editing.number}` : 'New channel'} onClose={() => setEditing(null)}>
        <ChannelForm channel={editing} onSave={save} onCancel={() => setEditing(null)} />
      </Modal>}
      {removing && <Confirm title="Delete channel" text={`Delete ${removing.number} ${removing.name}? It is removed from every lineup.`} onConfirm={remove} onClose={() => setRemoving(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); channels.reload(); }} />}
    </>
  );
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  async function file(e) { const f = e.target.files[0]; if (f) setCsv(await f.text()); }
  async function dry() {
    setBusy(true);
    try { setPreview(await post('/channels/import?dry=1', { csv })); } catch (e) { setPreview({ errors: (e.errors) || [e.message], rows: [] }); } finally { setBusy(false); }
  }
  async function run() {
    setBusy(true);
    try { const r = await post('/channels/import', { csv }); toast(`Imported ${r.imported} (${r.created} new, ${r.updated} updated)${r.errors.length ? `, ${r.errors.length} line(s) skipped` : ''}`); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <Modal title="Import channels from CSV" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button onClick={dry} disabled={!csv || busy}>Preview</button><button className="primary" onClick={run} disabled={!csv || busy || (preview && preview.rows && preview.rows.length === 0)}>Import</button></>}>
      <p className="muted small">Columns: <code>number,name,type,logo_url,ip,port,ipBroadcastType,url,mimeType,rfBroadcastType,frequency,programNumber,majorNumber,minorNumber,satelliteId,polarization,symbolRate</code>. Existing numbers are updated, new ones created. Export first to get a template.</p>
      <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={file} /></Field>
      <Field label="or paste CSV"><textarea className="code" style={{ minHeight: 140 }} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} /></Field>
      {preview && <div className="small">
        <div>{preview.rows ? `${preview.rows.length} channel(s) ready` : ''}</div>
        {preview.errors && preview.errors.length > 0 && <ul className="error">{preview.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>}
    </Modal>
  );
}
