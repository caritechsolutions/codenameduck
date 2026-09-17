import React, { useState } from 'react';
import { get, put, patch, del } from '../api.js';
import { useAsync, useToast, Empty, Field, Modal } from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';
import { timeAgo } from '../util.js';

// Apps discovered on the fleet (each set reports idcap://application/list at register).
// Enable per group with a checkbox matrix; override the display name and the icon (Media library).
export default function Apps() {
  const toast = useToast();
  const apps = useAsync(() => get('/apps'), []);
  const groups = useAsync(() => get('/groups'), []);
  const [edit, setEdit] = useState(null);       // app being edited
  const [raw, setRaw] = useState(null);         // app whose raw LG entry is shown
  const [saving, setSaving] = useState(null);   // group id being saved

  async function toggle(app, group) {
    const enabled = (apps.data || []).filter((a) => a.group_ids.includes(group.id)).map((a) => a.id);
    const next = enabled.includes(app.id) ? enabled.filter((id) => id !== app.id) : [...enabled, app.id];
    setSaving(group.id);
    try {
      const r = await put(`/groups/${group.id}/apps`, { app_ids: next });
      apps.setData((apps.data || []).map((a) => ({ ...a, group_ids: next.includes(a.id) ? [...new Set([...a.group_ids, group.id])] : a.group_ids.filter((g) => g !== group.id) })));
      toast(`${group.name}: ${r.app_ids.length} app(s) enabled · pushed to ${r.pushed} live set(s)`);
    } catch (e) { toast(e.message, 'bad'); } finally { setSaving(null); }
  }
  async function forget(app) {
    try { await del(`/apps/${app.id}`); toast(`Forgot ${app.name}`); apps.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  const list = apps.data || [];
  const gl = groups.data || [];
  return (
    <>
      <div className="topbar"><h1>Apps</h1><span className="muted small">{list.length} discovered on {gl.length} group(s)</span></div>
      <p className="muted small">Every set reports the apps LG installed on it when it registers. Tick an app for a group to show it in that group's <b>Apps</b> zones and menus; OK on the set launches it. Names and icons can be overridden (icons come from the Media library — LG's own icon paths are not reachable by the TV page).</p>
      <div className="card" style={{ padding: 0 }}>
        {apps.loading && !apps.data ? <div className="muted" style={{ padding: 16 }}>Loading…</div> : list.length === 0 ? <Empty>No apps yet. Apps appear here after a set with the current renderer registers (power-cycle a set).</Empty> : (
          <table className="apps-table">
            <thead><tr><th></th><th>App</th><th>LG id</th><th>Seen on</th>{gl.map((g) => <th key={g.id} className="num" title={`${g.set_count} sets`}>{g.name}</th>)}<th></th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 44 }}><div className="app-ico">{a.icon ? <img src={a.icon} alt="" /> : <span>{(a.name || '?').charAt(0).toUpperCase()}</span>}</div></td>
                <td><b>{a.name}</b>{a.name_override && a.title && <div className="muted small">LG title: {a.title}</div>}</td>
                <td><code className="small">{a.app_id}</code>{a.type && <span className="pill" style={{ marginLeft: 6 }}>{a.type}</span>}</td>
                <td className="muted small">{a.models.length ? a.models.join(', ') : '—'}<div>{a.set_count} set(s) · {timeAgo(a.last_seen)}</div></td>
                {gl.map((g) => <td key={g.id} className="num"><input type="checkbox" aria-label={`${a.name} in ${g.name}`} checked={a.group_ids.includes(g.id)} disabled={saving === g.id} onChange={() => toggle(a, g)} /></td>)}
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sm" onClick={() => setEdit(a)}>Edit</button>{' '}
                  <button className="sm ghost" onClick={() => setRaw(a)} title="What the set sent">Raw</button>{' '}
                  <button className="sm danger" onClick={() => forget(a)}>Forget</button>
                </td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {gl.length === 0 && list.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>Create a group first to enable apps for its sets.</p>}
      {edit && <EditApp app={edit} onClose={() => setEdit(null)} onSaved={(a) => { apps.setData(list.map((x) => (x.id === a.id ? { ...x, ...a } : x))); setEdit(null); }} />}
      {raw && <Modal title={`Raw entry for ${raw.app_id}`} onClose={() => setRaw(null)} footer={<button onClick={() => setRaw(null)}>Close</button>}>
        <p className="muted small">The first entry LG returned for this app in <code>idcap://application/list</code>, as received. Tell Richard the shape if the name/icon columns look wrong.</p>
        <pre className="code small" style={{ maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(raw.raw, null, 2)}</pre>
      </Modal>}
    </>
  );
}

function EditApp({ app, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(app.name_override || '');
  const [icon, setIcon] = useState(app.icon_override || '');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { const a = await patch(`/apps/${app.id}`, { name_override: name, icon_override: icon }); toast('Saved · pushed to live sets'); onSaved(a); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Edit ${app.title || app.app_id}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>Save</button></>}>
      <Field label="Display name" hint={`Leave empty to use LG's title (${app.title || app.app_id}).`}><input value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" placeholder={app.title || app.app_id} /></Field>
      <Field label="Icon" hint="From the Media library (PNG/SVG with transparency works best).">
        <div className="inline"><input value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon URL" placeholder="none" style={{ flex: 1 }} /><button className="sm" onClick={() => setPicker(true)} aria-label="Choose icon">Library…</button>{icon && <button className="sm ghost" onClick={() => setIcon('')}>Clear</button>}</div>
        {icon && <div className="media-inline-preview" style={{ marginTop: 8 }}><img src={icon} alt="" /></div>}
      </Field>
      {picker && <MediaPicker title="Choose an icon" allowLogo={false} onClose={() => setPicker(false)} onPick={(url) => { setIcon(url); setPicker(false); }} />}
    </Modal>
  );
}
