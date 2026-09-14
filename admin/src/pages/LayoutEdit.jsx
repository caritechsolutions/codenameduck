import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, put, post } from '../api.js';
import { useAsync, Field, useToast } from '../components/ui.jsx';
import { validateLayoutText, validateLayout } from '../layoutSchema.js';
import CanvasEditor from '../editor/CanvasEditor.jsx';
import ZonePanel from '../editor/ZonePanel.jsx';
import { ZONE_TYPES, addZone, ensureScreens } from '../editor/geometry.js';

// Layout editor: visual canvas (step 4) + JSON view, both editing the same document.
export default function LayoutEdit() {
  const { id } = useParams();
  const toast = useToast();
  const layout = useAsync(() => get(`/layouts/${id}`), [id]);
  const groups = useAsync(() => get('/groups'), []);
  const sets = useAsync(() => get('/sets'), []);
  const [name, setName] = useState('');
  const [doc, setDoc] = useState(null);           // current document (source of truth)
  const [text, setText] = useState('');           // JSON view text
  const [tab, setTab] = useState('canvas');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewSet, setPreviewSet] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [screenId, setScreenId] = useState(null);
  const [savedJson, setSavedJson] = useState('');
  const history = useRef([]);
  const [canvasWidth, setCanvasWidth] = useState(960);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!layout.data) return;
    const d = ensureScreens(layout.data.json);
    setName(layout.data.name); setDoc(d); setText(JSON.stringify(d, null, 2)); setErrors([]);
    setSavedJson(JSON.stringify(layout.data.json)); setScreenId(d.screens[0] && d.screens[0].id);
    history.current = [];
  }, [layout.data]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const fit = () => setCanvasWidth(Math.max(480, Math.min(1200, Math.floor(el.clientWidth - 2))));
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); };
  }, [doc]);

  const change = useCallback((next) => {
    setDoc((prev) => { if (prev) { history.current.push(prev); if (history.current.length > 50) history.current.shift(); } return next; });
    setText(JSON.stringify(next, null, 2));
    setErrors(validateLayout(next).errors);
  }, []);
  const undo = () => { const prev = history.current.pop(); if (prev) { setDoc(prev); setText(JSON.stringify(prev, null, 2)); setErrors(validateLayout(prev).errors); } };
  function onText(v) {
    setText(v);
    const r = validateLayoutText(v);
    setErrors(r.errors);
    if (r.doc) setDoc(ensureScreens(r.doc));
  }
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tab === 'canvas' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault(); change({ ...doc, zones: doc.zones.filter((z) => z.id !== selectedId), screens: doc.screens.map((s) => ({ ...s, zones: s.zones.filter((z) => z !== selectedId) })) }); setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save() {
    const r = validateLayout(doc);
    if (!r.doc) { setErrors(r.errors); return; }
    setSaving(true);
    try {
      const saved = await put(`/layouts/${id}`, { name, json: doc });
      layout.setData(saved);
      toast(`Saved v${saved.version} · pushed to ${saved.pushed} online set(s)`);
    } catch (e) { setErrors(e.errors || [e.message]); toast(e.message, 'bad'); } finally { setSaving(false); }
  }
  async function preview() {
    const r = validateLayout(doc);
    if (!r.doc) { setErrors(r.errors); return; }
    try { await post(`/sets/${previewSet}/preview`, { json: doc }); toast('Preview pushed — the TV shows it until its next real update'); }
    catch (e) { toast(e.message, 'bad'); }
  }
  async function assign(groupId, on) {
    try { await put(`/groups/${groupId}/layout`, { layout_id: on ? Number(id) : null }); groups.reload(); toast(on ? 'Assigned' : 'Unassigned'); }
    catch (e) { toast(e.message, 'bad'); }
  }
  if (layout.error) return <div className="error">{layout.error.message} · <Link to="/layouts">back to layouts</Link></div>;
  if (!layout.data || !doc) return <div className="muted">Loading…</div>;
  const dirty = JSON.stringify(doc) !== savedJson || name !== layout.data.name;
  const liveSets = (sets.data || []).filter((s) => s.ws);
  return (
    <>
      <div className="topbar">
        <h1><Link to="/layouts" className="muted">Layouts</Link> / <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Layout name" style={{ width: 260, display: 'inline-block', fontSize: 18, padding: '3px 8px' }} /> <span className="muted small">v{layout.data.version}</span></h1>
        <div className="actions">
          <div className="editor-tabs"><button className={tab === 'canvas' ? 'active' : ''} onClick={() => setTab('canvas')}>Canvas</button><button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>JSON</button></div>
          <button onClick={undo} disabled={history.current.length === 0} title="Ctrl+Z">Undo</button>
          <button className="primary" disabled={!dirty || saving || errors.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save & publish'}</button>
        </div>
      </div>
      {errors.length > 0 && <ul className="error" role="alert">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
        <div>
          {tab === 'canvas' ? (
            <div className="card" ref={wrapRef}>
              <div className="zone-add">
                <span className="muted small" style={{ alignSelf: 'center' }}>Add zone:</span>
                {ZONE_TYPES.map((t) => <button key={t} className="sm" onClick={() => { const r = addZone(doc, t, screenId); change(r.doc); setSelectedId(r.zone.id); }}>{t}</button>)}
                <span style={{ flex: 1 }} />
                {doc.screens.length > 1 && <span className="inline small"><span className="muted">Screen</span>{doc.screens.map((s) => <button key={s.id} className={'sm' + (s.id === screenId ? ' primary' : '')} onClick={() => setScreenId(s.id)}>{s.id}</button>)}</span>}
              </div>
              <CanvasEditor doc={doc} onChange={change} selectedId={selectedId} onSelect={setSelectedId} screenId={screenId} width={canvasWidth - 32} />
            </div>
          ) : (
            <div className="card">
              <Field label="Layout JSON (schema 1)"><textarea className="code" value={text} onChange={(e) => onText(e.target.value)} spellCheck={false} aria-label="Layout JSON" style={{ minHeight: 560 }} /></Field>
              {errors.length === 0 && dirty && <div className="muted small">Unsaved changes.</div>}
            </div>
          )}
        </div>
        <div>
          <div className="card"><ZonePanel doc={doc} selectedId={selectedId} onChange={change} onSelect={setSelectedId} screenId={screenId} setScreenId={setScreenId} /></div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Preview on a set</h3>
            <div className="row">
              <select value={previewSet} onChange={(e) => setPreviewSet(e.target.value)} aria-label="Preview set">
                <option value="">— choose a live set —</option>
                {liveSets.map((s) => <option key={s.id} value={s.id}>{s.room_number ? `Room ${s.room_number}` : s.serial} · {s.model || ''}</option>)}
              </select>
              <button disabled={!previewSet || errors.length > 0} onClick={preview} style={{ flex: '0 0 auto' }}>Preview</button>
            </div>
            {liveSets.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>No set is connected over WebSocket right now.</div>}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Assigned to groups</h3>
            {(groups.data || []).length === 0 ? <div className="muted small">No groups yet.</div> : (groups.data || []).map((g) => (
              <label key={g.id} className="inline" style={{ display: 'flex', marginBottom: 6, color: 'var(--text)', fontSize: 13 }}>
                <input type="checkbox" checked={String(g.layout_id) === String(id)} onChange={(e) => assign(g.id, e.target.checked)} /> {g.name} <span className="muted">({g.set_count} sets{g.layout_id && String(g.layout_id) !== String(id) ? `, now: ${g.layout_name}` : ''})</span>
              </label>))}
          </div>
        </div>
      </div>
    </>
  );
}
