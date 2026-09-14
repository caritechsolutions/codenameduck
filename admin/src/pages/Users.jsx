import React, { useContext, useState } from 'react';
import { get, post, patch, del } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';
import { fmtDate } from '../util.js';
import { SessionCtx } from '../App.jsx';

export default function Users() {
  const toast = useToast();
  const session = useContext(SessionCtx);
  const superadmin = session.user.role === 'superadmin';
  const users = useAsync(() => get('/users'), []);
  const tenants = useAsync(() => (superadmin ? get('/tenants') : Promise.resolve([])), [superadmin]);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });

  async function create(form) {
    try { await post('/users', form); toast(`User ${form.username} created`); setCreating(false); users.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function reset(u, password) {
    try { await patch(`/users/${u.id}`, { password }); toast(`Password for ${u.username} changed`); setResetting(null); } catch (e) { toast(e.message, 'bad'); }
  }
  async function role(u, r) {
    try { await patch(`/users/${u.id}`, { role: r }); users.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove() {
    try { await del(`/users/${removing.id}`); toast('User deleted'); setRemoving(null); users.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function changeOwn(e) {
    e.preventDefault();
    if (pw.next !== pw.again) return toast('New passwords do not match', 'bad');
    try { await post('/me/password', { current: pw.current, next: pw.next }); toast('Your password was changed'); setPw({ current: '', next: '', again: '' }); } catch (err) { toast(err.message, 'bad'); }
  }
  return (
    <>
      <div className="topbar"><h1>Users</h1><div className="actions"><button className="primary" onClick={() => setCreating(true)}>New user</button></div></div>
      <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card" style={{ padding: 0 }}>
          {users.data && users.data.length === 0 ? <Empty>No users.</Empty> : (
            <table>
              <thead><tr><th>Username</th><th>Role</th><th>Tenant</th><th>Last login</th><th></th></tr></thead>
              <tbody>{(users.data || []).map((u) => (
                <tr key={u.id}>
                  <td><b>{u.username}</b>{u.id === session.user.id && <span className="pill accent" style={{ marginLeft: 6 }}>you</span>}</td>
                  <td>{superadmin && u.id !== session.user.id ? <select value={u.role} onChange={(e) => role(u, e.target.value)} style={{ width: 'auto' }}><option value="tenant-admin">tenant-admin</option><option value="superadmin">superadmin</option></select> : <span className="pill">{u.role}</span>}</td>
                  <td className="muted">{u.tenant_name || (u.role === 'superadmin' ? 'all tenants' : '—')}</td>
                  <td className="muted small">{fmtDate(u.last_login)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="sm" onClick={() => setResetting(u)}>Set password</button> {u.id !== session.user.id && <button className="sm danger" onClick={() => setRemoving(u)}>Delete</button>}</td>
                </tr>))}</tbody>
            </table>)}
        </div>
        <form className="card" onSubmit={changeOwn}>
          <h2>Change my password</h2>
          <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" aria-label="Current password" /></Field>
          <Field label="New password (8+ characters)"><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" aria-label="New password" /></Field>
          <Field label="Repeat new password"><input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" aria-label="Repeat new password" /></Field>
          <button className="primary" disabled={!pw.current || pw.next.length < 8}>Change password</button>
        </form>
      </div>
      {creating && <UserModal superadmin={superadmin} tenants={tenants.data || []} tenant={session.tenant} onSave={create} onClose={() => setCreating(false)} />}
      {resetting && <PasswordModal user={resetting} onSave={(p) => reset(resetting, p)} onClose={() => setResetting(null)} />}
      {removing && <Confirm title="Delete user" text={`Delete ${removing.username}?`} onConfirm={remove} onClose={() => setRemoving(null)} />}
    </>
  );
}

function UserModal({ superadmin, tenants, tenant, onSave, onClose }) {
  const [f, setF] = useState({ username: '', password: '', role: 'tenant-admin', tenant_id: tenant.id });
  const ok = /^[a-z0-9][a-z0-9._-]*$/.test(f.username) && f.password.length >= 8;
  return (
    <Modal title="New user" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ok} onClick={() => onSave(f)}>Create</button></>}>
      <Field label="Username (lowercase)"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoFocus aria-label="Username" /></Field>
      <Field label="Password (8+ characters)"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label="Password" /></Field>
      {superadmin && <div className="row">
        <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role"><option value="tenant-admin">tenant-admin</option><option value="superadmin">superadmin (all tenants)</option></select></Field>
        {f.role === 'tenant-admin' && <Field label="Tenant"><select value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: Number(e.target.value) })} aria-label="Tenant">{tenants.map((t) => <option key={t.id} value={t.id}>{t.display_name} ({t.hostname})</option>)}</select></Field>}
      </div>}
    </Modal>
  );
}
function PasswordModal({ user, onSave, onClose }) {
  const [p, setP] = useState('');
  return <Modal title={`Set password for ${user.username}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={p.length < 8} onClick={() => onSave(p)}>Save</button></>}>
    <Field label="New password (8+ characters)"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoFocus aria-label="New password" /></Field>
    <p className="muted small">Their other sessions are signed out.</p>
  </Modal>;
}
