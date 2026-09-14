import React, { useState } from 'react';
import { get, post, patch } from '../api.js';
import { useAsync, Modal, Field, Empty, useToast } from '../components/ui.jsx';

export default function Tenants() {
  const toast = useToast();
  const tenants = useAsync(() => get('/tenants'), []);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState(null);

  async function create(form) {
    setBusy(true);
    try { const t = await post('/tenants', form); setOutput(t.output); toast(`Tenant ${t.name} created`); setCreating(false); tenants.reload(); }
    catch (e) { toast(e.message, 'bad'); setOutput(e.message); } finally { setBusy(false); }
  }
  async function rename(t) {
    const v = window.prompt('Display name', t.display_name); if (!v) return;
    try { await patch(`/tenants/${t.id}`, { display_name: v }); tenants.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  return (
    <>
      <div className="topbar"><h1>Tenants</h1><div className="actions"><button className="primary" onClick={() => setCreating(true)}>New tenant</button></div></div>
      <p className="muted small">Each tenant is one hotel: its own hostname, nginx vhost, xait.xml and TV app tree. Creating one runs <code>coopcentric-tenant new</code> on the server; DNS for the hostname must point at this VM.</p>
      <div className="card" style={{ padding: 0 }}>
        {tenants.data && tenants.data.length === 0 ? <Empty>No tenants.</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Hostname</th><th className="num">Sets</th><th className="num">Online</th><th className="num">Users</th><th></th></tr></thead>
            <tbody>{(tenants.data || []).map((t) => (
              <tr key={t.id}>
                <td><b>{t.display_name}</b><div className="muted small mono">{t.name}</div></td>
                <td><a href={`http://${t.hostname}/admin`} target="_blank" rel="noreferrer">{t.hostname}</a></td>
                <td className="num">{t.set_count}</td><td className="num">{t.online_count}</td><td className="num">{t.user_count}</td>
                <td style={{ textAlign: 'right' }}><button className="sm" onClick={() => rename(t)}>Rename</button></td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {output && <pre className="card small mono" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{output}</pre>}
      {creating && <TenantModal busy={busy} onSave={create} onClose={() => setCreating(false)} />}
    </>
  );
}
function TenantModal({ busy, onSave, onClose }) {
  const [f, setF] = useState({ name: '', hostname: '', display_name: '' });
  const ok = /^[a-z0-9][a-z0-9-]*$/.test(f.name) && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(f.hostname);
  return (
    <Modal title="New tenant" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ok || busy} onClick={() => onSave(f)}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <Field label="Short name (slug, e.g. hotelb)"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} autoFocus aria-label="Tenant name" /></Field>
      <Field label="Hostname (e.g. hotelb.caritech.net)"><input value={f.hostname} onChange={(e) => setF({ ...f, hostname: e.target.value.toLowerCase() })} aria-label="Tenant hostname" /></Field>
      <Field label="Display name"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Hotel B" /></Field>
    </Modal>
  );
}
