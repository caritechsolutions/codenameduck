import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, put, post } from '../api.js';
import { useAsync, Field, useToast } from '../components/ui.jsx';
import { validateLayoutText } from '../layoutSchema.js';

// Step 2: JSON editor with validation, save (= publish), assign to groups, preview on set.
// Step 4 adds the visual canvas editor next to it.
export default function LayoutEdit() {
  const { id } = useParams();
  const toast = useToast();
  const layout = useAsync(() => get(`/layouts/${id}`), [id]);
  const groups = useAsync(() => get('/groups'), []);
  const sets = useAsync(() => get('/sets'), []);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewSet, setPreviewSet] = useState('');

  useEffect(() => {
    if (layout.data) { setName(layout.data.name); setText(JSON.stringify(layout.data.json, null, 2)); setErrors([]); }
  }, [layout.data]);

  function onText(v) { setText(v); setErrors(validateLayoutText(v).errors); }
  function format() { const r = validateLayoutText(text); if (r.doc) setText(JSON.stringify(r.doc, null, 2)); setErrors(r.errors); }

  async function save() {
    const r = validateLayoutText(text);
    if (!r.doc) { setErrors(r.errors); return; }
    setSaving(true);
    try {
      const saved = await put(`/layouts/${id}`, { name, json: r.doc });
      layout.setData(saved);
      toast(`Saved v${saved.version} · pushed to ${saved.pushed} online set(s)`);
    } catch (e) { setErrors(e.errors || [e.message]); toast(e.message, 'bad'); } finally { setSaving(false); }
  }
  async function preview() {
    const r = validateLayoutText(text);
    if (!r.doc) { setErrors(r.errors); return; }
    try { await post(`/sets/${previewSet}/preview`, { json: r.doc }); toast('Preview pushed — the TV shows it until its next real update'); }
    catch (e) { toast(e.message, 'bad'); }
  }
  async function assign(groupId, on) {
    try { await put(`/groups/${groupId}/layout`, { layout_id: on ? Number(id) : null }); groups.reload(); toast(on ? 'Assigned' : 'Unassigned'); }
    catch (e) { toast(e.message, 'bad'); }
  }
  if (layout.error) return <div className="error">{layout.error.message} · <Link to="/layouts">back to layouts</Link></div>;
  if (!layout.data) return <div className="muted">Loading…</div>;
  const dirty = text !== JSON.stringify(layout.data.json, null, 2) || name !== layout.data.name;
  const liveSets = (sets.data || []).filter((s) => s.ws);
  return (
    <>
      <div className="topbar">
        <h1><Link to="/layouts" className="muted">Layouts</Link> / {layout.data.name} <span className="muted small">v{layout.data.version}</span></h1>
        <div className="actions">
          <button onClick={format}>Format JSON</button>
          <button className="primary" disabled={!dirty || saving || errors.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save & publish'}</button>
        </div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Layout JSON (schema 1)">
            <textarea className="code" value={text} onChange={(e) => onText(e.target.value)} spellCheck={false} aria-label="Layout JSON" />
          </Field>
          {errors.length > 0 && <ul className="error" role="alert">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {errors.length === 0 && dirty && <div className="muted small">Unsaved changes.</div>}
        </div>
        <div>
          <div className="card">
            <h2>Assigned to groups</h2>
            {(groups.data || []).length === 0 ? <div className="muted small">No groups yet.</div> : (groups.data || []).map((g) => (
              <label key={g.id} className="inline" style={{ display: 'flex', marginBottom: 6, color: 'var(--text)', fontSize: 13 }}>
                <input type="checkbox" checked={String(g.layout_id) === String(id)} onChange={(e) => assign(g.id, e.target.checked)} /> {g.name} <span className="muted">({g.set_count} sets{g.layout_id && String(g.layout_id) !== String(id) ? `, now: ${g.layout_name}` : ''})</span>
              </label>))}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h2>Preview on a set</h2>
            <p className="muted small">Pushes the current (unsaved) JSON to one live set without saving.</p>
            <div className="row">
              <select value={previewSet} onChange={(e) => setPreviewSet(e.target.value)}>
                <option value="">— choose a live set —</option>
                {liveSets.map((s) => <option key={s.id} value={s.id}>{s.room_number ? `Room ${s.room_number}` : s.serial} · {s.model || ''}</option>)}
              </select>
              <button disabled={!previewSet || errors.length > 0} onClick={preview} style={{ flex: '0 0 auto' }}>Preview</button>
            </div>
            {liveSets.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>No set is connected over WebSocket right now.</div>}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h2>Zone types</h2>
            <div className="small muted">
              <div><b>video</b> live TV (from the lineup) · <b>text</b> with <code>{'{{hotel}}'}</code> <code>{'{{room}}'}</code> <code>{'{{guest}}'}</code></div>
              <div><b>image</b> src · <b>clock</b> format HH:mm · <b>channel_list</b> · <b>menu</b> items · <b>html</b> · <b>weather</b> · <b>app_launcher</b></div>
              <div style={{ marginTop: 6 }}>Renderer v0 draws text, image and clock; video and channel_list arrive in step 3.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
