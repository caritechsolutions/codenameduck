import React, { useEffect, useState, useCallback, useRef, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, put, post } from '../api.js';
import { useAsync, Field, useToast } from '../components/ui.jsx';
import { validateLayoutText, validateLayout } from '../layoutSchema.js';
import CanvasEditor from '../editor/CanvasEditor.jsx';
import ZonePanel from '../editor/ZonePanel.jsx';
import Palette from '../editor/Palette.jsx';
import EditorToolbar from '../editor/EditorToolbar.jsx';
import LayoutPreview from '../editor/LayoutPreview.jsx';
import PageNavigator from '../editor/PageNavigator.jsx';
import { addZone, ensurePages, duplicateZone, removeZone, errorsByZone, pagesOf, homePageId, pageById, editableZoneIds } from '../editor/geometry.js';
import { SessionCtx } from '../App.jsx';

const HISTORY = 50;

// Layout editor: pages + palette | canvas (or preview / advanced JSON) | property panel.
export default function LayoutEdit() {
  const { id } = useParams();
  const toast = useToast();
  const session = useContext(SessionCtx);
  const layout = useAsync(() => get(`/layouts/${id}`), [id]);
  const groups = useAsync(() => get('/groups'), []);
  const sets = useAsync(() => get('/sets'), []);
  const apps = useAsync(() => get('/apps').catch(() => []), []);
  const [name, setName] = useState('');
  const [doc, setDoc] = useState(null);           // current document (source of truth, schema 2)
  const [text, setText] = useState('');           // Advanced (JSON) view text
  const [tab, setTab] = useState('canvas');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewSet, setPreviewSet] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [pageId, setPageId] = useState(null);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [savedJson, setSavedJson] = useState('');
  const past = useRef([]); const future = useRef([]);
  const [, bump] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(960);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!layout.data) return;
    const d = ensurePages(layout.data.json);
    setName(layout.data.name); setDoc(d); setText(JSON.stringify(d, null, 2)); setErrors(validateLayout(d).errors);
    setSavedJson(JSON.stringify(d)); setPageId(homePageId(d));
    past.current = []; future.current = []; setSelectedIds([]);
  }, [layout.data]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const fit = () => setCanvasWidth(Math.max(420, Math.min(1400, Math.floor(el.clientWidth - 2))));
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); };
  }, [doc, tab]);
  // keep the selected page valid after deletes / JSON edits
  useEffect(() => { if (doc && !pageById(doc, pageId)) setPageId(homePageId(doc)); }, [doc, pageId]);

  const change = useCallback((next) => {
    setDoc((prev) => { if (prev) { past.current.push(prev); if (past.current.length > HISTORY) past.current.shift(); } return next; });
    future.current = [];
    setText(JSON.stringify(next, null, 2));
    setErrors(validateLayout(next).errors);
    bump((n) => n + 1);
  }, []);
  const undo = () => { const prev = past.current.pop(); if (!prev) return; setDoc((cur) => { future.current.push(cur); return prev; }); setText(JSON.stringify(prev, null, 2)); setErrors(validateLayout(prev).errors); bump((n) => n + 1); };
  const redo = () => { const next = future.current.pop(); if (!next) return; setDoc((cur) => { past.current.push(cur); return next; }); setText(JSON.stringify(next, null, 2)); setErrors(validateLayout(next).errors); bump((n) => n + 1); };
  function onText(v) {
    setText(v);
    const r = validateLayoutText(v);
    setErrors(r.errors);
    if (r.doc) { const d = r.doc; setDoc((prev) => { if (prev) { past.current.push(prev); if (past.current.length > HISTORY) past.current.shift(); } return d; }); future.current = []; bump((n) => n + 1); }
  }
  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
      else if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y') && !typing) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === 'd' && tab === 'canvas' && selectedIds.length && !typing) { e.preventDefault(); const r = duplicateZone(doc, selectedIds, pageId); change(r.doc); setSelectedIds(r.zones.map((z) => z.id)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length && tab === 'canvas' && !typing) { e.preventDefault(); change(removeZone(doc, selectedIds)); setSelectedIds([]); }
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
    try { await post(`/sets/${previewSet}/preview`, { json: doc, page: pageId }); toast(`Preview pushed, opened on page “${(pageById(doc, pageId) || {}).name || pageId}” — the TV shows it until its next real update`); }
    catch (e) { toast(e.message, 'bad'); }
  }
  async function assign(groupId, on) {
    try { await put(`/groups/${groupId}/layout`, { layout_id: on ? Number(id) : null }); groups.reload(); toast(on ? 'Assigned' : 'Unassigned'); }
    catch (e) { toast(e.message, 'bad'); }
  }
  // Page isolation: the selection can only hold zones editable on the current page.
  useEffect(() => {
    if (!doc || !selectedIds.length) return;
    const ok = new Set(editableZoneIds(doc, pageId));
    if (selectedIds.some((sid) => !ok.has(sid))) setSelectedIds(selectedIds.filter((sid) => ok.has(sid)));
  }, [doc, pageId, selectedIds]);
  const add = (type, at) => { const r = addZone(doc, type, pageId, at); change(r.doc); setSelectedIds([r.zone.id]); setTab('canvas'); };
  const selectPage = (pid) => { setPageId(pid); setSelectedIds([]); };

  if (layout.error) return <div className="error">{layout.error.message} · <Link to="/layouts">back to layouts</Link></div>;
  if (!layout.data || !doc) return <div className="muted">Loading…</div>;
  const dirty = JSON.stringify(doc) !== savedJson || name !== layout.data.name;
  const liveSets = (sets.data || []).filter((s) => s.ws);
  const byZone = errorsByZone(errors);
  const generalErrors = errors.filter((e) => !/zone "/.test(e));
  const tenant = session && session.tenant;
  const appChoices = (apps.data || []).map((a) => ({ id: a.app_id, name: a.name, icon: a.icon }));
  const page = pageById(doc, pageId);
  return (
    <>
      <div className="topbar">
        <h1><Link to="/layouts" className="muted">Layouts</Link> / <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Layout name" style={{ width: 260, display: 'inline-block', fontSize: 18, padding: '3px 8px' }} /> <span className="muted small">v{layout.data.version} · {pagesOf(doc).length} page(s)</span></h1>
        <div className="actions">
          <div className="editor-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'canvas'} className={tab === 'canvas' ? 'active' : ''} onClick={() => setTab('canvas')}>Canvas</button>
            <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
            <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>Advanced</button>
          </div>
          <button className="primary" disabled={!dirty || saving || errors.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save & publish'}</button>
        </div>
      </div>
      {generalErrors.length > 0 && <ul className="error" role="status">{generalErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className={'editor-grid' + (tab !== 'json' ? ' with-palette' : '')}>
        {tab !== 'json' && <div>
          <PageNavigator doc={doc} pageId={pageId} onSelect={selectPage} onChange={change} />
          {tab === 'canvas' && <Palette onAdd={(t) => add(t)} />}
        </div>}
        <div>
          {tab === 'canvas' && (
            <div className="card" ref={wrapRef}>
              <EditorToolbar doc={doc} selectedIds={selectedIds} onChange={change} onSelect={setSelectedIds} pageId={pageId} canUndo={past.current.length > 0} canRedo={future.current.length > 0} onUndo={undo} onRedo={redo} />
              <CanvasEditor doc={doc} onChange={change} selectedIds={selectedIds} onSelect={setSelectedIds} pageId={pageId} width={canvasWidth - 32} errorsByZone={byZone} onDropType={(t, at) => add(t, at)} />
            </div>)}
          {tab === 'preview' && (
            <div className="card" ref={wrapRef}>
              <div className="inline" style={{ marginBottom: 8, gap: 12 }}>
                <span className="small">Page <b>{page ? page.name || page.id : '—'}</b></span>
                <label className="inline small" style={{ color: 'var(--text)' }}><input type="checkbox" checked={fullscreenPreview} onChange={(e) => setFullscreenPreview(e.target.checked)} aria-label="Preview full-screen TV" /> full-screen TV (what the fullscreen_tv action shows)</label>
              </div>
              <LayoutPreview doc={doc} pageId={pageId} width={canvasWidth - 32} tenant={tenant} apps={appChoices} fullscreen={fullscreenPreview} />
              <div className="muted small" style={{ marginTop: 6 }}>Drawn by the TV renderer's own code with sample channels, weather and guest. The live picture is a placeholder; the first focusable element shows the focus ring.</div>
            </div>)}
          {tab === 'json' && (
            <div className="card">
              <Field label="Layout JSON (schema 2) — advanced"><textarea className="code" value={text} onChange={(e) => onText(e.target.value)} spellCheck={false} aria-label="Layout JSON" style={{ minHeight: 560 }} /></Field>
              {errors.length > 0 && <ul className="error small">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              {errors.length === 0 && dirty && <div className="muted small">Unsaved changes.</div>}
            </div>)}
        </div>
        <div>
          <div className="card"><ZonePanel doc={doc} selectedIds={selectedIds} onChange={change} onSelect={setSelectedIds} pageId={pageId} errorsByZone={byZone} apps={appChoices} /></div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Preview on a set</h3>
            <div className="row">
              <select value={previewSet} onChange={(e) => setPreviewSet(e.target.value)} aria-label="Preview set">
                <option value="">— choose a live set —</option>
                {liveSets.map((s) => <option key={s.id} value={s.id}>{s.room_number ? `Room ${s.room_number}` : s.serial} · {s.model || ''}</option>)}
              </select>
              <button disabled={!previewSet || errors.length > 0} onClick={preview} style={{ flex: '0 0 auto' }}>Preview</button>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>{liveSets.length === 0 ? 'No set is connected over WebSocket right now.' : `Pushes the whole layout and opens page “${page ? page.name || page.id : ''}”.`}</div>
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
