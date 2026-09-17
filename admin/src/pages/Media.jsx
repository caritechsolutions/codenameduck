import React, { useContext, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, patch, del } from '../api.js';
import { useAsync, useToast, Modal, Empty } from '../components/ui.jsx';
import { uploadMedia, MediaTile, ACCEPT_ALL, fmtBytes } from '../components/MediaPicker.jsx';
import { SessionCtx } from '../App.jsx';
import { timeAgo } from '../util.js';

// Media library: drag-and-drop upload, thumbnail grid, rename, delete (blocked while a layout
// or the logo uses the file — the dialog says which).
export default function Media() {
  const toast = useToast();
  const session = useContext(SessionCtx);
  const media = useAsync(() => get('/media'), []);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);      // "3 / 5"
  const [sel, setSel] = useState(null);        // selected item (detail panel)
  const [rename, setRename] = useState('');
  const [blocked, setBlocked] = useState(null); // {item, layouts, logo}
  const fileRef = useRef(null);

  async function uploadFiles(files) {
    const list = Array.from(files || []).filter((f) => f.size);
    if (!list.length) return;
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`${i + 1} / ${list.length}`);
      try { await uploadMedia(list[i]); ok++; } catch (err) { toast(`${list[i].name}: ${err.message}`, 'bad'); }
    }
    setBusy(null);
    if (ok) toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`);
    media.reload();
  }
  function onDrop(e) { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }
  function select(m) { setSel(m); setRename(m ? m.name : ''); }
  async function saveName() {
    if (!sel || !rename.trim() || rename.trim() === sel.name) return;
    try { const r = await patch(`/media/${sel.id}`, { name: rename.trim() }); setSel(r); media.reload(); toast('Renamed'); } catch (err) { toast(err.message, 'bad'); }
  }
  async function remove(m) {
    try { await del(`/media/${m.id}`); toast(`Deleted ${m.name}`); if (sel && sel.id === m.id) select(null); media.reload(); } catch (err) {
      if (err.status === 409) setBlocked({ item: m, layouts: (err.body && err.body.layouts) || [], logo: !!(err.body && err.body.logo) });
      else toast(err.message, 'bad');
    }
  }
  async function setAsLogo(m) {
    // Re-point the tenant logo at this library file (no re-upload: PATCH settings).
    try { await patch('/tenant', { settings: { logo_url: m.url } }); session.refresh(); toast('Logo updated · pushed to online sets'); } catch (err) { toast(err.message, 'bad'); }
  }
  const items = (media.data || []).filter((m) => (filter === 'all' || m.kind === filter) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const logoUrl = session && session.tenant && session.tenant.settings && session.tenant.settings.logo_url;
  const total = (media.data || []).reduce((a, m) => a + m.bytes, 0);

  return (
    <>
      <div className="topbar"><h1>Media</h1>
        <span className="muted small">{(media.data || []).length} files · {fmtBytes(total)}</span>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search media" style={{ width: 200 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Kind"><option value="all">All</option><option value="image">Images</option><option value="video">Videos</option></select>
        <label className="btn primary">{busy ? `Uploading ${busy}` : 'Upload'}<input ref={fileRef} type="file" multiple accept={ACCEPT_ALL} style={{ display: 'none' }} disabled={!!busy} onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} aria-label="Upload files" /></label>
      </div>
      <div className={'dropzone' + (drag ? ' drag' : '')} onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} data-testid="dropzone">
        <div className="muted small" style={{ textAlign: 'center', padding: '10px 0' }}>Drop images (PNG, JPG, GIF, WebP, SVG) or short MP4 clips here · up to 10 MB each · served to the TVs from this hotel's own hostname</div>
        {media.loading && !media.data ? <div className="muted">Loading…</div> : items.length === 0 ? <Empty>{(media.data || []).length ? 'Nothing matches.' : 'No media yet. Drop a file above or click Upload.'}</Empty> : (
          <div className="media-grid">
            {items.map((m) => <MediaTile key={m.id} item={m} selected={sel && sel.id === m.id} onClick={() => select(m)}>
              {logoUrl && logoUrl === m.url && <span className="pill accent media-badge">logo</span>}
            </MediaTile>)}
          </div>)}
      </div>

      {sel && (
        <div className="card media-detail" role="region" aria-label="Media details">
          <div className="inline" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div className="media-preview">{sel.kind === 'video' ? <video src={sel.url} controls muted style={{ width: '100%' }} /> : <img src={sel.url} alt="" />}</div>
            <div style={{ flex: 1 }}>
              <div className="field"><label>Name</label>
                <div className="inline"><input value={rename} onChange={(e) => setRename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }} aria-label="Media name" style={{ flex: 1 }} /><button onClick={saveName} disabled={!rename.trim() || rename.trim() === sel.name}>Rename</button></div></div>
              <table className="kv small"><tbody>
                <tr><td className="muted">URL</td><td><code>{sel.url}</code> <button className="sm ghost" onClick={() => { try { navigator.clipboard.writeText(sel.url); toast('Copied'); } catch { /* no clipboard */ } }}>Copy</button></td></tr>
                <tr><td className="muted">Type</td><td>{sel.mime}{sel.width ? ` · ${sel.width}×${sel.height}` : ''} · {fmtBytes(sel.bytes)}</td></tr>
                <tr><td className="muted">Uploaded</td><td>{timeAgo(sel.created_at)}</td></tr>
              </tbody></table>
              <div className="actions" style={{ marginTop: 10 }}>
                {sel.kind === 'image' && <button onClick={() => setAsLogo(sel)} disabled={logoUrl === sel.url}>{logoUrl === sel.url ? 'Current logo' : 'Use as hotel logo'}</button>}
                <button className="danger" onClick={() => remove(sel)}>Delete</button>
                <button className="ghost" onClick={() => select(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>)}

      {blocked && (
        <Modal title="This file is in use" onClose={() => setBlocked(null)} footer={<button onClick={() => setBlocked(null)}>OK</button>}>
          <p><b>{blocked.item.name}</b> cannot be deleted while it is referenced. Remove it from these places first:</p>
          <ul>
            {blocked.layouts.map((l) => <li key={l.id}><Link to={`/layouts/${l.id}`}>Layout “{l.name}”</Link></li>)}
            {blocked.logo && <li>The hotel logo (<Link to="/settings">Settings</Link>)</li>}
          </ul>
        </Modal>)}
    </>
  );
}
